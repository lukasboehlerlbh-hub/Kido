from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone, date, timedelta
import os, secrets, string, random
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.getenv("DB_NAME", "kido_app")
client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

AVATAR_COLORS = ["#1D9E75", "#8B5CF6", "#FB7185", "#F59E0B", "#60A5FA", "#F472B6", "#34D399", "#FCD34D"]

def serialize_doc(doc: Any) -> Any:
    if doc is None:
        return None
    if isinstance(doc, list):
        return [serialize_doc(i) for i in doc]
    if not isinstance(doc, dict):
        if isinstance(doc, ObjectId):
            return str(doc)
        if isinstance(doc, datetime):
            return doc.isoformat()
        return doc
    result = {}
    for k, v in doc.items():
        if isinstance(v, ObjectId):
            result[k] = str(v)
        elif isinstance(v, datetime):
            result[k] = v.isoformat()
        elif isinstance(v, list):
            result[k] = [serialize_doc(i) for i in v]
        elif isinstance(v, dict):
            result[k] = serialize_doc(v)
        else:
            result[k] = v
    if "_id" in result:
        result["id"] = result.pop("_id")
    return result

# ── Plan Calculation (KORRIGIERT: paarbasierte Konfliktlogik) ─────────────────

FLEX_SCORES = {"yes": 5, "rel": 3, "disc": 2, "temp": 2, "no": 1, "ext": 0}

def get_next_weekends(n=8):
    today = date.today()
    days_to_sat = (5 - today.weekday()) % 7 or 7
    next_sat = today + timedelta(days=days_to_sat)
    return [
        {
            "week_index": i,
            "date": (next_sat + timedelta(weeks=i)).isoformat(),
            "label": f"WE{i+1}",
            "week_num": (next_sat + timedelta(weeks=i)).isocalendar()[1],
            "is_even": (next_sat + timedelta(weeks=i)).isocalendar()[1] % 2 == 0
        }
        for i in range(n)
    ]

def calc_schedule(members, overrides={}):
    weekends = get_next_weekends(8)
    schedule = {}
    for m in members:
        mid = str(m.get("id") or str(m.get("_id", "")))
        logic = overrides.get(mid, m.get("current_logic", "even"))
        schedule[mid] = [w["is_even"] if logic == "even" else not w["is_even"] for w in weekends]
    return schedule

def get_effective_flex(member: dict) -> str:
    """court_strict überschreibt flex zu ext (0) – kein Wechsel möglich."""
    if member.get("court_ruling") == "court_strict":
        return "ext"
    return member.get("flex_level", "no")

def build_coparent_pairs(members, coparent_relations):
    """
    Baut Ex-Paar-Liste aus coparent_relations auf.
    Fallback auf Nachbarn wenn keine Relations vorhanden.
    """
    pairs = []
    if coparent_relations:
        for rel in coparent_relations:
            p1 = rel.get("parent1_id")
            p2 = rel.get("parent2_id")
            if p1 and p2:
                pairs.append((str(p1), str(p2)))
    else:
        # Fallback: Nachbarn als Paare (Abwärtskompatibilität)
        member_ids = [str(m.get("id") or str(m.get("_id", ""))) for m in members]
        for i in range(0, len(member_ids) - 1, 2):
            pairs.append((member_ids[i], member_ids[i + 1]))
    return pairs

def find_conflicts_by_pairs(schedule, coparent_pairs):
    """
    KORRIGIERT: Prüft Konflikte zwischen echten Ex-Paaren.
    Ein Konflikt = beide Ex-Partner wollen das gleiche Wochenende.
    """
    conflicts = []
    for (id1, id2) in coparent_pairs:
        sched1 = schedule.get(id1, [False] * 8)
        sched2 = schedule.get(id2, [False] * 8)
        for w in range(8):
            if sched1[w] and sched2[w]:
                conflicts.append({"pair": (id1, id2), "week": w})
    return conflicts

def compute_blockers_by_pairs(members, pairs, schedule):
    """
    Blocker = Personen in einem Konflikt-Paar mit Flex-Score <= 1.
    """
    conflicts = find_conflicts_by_pairs(schedule, pairs)
    conflicted_ids = set()
    for c in conflicts:
        conflicted_ids.add(c["pair"][0])
        conflicted_ids.add(c["pair"][1])
    blockers = []
    for m in members:
        mid = str(m.get("id") or str(m.get("_id", "")))
        if mid in conflicted_ids:
            if FLEX_SCORES.get(get_effective_flex(m), 0) <= 1:
                blockers.append(mid)
    return blockers

def find_partner_conflicts(schedule, partner_pairs, min_shared_free=2):
    """
    NEU: Prüft ob aktuelle Paare genügend gemeinsame freie Wochenenden haben.
    
    Ein "Partner-Konflikt" entsteht wenn zwei aktuelle Partner weniger als
    min_shared_free gemeinsame freie Wochenenden haben.
    
    Frei = schedule[id][week] == False (keine Kinder an diesem WE)
    """
    conflicts = []
    for (id1, id2) in partner_pairs:
        sched1 = schedule.get(id1, [False] * 8)
        sched2 = schedule.get(id2, [False] * 8)
        # Gemeinsame freie WE = beide haben KEINE Kinder
        shared_free = sum(1 for w in range(8) if not sched1[w] and not sched2[w])
        if shared_free < min_shared_free:
            conflicts.append({
                "pair": (id1, id2),
                "type": "partner",
                "shared_free": shared_free,
                "needed": min_shared_free
            })
    return conflicts


def build_partner_pairs(partner_relations):
    """Baut Paar-Liste aus partner_relations auf."""
    pairs = []
    for rel in (partner_relations or []):
        p1 = rel.get("partner1_id")
        p2 = rel.get("partner2_id")
        if p1 and p2:
            pairs.append((str(p1), str(p2)))
    return pairs


def find_all_conflicts(schedule, coparent_pairs, partner_pairs):
    """Kombiniert Ex-Paar und Partner-Konflikte."""
    ex_conflicts = find_conflicts_by_pairs(schedule, coparent_pairs)
    partner_conflicts = find_partner_conflicts(schedule, partner_pairs)
    return ex_conflicts + partner_conflicts


def calculate_plan(members, coparent_relations=None, partner_relations=None, rejected_pivot_ids=None):
    """
    ERWEITERTER Hauptalgorithmus.
    
    Berücksichtigt ZWEI Konflikttypen:
    - Typ A (Ex-Konflikt): Beide Ex-Partner wollen das gleiche WE mit Kindern
    - Typ B (Partner-Konflikt): Aktuelle Partner haben zu wenig gemeinsame freie WE
    
    Die Lösung muss beide Konflikttypen auflösen.
    """
    rejected_pivot_ids = rejected_pivot_ids or []
    coparent_relations = coparent_relations or []
    partner_relations = partner_relations or []

    weekends = get_next_weekends(8)

    # Paar-Listen aufbauen
    coparent_pairs = build_coparent_pairs(members, coparent_relations)
    partner_pairs = build_partner_pairs(partner_relations)

    # Aktuellen Plan berechnen
    current_schedule = calc_schedule(members)

    # Alle Konflikte prüfen (Ex + Partner)
    all_conflicts = find_all_conflicts(current_schedule, coparent_pairs, partner_pairs)

    if not all_conflicts:
        return {
            "type": "clean", "stage": "1_clean",
            "pivot_id": None, "pivot_name": None, "new_logic": None,
            "schedule": current_schedule, "proposed_schedule": current_schedule,
            "weekends": weekends, "blockers": [], "subgroups": None,
            "conflict_details": [],
            "kido_message": KIDO_MSG["clean"]
        }

    # IDs aller Personen die in einem Konflikt involviert sind
    conflicted_ids = set()
    for c in all_conflicts:
        conflicted_ids.add(c["pair"][0])
        conflicted_ids.add(c["pair"][1])

    # Kandidaten nach Flex-Score sortieren (höchster zuerst)
    sorted_members = sorted(
        members,
        key=lambda m: FLEX_SCORES.get(get_effective_flex(m), 0),
        reverse=True
    )

    for candidate in sorted_members:
        cid = str(candidate.get("id") or str(candidate.get("_id", "")))

        # Zu wenig flexibel → überspringen
        if FLEX_SCORES.get(get_effective_flex(candidate), 0) <= 1:
            continue
        # Bereits abgelehnt → überspringen
        if cid in rejected_pivot_ids:
            continue
        # Nicht in einem Konflikt involviert → muss nicht wechseln
        if cid not in conflicted_ids:
            continue

        # Logikwechsel testen
        new_logic = "odd" if candidate.get("current_logic", "even") == "even" else "even"
        trial_schedule = calc_schedule(members, {cid: new_logic})
        trial_conflicts = find_all_conflicts(trial_schedule, coparent_pairs, partner_pairs)

        if not trial_conflicts:
            # Lösung gefunden!
            is_ungern = candidate.get("flex_level") in ["rel", "temp"]
            stage = "2_ungern" if is_ungern else "1_clean"
            return {
                "type": "ungern" if is_ungern else "clean",
                "stage": stage,
                "pivot_id": cid,
                "pivot_name": candidate.get("user_name", ""),
                "new_logic": new_logic,
                "schedule": current_schedule,
                "proposed_schedule": trial_schedule,
                "weekends": weekends,
                "blockers": [], "subgroups": None,
                "conflict_details": all_conflicts,
                "kido_message": KIDO_MSG["ungern"] if is_ungern else KIDO_MSG["clean"]
            }

    # Keine Einzellösung → Stufe 3a
    blockers = compute_blockers_by_pairs(members, coparent_pairs, current_schedule)
    # Auch Partner-Konflikte als Blocker berücksichtigen
    for c in find_partner_conflicts(current_schedule, partner_pairs):
        for pid in c["pair"]:
            m = next((m for m in members if str(m.get("id") or str(m.get("_id", ""))) == pid), None)
            if m and FLEX_SCORES.get(get_effective_flex(m), 0) <= 1 and pid not in blockers:
                blockers.append(pid)

    return {
        "type": "blocked", "stage": "3a_blockers",
        "pivot_id": None, "pivot_name": None, "new_logic": None,
        "schedule": current_schedule, "proposed_schedule": current_schedule,
        "weekends": weekends, "blockers": blockers, "subgroups": None,
        "conflict_details": all_conflicts,
        "kido_message": KIDO_MSG["blocked_3a"]
    }

def compute_subgroups(members, coparent_relations=None):
    """
    Stufe 3b: Subgruppen basierend auf Ex-Paaren.
    Paare einig → gemeinsame Gruppe. Konflikt → getrennte Gruppen.
    """
    if not members:
        return []
    pairs = build_coparent_pairs(members, coparent_relations or [])
    member_map = {str(m.get("id") or str(m.get("_id", ""))): m for m in members}
    groups = []
    processed = set()

    for (id1, id2) in pairs:
        m1 = member_map.get(id1)
        m2 = member_map.get(id2)
        if not m1 or not m2:
            continue
        logic1 = m1.get("current_logic", "even")
        logic2 = m2.get("current_logic", "even")
        if logic1 == logic2:
            # Konflikt → getrennte Gruppen
            for mid, m, logic in [(id1, m1, logic1), (id2, m2, logic2)]:
                if mid not in processed:
                    groups.append([{"id": mid, "name": m.get("user_name", ""), "color": m.get("avatar_color", "#1D9E75"), "logic": logic}])
                    processed.add(mid)
        else:
            group = []
            for mid, m, logic in [(id1, m1, logic1), (id2, m2, logic2)]:
                if mid not in processed:
                    group.append({"id": mid, "name": m.get("user_name", ""), "color": m.get("avatar_color", "#1D9E75"), "logic": logic})
                    processed.add(mid)
            if group:
                groups.append(group)

    # Restliche Members ohne definiertes Paar
    for m in members:
        mid = str(m.get("id") or str(m.get("_id", "")))
        if mid not in processed:
            groups.append([{"id": mid, "name": m.get("user_name", ""), "color": m.get("avatar_color", "#1D9E75"), "logic": m.get("current_logic", "even")}])
    return groups

KIDO_MSG = {
    "clean": "Liebe Elternkette – ich habe eine Lösung gefunden, die für alle passen sollte. Bitte schaut euch den Vorschlag an.",
    "ungern": "Kido hat eine mögliche Lösung gefunden – aber sie hängt an einer Person. Wenn diese Person bereit ist, löst das den Konflikt für die gesamte Kette.",
    "ungern_private": "Die ganze Kette hofft gerade auf dich. Mit deinem Wechsel auf {logic} Wochenenden wäre der Konflikt für alle gelöst. Möchtest du helfen?",
    "ungern_reconsider": "Ich weiß, es ist nicht einfach. Möchtest du deine Entscheidung vielleicht nochmal überdenken? Deine Kinder und die ganze Kette würden es dir danken.",
    "ungern_accepted_public": "Herzlichen Dank! Dank des Entgegenkommens von {name} ist der Wochenendplan für alle gelöst.",
    "blocked_3a": "Kido hat alle Möglichkeiten durchgespielt. Einige Personen halten gerade an ihrer Position fest und blockieren eine Lösung.",
    "blocked_3a_private": "Du hältst gerade eine Lösung für alle zurück. Bitte denke im Sinne deiner Kinder darüber nach, ob du deine Haltung überdenken kannst.",
    "blocked_3b": "Es gibt unauflösbare Blockaden. Kido schlägt Subgruppen mit unterschiedlichen Logiken vor. Einige Paare sind dabei suboptimal gestellt.",
    "accepted": "Herzlichen Dank an alle. Ihr habt gemeinsam eine Lösung gefunden – das zeigt, dass ihr das Beste für eure Kinder wollt.",
}

def get_kido_ai_response(text: str) -> str:
    t = text.lower()
    if any(w in t for w in ["wochenende","plan","kalender"]):
        return "Für den Wochenendplan schau dir die 'Wochenenden'-Ansicht an. Dort berechne ich einen optimalen Plan für die ganze Kette."
    if any(w in t for w in ["ferien","urlaub","sommer","herbst","weihnacht"]):
        return "Für die Ferienplanung gehe zu 'Ferien'. Du kannst dort Wünsche erfassen und mit der Kette teilen."
    if any(w in t for w in ["konflikt","problem","streit","einig"]):
        return "Konflikte sind normal. Ich versuche immer, die Person mit der meisten Flexibilität zu finden, damit eine Lösung für alle möglich wird."
    return random.choice([
        "Ich verstehe, dass diese Situation herausfordernd ist. Lass uns gemeinsam eine Lösung finden.",
        "Das Wichtigste ist das Wohlbefinden eurer Kinder. Wenn beide Elternteile kooperieren, profitieren die Kinder am meisten.",
        "Kinder profitieren am meisten, wenn ihre Eltern genug Raum haben, um Energie zu tanken.",
        "Ich bin hier, um zu helfen – nicht zu urteilen. Was beschäftigt dich am meisten?",
        "Ein ausgeglichenes Wochenende ist kein Luxus – es ist das Fundament.",
    ])

# ── Swiss Holidays ─────────────────────────────────────────────────────────────

SWISS_HOLIDAYS = {
    "ZH": {
        2026: [{"type":"fruehling","label":"Frühlingsferien","date_from":"2026-04-06","date_to":"2026-04-17"},
               {"type":"sommer","label":"Sommerferien","date_from":"2026-07-13","date_to":"2026-08-16"},
               {"type":"herbst","label":"Herbstferien","date_from":"2026-10-03","date_to":"2026-10-18"},
               {"type":"weihnachten","label":"Weihnachtsferien","date_from":"2026-12-21","date_to":"2027-01-03"}],
        2027: [{"type":"fruehling","label":"Frühlingsferien","date_from":"2027-03-29","date_to":"2027-04-09"},
               {"type":"sommer","label":"Sommerferien","date_from":"2027-07-12","date_to":"2027-08-15"},
               {"type":"herbst","label":"Herbstferien","date_from":"2027-10-09","date_to":"2027-10-24"},
               {"type":"weihnachten","label":"Weihnachtsferien","date_from":"2027-12-22","date_to":"2028-01-02"}],
        2028: [{"type":"fruehling","label":"Frühlingsferien","date_from":"2028-04-10","date_to":"2028-04-21"},
               {"type":"sommer","label":"Sommerferien","date_from":"2028-07-10","date_to":"2028-08-13"},
               {"type":"herbst","label":"Herbstferien","date_from":"2028-10-07","date_to":"2028-10-22"},
               {"type":"weihnachten","label":"Weihnachtsferien","date_from":"2028-12-22","date_to":"2029-01-06"}],
    },
    "BE": {
        2026: [{"type":"fruehling","label":"Frühlingsferien","date_from":"2026-04-11","date_to":"2026-04-25"},
               {"type":"sommer","label":"Sommerferien","date_from":"2026-07-13","date_to":"2026-08-16"},
               {"type":"herbst","label":"Herbstferien","date_from":"2026-10-10","date_to":"2026-10-25"},
               {"type":"weihnachten","label":"Weihnachtsferien","date_from":"2026-12-21","date_to":"2027-01-03"}],
        2027: [{"type":"fruehling","label":"Frühlingsferien","date_from":"2027-04-03","date_to":"2027-04-17"},
               {"type":"sommer","label":"Sommerferien","date_from":"2027-07-12","date_to":"2027-08-15"},
               {"type":"herbst","label":"Herbstferien","date_from":"2027-10-16","date_to":"2027-10-31"},
               {"type":"weihnachten","label":"Weihnachtsferien","date_from":"2027-12-22","date_to":"2028-01-02"}],
        2028: [{"type":"fruehling","label":"Frühlingsferien","date_from":"2028-04-06","date_to":"2028-04-20"},
               {"type":"sommer","label":"Sommerferien","date_from":"2028-07-10","date_to":"2028-08-13"},
               {"type":"herbst","label":"Herbstferien","date_from":"2028-10-14","date_to":"2028-10-29"},
               {"type":"weihnachten","label":"Weihnachtsferien","date_from":"2028-12-22","date_to":"2029-01-06"}],
    },
    "SG": {
        2026: [{"type":"fruehling","label":"Frühlingsferien","date_from":"2026-04-13","date_to":"2026-04-24"},
               {"type":"sommer","label":"Sommerferien","date_from":"2026-07-06","date_to":"2026-08-09"},
               {"type":"herbst","label":"Herbstferien","date_from":"2026-10-03","date_to":"2026-10-18"},
               {"type":"weihnachten","label":"Weihnachtsferien","date_from":"2026-12-19","date_to":"2027-01-03"}],
        2027: [{"type":"fruehling","label":"Frühlingsferien","date_from":"2027-04-12","date_to":"2027-04-23"},
               {"type":"sommer","label":"Sommerferien","date_from":"2027-07-05","date_to":"2027-08-08"},
               {"type":"herbst","label":"Herbstferien","date_from":"2027-10-09","date_to":"2027-10-24"},
               {"type":"weihnachten","label":"Weihnachtsferien","date_from":"2027-12-20","date_to":"2028-01-02"}],
        2028: [{"type":"fruehling","label":"Frühlingsferien","date_from":"2028-04-10","date_to":"2028-04-21"},
               {"type":"sommer","label":"Sommerferien","date_from":"2028-07-03","date_to":"2028-08-06"},
               {"type":"herbst","label":"Herbstferien","date_from":"2028-10-07","date_to":"2028-10-22"},
               {"type":"weihnachten","label":"Weihnachtsferien","date_from":"2028-12-21","date_to":"2029-01-05"}],
    },
    "AG": {
        2026: [{"type":"fruehling","label":"Frühlingsferien","date_from":"2026-04-18","date_to":"2026-05-02"},
               {"type":"sommer","label":"Sommerferien","date_from":"2026-07-06","date_to":"2026-08-16"},
               {"type":"herbst","label":"Herbstferien","date_from":"2026-10-03","date_to":"2026-10-18"},
               {"type":"weihnachten","label":"Weihnachtsferien","date_from":"2026-12-21","date_to":"2027-01-03"}],
        2027: [{"type":"fruehling","label":"Frühlingsferien","date_from":"2027-04-19","date_to":"2027-05-03"},
               {"type":"sommer","label":"Sommerferien","date_from":"2027-07-05","date_to":"2027-08-15"},
               {"type":"herbst","label":"Herbstferien","date_from":"2027-10-09","date_to":"2027-10-24"},
               {"type":"weihnachten","label":"Weihnachtsferien","date_from":"2027-12-22","date_to":"2028-01-02"}],
        2028: [{"type":"fruehling","label":"Frühlingsferien","date_from":"2028-04-17","date_to":"2028-05-01"},
               {"type":"sommer","label":"Sommerferien","date_from":"2028-07-03","date_to":"2028-08-13"},
               {"type":"herbst","label":"Herbstferien","date_from":"2028-10-07","date_to":"2028-10-22"},
               {"type":"weihnachten","label":"Weihnachtsferien","date_from":"2028-12-22","date_to":"2029-01-06"}],
    },
    "BS": {
        2026: [{"type":"fruehling","label":"Frühlingsferien","date_from":"2026-04-13","date_to":"2026-04-23"},
               {"type":"sommer","label":"Sommerferien","date_from":"2026-07-06","date_to":"2026-08-16"},
               {"type":"herbst","label":"Herbstferien","date_from":"2026-10-03","date_to":"2026-10-18"},
               {"type":"weihnachten","label":"Weihnachtsferien","date_from":"2026-12-21","date_to":"2027-01-03"}],
        2027: [{"type":"fruehling","label":"Frühlingsferien","date_from":"2027-04-12","date_to":"2027-04-22"},
               {"type":"sommer","label":"Sommerferien","date_from":"2027-07-05","date_to":"2027-08-15"},
               {"type":"herbst","label":"Herbstferien","date_from":"2027-10-09","date_to":"2027-10-24"},
               {"type":"weihnachten","label":"Weihnachtsferien","date_from":"2027-12-22","date_to":"2028-01-02"}],
        2028: [{"type":"fruehling","label":"Frühlingsferien","date_from":"2028-04-10","date_to":"2028-04-20"},
               {"type":"sommer","label":"Sommerferien","date_from":"2028-07-03","date_to":"2028-08-13"},
               {"type":"herbst","label":"Herbstferien","date_from":"2028-10-07","date_to":"2028-10-22"},
               {"type":"weihnachten","label":"Weihnachtsferien","date_from":"2028-12-22","date_to":"2029-01-05"}],
    },
}

# ── Request Models ─────────────────────────────────────────────────────────────

class CreateChainRequest(BaseModel):
    user_name: str
    user_phone: str
    avatar_color: str
    chain_name: Optional[str] = None

class AcceptInvitationRequest(BaseModel):
    user_name: str
    user_phone: str
    avatar_color: str

class PreferencesRequest(BaseModel):
    court_ruling: str
    current_logic: str
    flex_level: str
    flex_duration: Optional[int] = None
    external_type: Optional[str] = None
    external_level: Optional[int] = None

class CreateInvitationRequest(BaseModel):
    chain_id: str
    invited_by_id: str
    phone_number: str

class HolidayWishRequest(BaseModel):
    member_id: str
    chain_id: str
    year: int
    period_type: str
    period_label: str
    title: Optional[str] = None
    date_from: str
    date_to: str
    wish: str
    wish_target_member_id: Optional[str] = None
    children_names: Optional[List[str]] = None
    is_shared: bool = False
    note: Optional[str] = None

class UpdateHolidayWishRequest(BaseModel):
    wish: Optional[str] = None
    wish_target_member_id: Optional[str] = None
    status: Optional[str] = None
    is_shared: Optional[bool] = None
    note: Optional[str] = None
    title: Optional[str] = None
    children_names: Optional[List[str]] = None
    partner_status: Optional[str] = None

class SendMessageRequest(BaseModel):
    sender_id: str
    chain_id: Optional[str] = None
    recipient_id: Optional[str] = None
    text: str
    is_kido_message: bool = False
    was_moderated: bool = False
    original_text: Optional[str] = None

class VoteRequest(BaseModel):
    member_id: str
    vote: str

# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {"status": "ok"}

# Users
@app.post("/api/users")
async def create_user(data: dict):
    user = {"name": data["name"], "phone": data["phone"],
            "avatar_color": data.get("avatar_color", AVATAR_COLORS[0]),
            "is_host": data.get("is_host", False),
            "created_date": datetime.now(timezone.utc)}
    result = await db.users.insert_one(user)
    user["_id"] = result.inserted_id
    return serialize_doc(user)

@app.get("/api/users/phone/{phone}")
async def get_user_by_phone(phone: str):
    user = await db.users.find_one({"phone": phone})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return serialize_doc(user)

@app.get("/api/users/{user_id}")
async def get_user(user_id: str):
    if not ObjectId.is_valid(user_id):
        raise HTTPException(status_code=400, detail="Invalid user ID")
    user = await db.users.find_one({"_id": ObjectId(user_id)})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return serialize_doc(user)

@app.put("/api/users/{user_id}")
async def update_user(user_id: str, data: dict):
    if not ObjectId.is_valid(user_id):
        raise HTTPException(status_code=400, detail="Invalid user ID")
    allowed = {k: v for k, v in data.items() if k in ["name","phone","avatar_color","kanton"]}
    await db.users.update_one({"_id": ObjectId(user_id)}, {"$set": allowed})
    user = await db.users.find_one({"_id": ObjectId(user_id)})
    return serialize_doc(user)

# Chains
@app.post("/api/chains")
async def create_chain(req: CreateChainRequest):
    now = datetime.now(timezone.utc)
    user = {"name": req.user_name, "phone": req.user_phone, "avatar_color": req.avatar_color,
            "is_host": True, "created_date": now}
    user_result = await db.users.insert_one(user)
    user_id = str(user_result.inserted_id)
    chain = {"name": req.chain_name or f"{req.user_name}s Kette", "host_id": user_id,
             "status": "active", "created_date": now}
    chain_result = await db.chains.insert_one(chain)
    chain_id = str(chain_result.inserted_id)
    member = {"user_id": user_id, "chain_id": chain_id, "position": 1, "user_name": req.user_name,
              "avatar_color": req.avatar_color, "court_ruling": "no_court", "current_logic": "even",
              "flex_level": "disc", "is_host": True, "joined_date": now}
    member_result = await db.chain_members.insert_one(member)
    member_id = str(member_result.inserted_id)
    return {"user_id": user_id, "chain_id": chain_id, "member_id": member_id,
            "chain_name": chain["name"], "user_name": req.user_name, "avatar_color": req.avatar_color}

@app.get("/api/chains/{chain_id}")
async def get_chain(chain_id: str):
    if not ObjectId.is_valid(chain_id):
        raise HTTPException(status_code=400, detail="Invalid chain ID")
    chain = await db.chains.find_one({"_id": ObjectId(chain_id)})
    if not chain:
        raise HTTPException(status_code=404, detail="Chain not found")
    members = await db.chain_members.find({"chain_id": chain_id}).sort("position", 1).to_list(20)
    result = serialize_doc(chain)
    result["members"] = [serialize_doc(m) for m in members]
    return result

# Invitations
@app.post("/api/invitations")
async def create_invitation(req: CreateInvitationRequest):
    token = "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(8))
    inv = {"chain_id": req.chain_id, "invited_by_id": req.invited_by_id,
           "phone_number": req.phone_number, "token": token,
           "status": "sent", "sent_date": datetime.now(timezone.utc)}
    result = await db.invitations.insert_one(inv)
    inv["_id"] = result.inserted_id
    return serialize_doc(inv)

@app.get("/api/invitations/{token}")
async def get_invitation(token: str):
    inv = await db.invitations.find_one({"token": token})
    if not inv:
        raise HTTPException(status_code=404, detail="Invitation not found")
    chain = await db.chains.find_one({"_id": ObjectId(inv["chain_id"])})
    result = serialize_doc(inv)
    if chain:
        result["chain_name"] = chain.get("name", "")
    return result

@app.post("/api/invitations/{token}/accept")
async def accept_invitation(token: str, req: AcceptInvitationRequest):
    inv = await db.invitations.find_one({"token": token, "status": "sent"})
    if not inv:
        raise HTTPException(status_code=404, detail="Invalid or expired invitation")
    now = datetime.now(timezone.utc)
    chain_id = inv["chain_id"]
    count = await db.chain_members.count_documents({"chain_id": chain_id})
    avatar_color = req.avatar_color or AVATAR_COLORS[count % len(AVATAR_COLORS)]
    user = {"name": req.user_name, "phone": req.user_phone, "avatar_color": avatar_color,
            "is_host": False, "created_date": now}
    user_result = await db.users.insert_one(user)
    user_id = str(user_result.inserted_id)
    member = {"user_id": user_id, "chain_id": chain_id, "position": count + 1,
              "user_name": req.user_name, "avatar_color": avatar_color,
              "court_ruling": "no_court", "current_logic": "even", "flex_level": "disc",
              "is_host": False, "invited_by": str(inv["invited_by_id"]), "joined_date": now}
    member_result = await db.chain_members.insert_one(member)
    member_id = str(member_result.inserted_id)
    await db.invitations.update_one({"_id": inv["_id"]},
        {"$set": {"status": "accepted", "accepted_date": now, "accepted_user_id": user_id}})
    chain = await db.chains.find_one({"_id": ObjectId(chain_id)})
    return {"user_id": user_id, "chain_id": chain_id, "member_id": member_id,
            "chain_name": chain.get("name","") if chain else "", "user_name": req.user_name,
            "avatar_color": avatar_color}

# Chain Members
@app.put("/api/chain-members/{member_id}/preferences")
async def update_preferences(member_id: str, req: PreferencesRequest):
    if not ObjectId.is_valid(member_id):
        raise HTTPException(status_code=400, detail="Invalid member ID")
    upd = {"court_ruling": req.court_ruling, "current_logic": req.current_logic, "flex_level": req.flex_level}
    if req.flex_duration is not None:
        upd["flex_duration"] = req.flex_duration
    if req.external_type is not None:
        upd["external_type"] = req.external_type
    if req.external_level is not None:
        upd["external_level"] = req.external_level
    await db.chain_members.update_one({"_id": ObjectId(member_id)}, {"$set": upd})
    m = await db.chain_members.find_one({"_id": ObjectId(member_id)})
    return serialize_doc(m)

@app.get("/api/chain-members/{member_id}")
async def get_member(member_id: str):
    if not ObjectId.is_valid(member_id):
        raise HTTPException(status_code=400, detail="Invalid member ID")
    m = await db.chain_members.find_one({"_id": ObjectId(member_id)})
    if not m:
        raise HTTPException(status_code=404, detail="Member not found")
    return serialize_doc(m)

# Weekend Plans
@app.get("/api/chains/{chain_id}/weekend-plan")
async def get_weekend_plan(chain_id: str):
    plan = await db.weekend_plans.find_one({"chain_id": chain_id}, sort=[("created_date", -1)])
    if not plan:
        return None
    plan_data = serialize_doc(plan)
    votes = await db.plan_votes.find({"plan_id": str(plan["_id"])}).to_list(20)
    plan_data["votes"] = [serialize_doc(v) for v in votes]
    return plan_data

@app.post("/api/chains/{chain_id}/calculate-plan")
async def calculate_weekend_plan(chain_id: str):
    members = await db.chain_members.find({"chain_id": chain_id}).sort("position", 1).to_list(20)
    if not members:
        raise HTTPException(status_code=404, detail="No members found")
    members_data = [serialize_doc(m) for m in members]

    # Beziehungen aus DB laden
    coparent_rels = await db.coparent_relations.find({"chain_id": chain_id}).to_list(50)
    coparent_rels_data = [serialize_doc(r) for r in coparent_rels]
    partner_rels = await db.partner_relations.find({"chain_id": chain_id}).to_list(50)
    partner_rels_data = [serialize_doc(r) for r in partner_rels]

    result = calculate_plan(members_data, coparent_relations=coparent_rels_data, partner_relations=partner_rels_data)
    subgroups = compute_subgroups(members_data, coparent_relations=coparent_rels_data) if result.get("stage") == "3a_blockers" else None

    plan = {"chain_id": chain_id, "status": "proposed",
            "proposal_type": result["type"],
            "escalation_stage": result.get("stage", "1_clean"),
            "rejected_pivot_ids": [],
            "reconsider_count": {},
            "blockers": result.get("blockers", []),
            "subgroups": None,
            "pivot_member_id": result.get("pivot_id"),
            "pivot_member_name": result.get("pivot_name"),
            "pivot_new_logic": result.get("new_logic"),
            "schedule": result["schedule"],
            "proposed_schedule": result["proposed_schedule"],
            "weekends": result["weekends"],
            "kido_message": result["kido_message"],
            "created_date": datetime.now(timezone.utc)}

    plan_result = await db.weekend_plans.insert_one(plan)
    plan_id = str(plan_result.inserted_id)

    stage = result.get("stage", "1_clean")
    current_sched = result["schedule"]
    proposed_sched = result["proposed_schedule"]

    for m in members_data:
        mid = m["id"]
        changes = current_sched.get(mid) != proposed_sched.get(mid)
        if stage == "2_ungern":
            is_active = mid == result.get("pivot_id")
        elif stage == "3a_blockers":
            is_active = mid in result.get("blockers", [])
        else:
            is_active = True
        vote = {"plan_id": plan_id, "member_id": mid, "member_name": m["user_name"],
                "vote": "pending" if is_active else "na",
                "is_active": is_active,
                "logic_changes": changes,
                "created_date": datetime.now(timezone.utc)}
        await db.plan_votes.insert_one(vote)

    plan["_id"] = plan_result.inserted_id
    plan_data = serialize_doc(plan)
    votes = await db.plan_votes.find({"plan_id": plan_id}).to_list(20)
    plan_data["votes"] = [serialize_doc(v) for v in votes]
    plan_data["subgroups_preview"] = subgroups
    return plan_data

@app.post("/api/weekend-plans/{plan_id}/reconsider")
async def reconsider_plan(plan_id: str):
    if not ObjectId.is_valid(plan_id):
        raise HTTPException(status_code=400, detail="Invalid plan ID")
    plan = await db.weekend_plans.find_one({"_id": ObjectId(plan_id)})
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    pivot = plan.get("pivot_member_id")
    if not pivot:
        raise HTTPException(status_code=400, detail="No pivot to reconsider")
    rc = plan.get("reconsider_count") or {}
    rc[pivot] = rc.get(pivot, 0) + 1
    await db.plan_votes.update_one(
        {"plan_id": plan_id, "member_id": pivot},
        {"$set": {"vote": "pending", "is_active": True}})
    await db.weekend_plans.update_one(
        {"_id": ObjectId(plan_id)},
        {"$set": {"reconsider_count": rc, "kido_message": KIDO_MSG["ungern_reconsider"]}})
    updated = await db.weekend_plans.find_one({"_id": ObjectId(plan_id)})
    result = serialize_doc(updated)
    votes = await db.plan_votes.find({"plan_id": plan_id}).to_list(20)
    result["votes"] = [serialize_doc(v) for v in votes]
    return result

@app.post("/api/weekend-plans/{plan_id}/try-next-pivot")
async def try_next_pivot(plan_id: str):
    if not ObjectId.is_valid(plan_id):
        raise HTTPException(status_code=400, detail="Invalid plan ID")
    plan = await db.weekend_plans.find_one({"_id": ObjectId(plan_id)})
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    chain_id = plan["chain_id"]
    rejected = list(plan.get("rejected_pivot_ids") or [])
    if plan.get("pivot_member_id") and plan["pivot_member_id"] not in rejected:
        rejected.append(plan["pivot_member_id"])

    members = await db.chain_members.find({"chain_id": chain_id}).sort("position", 1).to_list(20)
    members_data = [serialize_doc(m) for m in members]

    # Beziehungen aus DB laden
    coparent_rels = await db.coparent_relations.find({"chain_id": chain_id}).to_list(50)
    coparent_rels_data = [serialize_doc(r) for r in coparent_rels]
    partner_rels = await db.partner_relations.find({"chain_id": chain_id}).to_list(50)
    partner_rels_data = [serialize_doc(r) for r in partner_rels]

    result = calculate_plan(members_data, coparent_relations=coparent_rels_data, partner_relations=partner_rels_data, rejected_pivot_ids=rejected)
    now = datetime.now(timezone.utc)
    subgroups = compute_subgroups(members_data, coparent_relations=coparent_rels_data) if result.get("stage") == "3a_blockers" else None

    new_plan = {"chain_id": chain_id, "status": "proposed",
                "proposal_type": result["type"],
                "escalation_stage": result.get("stage", "1_clean"),
                "rejected_pivot_ids": rejected,
                "reconsider_count": {},
                "blockers": result.get("blockers", []),
                "subgroups": None,
                "pivot_member_id": result.get("pivot_id"),
                "pivot_member_name": result.get("pivot_name"),
                "pivot_new_logic": result.get("new_logic"),
                "schedule": result["schedule"],
                "proposed_schedule": result["proposed_schedule"],
                "weekends": result["weekends"],
                "kido_message": result["kido_message"],
                "created_date": now}

    res = await db.weekend_plans.insert_one(new_plan)
    new_id = str(res.inserted_id)
    stage = result.get("stage", "1_clean")
    cur_s = result["schedule"]
    prop_s = result["proposed_schedule"]

    for m in members_data:
        mid = m["id"]
        changes = cur_s.get(mid) != prop_s.get(mid)
        if stage == "2_ungern":
            is_active = mid == result.get("pivot_id")
        elif stage == "3a_blockers":
            is_active = mid in result.get("blockers", [])
        else:
            is_active = True
        await db.plan_votes.insert_one({"plan_id": new_id, "member_id": mid,
                                        "member_name": m["user_name"],
                                        "vote": "pending" if is_active else "na",
                                        "is_active": is_active,
                                        "logic_changes": changes,
                                        "created_date": now})
    new_plan["_id"] = res.inserted_id
    data = serialize_doc(new_plan)
    votes = await db.plan_votes.find({"plan_id": new_id}).to_list(20)
    data["votes"] = [serialize_doc(v) for v in votes]
    data["subgroups_preview"] = subgroups
    return data

@app.post("/api/weekend-plans/{plan_id}/escalate-3b")
async def escalate_to_3b(plan_id: str):
    if not ObjectId.is_valid(plan_id):
        raise HTTPException(status_code=400, detail="Invalid plan ID")
    plan = await db.weekend_plans.find_one({"_id": ObjectId(plan_id)})
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    chain_id = plan["chain_id"]
    members = await db.chain_members.find({"chain_id": chain_id}).sort("position", 1).to_list(20)
    members_data = [serialize_doc(m) for m in members]

    # Beziehungen aus DB laden
    coparent_rels = await db.coparent_relations.find({"chain_id": chain_id}).to_list(50)
    coparent_rels_data = [serialize_doc(r) for r in coparent_rels]

    subgroups = compute_subgroups(members_data, coparent_relations=coparent_rels_data)
    await db.weekend_plans.update_one({"_id": ObjectId(plan_id)},
        {"$set": {"escalation_stage": "3b_subgroups", "subgroups": subgroups, "kido_message": KIDO_MSG["blocked_3b"]}})
    await db.plan_votes.update_many({"plan_id": plan_id}, {"$set": {"vote": "pending", "is_active": True}})
    updated = await db.weekend_plans.find_one({"_id": ObjectId(plan_id)})
    data = serialize_doc(updated)
    votes = await db.plan_votes.find({"plan_id": plan_id}).to_list(20)
    data["votes"] = [serialize_doc(v) for v in votes]
    return data

@app.post("/api/weekend-plans/{plan_id}/vote")
async def vote_plan(plan_id: str, req: VoteRequest):
    if not ObjectId.is_valid(plan_id):
        raise HTTPException(status_code=400, detail="Invalid plan ID")
    await db.plan_votes.update_one({"plan_id": plan_id, "member_id": req.member_id},
        {"$set": {"vote": req.vote, "voted_date": datetime.now(timezone.utc)}})
    votes = await db.plan_votes.find({"plan_id": plan_id}).to_list(20)
    active_votes = [v for v in votes if v.get("is_active", True)]
    required_votes = [v for v in votes if v.get("logic_changes", False) and v.get("is_active", True)]
    all_voted = all(v["vote"] != "pending" for v in active_votes)
    if all_voted:
        any_declined = any(v["vote"] == "declined" for v in active_votes)
        all_required_accepted = all(v["vote"] == "accepted" for v in required_votes) if required_votes else True
        all_accepted = (not any_declined) and all_required_accepted
        new_status = "accepted" if all_accepted else "partial"
        await db.weekend_plans.update_one({"_id": ObjectId(plan_id)},
            {"$set": {"status": new_status, "resolved_date": datetime.now(timezone.utc)}})
        if all_accepted:
            plan = await db.weekend_plans.find_one({"_id": ObjectId(plan_id)})
            if plan and plan.get("pivot_member_id"):
                await db.chain_members.update_one(
                    {"_id": ObjectId(plan["pivot_member_id"])},
                    {"$set": {"current_logic": plan["pivot_new_logic"]}})
            if plan and plan.get("escalation_stage") == "2_ungern":
                await db.weekend_plans.update_one({"_id": ObjectId(plan_id)},
                    {"$set": {"kido_message": KIDO_MSG["ungern_accepted_public"].format(name=plan.get("pivot_member_name",""))}})
    plan = await db.weekend_plans.find_one({"_id": ObjectId(plan_id)})
    result = serialize_doc(plan)
    result["votes"] = [serialize_doc(v) for v in votes]
    return result

# Holiday Wishes
@app.get("/api/chains/{chain_id}/holiday-wishes")
async def get_holiday_wishes(chain_id: str, year: Optional[int] = None, viewer_member_id: Optional[str] = None):
    query = {"chain_id": chain_id}
    if year:
        query["year"] = year
    wishes = await db.holiday_wishes.find(query).sort("date_from", 1).to_list(200)
    out = []
    for w in wishes:
        if w.get("is_shared") or not viewer_member_id:
            out.append(w)
            continue
        if viewer_member_id == w.get("member_id") or viewer_member_id == w.get("wish_target_member_id"):
            out.append(w)
    return [serialize_doc(w) for w in out]

@app.post("/api/holiday-wishes")
async def create_holiday_wish(req: HolidayWishRequest):
    wish = {"member_id": req.member_id, "chain_id": req.chain_id, "year": req.year,
            "period_type": req.period_type, "period_label": req.period_label,
            "title": req.title, "date_from": req.date_from, "date_to": req.date_to,
            "wish": req.wish, "wish_target_member_id": req.wish_target_member_id,
            "children_names": req.children_names or [],
            "status": "pending", "partner_status": "pending",
            "is_shared": req.is_shared, "note": req.note,
            "created_date": datetime.now(timezone.utc)}
    result = await db.holiday_wishes.insert_one(wish)
    wish["_id"] = result.inserted_id
    return serialize_doc(wish)

@app.put("/api/holiday-wishes/{wish_id}")
async def update_holiday_wish(wish_id: str, req: UpdateHolidayWishRequest):
    if not ObjectId.is_valid(wish_id):
        raise HTTPException(status_code=400, detail="Invalid wish ID")
    upd = {k: v for k, v in req.model_dump().items() if v is not None}
    if upd:
        await db.holiday_wishes.update_one({"_id": ObjectId(wish_id)}, {"$set": upd})
    w = await db.holiday_wishes.find_one({"_id": ObjectId(wish_id)})
    return serialize_doc(w)

# Messages
@app.get("/api/chains/{chain_id}/messages")
async def get_chain_messages(chain_id: str):
    msgs = await db.messages.find({"chain_id": chain_id, "recipient_id": None}).sort("created_date", 1).to_list(100)
    return [serialize_doc(m) for m in msgs]

@app.get("/api/messages/direct/{user1_id}/{user2_id}")
async def get_direct_messages(user1_id: str, user2_id: str):
    msgs = await db.messages.find(
        {"$or": [{"sender_id": user1_id, "recipient_id": user2_id},
                 {"sender_id": user2_id, "recipient_id": user1_id}]}
    ).sort("created_date", 1).to_list(100)
    return [serialize_doc(m) for m in msgs]

@app.get("/api/messages/kido/{user_id}")
async def get_kido_messages(user_id: str):
    msgs = await db.messages.find(
        {"$or": [{"sender_id": user_id, "recipient_id": "kido"},
                 {"sender_id": "kido", "recipient_id": user_id}]}
    ).sort("created_date", 1).to_list(100)
    return [serialize_doc(m) for m in msgs]

@app.post("/api/messages")
async def send_message(req: SendMessageRequest):
    now = datetime.now(timezone.utc)
    msg = {"sender_id": req.sender_id, "chain_id": req.chain_id,
           "recipient_id": req.recipient_id, "text": req.text,
           "is_kido_message": req.is_kido_message, "was_moderated": req.was_moderated,
           "original_text": req.original_text, "created_date": now}
    result = await db.messages.insert_one(msg)
    msg["_id"] = result.inserted_id
    saved = serialize_doc(msg)
    if req.recipient_id == "kido":
        response_text = get_kido_ai_response(req.text)
        kido_msg = {"sender_id": "kido", "chain_id": None, "recipient_id": req.sender_id,
                    "text": response_text, "is_kido_message": True, "was_moderated": False,
                    "original_text": None, "created_date": datetime.now(timezone.utc)}
        kido_result = await db.messages.insert_one(kido_msg)
        kido_msg["_id"] = kido_result.inserted_id
        return {"message": saved, "kido_response": serialize_doc(kido_msg)}
    return {"message": saved}

# Swiss Holidays
@app.get("/api/swiss-holidays/{kanton}/{year}")
async def get_swiss_holidays(kanton: str, year: int):
    kanton = kanton.upper()
    holidays = SWISS_HOLIDAYS.get(kanton, {}).get(year, [])
    return [{"kanton": kanton, "year": year, **h} for h in holidays]

# ── Dev / Test Chain Seed ─────────────────────────────────────────────────────

TEST_SCENARIOS: Dict[str, Dict[str, Any]] = {

    # ── Szenario 1: Harmonische Patchwork-Kette ────────────────────────────
    # Kettenstruktur:
    #   Anna ←Ex→ Thomas ←Partner→ Nina ←Ex→ Marco ←Partner→ Sara ←Ex→ David
    # Alle Ex-Paare alternieren korrekt → kein Konflikt
    "harmonische_kette": {
        "label": "Szenario 1 – Harmonische Patchwork-Kette",
        "description": (
            "Anna & Thomas (Ex, Kinder: Lena, Tim). Thomas & Nina (Paar). "
            "Nina & Marco (Ex, Kinder: Sami). Marco & Sara (Paar). "
            "Sara & David (Ex, Kinder: Ben, Lea). "
            "Alle Ex-Paare alternieren korrekt → kein Konflikt."
        ),
        "phone_prefix": "+41 79 100 10 ",
        "members": [
            # Pos 1: Anna – Ex von Thomas
            # Anna(even) ←Ex→ Thomas(odd): alternieren ✓
            {"name": "Anna Meier",   "color": "#1D9E75", "logic": "even", "flex": "disc", "court": "no_court"},
            # Pos 2: Thomas – Ex von Anna(even), Partner von Nina(odd)
            # Thomas(odd) frei@even, Nina(odd) frei@even → 4 gemeinsame freie WE ✓
            {"name": "Thomas Meier", "color": "#8B5CF6", "logic": "odd",  "flex": "disc", "court": "no_court"},
            # Pos 3: Nina – Partnerin von Thomas(odd), Ex von Marco(even)
            # Nina(odd) ←Ex→ Marco(even): alternieren ✓
            {"name": "Nina Huber",   "color": "#FB7185", "logic": "odd",  "flex": "disc", "court": "no_court"},
            # Pos 4: Marco – Ex von Nina(odd), Partner von Sara(even)
            # Marco(even) frei@odd, Sara(even) frei@odd → 4 gemeinsame freie WE ✓
            {"name": "Marco Huber",  "color": "#F59E0B", "logic": "even", "flex": "disc", "court": "no_court"},
            # Pos 5: Sara – Partnerin von Marco(even), Ex von David(odd)
            # Sara(even) ←Ex→ David(odd): alternieren ✓
            {"name": "Sara Keller",  "color": "#60A5FA", "logic": "even", "flex": "disc", "court": "no_court"},
            # Pos 6: David – Ex von Sara(even)
            {"name": "David Keller", "color": "#F472B6", "logic": "odd",  "flex": "disc", "court": "no_court"},
        ],
        "couples": [
            (0, 1, ["Lena", "Tim"]),   # Anna ↔ Thomas (Ex)
            (2, 3, ["Sami"]),           # Nina ↔ Marco (Ex)
            (4, 5, ["Ben", "Lea"]),     # Sara ↔ David (Ex)
        ],
        "current_partners": [(1, 2), (3, 4)],  # Thomas↔Nina, Marco↔Sara
    },

    # ── Szenario 2: Brücken-Konflikt (lösbar, Stufe 1) ────────────────────
    # Kettenstruktur:
    #   Laura ←Ex→ Stefan ←Partner→ Monika ←Ex→ Peter ←Partner→ Claudia ←Ex→ René
    # Konflikt: Claudia & René (beide even → gleiche WE mit Kindern)
    # René (flex=yes) wechselt auf odd → gelöst, Stufe 1 clean
    "bruecken_konflikt": {
        "label": "Szenario 2 – Brücken-Konflikt (lösbar, Stufe 1)",
        "description": (
            "Laura & Stefan (Ex, Kinder: Mia). Stefan & Monika (Paar). "
            "Monika & Peter (Ex, Kinder: Jonas, Lea). Peter & Claudia (Paar). "
            "Claudia & René (Ex, Kinder: Zoe). "
            "Konflikt: Claudia & René beide even. "
            "René (flex=yes) wechselt auf odd → Stufe 1 clean."
        ),
        "phone_prefix": "+41 79 200 10 ",
        "members": [
            # Pos 1: Laura – Ex von Stefan
            # Laura(odd) ←Ex→ Stefan(even): alternieren ✓
            {"name": "Laura Frei",    "color": "#1D9E75", "logic": "odd",  "flex": "disc", "court": "no_court"},
            # Pos 2: Stefan – Ex von Laura, Partner von Monika
            # Stefan(even) frei@odd, Monika(even) frei@odd → 4 gemeinsame ✓
            {"name": "Stefan Frei",   "color": "#8B5CF6", "logic": "even", "flex": "disc", "court": "no_court"},
            # Pos 3: Monika – Partnerin von Stefan(even), Ex von Peter
            # Monika(even) ←Ex→ Peter(odd): alternieren ✓
            {"name": "Monika Suter",  "color": "#FB7185", "logic": "even", "flex": "disc", "court": "no_court"},
            # Pos 4: Peter – Ex von Monika(even), Partner von Claudia
            # Peter(odd) frei@even, Claudia(odd) frei@even → 4 gemeinsame ✓
            {"name": "Peter Suter",   "color": "#F59E0B", "logic": "odd",  "flex": "disc", "court": "no_court"},
            # Pos 5: Claudia – Partnerin von Peter(odd), Ex von René → EX-KONFLIKT
            # Claudia(odd) ←Ex→ René(odd): BEIDE ODD → Konflikt!
            {"name": "Claudia Baer",  "color": "#60A5FA", "logic": "odd",  "flex": "disc", "court": "no_court"},
            # Pos 6: René – Ex von Claudia(odd), flex=yes → wird Pivot (wechselt auf even)
            {"name": "René Baer",     "color": "#F472B6", "logic": "odd",  "flex": "yes",  "court": "no_court"},
        ],
        "couples": [
            (0, 1, ["Mia"]),            # Laura ↔ Stefan (Ex)
            (2, 3, ["Jonas", "Lea"]),   # Monika ↔ Peter (Ex)
            (4, 5, ["Zoe"]),            # Claudia ↔ René (Ex) → Konflikt
        ],
        "current_partners": [(1, 2), (3, 4)],  # Stefan↔Monika, Peter↔Claudia
    },

    # ── Szenario 3: Ungern-Konflikt (Stufe 2) ─────────────────────────────
    # Kettenstruktur:
    #   Petra ←Ex→ Lukas ←Partner→ Sabine ←Ex→ Oliver ←Partner→ Vera ←Ex→ Tobias
    # Konflikt: Vera & Tobias (beide even)
    # Tobias flex=rel → ungern wechseln → Kido fragt privat → Stufe 2
    "ungern_konflikt": {
        "label": "Szenario 3 – Ungern-Konflikt (Stufe 2, privat)",
        "description": (
            "Petra & Lukas (Ex, Kinder: Finn, Clara). Lukas & Sabine (Paar). "
            "Sabine & Oliver (Ex, Kinder: Noah). Oliver & Vera (Paar). "
            "Vera & Tobias (Ex, Kinder: Mia). "
            "Konflikt: Vera & Tobias beide even. "
            "Tobias (flex=rel) wechselt ungern → Kido fragt privat, Stufe 2."
        ),
        "phone_prefix": "+41 79 300 10 ",
        "members": [
            # Pos 1: Petra – Ex von Lukas
            # Petra(odd) ←Ex→ Lukas(even): alternieren ✓
            {"name": "Petra Lang",    "color": "#1D9E75", "logic": "odd",  "flex": "disc", "court": "no_court"},
            # Pos 2: Lukas – Ex von Petra, Partner von Sabine
            # Lukas(even) frei@odd, Sabine(even) frei@odd → 4 gemeinsame ✓
            {"name": "Lukas Lang",    "color": "#8B5CF6", "logic": "even", "flex": "disc", "court": "no_court"},
            # Pos 3: Sabine – Partnerin von Lukas(even), Ex von Oliver
            # Sabine(even) ←Ex→ Oliver(odd): alternieren ✓
            {"name": "Sabine Vogt",   "color": "#FB7185", "logic": "even", "flex": "disc", "court": "no_court"},
            # Pos 4: Oliver – Ex von Sabine(even), Partner von Vera
            # Oliver(odd) frei@even, Vera(odd) frei@even → 4 gemeinsame ✓
            {"name": "Oliver Vogt",   "color": "#F59E0B", "logic": "odd",  "flex": "disc", "court": "no_court"},
            # Pos 5: Vera – Partnerin von Oliver(odd), Ex von Tobias → EX-KONFLIKT
            # Vera(odd) ←Ex→ Tobias(odd): BEIDE ODD → Konflikt!
            {"name": "Vera Roth",     "color": "#60A5FA", "logic": "odd",  "flex": "disc", "court": "no_court"},
            # Pos 6: Tobias – Ex von Vera(odd), flex=rel → wechselt ungern auf even → Stufe 2
            {"name": "Tobias Roth",   "color": "#F472B6", "logic": "odd",  "flex": "rel",  "court": "no_court"},
        ],
        "couples": [
            (0, 1, ["Finn", "Clara"]),  # Petra ↔ Lukas (Ex)
            (2, 3, ["Noah"]),            # Sabine ↔ Oliver (Ex)
            (4, 5, ["Mia"]),             # Vera ↔ Tobias (Ex) → Konflikt
        ],
        "current_partners": [(1, 2), (3, 4)],  # Lukas↔Sabine, Oliver↔Vera
    },

    # ── Szenario 4: Doppelter Kettenkonflikt (Stufe 3a) ───────────────────
    # Kettenstruktur:
    #   Sandra ←Ex→ Felix ←Partner→ Julia ←Ex→ Markus ←Partner→ Lisa ←Ex→ Hans
    # Konflikt 1: Sandra & Felix (beide even) → Felix court_strict → BLOCKER
    # Konflikt 2: Lisa & Hans (beide odd) → Hans flex=no → BLOCKER
    # Kein Einzelpivot lösbar → Stufe 3a
    "doppelter_konflikt": {
        "label": "Szenario 4 – Doppelter Kettenkonflikt (Stufe 3a)",
        "description": (
            "Sandra & Felix (Ex, Kinder: Max, Lina). Felix court_strict. "
            "Felix & Julia (Paar). Julia & Markus (Ex, Kinder: Tom). "
            "Markus & Lisa (Paar). Lisa & Hans (Ex, Kinder: Emma). Hans flex=no. "
            "Konflikt 1: Sandra & Felix beide even, Felix blockiert. "
            "Konflikt 2: Lisa & Hans beide odd, Hans blockiert. "
            "→ Stufe 3a, zwei Blocker."
        ),
        "phone_prefix": "+41 79 400 10 ",
        "members": [
            # Pos 1: Sandra – Ex von Felix → KONFLIKT 1
            {"name": "Sandra Graf",   "color": "#1D9E75", "logic": "even", "flex": "disc", "court": "no_court"},
            # Pos 2: Felix – Ex von Sandra, Partner von Julia → BLOCKER (court_strict)
            {"name": "Felix Graf",    "color": "#8B5CF6", "logic": "even", "flex": "rel",  "court": "court_strict"},
            # Pos 3: Julia – Partnerin von Felix, Ex von Markus
            {"name": "Julia Müller",  "color": "#FB7185", "logic": "odd",  "flex": "disc", "court": "no_court"},
            # Pos 4: Markus – Ex von Julia, Partner von Lisa
            {"name": "Markus Müller", "color": "#F59E0B", "logic": "even", "flex": "disc", "court": "no_court"},
            # Pos 5: Lisa – Partnerin von Markus, Ex von Hans → KONFLIKT 2
            {"name": "Lisa Schmid",   "color": "#60A5FA", "logic": "odd",  "flex": "disc", "court": "no_court"},
            # Pos 6: Hans – Ex von Lisa → BLOCKER (flex=no)
            {"name": "Hans Schmid",   "color": "#F472B6", "logic": "odd",  "flex": "no",   "court": "no_court"},
        ],
        "couples": [
            (0, 1, ["Max", "Lina"]),    # Sandra ↔ Felix (Ex) → Konflikt 1
            (2, 3, ["Tom"]),             # Julia ↔ Markus (Ex)
            (4, 5, ["Emma"]),            # Lisa ↔ Hans (Ex) → Konflikt 2
        ],
        "current_partners": [(1, 2), (3, 4)],  # Felix↔Julia, Markus↔Lisa
    },
}

@app.post("/api/dev/seed-test-chain")
async def seed_test_chain(scenario: str = "bruecken_konflikt"):
    if scenario not in TEST_SCENARIOS:
        raise HTTPException(status_code=400, detail=f"Unknown scenario: {scenario}")
    spec = TEST_SCENARIOS[scenario]
    phone_prefix = spec["phone_prefix"]
    member_specs = spec["members"]

    # 1) Alte Testdaten entfernen
    test_phones = [phone_prefix + f"{i+1:02d}" for i in range(len(member_specs))]
    old_users = await db.users.find({"phone": {"$in": test_phones}}).to_list(50)
    old_user_ids = [str(u["_id"]) for u in old_users]
    old_members = await db.chain_members.find({"user_id": {"$in": old_user_ids}}).to_list(50)
    old_chain_ids = list({m["chain_id"] for m in old_members})
    if old_chain_ids:
        await db.coparent_relations.delete_many({"chain_id": {"$in": old_chain_ids}})
        await db.partner_relations.delete_many({"chain_id": {"$in": old_chain_ids}})
        await db.messages.delete_many({"chain_id": {"$in": old_chain_ids}})
        await db.holiday_wishes.delete_many({"chain_id": {"$in": old_chain_ids}})
        await db.weekend_plans.delete_many({"chain_id": {"$in": old_chain_ids}})
        await db.chain_members.delete_many({"chain_id": {"$in": old_chain_ids}})
        await db.invitations.delete_many({"chain_id": {"$in": old_chain_ids}})
        await db.chains.delete_many({"_id": {"$in": [ObjectId(cid) for cid in old_chain_ids if ObjectId.is_valid(cid)]}})
    if old_user_ids:
        await db.users.delete_many({"_id": {"$in": [ObjectId(uid) for uid in old_user_ids if ObjectId.is_valid(uid)]}})

    # 2) Neue Chain + Users + Members erstellen
    now = datetime.now(timezone.utc)
    chain_doc = {"name": spec["label"], "host_id": "", "status": "active", "created_date": now}
    chain_result = await db.chains.insert_one(chain_doc)
    chain_id = str(chain_result.inserted_id)

    created_members = []
    host_id = None
    for idx, m in enumerate(member_specs):
        phone = phone_prefix + f"{idx+1:02d}"
        is_host = (idx == 0)
        user_doc = {"name": m["name"], "phone": phone, "avatar_color": m["color"],
                    "is_host": is_host, "kanton": "ZH", "created_date": now}
        u_res = await db.users.insert_one(user_doc)
        user_id = str(u_res.inserted_id)
        if is_host:
            host_id = user_id
        member_doc = {"user_id": user_id, "chain_id": chain_id, "position": idx + 1,
                      "user_name": m["name"], "avatar_color": m["color"],
                      "court_ruling": m["court"], "current_logic": m["logic"],
                      "flex_level": m["flex"], "is_host": is_host, "joined_date": now}
        m_res = await db.chain_members.insert_one(member_doc)
        created_members.append({
            "user_id": user_id, "chain_id": chain_id, "member_id": str(m_res.inserted_id),
            "chain_name": spec["label"], "user_name": m["name"], "avatar_color": m["color"],
            "phone": phone, "is_host": is_host,
            "logic": m["logic"], "flex": m["flex"], "court": m["court"], "prefsSet": True, "kanton": "ZH",
        })

    await db.chains.update_one({"_id": ObjectId(chain_id)}, {"$set": {"host_id": host_id}})

    # 3) Coparent Relations erstellen (KORREKT: aus couples-Definition)
    coparent_rels_data = []
    for (i, j, children) in spec["couples"]:
        rel = {
            "chain_id": chain_id,
            "parent1_id": created_members[i]["member_id"],
            "parent2_id": created_members[j]["member_id"],
            "children": [{"name": n} for n in children],
            "created_date": now,
        }
        await db.coparent_relations.insert_one(rel)
        coparent_rels_data.append(serialize_doc(rel))

    # 3b) Partner Relations erstellen (aktuelle Partnerschaften)
    for (i, j) in spec.get("current_partners", []):
        await db.partner_relations.insert_one({
            "chain_id": chain_id,
            "partner1_id": created_members[i]["member_id"],
            "partner2_id": created_members[j]["member_id"],
            "partner1_name": created_members[i]["user_name"],
            "partner2_name": created_members[j]["user_name"],
            "created_date": now,
        })

    # 4) Plan berechnen (KORRIGIERT: mit coparent_relations)
    members = await db.chain_members.find({"chain_id": chain_id}).sort("position", 1).to_list(20)
    members_data = [serialize_doc(m) for m in members]
    # Partner Relations aus DB laden
    partner_rels = await db.partner_relations.find({"chain_id": chain_id}).to_list(50)
    partner_rels_data = [serialize_doc(r) for r in partner_rels]

    result = calculate_plan(members_data, coparent_relations=coparent_rels_data, partner_relations=partner_rels_data)
    stage = result.get("stage", "1_clean")

    plan = {"chain_id": chain_id, "status": "proposed",
            "proposal_type": result["type"],
            "escalation_stage": stage,
            "rejected_pivot_ids": [], "reconsider_count": {},
            "blockers": result.get("blockers", []), "subgroups": None,
            "pivot_member_id": result.get("pivot_id"),
            "pivot_member_name": result.get("pivot_name"),
            "pivot_new_logic": result.get("new_logic"),
            "schedule": result["schedule"],
            "proposed_schedule": result["proposed_schedule"],
            "weekends": result["weekends"],
            "kido_message": result["kido_message"], "created_date": now}

    plan_res = await db.weekend_plans.insert_one(plan)
    plan_id = str(plan_res.inserted_id)
    cur_s = result["schedule"]
    prop_s = result["proposed_schedule"]

    for m in members_data:
        mid = m["id"]
        changes = cur_s.get(mid) != prop_s.get(mid)
        if stage == "2_ungern":
            is_active = mid == result.get("pivot_id")
        elif stage == "3a_blockers":
            is_active = mid in result.get("blockers", [])
        else:
            is_active = True
        await db.plan_votes.insert_one({
            "plan_id": plan_id, "member_id": mid, "member_name": m["user_name"],
            "vote": "pending" if is_active else "na",
            "is_active": is_active, "logic_changes": changes, "created_date": now,
        })

    return {
        "scenario": scenario,
        "chain_id": chain_id,
        "chain_name": spec["label"],
        "description": spec["description"],
        "conflict_scenario": stage,
        "proposal_type": result["type"],
        "pivot_member_name": result.get("pivot_name"),
        "blockers_count": len(result.get("blockers", [])),
        "members": created_members,
    }

# ── Partner Relations ────────────────────────────────────────────────────────

class PartnerRelationRequest(BaseModel):
    chain_id: str
    partner1_id: str
    partner2_id: str

@app.post("/api/partner-relations")
async def create_partner_relation(req: PartnerRelationRequest):
    # Prevent duplicates
    existing = await db.partner_relations.find_one({
        "chain_id": req.chain_id,
        "$or": [
            {"partner1_id": req.partner1_id, "partner2_id": req.partner2_id},
            {"partner1_id": req.partner2_id, "partner2_id": req.partner1_id},
        ]
    })
    if existing:
        return serialize_doc(existing)
    # Get names
    m1 = await db.chain_members.find_one({"_id": ObjectId(req.partner1_id)})
    m2 = await db.chain_members.find_one({"_id": ObjectId(req.partner2_id)})
    doc = {
        "chain_id": req.chain_id,
        "partner1_id": req.partner1_id,
        "partner2_id": req.partner2_id,
        "partner1_name": m1.get("user_name", "") if m1 else "",
        "partner2_name": m2.get("user_name", "") if m2 else "",
        "created_date": datetime.now(timezone.utc)
    }
    res = await db.partner_relations.insert_one(doc)
    doc["_id"] = res.inserted_id
    return serialize_doc(doc)

@app.get("/api/chains/{chain_id}/partner-relations")
async def get_partner_relations(chain_id: str):
    rels = await db.partner_relations.find({"chain_id": chain_id}).to_list(50)
    return [serialize_doc(r) for r in rels]

@app.delete("/api/partner-relations/{relation_id}")
async def delete_partner_relation(relation_id: str):
    if not ObjectId.is_valid(relation_id):
        raise HTTPException(status_code=400, detail="Invalid relation ID")
    await db.partner_relations.delete_one({"_id": ObjectId(relation_id)})
    return {"deleted": True}

@app.get("/api/chains/{chain_id}/relations")
async def get_all_relations(chain_id: str):
    """Returns both coparent and partner relations for a chain.
    Used by the Beziehungen/Relationships settings page."""
    coparent = await db.coparent_relations.find({"chain_id": chain_id}).to_list(50)
    partner = await db.partner_relations.find({"chain_id": chain_id}).to_list(50)
    return {
        "coparent_relations": [serialize_doc(r) for r in coparent],
        "partner_relations": [serialize_doc(r) for r in partner],
    }

# ── Chat Channels ─────────────────────────────────────────────────────────────

class ChatChannelRequest(BaseModel):
    chain_id: str
    name: str
    member_ids: List[str]
    type: str = "subgroup_manual"
    created_by: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None

class UpdateChatChannelRequest(BaseModel):
    name: Optional[str] = None
    member_ids: Optional[List[str]] = None
    icon: Optional[str] = None
    color: Optional[str] = None

@app.post("/api/chat-channels")
async def create_channel(req: ChatChannelRequest):
    doc = {"chain_id": req.chain_id, "name": req.name, "member_ids": req.member_ids,
           "type": req.type, "created_by": req.created_by,
           "icon": req.icon, "color": req.color,
           "created_date": datetime.now(timezone.utc)}
    res = await db.chat_channels.insert_one(doc)
    doc["_id"] = res.inserted_id
    return serialize_doc(doc)

@app.get("/api/chains/{chain_id}/chat-channels")
async def list_channels(chain_id: str, viewer_member_id: Optional[str] = None):
    channels = await db.chat_channels.find({"chain_id": chain_id}).to_list(100)
    out = []
    for c in channels:
        if viewer_member_id and viewer_member_id not in c.get("member_ids", []):
            continue
        out.append(serialize_doc(c))
    return out

@app.put("/api/chat-channels/{channel_id}")
async def update_channel(channel_id: str, req: UpdateChatChannelRequest):
    if not ObjectId.is_valid(channel_id):
        raise HTTPException(status_code=400, detail="Invalid channel ID")
    upd = {k: v for k, v in req.model_dump().items() if v is not None}
    if upd:
        await db.chat_channels.update_one({"_id": ObjectId(channel_id)}, {"$set": upd})
    c = await db.chat_channels.find_one({"_id": ObjectId(channel_id)})
    return serialize_doc(c)

@app.delete("/api/chat-channels/{channel_id}")
async def delete_channel(channel_id: str):
    if not ObjectId.is_valid(channel_id):
        raise HTTPException(status_code=400, detail="Invalid channel ID")
    await db.chat_channels.delete_one({"_id": ObjectId(channel_id)})
    await db.channel_messages.delete_many({"channel_id": channel_id})
    return {"deleted": True}

class ChannelMessageRequest(BaseModel):
    sender_id: str
    text: str
    was_moderated: bool = False
    original_text: Optional[str] = None

@app.post("/api/chat-channels/{channel_id}/messages")
async def send_channel_message(channel_id: str, req: ChannelMessageRequest):
    msg = {"channel_id": channel_id, "sender_id": req.sender_id, "text": req.text,
           "was_moderated": req.was_moderated, "original_text": req.original_text,
           "created_date": datetime.now(timezone.utc)}
    res = await db.channel_messages.insert_one(msg)
    msg["_id"] = res.inserted_id
    return serialize_doc(msg)

@app.get("/api/chat-channels/{channel_id}/messages")
async def get_channel_messages(channel_id: str):
    msgs = await db.channel_messages.find({"channel_id": channel_id}).sort("created_date", 1).to_list(200)
    return [serialize_doc(m) for m in msgs]

# ── Coparent Relations ────────────────────────────────────────────────────────

class CoparentRelationRequest(BaseModel):
    chain_id: str
    parent1_id: str
    parent2_id: str
    children: Optional[List[dict]] = None

@app.post("/api/coparent-relations")
async def create_coparent_relation(req: CoparentRelationRequest):
    doc = {"chain_id": req.chain_id, "parent1_id": req.parent1_id,
           "parent2_id": req.parent2_id, "children": req.children or [],
           "created_date": datetime.now(timezone.utc)}
    res = await db.coparent_relations.insert_one(doc)
    doc["_id"] = res.inserted_id
    return serialize_doc(doc)

@app.get("/api/chains/{chain_id}/coparent-relations")
async def get_coparent_relations(chain_id: str):
    rels = await db.coparent_relations.find({"chain_id": chain_id}).to_list(50)
    return [serialize_doc(r) for r in rels]
