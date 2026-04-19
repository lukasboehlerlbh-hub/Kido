"""Backend tests for the NEW escalation model and ferien schema.

Covers:
  1. POST /api/chains/{chain_id}/calculate-plan → escalation_stage, is_active on votes
  2. POST /api/weekend-plans/{plan_id}/reconsider
  3. POST /api/weekend-plans/{plan_id}/try-next-pivot
  4. POST /api/weekend-plans/{plan_id}/escalate-3b
  5. Vote all_voted logic (only active votes)
  6. Ferien: POST /api/holiday-wishes with new fields; visibility filter; partner_status
  7. POST /api/dev/seed-test-chain

The tests use the real 6-member seed scenario:
  Anna Muster (host, even, rel, no_court) – expected ungern pivot
  Peter Muster (even, no, court_strict) – blocker (effective flex=ext)
  Sara Beispiel (odd, disc, court_no_logic)
  Tom Testmann (even, disc, no_court)
  Lisa Meier (odd, no, court_willing)
  Max Keller (even, temp, no_court)
"""
import os
import sys
import json
import requests

BASE_URL = "https://family-chain-planner.preview.emergentagent.com/api"

PASSED = 0
FAILED = 0
FAILURES: list[str] = []


def check(name: str, cond: bool, detail: str = ""):
    global PASSED, FAILED
    if cond:
        PASSED += 1
        print(f"  PASS: {name}")
    else:
        FAILED += 1
        FAILURES.append(f"{name} :: {detail}")
        print(f"  FAIL: {name} – {detail}")


def dump(obj):
    return json.dumps(obj, indent=2, ensure_ascii=False, default=str)[:1200]


# ────────────────────────────────────────────────────────────────────────────
# Section 1: Seed + initial plan state
# ────────────────────────────────────────────────────────────────────────────
print("\n=== 1. POST /api/dev/seed-test-chain ===")
r = requests.post(f"{BASE_URL}/dev/seed-test-chain", timeout=30)
check("seed returns 200", r.status_code == 200, f"status={r.status_code}, body={r.text[:300]}")
seed = r.json() if r.status_code == 200 else {}
chain_id = seed.get("chain_id")
members = seed.get("members", [])
check("seed has chain_id", bool(chain_id))
check("seed has 6 members", len(members) == 6, f"got {len(members)}")
check("seed conflict_scenario is ungern", seed.get("conflict_scenario") == "ungern", f"got {seed.get('conflict_scenario')}")
check("seed pivot_member_name is Anna Muster", seed.get("pivot_member_name") == "Anna Muster",
      f"got {seed.get('pivot_member_name')}")

# Identify members by name
by_name = {m["user_name"]: m for m in members}
anna = by_name.get("Anna Muster", {})
peter = by_name.get("Peter Muster", {})
tom = by_name.get("Tom Testmann", {})
anna_id = anna.get("member_id")
peter_id = peter.get("member_id")
tom_id = tom.get("member_id")

# ────────────────────────────────────────────────────────────────────────────
# Section 2: Calculate a fresh plan → verify new escalation fields
# ────────────────────────────────────────────────────────────────────────────
print("\n=== 2. POST /api/chains/{chain_id}/calculate-plan → escalation_stage=2_ungern ===")
r = requests.post(f"{BASE_URL}/chains/{chain_id}/calculate-plan", timeout=30)
check("calculate-plan returns 200", r.status_code == 200, f"body={r.text[:300]}")
plan = r.json() if r.status_code == 200 else {}
plan_id = plan.get("id")

check("plan has escalation_stage field", "escalation_stage" in plan,
      f"keys={list(plan.keys())[:20]}")
check("plan escalation_stage == 2_ungern",
      plan.get("escalation_stage") == "2_ungern",
      f"got {plan.get('escalation_stage')}")
check("plan has rejected_pivot_ids (list, empty)",
      isinstance(plan.get("rejected_pivot_ids"), list) and len(plan.get("rejected_pivot_ids", [])) == 0,
      f"got {plan.get('rejected_pivot_ids')}")
check("plan has reconsider_count (dict, empty)",
      isinstance(plan.get("reconsider_count"), dict) and len(plan.get("reconsider_count", {})) == 0,
      f"got {plan.get('reconsider_count')}")
check("plan has blockers (empty list)",
      isinstance(plan.get("blockers"), list) and len(plan.get("blockers", [])) == 0,
      f"got {plan.get('blockers')}")
check("plan subgroups is None at stage 2", plan.get("subgroups") is None,
      f"got {plan.get('subgroups')}")
check("plan pivot_member_id == Anna", plan.get("pivot_member_id") == anna_id,
      f"got {plan.get('pivot_member_id')} vs anna={anna_id}")

votes = plan.get("votes", [])
check("plan has 6 votes", len(votes) == 6, f"got {len(votes)}")
anna_vote = next((v for v in votes if v["member_id"] == anna_id), None)
other_votes = [v for v in votes if v["member_id"] != anna_id]
check("Anna vote is_active=True", bool(anna_vote and anna_vote.get("is_active") is True),
      f"anna_vote={anna_vote}")
check("Anna vote == pending", bool(anna_vote and anna_vote.get("vote") == "pending"),
      f"vote={anna_vote.get('vote') if anna_vote else None}")
check("All other 5 votes is_active=False",
      all(v.get("is_active") is False for v in other_votes),
      f"others={[{'n':v['member_name'],'a':v.get('is_active')} for v in other_votes]}")
check("All other 5 votes == 'na'",
      all(v.get("vote") == "na" for v in other_votes),
      f"others={[v.get('vote') for v in other_votes]}")

# ────────────────────────────────────────────────────────────────────────────
# Section 3: Anna votes 'declined' → plan should stay not 'accepted'
# ────────────────────────────────────────────────────────────────────────────
print("\n=== 3. Anna votes 'declined' → plan status partial ===")
r = requests.post(f"{BASE_URL}/weekend-plans/{plan_id}/vote",
                  json={"member_id": anna_id, "vote": "declined"}, timeout=30)
check("vote declined returns 200", r.status_code == 200, f"body={r.text[:300]}")
voted = r.json() if r.status_code == 200 else {}
check("Anna vote registered as declined",
      any(v["member_id"] == anna_id and v["vote"] == "declined" for v in voted.get("votes", [])),
      f"votes={voted.get('votes')}")
check("Plan status not 'accepted'",
      voted.get("status") != "accepted",
      f"status={voted.get('status')}")
# With only active member voting and declining → all_voted=True, all_accepted=False → status=partial
check("Plan status == 'partial' after only-active-voter declined",
      voted.get("status") == "partial",
      f"status={voted.get('status')}")

# ────────────────────────────────────────────────────────────────────────────
# Section 4: reconsider endpoint
# ────────────────────────────────────────────────────────────────────────────
print("\n=== 4. POST /api/weekend-plans/{plan_id}/reconsider ===")
r = requests.post(f"{BASE_URL}/weekend-plans/{plan_id}/reconsider", timeout=30)
check("reconsider returns 200", r.status_code == 200, f"body={r.text[:300]}")
rec = r.json() if r.status_code == 200 else {}

anna_vote2 = next((v for v in rec.get("votes", []) if v["member_id"] == anna_id), None)
check("Anna vote reset to 'pending'",
      bool(anna_vote2 and anna_vote2.get("vote") == "pending"),
      f"anna_vote={anna_vote2}")
rc = rec.get("reconsider_count", {})
check("reconsider_count[anna_id] == 1", rc.get(anna_id) == 1, f"rc={rc}")
check("kido_message updated for reconsider",
      "überdenken" in (rec.get("kido_message", "") or "").lower() or
      "nochmal" in (rec.get("kido_message", "") or "").lower() or
      "denken" in (rec.get("kido_message", "") or "").lower(),
      f"msg={rec.get('kido_message')[:200] if rec.get('kido_message') else None}")

# ────────────────────────────────────────────────────────────────────────────
# Section 5: Anna declines again → try-next-pivot → expect 3a_blockers
# ────────────────────────────────────────────────────────────────────────────
print("\n=== 5. Anna declines again → try-next-pivot → 3a_blockers ===")
r = requests.post(f"{BASE_URL}/weekend-plans/{plan_id}/vote",
                  json={"member_id": anna_id, "vote": "declined"}, timeout=30)
check("second decline returns 200", r.status_code == 200)

r = requests.post(f"{BASE_URL}/weekend-plans/{plan_id}/try-next-pivot", timeout=30)
check("try-next-pivot returns 200", r.status_code == 200, f"body={r.text[:300]}")
plan2 = r.json() if r.status_code == 200 else {}
plan2_id = plan2.get("id")
check("new plan_id differs from previous", plan2_id and plan2_id != plan_id,
      f"plan2_id={plan2_id}, plan_id={plan_id}")
check("new plan escalation_stage == '3a_blockers'",
      plan2.get("escalation_stage") == "3a_blockers",
      f"stage={plan2.get('escalation_stage')}, type={plan2.get('proposal_type')}")
rpi = plan2.get("rejected_pivot_ids", [])
check("rejected_pivot_ids contains Anna",
      anna_id in rpi, f"rpi={rpi}, anna_id={anna_id}")
blockers = plan2.get("blockers", [])
check("blockers is non-empty",
      isinstance(blockers, list) and len(blockers) > 0, f"blockers={blockers}")
check("blockers contains Peter (court_strict)", peter_id in blockers,
      f"blockers={blockers}, peter_id={peter_id}")

# Vote is_active: only blockers active
votes2 = plan2.get("votes", [])
active_ids = {v["member_id"] for v in votes2 if v.get("is_active")}
check("Only blockers are active in votes",
      active_ids == set(blockers),
      f"active={active_ids}, blockers={set(blockers)}")
# All non-blocker votes should be 'na' and is_active False
non_active_ok = all(
    v.get("vote") == "na" and v.get("is_active") is False
    for v in votes2 if v["member_id"] not in blockers
)
check("Non-blocker votes are 'na' and is_active=False", non_active_ok,
      f"votes={[(v['member_name'], v.get('vote'), v.get('is_active')) for v in votes2]}")

# ────────────────────────────────────────────────────────────────────────────
# Section 6: escalate-3b
# ────────────────────────────────────────────────────────────────────────────
print("\n=== 6. POST /api/weekend-plans/{plan_id}/escalate-3b ===")
r = requests.post(f"{BASE_URL}/weekend-plans/{plan2_id}/escalate-3b", timeout=30)
check("escalate-3b returns 200", r.status_code == 200, f"body={r.text[:300]}")
plan3 = r.json() if r.status_code == 200 else {}
check("plan escalation_stage == '3b_subgroups'",
      plan3.get("escalation_stage") == "3b_subgroups",
      f"stage={plan3.get('escalation_stage')}")
check("plan subgroups is non-null list",
      isinstance(plan3.get("subgroups"), list) and len(plan3.get("subgroups", [])) > 0,
      f"subgroups={plan3.get('subgroups')}")
votes3 = plan3.get("votes", [])
all_active = all(v.get("is_active") is True for v in votes3)
check("All 6 votes re-activated (is_active=True)", all_active,
      f"votes={[(v['member_name'], v.get('is_active')) for v in votes3]}")
all_pending = all(v.get("vote") == "pending" for v in votes3)
check("All 6 votes reset to 'pending'", all_pending,
      f"votes={[(v['member_name'], v.get('vote')) for v in votes3]}")

# ────────────────────────────────────────────────────────────────────────────
# Section 7: Ferien schema – new fields + visibility
# ────────────────────────────────────────────────────────────────────────────
print("\n=== 7. Ferien schema – new fields + visibility filter ===")
# Create a private wish: Anna asks Peter
wish_body = {
    "member_id": anna_id,
    "chain_id": chain_id,
    "year": 2026,
    "period_type": "sommer",
    "period_label": "Sommerferien",
    "title": "Sommerreise",
    "date_from": "2026-07-20",
    "date_to": "2026-08-02",
    "wish": "partner",
    "wish_target_member_id": peter_id,
    "children_names": ["Mia", "Tom"],
    "is_shared": False,
    "note": "Kannst du Peter?",
}
r = requests.post(f"{BASE_URL}/holiday-wishes", json=wish_body, timeout=30)
check("create private holiday wish returns 200", r.status_code == 200, f"body={r.text[:300]}")
wish = r.json() if r.status_code == 200 else {}
wish_id = wish.get("id")
check("wish has title", wish.get("title") == "Sommerreise")
check("wish has wish_target_member_id", wish.get("wish_target_member_id") == peter_id)
check("wish has children_names", wish.get("children_names") == ["Mia", "Tom"])
check("wish has partner_status default 'pending'", wish.get("partner_status") == "pending",
      f"partner_status={wish.get('partner_status')}")
check("wish value is 'partner' (new allowed value)", wish.get("wish") == "partner")

# Visibility: Anna (creator) → visible
r = requests.get(f"{BASE_URL}/chains/{chain_id}/holiday-wishes",
                 params={"year": 2026, "viewer_member_id": anna_id}, timeout=30)
check("GET wishes (viewer=Anna) returns 200", r.status_code == 200)
anna_view = r.json() if r.status_code == 200 else []
check("Anna (creator) sees the private wish",
      any(w.get("id") == wish_id for w in anna_view),
      f"ids={[w.get('id') for w in anna_view]}")

# Visibility: Peter (target) → visible
r = requests.get(f"{BASE_URL}/chains/{chain_id}/holiday-wishes",
                 params={"year": 2026, "viewer_member_id": peter_id}, timeout=30)
peter_view = r.json() if r.status_code == 200 else []
check("Peter (target) sees the private wish",
      any(w.get("id") == wish_id for w in peter_view),
      f"ids={[w.get('id') for w in peter_view]}")

# Visibility: Tom (other, NOT target) → NOT visible
r = requests.get(f"{BASE_URL}/chains/{chain_id}/holiday-wishes",
                 params={"year": 2026, "viewer_member_id": tom_id}, timeout=30)
tom_view = r.json() if r.status_code == 200 else []
check("Tom (other) does NOT see the private wish",
      not any(w.get("id") == wish_id for w in tom_view),
      f"ids={[w.get('id') for w in tom_view]}")

# Flip is_shared=True via PUT → all viewers should see it
r = requests.put(f"{BASE_URL}/holiday-wishes/{wish_id}",
                 json={"is_shared": True}, timeout=30)
check("PUT wish is_shared=True returns 200", r.status_code == 200, f"body={r.text[:300]}")
updated = r.json() if r.status_code == 200 else {}
check("wish is_shared now True", updated.get("is_shared") is True)

r = requests.get(f"{BASE_URL}/chains/{chain_id}/holiday-wishes",
                 params={"year": 2026, "viewer_member_id": tom_id}, timeout=30)
tom_view2 = r.json() if r.status_code == 200 else []
check("Tom now sees the wish after is_shared=True",
      any(w.get("id") == wish_id for w in tom_view2),
      f"ids={[w.get('id') for w in tom_view2]}")

# PUT partner_status='accepted'
r = requests.put(f"{BASE_URL}/holiday-wishes/{wish_id}",
                 json={"partner_status": "accepted"}, timeout=30)
check("PUT partner_status='accepted' returns 200", r.status_code == 200, f"body={r.text[:300]}")
accepted_wish = r.json() if r.status_code == 200 else {}
check("wish partner_status persisted = 'accepted'",
      accepted_wish.get("partner_status") == "accepted",
      f"partner_status={accepted_wish.get('partner_status')}")

# ────────────────────────────────────────────────────────────────────────────
# Section 8: ungern_accepted_public message on stage 2 success
# ────────────────────────────────────────────────────────────────────────────
print("\n=== 8. Stage 2_ungern → all active accept → public message ===")
# Re-seed + re-calc
r = requests.post(f"{BASE_URL}/dev/seed-test-chain", timeout=30)
seed2 = r.json() if r.status_code == 200 else {}
chain_id2 = seed2.get("chain_id")
anna_id2 = next((m["member_id"] for m in seed2.get("members", []) if m["user_name"] == "Anna Muster"), None)

r = requests.post(f"{BASE_URL}/chains/{chain_id2}/calculate-plan", timeout=30)
plan_b = r.json() if r.status_code == 200 else {}
plan_b_id = plan_b.get("id")
check("second calc-plan is 2_ungern", plan_b.get("escalation_stage") == "2_ungern",
      f"stage={plan_b.get('escalation_stage')}")

r = requests.post(f"{BASE_URL}/weekend-plans/{plan_b_id}/vote",
                  json={"member_id": anna_id2, "vote": "accepted"}, timeout=30)
accepted_plan = r.json() if r.status_code == 200 else {}
check("plan status 'accepted' when pivot accepts",
      accepted_plan.get("status") == "accepted",
      f"status={accepted_plan.get('status')}")
msg = (accepted_plan.get("kido_message") or "")
check("kido_message updated to public announcement (mentions Anna)",
      "Anna" in msg and ("Dank" in msg or "gelöst" in msg.lower()),
      f"msg={msg[:250]}")

# ────────────────────────────────────────────────────────────────────────────
print("\n" + "=" * 60)
print(f"TOTAL: {PASSED} passed / {FAILED} failed")
if FAILED:
    print("\nFAILURES:")
    for f in FAILURES:
        print(f"  - {f}")
    sys.exit(1)
print("All escalation & ferien tests passed!")
