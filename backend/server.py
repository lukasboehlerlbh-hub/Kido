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

def calculate_plan(members):
    member_ids = [str(m.get("id") or str(m.get("_id", ""))) for m in members]
    weekends = get_next_weekends(8)
    current = calc_schedule(members)
    conflicts = find_conflicts(current, member_ids)
    if not conflicts:
        return {"type": "clean", "pivot_id": None, "pivot_name": None, "new_logic": None,
                "schedule": current, "proposed_schedule": current, "weekends": weekends,
                "kido_message": KIDO_MSG["clean"]}
    for c in sorted(members, key=lambda m: FLEX_SCORES.get(get_effective_flex(m), 0), reverse=True):
        if FLEX_SCORES.get(get_effective_flex(c), 0) <= 1:
            continue
        cid = str(c.get("id") or str(c.get("_id", "")))
        nl = "odd" if c.get("current_logic","even") == "even" else "even"
        trial = calc_schedule(members, {cid: nl})
        if not find_conflicts(trial, member_ids):
            ungern = c.get("flex_level") in ["rel", "temp"]
            return {"type": "ungern" if ungern else "clean", "pivot_id": cid,
                    "pivot_name": c.get("user_name",""), "new_logic": nl,
                    "schedule": current, "proposed_schedule": trial, "weekends": weekends,
                    "kido_message": KIDO_MSG["ungern"] if ungern else KIDO_MSG["clean"]}
    return {"type": "blocked", "pivot_id": None, "pivot_name": None, "new_logic": None,
            "schedule": current, "proposed_schedule": current, "weekends": weekends,
            "kido_message": KIDO_MSG["blocked"]}

KIDO_MSG = {
    "clean": "Liebe Elternkette – ich habe eine Lösung gefunden, die für alle passen sollte. Bitte schaut euch den Vorschlag an.",
    "ungern": "Kido hat eine mögliche Lösung gefunden – aber sie hängt an einer Person. Jemand müsste seine Wochenendlogik wechseln. Wenn diese Person bereit ist, löst das den Konflikt für die gesamte Kette.",
    "blocked": "Kido hat alle Möglichkeiten durchgespielt. Leider gibt es derzeit keine Lösung, die für alle passt. Eine Mediation könnte helfen.",
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
    date_from: str
    date_to: str
    wish: str
    is_shared: bool = False
    note: Optional[str] = None

class UpdateHolidayWishRequest(BaseModel):
    wish: Optional[str] = None
    status: Optional[str] = None
    is_shared: Optional[bool] = None
    note: Optional[str] = None

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

    plan = {"chain_id": chain_id, "status": "proposed", "proposal_type": result["type"],
            "pivot_member_id": result.get("pivot_id"), "pivot_member_name": result.get("pivot_name"),
            "pivot_new_logic": result.get("new_logic"), "schedule": result["schedule"],
            "proposed_schedule": result["proposed_schedule"],
            "weekends": result["weekends"], "kido_message": result["kido_message"],
            "created_date": datetime.now(timezone.utc)}
    plan_result = await db.weekend_plans.insert_one(plan)
    plan_id = str(plan_result.inserted_id)

    for m in members_data:
        vote = {"plan_id": plan_id, "member_id": m["id"], "member_name": m["user_name"],
                "vote": "pending", "created_date": datetime.now(timezone.utc)}
        await db.plan_votes.insert_one(vote)

    plan["_id"] = plan_result.inserted_id
    plan_data = serialize_doc(plan)
    plan_data["votes"] = []
    return plan_data

@app.post("/api/weekend-plans/{plan_id}/vote")
async def vote_plan(plan_id: str, req: VoteRequest):
    if not ObjectId.is_valid(plan_id):
        raise HTTPException(status_code=400, detail="Invalid plan ID")
    await db.plan_votes.update_one({"plan_id": plan_id, "member_id": req.member_id},
        {"$set": {"vote": req.vote, "voted_date": datetime.now(timezone.utc)}})
    votes = await db.plan_votes.find({"plan_id": plan_id}).to_list(20)
    all_voted = all(v["vote"] != "pending" for v in votes)
    if all_voted:
        all_accepted = all(v["vote"] == "accepted" for v in votes)
        new_status = "accepted" if all_accepted else "partial"
        await db.weekend_plans.update_one({"_id": ObjectId(plan_id)},
            {"$set": {"status": new_status, "resolved_date": datetime.now(timezone.utc)}})
        if all_accepted:
            plan = await db.weekend_plans.find_one({"_id": ObjectId(plan_id)})
            if plan and plan.get("pivot_member_id"):
                await db.chain_members.update_one(
                    {"_id": ObjectId(plan["pivot_member_id"])},
                    {"$set": {"current_logic": plan["pivot_new_logic"]}})
    plan = await db.weekend_plans.find_one({"_id": ObjectId(plan_id)})
    result = serialize_doc(plan)
    result["votes"] = [serialize_doc(v) for v in votes]
    return result

# Holiday Wishes
@app.get("/api/chains/{chain_id}/holiday-wishes")
async def get_holiday_wishes(chain_id: str, year: Optional[int] = None):
    query = {"chain_id": chain_id}
    if year:
        query["year"] = year
    wishes = await db.holiday_wishes.find(query).sort("date_from", 1).to_list(100)
    return [serialize_doc(w) for w in wishes]

@app.post("/api/holiday-wishes")
async def create_holiday_wish(req: HolidayWishRequest):
    wish = {"member_id": req.member_id, "chain_id": req.chain_id, "year": req.year,
            "period_type": req.period_type, "period_label": req.period_label,
            "date_from": req.date_from, "date_to": req.date_to, "wish": req.wish,
            "status": "pending", "is_shared": req.is_shared, "note": req.note,
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
