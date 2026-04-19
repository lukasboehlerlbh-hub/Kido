"""
Backend tests for Kido – Family Chain Planner.
Tests against external URL from /app/frontend/.env (EXPO_PUBLIC_BACKEND_URL) + /api prefix.
"""
import os
import re
import sys
import json
import time
import requests
from datetime import datetime
from pathlib import Path

# Load EXPO_PUBLIC_BACKEND_URL from /app/frontend/.env
ENV_PATH = Path("/app/frontend/.env")
BACKEND_URL = None
for line in ENV_PATH.read_text().splitlines():
    if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
        BACKEND_URL = line.split("=", 1)[1].strip().strip('"').strip("'")
        break
assert BACKEND_URL, "EXPO_PUBLIC_BACKEND_URL missing"
API = BACKEND_URL.rstrip("/") + "/api"
print(f"Using API base URL: {API}")

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

results = {"passed": [], "failed": []}

def ok(name, msg=""):
    print(f"  ✅ {name} {msg}")
    results["passed"].append(name)

def fail(name, msg):
    print(f"  ❌ {name}: {msg}")
    results["failed"].append((name, msg))

def section(title):
    print(f"\n=== {title} ===")


# ── TEST 1: Swiss Holidays 2026-2028 coverage ───────────────────────────────
section("1. Swiss Holidays 2026-2028 coverage")

KANTONE = ["ZH", "BE", "SG", "AG", "BS"]
EXPECTED_TYPES = {"fruehling", "sommer", "herbst", "weihnachten"}

for kanton in KANTONE:
    for year in [2026, 2027, 2028]:
        name = f"GET /swiss-holidays/{kanton}/{year}"
        try:
            r = requests.get(f"{API}/swiss-holidays/{kanton}/{year}", timeout=15)
            if r.status_code != 200:
                fail(name, f"HTTP {r.status_code}: {r.text[:200]}")
                continue
            data = r.json()
            if not isinstance(data, list):
                fail(name, f"Expected list, got {type(data).__name__}")
                continue
            if len(data) != 4:
                fail(name, f"Expected 4 entries, got {len(data)}")
                continue
            types = {h.get("type") for h in data}
            if types != EXPECTED_TYPES:
                fail(name, f"Types mismatch: {types}")
                continue
            bad_dates = False
            for h in data:
                df, dt = h.get("date_from"), h.get("date_to")
                if not (df and dt and DATE_RE.match(df) and DATE_RE.match(dt)):
                    fail(name, f"Invalid date format: {df} / {dt}")
                    bad_dates = True
                    break
                if datetime.fromisoformat(df) >= datetime.fromisoformat(dt):
                    fail(name, f"date_from >= date_to for {h['type']}: {df} / {dt}")
                    bad_dates = True
                    break
            if not bad_dates:
                ok(name, f"({len(data)} periods, types ok)")
        except Exception as e:
            fail(name, f"Exception: {e}")

# Year 2025 should NOT be supported
for kanton in ["ZH", "BE"]:
    name = f"GET /swiss-holidays/{kanton}/2025 (should be empty)"
    try:
        r = requests.get(f"{API}/swiss-holidays/{kanton}/2025", timeout=15)
        if r.status_code == 200 and r.json() == []:
            ok(name)
        else:
            fail(name, f"Expected empty list, got {r.status_code} / {r.text[:100]}")
    except Exception as e:
        fail(name, f"Exception: {e}")


# ── TEST 2: Court Ruling – 4 states incl. court_strict flex override ────────
section("2. Court Ruling – 4 states + court_strict override")

# Create chain for Anna
def create_chain(user_name, user_phone, color, chain_name=None):
    body = {"user_name": user_name, "user_phone": user_phone, "avatar_color": color}
    if chain_name:
        body["chain_name"] = chain_name
    r = requests.post(f"{API}/chains", json=body, timeout=15)
    r.raise_for_status()
    return r.json()

anna = None
try:
    anna = create_chain("Anna Muster", f"+4179{int(time.time())%10000000:07d}", "#1D9E75", "Familie Muster")
    ok("POST /chains – Anna Muster", f"(member_id={anna['member_id']})")
except Exception as e:
    fail("POST /chains – Anna Muster", str(e))

if anna:
    for court_state in ["court_strict", "court_willing", "court_no_logic", "no_court"]:
        name = f"PUT preferences court_ruling={court_state}"
        try:
            prefs = {"court_ruling": court_state, "current_logic": "even", "flex_level": "yes"}
            r = requests.put(f"{API}/chain-members/{anna['member_id']}/preferences", json=prefs, timeout=15)
            if r.status_code != 200:
                fail(name, f"HTTP {r.status_code}: {r.text[:200]}")
                continue
            m = r.json()
            if m.get("court_ruling") != court_state:
                fail(name, f"stored court_ruling={m.get('court_ruling')}, expected {court_state}")
                continue
            if m.get("flex_level") != "yes":
                fail(name, f"stored flex_level={m.get('flex_level')}, expected 'yes'")
                continue
            ok(name)
        except Exception as e:
            fail(name, f"Exception: {e}")

# Multi-member chain: Anna court_strict (yes), Peter no_court (yes), both logic=even
section("2b. Court strict excludes Anna as pivot (conflict → Peter pivots)")

conflict_chain = None
peter = None
if anna:
    try:
        # Build a fresh chain to avoid contaminating anna prefs
        host = create_chain("Anna Keller", f"+4178{int(time.time())%10000000:07d}", "#1D9E75", "Keller Familie")
        # Create invitation
        invite_body = {"chain_id": host["chain_id"], "invited_by_id": host["user_id"],
                       "phone_number": f"+4178{(int(time.time())+1)%10000000:07d}"}
        r = requests.post(f"{API}/invitations", json=invite_body, timeout=15)
        r.raise_for_status()
        inv = r.json()
        ok("POST /invitations", f"(token={inv['token']})")

        # Accept invitation as Peter
        accept_body = {"user_name": "Peter Keller", "user_phone": f"+4178{(int(time.time())+2)%10000000:07d}",
                       "avatar_color": "#8B5CF6"}
        r = requests.post(f"{API}/invitations/{inv['token']}/accept", json=accept_body, timeout=15)
        r.raise_for_status()
        peter = r.json()
        ok("POST /invitations/{token}/accept", f"(member_id={peter['member_id']})")

        # Set Anna: court_strict + flex=yes + logic=even
        requests.put(f"{API}/chain-members/{host['member_id']}/preferences",
                     json={"court_ruling": "court_strict", "current_logic": "even", "flex_level": "yes"},
                     timeout=15).raise_for_status()
        # Set Peter: no_court + flex=yes + logic=even (conflict)
        requests.put(f"{API}/chain-members/{peter['member_id']}/preferences",
                     json={"court_ruling": "no_court", "current_logic": "even", "flex_level": "yes"},
                     timeout=15).raise_for_status()
        ok("Both members preferences set (conflicting even/even)")

        # Calculate plan
        r = requests.post(f"{API}/chains/{host['chain_id']}/calculate-plan", timeout=15)
        if r.status_code != 200:
            fail("POST /calculate-plan", f"HTTP {r.status_code}: {r.text[:200]}")
        else:
            plan = r.json()
            ptype = plan.get("proposal_type")
            pivot_id = plan.get("pivot_member_id")
            pivot_name = plan.get("pivot_member_name")
            print(f"    plan type={ptype} pivot={pivot_name} ({pivot_id})")

            if ptype == "blocked":
                fail("Court strict plan outcome", f"Got 'blocked' – expected resolvable via Peter")
            elif ptype not in ("clean", "ungern"):
                fail("Court strict plan outcome", f"Unexpected type: {ptype}")
            elif pivot_id == host["member_id"]:
                fail("Court strict flex override", "Anna was chosen as pivot despite court_strict (should be excluded)")
            elif pivot_id == peter["member_id"]:
                ok("Court strict flex override", f"Peter (no_court) was pivot, Anna excluded ✓ (type={ptype})")
                conflict_chain = {"host": host, "peter": peter, "plan_id": plan["id"]}
            else:
                fail("Court strict flex override", f"Unexpected pivot_id={pivot_id}")
    except Exception as e:
        fail("Court strict flow", f"Exception: {e}")


# ── TEST 3: Full end-to-end flow ────────────────────────────────────────────
section("3. Full end-to-end flow smoke test")

e2e = {}
try:
    host = create_chain("Laura Weber", f"+4176{int(time.time())%10000000:07d}", "#1D9E75", "Weber Familie")
    e2e["host"] = host

    inv_body = {"chain_id": host["chain_id"], "invited_by_id": host["user_id"],
                "phone_number": f"+4176{(int(time.time())+10)%10000000:07d}"}
    inv = requests.post(f"{API}/invitations", json=inv_body, timeout=15).json()
    accept_body = {"user_name": "Marco Weber", "user_phone": f"+4176{(int(time.time())+11)%10000000:07d}",
                   "avatar_color": "#8B5CF6"}
    partner = requests.post(f"{API}/invitations/{inv['token']}/accept", json=accept_body, timeout=15).json()
    e2e["partner"] = partner
    ok("E2E chain + invitation + accept")

    # Opposite logics → no conflict (clean)
    requests.put(f"{API}/chain-members/{host['member_id']}/preferences",
                 json={"court_ruling": "no_court", "current_logic": "even", "flex_level": "disc"}, timeout=15).raise_for_status()
    requests.put(f"{API}/chain-members/{partner['member_id']}/preferences",
                 json={"court_ruling": "no_court", "current_logic": "odd", "flex_level": "disc"}, timeout=15).raise_for_status()
    ok("E2E set preferences for both members")

    plan = requests.post(f"{API}/chains/{host['chain_id']}/calculate-plan", timeout=15).json()
    ptype = plan.get("proposal_type")
    if ptype == "clean":
        ok("E2E calculate-plan (opposite logics = clean)")
    else:
        fail("E2E calculate-plan", f"Expected 'clean', got {ptype}")
    plan_id = plan.get("id")

    # Both vote accepted
    for mid in [host["member_id"], partner["member_id"]]:
        rv = requests.post(f"{API}/weekend-plans/{plan_id}/vote",
                           json={"member_id": mid, "vote": "accepted"}, timeout=15)
        if rv.status_code != 200:
            fail("E2E vote", f"HTTP {rv.status_code}: {rv.text[:200]}")
            break
    # Check final status
    final = requests.get(f"{API}/chains/{host['chain_id']}/weekend-plan", timeout=15).json()
    if final and final.get("status") == "accepted":
        ok("E2E plan status → accepted")
    else:
        fail("E2E plan status", f"status={final.get('status') if final else None}")

    # Pivot current_logic update (only if pivot existed). Clean with no pivot → skip.
    if plan.get("pivot_member_id"):
        pm = requests.get(f"{API}/chain-members/{plan['pivot_member_id']}", timeout=15).json()
        if pm.get("current_logic") == plan.get("pivot_new_logic"):
            ok("E2E pivot current_logic updated after full accept")
        else:
            fail("E2E pivot current_logic update",
                 f"got {pm.get('current_logic')}, expected {plan.get('pivot_new_logic')}")
    else:
        print("    (no pivot – skipping current_logic update check)")

    # Holiday wish 2027
    wish_body = {"member_id": host["member_id"], "chain_id": host["chain_id"], "year": 2027,
                 "period_type": "sommer", "period_label": "Sommerferien",
                 "date_from": "2027-07-12", "date_to": "2027-08-15",
                 "wish": "Italien Ferien mit den Kindern", "is_shared": False,
                 "note": "Flugtickets bereits gebucht"}
    rw = requests.post(f"{API}/holiday-wishes", json=wish_body, timeout=15)
    if rw.status_code != 200:
        fail("E2E create holiday wish", f"HTTP {rw.status_code}: {rw.text[:200]}")
    else:
        wish = rw.json()
        wish_id = wish["id"]
        # Share it
        ru = requests.put(f"{API}/holiday-wishes/{wish_id}", json={"is_shared": True}, timeout=15)
        if ru.status_code != 200 or ru.json().get("is_shared") is not True:
            fail("E2E share holiday wish", f"got is_shared={ru.json().get('is_shared')}")
        else:
            ok("E2E holiday wish created + shared")

        # Partner accepts
        ra = requests.put(f"{API}/holiday-wishes/{wish_id}", json={"status": "accepted"}, timeout=15)
        if ra.status_code == 200 and ra.json().get("status") == "accepted":
            ok("E2E partner accepts holiday wish")
        else:
            fail("E2E partner accepts holiday wish", f"got status={ra.json().get('status')}")

        # List with year filter
        rl = requests.get(f"{API}/chains/{host['chain_id']}/holiday-wishes", params={"year": 2027}, timeout=15)
        if rl.status_code == 200 and any(w.get("id") == wish_id for w in rl.json()):
            ok("E2E GET holiday-wishes?year=2027")
        else:
            fail("E2E GET holiday-wishes", f"wish not listed: {rl.status_code}")

    # Chain message
    cm = requests.post(f"{API}/messages", json={"sender_id": host["user_id"],
                                                 "chain_id": host["chain_id"],
                                                 "recipient_id": None,
                                                 "text": "Hoi zäme, hier ist Laura."}, timeout=15)
    if cm.status_code == 200 and "message" in cm.json():
        ok("E2E chain message sent")
    else:
        fail("E2E chain message", f"HTTP {cm.status_code}: {cm.text[:200]}")

    # Kido message
    km = requests.post(f"{API}/messages", json={"sender_id": host["user_id"],
                                                 "chain_id": None,
                                                 "recipient_id": "kido",
                                                 "text": "Hallo Kido, wie plane ich Sommerferien?"}, timeout=15)
    if km.status_code == 200:
        body = km.json()
        kr = body.get("kido_response")
        if kr and kr.get("text") and kr.get("sender_id") == "kido":
            ok("E2E Kido AI response returned", f"('{kr['text'][:60]}...')")
        else:
            fail("E2E Kido AI response", f"no kido_response in body: {body}")
    else:
        fail("E2E Kido message", f"HTTP {km.status_code}: {km.text[:200]}")

except Exception as e:
    fail("E2E flow", f"Exception: {e}")


# ── Summary ─────────────────────────────────────────────────────────────────
print("\n" + "=" * 60)
print(f"PASSED: {len(results['passed'])}")
print(f"FAILED: {len(results['failed'])}")
if results["failed"]:
    print("\nFailures:")
    for n, m in results["failed"]:
        print(f"  - {n}: {m}")
    sys.exit(1)
sys.exit(0)
