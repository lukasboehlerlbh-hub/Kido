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

# ── Plan Calculation ──────────────────────────────────────────────────────────
FLEX_SCORES = {"yes": 5, "rel": 3, "disc": 2, "temp": 2, "no": 1, "ext": 0}

def get_next_weekends(n=8):
    today = date.today()
    days_to_sat = (5 - today.weekday()) % 7 or 7
    next_sat = today + timedelta(days=days_to_sat)
    return [
        {"week_index": i, "date": (next_sat + timedelta(weeks=i)).isoformat(),
         "label": f"WE{i+1}", "week_num": (next_sat + timedelta(weeks=i)).isocalendar()[1],
         "is_even": (next_sat + timedelta(weeks=i)).isocalendar()[1] % 2 == 0}
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

def find_conflicts(schedule, member_ids):
    conflicts = []
    for i in range(len(member_ids) - 1):
        for w in range(8):
            if schedule.get(member_ids[i], [False]*8)[w] and schedule.get(member_ids[i+1], [False]*8)[w]:
                conflicts.append({"pi": i, "qi": i+1, "week": w})
    return conflicts

def get_effective_flex(member: dict) -> str:
    """court_strict overrides flex to ext (0) – hardest block."""
    if member.get("court_ruling") == "court_strict":
        return "ext"
    return member.get("flex_level", "no")

def calculate_plan(members, rejected_pivot_ids=None):
    """Calculate weekend plan. If rejected_pivot_ids given, skip those members as pivot candidates."""
    rejected_pivot_ids = rejected_pivot_ids or []
    member_ids = [str(m.get("id") or str(m.get("_id", ""))) for m in members]
    weekends = get_next_weekends(8)
    current = calc_schedule(members)
    conflicts = find_conflicts(current, member_ids)
    if not conflicts:
        return {"type": "clean", "stage": "1_clean", "pivot_id": None, "pivot_name": None, "new_logic": None,
                "schedule": current, "proposed_schedule": current, "weekends": weekends,
                "blockers": [], "subgroups": None,
                "kido_message": KIDO_MSG["clean"]}
    for c in sorted(members, key=lambda m: FLEX_SCORES.get(get_effective_flex(m), 0), reverse=True):
        if FLEX_SCORES.get(get_effective_flex(c), 0) <= 1:
            continue
        cid = str(c.get("id") or str(c.get("_id", "")))
        if cid in rejected_pivot_ids:
            continue
        nl = "odd" if c.get("current_logic","even") == "even" else "even"
        trial = calc_schedule(members, {cid: nl})
        if not find_conflicts(trial, member_ids):
            ungern = c.get("flex_level") in ["rel", "temp"]
            stage = "2_ungern" if ungern else "1_clean"
            return {"type": "ungern" if ungern else "clean", "stage": stage, "pivot_id": cid,
                    "pivot_name": c.get("user_name",""), "new_logic": nl,
                    "schedule": current, "proposed_schedule": trial, "weekends": weekends,
                    "blockers": [], "subgroups": None,
                    "kido_message": KIDO_MSG["ungern"] if ungern else KIDO_MSG["clean"]}

    # All candidates exhausted → 3a (blockers) / 3b (subgroups)
    blockers = compute_blockers(members, member_ids, current)
    return {"type": "blocked", "stage": "3a_blockers", "pivot_id": None, "pivot_name": None, "new_logic": None,
            "schedule": current, "proposed_schedule": current, "weekends": weekends,
            "blockers": blockers, "subgroups": None,
            "kido_message": KIDO_MSG["blocked_3a"]}

def compute_blockers(members, member_ids, current):
    """Return member_ids that are involved in conflicts AND have low flex (effective ≤ 1)."""
    conflicts = find_conflicts(current, member_ids)
    conflicted_indices = set()
    for c in conflicts:
        conflicted_indices.add(c["pi"])
        conflicted_indices.add(c["qi"])
    blockers = []
    for idx in conflicted_indices:
        m = members[idx]
        if FLEX_SCORES.get(get_effective_flex(m), 0) <= 1:
            blockers.append(str(m.get("id") or str(m.get("_id", ""))))
    return blockers

def compute_subgroups(members):
    """For stage 3b: cluster adjacent members with same logic into subgroups."""
    if not members:
        return []
    groups = []
    current_group = [{"id": str(members[0].get("id") or ""), "name": members[0].get("user_name", ""), "color": members[0].get("avatar_color","#1D9E75"), "logic": members[0].get("current_logic","even")}]
    last_logic = members[0].get("current_logic", "even")
    for m in members[1:]:
        mlogic = m.get("current_logic", "even")
        entry = {"id": str(m.get("id") or ""), "name": m.get("user_name",""), "color": m.get("avatar_color","#1D9E75"), "logic": mlogic}
        if mlogic == last_logic:
            # conflict – start new subgroup
            groups.append(current_group)
            current_group = [entry]
        else:
            current_group.append(entry)
        last_logic = mlogic
    groups.append(current_group)
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
    wish_target_member_id: Optional[str] = None  # When wish == specific person, points to that member
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
    partner_status: Optional[str] = None  # acceptance from the target partner

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
            "chain_name": chain["name"], "user_name": req.user_name,
            "avatar_color": req.avatar_color}

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
    upd = {"court_ruling": req.court_ruling, "current_logic": req.current_logic,
           "flex_level": req.flex_level}
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
    result = calculate_plan(members_data)

    subgroups = compute_subgroups(members_data) if result.get("stage") == "3a_blockers" else None

    plan = {"chain_id": chain_id, "status": "proposed",
            "proposal_type": result["type"],
            "escalation_stage": result.get("stage", "1_clean"),
            "rejected_pivot_ids": [],
            "reconsider_count": {},
            "blockers": result.get("blockers", []),
            "subgroups": None,  # only populated when 3b is reached
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
        # Active = logic actually changes in proposed vs current (CRITICAL: everyone with a logic change must explicitly vote, even if fully flexible)
        changes = current_sched.get(mid) != proposed_sched.get(mid)
        if stage == "2_ungern":
            is_active = mid == result.get("pivot_id")
        elif stage == "3a_blockers":
            is_active = mid in result.get("blockers", [])
        elif stage == "1_clean":
            # Stage 1: everyone can vote; required voters are those with logic changes
            is_active = True
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
    plan_data["subgroups_preview"] = subgroups  # for UI preview at 3a
    return plan_data

@app.post("/api/weekend-plans/{plan_id}/reconsider")
async def reconsider_plan(plan_id: str):
    """Stage 2 reconsider button: re-prompt the current pivot."""
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
    # Reset pivot's vote to pending
    await db.plan_votes.update_one(
        {"plan_id": plan_id, "member_id": pivot},
        {"$set": {"vote": "pending", "is_active": True}})
    await db.weekend_plans.update_one(
        {"_id": ObjectId(plan_id)},
        {"$set": {"reconsider_count": rc,
                  "kido_message": KIDO_MSG["ungern_reconsider"]}})
    updated = await db.weekend_plans.find_one({"_id": ObjectId(plan_id)})
    result = serialize_doc(updated)
    votes = await db.plan_votes.find({"plan_id": plan_id}).to_list(20)
    result["votes"] = [serialize_doc(v) for v in votes]
    return result

@app.post("/api/weekend-plans/{plan_id}/try-next-pivot")
async def try_next_pivot(plan_id: str):
    """Declined pivot: compute a new plan excluding declined pivots."""
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
    result = calculate_plan(members_data, rejected_pivot_ids=rejected)

    now = datetime.now(timezone.utc)
    subgroups = compute_subgroups(members_data) if result.get("stage") == "3a_blockers" else None
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
    cur_s = result["schedule"]; prop_s = result["proposed_schedule"]
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
    """Move from 3a (blockers refuse) to 3b (subgroups)."""
    if not ObjectId.is_valid(plan_id):
        raise HTTPException(status_code=400, detail="Invalid plan ID")
    plan = await db.weekend_plans.find_one({"_id": ObjectId(plan_id)})
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    chain_id = plan["chain_id"]
    members = await db.chain_members.find({"chain_id": chain_id}).sort("position", 1).to_list(20)
    members_data = [serialize_doc(m) for m in members]
    subgroups = compute_subgroups(members_data)
    now = datetime.now(timezone.utc)
    await db.weekend_plans.update_one({"_id": ObjectId(plan_id)},
        {"$set": {"escalation_stage": "3b_subgroups",
                  "subgroups": subgroups,
                  "kido_message": KIDO_MSG["blocked_3b"]}})
    # Re-activate all votes
    await db.plan_votes.update_many({"plan_id": plan_id},
        {"$set": {"vote": "pending", "is_active": True}})
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
    # Required = people whose logic changes (must all accept, regardless of flex level)
    required_votes = [v for v in votes if v.get("logic_changes", False) and v.get("is_active", True)]
    all_voted = all(v["vote"] != "pending" for v in active_votes)
    if all_voted:
        # Plan accepted only if: no declines from active voters AND all required (logic-change) voters accepted
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
                # Public announcement for ungern accept
                if plan.get("escalation_stage") == "2_ungern":
                    await db.weekend_plans.update_one({"_id": ObjectId(plan_id)},
                        {"$set": {"kido_message": KIDO_MSG["ungern_accepted_public"].format(name=plan.get("pivot_member_name",""))}})
    plan = await db.weekend_plans.find_one({"_id": ObjectId(plan_id)})
    result = serialize_doc(plan)
    result["votes"] = [serialize_doc(v) for v in votes]
    return result

# Holiday Wishes
@app.get("/api/chains/{chain_id}/holiday-wishes")
async def get_holiday_wishes(chain_id: str, year: Optional[int] = None, viewer_member_id: Optional[str] = None):
    """Returns wishes visible to viewer_member_id.
    Visibility rules:
      - is_shared=True  → visible to everyone in chain
      - is_shared=False → visible only to wish creator (member_id) + wish_target_member_id
    """
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
            "title": req.title,
            "date_from": req.date_from, "date_to": req.date_to,
            "wish": req.wish,
            "wish_target_member_id": req.wish_target_member_id,
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
TEST_CHAIN_PHONE_PREFIX = "+41 79 001 00 "
TEST_MEMBERS_SPEC = [
    {"name": "Anna Muster",    "color": "#1D9E75", "logic": "even", "flex": "rel",  "court": "no_court",       "phone_suffix": "01", "is_host": True},
    {"name": "Peter Muster",   "color": "#E24B4A", "logic": "even", "flex": "no",   "court": "court_strict",   "phone_suffix": "02", "is_host": False},
    {"name": "Sara Beispiel",  "color": "#8B5CF6", "logic": "odd",  "flex": "disc", "court": "court_no_logic", "phone_suffix": "03", "is_host": False},
    {"name": "Tom Testmann",   "color": "#F59E0B", "logic": "even", "flex": "disc", "court": "no_court",       "phone_suffix": "04", "is_host": False},
    {"name": "Lisa Meier",     "color": "#60A5FA", "logic": "odd",  "flex": "no",   "court": "court_willing",  "phone_suffix": "05", "is_host": False},
    {"name": "Max Keller",     "color": "#F472B6", "logic": "even", "flex": "temp", "court": "no_court",       "phone_suffix": "06", "is_host": False},
]

@app.post("/api/dev/seed-test-chain")
async def seed_test_chain():
    """Wipe previous test chain and create a fresh 6-member chain with a solvable 'ungern' conflict.
    Returns list of member login payloads the client can switch between."""
    # 1) Remove previous test data (users with these phone numbers and their chains)
    test_phones = [TEST_CHAIN_PHONE_PREFIX + m["phone_suffix"] for m in TEST_MEMBERS_SPEC]
    old_users = await db.users.find({"phone": {"$in": test_phones}}).to_list(50)
    old_user_ids = [str(u["_id"]) for u in old_users]
    old_members = await db.chain_members.find({"user_id": {"$in": old_user_ids}}).to_list(50)
    old_chain_ids = list({m["chain_id"] for m in old_members})

    if old_chain_ids:
        await db.messages.delete_many({"chain_id": {"$in": old_chain_ids}})
        await db.holiday_wishes.delete_many({"chain_id": {"$in": old_chain_ids}})
        await db.plan_votes.delete_many({})  # cleanup orphaned votes linked via plan_id
        await db.weekend_plans.delete_many({"chain_id": {"$in": old_chain_ids}})
        await db.chain_members.delete_many({"chain_id": {"$in": old_chain_ids}})
        await db.invitations.delete_many({"chain_id": {"$in": old_chain_ids}})
        await db.chains.delete_many({"_id": {"$in": [ObjectId(cid) for cid in old_chain_ids if ObjectId.is_valid(cid)]}})
    if old_user_ids:
        await db.users.delete_many({"_id": {"$in": [ObjectId(uid) for uid in old_user_ids if ObjectId.is_valid(uid)]}})

    # 2) Create fresh chain + users + members
    now = datetime.now(timezone.utc)
    # Create chain placeholder (host_id filled later)
    chain_doc = {"name": "Test-Kette (6 Personen)", "host_id": "", "status": "active", "created_date": now}
    chain_result = await db.chains.insert_one(chain_doc)
    chain_id = str(chain_result.inserted_id)

    created_members = []
    host_id = None
    for idx, spec in enumerate(TEST_MEMBERS_SPEC):
        phone = TEST_CHAIN_PHONE_PREFIX + spec["phone_suffix"]
        user_doc = {"name": spec["name"], "phone": phone, "avatar_color": spec["color"],
                    "is_host": spec["is_host"], "kanton": "ZH", "created_date": now}
        u_res = await db.users.insert_one(user_doc)
        user_id = str(u_res.inserted_id)
        if spec["is_host"]:
            host_id = user_id

        member_doc = {"user_id": user_id, "chain_id": chain_id, "position": idx + 1,
                      "user_name": spec["name"], "avatar_color": spec["color"],
                      "court_ruling": spec["court"], "current_logic": spec["logic"],
                      "flex_level": spec["flex"], "is_host": spec["is_host"],
                      "joined_date": now}
        m_res = await db.chain_members.insert_one(member_doc)
        member_id = str(m_res.inserted_id)

        created_members.append({
            "user_id": user_id,
            "chain_id": chain_id,
            "member_id": member_id,
            "chain_name": chain_doc["name"],
            "user_name": spec["name"],
            "avatar_color": spec["color"],
            "phone": phone,
            "is_host": spec["is_host"],
            "logic": spec["logic"],
            "flex": spec["flex"],
            "court": spec["court"],
            "prefsSet": True,
            "kanton": "ZH",
        })

    # Update chain with host_id
    await db.chains.update_one({"_id": ObjectId(chain_id)}, {"$set": {"host_id": host_id}})

    # 3) Pre-calculate a plan so the user immediately sees the "ungern" proposal
    members = await db.chain_members.find({"chain_id": chain_id}).sort("position", 1).to_list(20)
    members_data = [serialize_doc(m) for m in members]
    result = calculate_plan(members_data)
    stage = result.get("stage", "1_clean")
    plan = {"chain_id": chain_id, "status": "proposed",
            "proposal_type": result["type"],
            "escalation_stage": stage,
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
            "created_date": now}
    plan_res = await db.weekend_plans.insert_one(plan)
    plan_id = str(plan_res.inserted_id)
    for m in members_data:
        mid = m["id"]
        if stage == "2_ungern":
            is_active = mid == result.get("pivot_id")
        elif stage == "3a_blockers":
            is_active = mid in result.get("blockers", [])
        else:
            is_active = True
        await db.plan_votes.insert_one({
            "plan_id": plan_id, "member_id": mid, "member_name": m["user_name"],
            "vote": "pending" if is_active else "na",
            "is_active": is_active,
            "created_date": now,
        })

    # 4) Seed a few holiday wishes (shared) so the picker works immediately
    anna_member_id = created_members[0]["member_id"]
    peter_member_id = created_members[1]["member_id"]
    await db.holiday_wishes.insert_one({
        "member_id": anna_member_id, "chain_id": chain_id, "year": 2026,
        "period_type": "sommer", "period_label": "Sommerferien",
        "date_from": "2026-07-13", "date_to": "2026-07-26",
        "wish": "ich", "status": "pending", "is_shared": True,
        "note": "Erste zwei Wochen bei mir (Anna).",
        "created_date": now,
    })
    await db.holiday_wishes.insert_one({
        "member_id": peter_member_id, "chain_id": chain_id, "year": 2026,
        "period_type": "sommer", "period_label": "Sommerferien",
        "date_from": "2026-07-27", "date_to": "2026-08-09",
        "wish": "ich", "status": "pending", "is_shared": True,
        "note": "Zweite Hälfte bei mir (Peter).",
        "created_date": now,
    })

    return {
        "chain_id": chain_id,
        "chain_name": chain_doc["name"],
        "conflict_scenario": "ungern" if result["type"] == "ungern" else result["type"],
        "pivot_member_name": result.get("pivot_name"),
        "members": created_members,
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
    """Return channels visible to viewer. If viewer given, only channels containing viewer."""
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
    return {"ok": True}

class ChannelMessageRequest(BaseModel):
    channel_id: str
    sender_id: str
    sender_name: str
    text: str

@app.post("/api/channel-messages")
async def send_channel_message(req: ChannelMessageRequest):
    msg = {"channel_id": req.channel_id, "sender_id": req.sender_id,
           "sender_name": req.sender_name, "text": req.text,
           "created_date": datetime.now(timezone.utc)}
    res = await db.channel_messages.insert_one(msg)
    msg["_id"] = res.inserted_id
    return serialize_doc(msg)

@app.get("/api/channel-messages/{channel_id}")
async def list_channel_messages(channel_id: str):
    msgs = await db.channel_messages.find({"channel_id": channel_id}).sort("created_date", 1).to_list(500)
    return [serialize_doc(m) for m in msgs]

# ── Relationships (Co-Parents & Couples) ──────────────────────────────────────
class CoparentRelationRequest(BaseModel):
    chain_id: str
    parent1_id: str
    parent2_id: str
    children: List[Dict[str, Any]] = []

class CoupleRelationRequest(BaseModel):
    chain_id: str
    partner1_id: str
    partner2_id: str
    sync_pref: str = "none"  # "same" | "opposite" | "none"

@app.post("/api/coparent-relations")
async def create_coparent(req: CoparentRelationRequest):
    doc = {**req.model_dump(), "created_date": datetime.now(timezone.utc)}
    res = await db.coparent_relations.insert_one(doc)
    doc["_id"] = res.inserted_id
    return serialize_doc(doc)

@app.get("/api/chains/{chain_id}/coparent-relations")
async def list_coparent(chain_id: str):
    rels = await db.coparent_relations.find({"chain_id": chain_id}).to_list(100)
    return [serialize_doc(r) for r in rels]

@app.delete("/api/coparent-relations/{rid}")
async def delete_coparent(rid: str):
    if not ObjectId.is_valid(rid):
        raise HTTPException(status_code=400, detail="Invalid id")
    await db.coparent_relations.delete_one({"_id": ObjectId(rid)})
    return {"ok": True}

@app.post("/api/couple-relations")
async def create_couple(req: CoupleRelationRequest):
    doc = {**req.model_dump(), "confirmed_by_both": False, "created_date": datetime.now(timezone.utc)}
    res = await db.couple_relations.insert_one(doc)
    doc["_id"] = res.inserted_id
    return serialize_doc(doc)

@app.put("/api/couple-relations/{rid}/confirm")
async def confirm_couple(rid: str):
    if not ObjectId.is_valid(rid):
        raise HTTPException(status_code=400, detail="Invalid id")
    await db.couple_relations.update_one({"_id": ObjectId(rid)}, {"$set": {"confirmed_by_both": True}})
    c = await db.couple_relations.find_one({"_id": ObjectId(rid)})
    return serialize_doc(c)

@app.get("/api/chains/{chain_id}/couple-relations")
async def list_couple(chain_id: str):
    rels = await db.couple_relations.find({"chain_id": chain_id}).to_list(100)
    return [serialize_doc(r) for r in rels]

@app.delete("/api/couple-relations/{rid}")
async def delete_couple(rid: str):
    if not ObjectId.is_valid(rid):
        raise HTTPException(status_code=400, detail="Invalid id")
    await db.couple_relations.delete_one({"_id": ObjectId(rid)})
    return {"ok": True}

@app.get("/api/chains/{chain_id}/consistency-check")
async def consistency_check(chain_id: str):
    """Return a list of issues detected across coparent/couple relations and current logics."""
    issues = []
    members = await db.chain_members.find({"chain_id": chain_id}).to_list(30)
    members_by_id = {str(m["_id"]): m for m in members}
    couples = await db.couple_relations.find({"chain_id": chain_id}).to_list(50)
    for c in couples:
        m1 = members_by_id.get(c.get("partner1_id"))
        m2 = members_by_id.get(c.get("partner2_id"))
        if not m1 or not m2:
            continue
        same_logic = (m1.get("current_logic") == m2.get("current_logic"))
        if c.get("sync_pref") == "same" and not same_logic:
            issues.append({"type": "couple_sync_broken",
                           "severity": "warning",
                           "members": [str(m1["_id"]), str(m2["_id"])],
                           "message": f"{m1.get('user_name','?')} und {m2.get('user_name','?')} wollten die Kinder gleichzeitig haben, haben aber unterschiedliche Wochenend-Logiken."})
        if c.get("sync_pref") == "opposite" and same_logic:
            issues.append({"type": "couple_split_broken",
                           "severity": "warning",
                           "members": [str(m1["_id"]), str(m2["_id"])],
                           "message": f"{m1.get('user_name','?')} und {m2.get('user_name','?')} wollten die Kinder abwechselnd haben, haben aber die gleichen Wochenend-Logiken."})
        if not c.get("confirmed_by_both"):
            issues.append({"type": "couple_unconfirmed",
                           "severity": "info",
                           "members": [str(m1["_id"]), str(m2["_id"])],
                           "message": f"Die Partnerschaft zwischen {m1.get('user_name','?')} und {m2.get('user_name','?')} wurde noch nicht von beiden bestätigt."})
    # Co-parent asymmetry check (both sides must agree)
    coparents = await db.coparent_relations.find({"chain_id": chain_id}).to_list(50)
    pairs_seen = set()
    for r in coparents:
        key = frozenset([r.get("parent1_id"), r.get("parent2_id")])
        pairs_seen.add(key)
    # (No deep asymmetry check needed if only stored once; if asymmetric entries exist, the UI rejects them)
    return {"issues": issues, "couples_count": len(couples), "coparents_count": len(coparents)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
