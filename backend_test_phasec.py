"""
Phase-C backend tests for Kido app.
Tests only NEW endpoints:
  - Chat Channels
  - Relationships (coparent / couple)
  - Consistency Check
  - Vote logic_changes field behaviour
"""
import os
import sys
import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://family-chain-planner.preview.emergentagent.com"
API = BASE.rstrip("/") + "/api"

results = []  # (name, ok, detail)


def check(name: str, ok: bool, detail: str = ""):
    results.append((name, ok, detail))
    prefix = "PASS" if ok else "FAIL"
    print(f"[{prefix}] {name}" + (f"  -- {detail}" if detail and not ok else ""))


def req(method, path, **kw):
    url = API + path
    r = requests.request(method, url, timeout=30, **kw)
    return r


# ── Seed a fresh chain ────────────────────────────────────────────────────────
print("\n=== Seeding test chain ===")
seed_r = req("POST", "/dev/seed-test-chain")
check("seed returns 200", seed_r.status_code == 200, f"status={seed_r.status_code} body={seed_r.text[:300]}")
if seed_r.status_code != 200:
    print("Cannot continue without seed")
    sys.exit(1)

seed = seed_r.json()
chain_id = seed["chain_id"]
members = seed["members"]
check("seed returns 6 members", len(members) == 6, f"got {len(members)}")

anna = members[0]   # host, flex=rel
peter = members[1]  # court_strict / flex=no
sara = members[2]
tom = members[3]
lisa = members[4]
max_m = members[5]

anna_mid = anna["member_id"]
peter_mid = peter["member_id"]
sara_mid = sara["member_id"]
tom_mid = tom["member_id"]
lisa_mid = lisa["member_id"]
max_mid = max_m["member_id"]

# ── 1. CHAT CHANNELS ──────────────────────────────────────────────────────────
print("\n=== Chat Channels ===")

# Create channel for Anna + Peter + Sara
r = req("POST", "/chat-channels", json={
    "chain_id": chain_id,
    "name": "Eltern-Abstimmung",
    "type": "subgroup_manual",
    "member_ids": [anna_mid, peter_mid, sara_mid],
    "created_by": anna_mid,
    "icon": "users",
    "color": "#1D9E75",
})
check("POST /chat-channels 200", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
ch = r.json() if r.status_code == 200 else {}
check("channel has id", bool(ch.get("id")), f"body={ch}")
check("channel name stored", ch.get("name") == "Eltern-Abstimmung")
check("channel member_ids stored",
      set(ch.get("member_ids", [])) == {anna_mid, peter_mid, sara_mid})
check("channel type stored", ch.get("type") == "subgroup_manual")
check("channel icon stored", ch.get("icon") == "users")
check("channel color stored", ch.get("color") == "#1D9E75")
channel_id = ch.get("id")

# Second channel only for Peter+Sara (for visibility filter test)
r2 = req("POST", "/chat-channels", json={
    "chain_id": chain_id,
    "name": "Nur Peter+Sara",
    "type": "subgroup_manual",
    "member_ids": [peter_mid, sara_mid],
})
check("POST /chat-channels (2nd) 200", r2.status_code == 200)
ch2 = r2.json() if r2.status_code == 200 else {}
ch2_id = ch2.get("id")

# List with no viewer filter → both channels
r = req("GET", f"/chains/{chain_id}/chat-channels")
check("GET list w/o viewer 200", r.status_code == 200)
lst = r.json()
check("list contains both channels", len(lst) >= 2, f"count={len(lst)}")

# List with viewer=anna → only channel 1 (anna is not in channel2)
r = req("GET", f"/chains/{chain_id}/chat-channels",
        params={"viewer_member_id": anna_mid})
check("GET list w/ viewer=anna 200", r.status_code == 200)
lst_a = r.json()
ids_a = {c["id"] for c in lst_a}
check("viewer=anna sees channel 1", channel_id in ids_a)
check("viewer=anna does NOT see channel 2 (not in members)",
      ch2_id not in ids_a, f"saw={ids_a}")

# List with viewer=tom → sees neither (tom is in no channel)
r = req("GET", f"/chains/{chain_id}/chat-channels",
        params={"viewer_member_id": tom_mid})
lst_t = r.json()
check("viewer=tom sees no channels", len(lst_t) == 0, f"got {len(lst_t)}")

# PUT partial update name/color
r = req("PUT", f"/chat-channels/{channel_id}",
        json={"name": "Eltern-Rat", "color": "#F59E0B"})
check("PUT channel 200", r.status_code == 200)
upd = r.json()
check("channel name updated", upd.get("name") == "Eltern-Rat")
check("channel color updated", upd.get("color") == "#F59E0B")
check("channel icon preserved", upd.get("icon") == "users")
check("channel members preserved",
      set(upd.get("member_ids", [])) == {anna_mid, peter_mid, sara_mid})

# PUT update member_ids
r = req("PUT", f"/chat-channels/{channel_id}",
        json={"member_ids": [anna_mid, peter_mid]})
check("PUT channel member_ids 200", r.status_code == 200)
upd2 = r.json()
check("channel members replaced",
      set(upd2.get("member_ids", [])) == {anna_mid, peter_mid})

# POST channel message
r = req("POST", "/channel-messages", json={
    "channel_id": channel_id,
    "sender_id": anna_mid,
    "sender_name": "Anna Muster",
    "text": "Hallo zusammen, könnt ihr bitte den Vorschlag anschauen?",
})
check("POST /channel-messages 200", r.status_code == 200)
msg = r.json()
check("channel msg has id", bool(msg.get("id")))
check("channel msg has channel_id", msg.get("channel_id") == channel_id)

# Second message for ordering
r = req("POST", "/channel-messages", json={
    "channel_id": channel_id,
    "sender_id": peter_mid,
    "sender_name": "Peter Muster",
    "text": "Ich schaue mir das heute Abend an.",
})
check("POST /channel-messages 2nd 200", r.status_code == 200)

# GET channel messages sorted ASC
r = req("GET", f"/channel-messages/{channel_id}")
check("GET channel messages 200", r.status_code == 200)
msgs = r.json()
check("2 messages returned", len(msgs) == 2, f"got {len(msgs)}")
if len(msgs) == 2:
    check("messages sorted ASC by created_date",
          msgs[0]["created_date"] <= msgs[1]["created_date"],
          f"{msgs[0]['created_date']} / {msgs[1]['created_date']}")
    check("first msg is Anna's", msgs[0]["sender_id"] == anna_mid)

# DELETE channel also removes messages
r = req("DELETE", f"/chat-channels/{channel_id}")
check("DELETE channel 200", r.status_code == 200)
r = req("GET", f"/channel-messages/{channel_id}")
check("channel messages removed after delete",
      r.status_code == 200 and len(r.json()) == 0,
      f"status={r.status_code} body={r.text[:200]}")

# Verify list no longer contains deleted channel
r = req("GET", f"/chains/{chain_id}/chat-channels")
lst_after = r.json()
check("deleted channel not in list",
      all(c["id"] != channel_id for c in lst_after))


# ── 2. RELATIONSHIPS ──────────────────────────────────────────────────────────
print("\n=== Relationships ===")

# Create coparent relation: Anna & Peter (children Mia, Tom)
r = req("POST", "/coparent-relations", json={
    "chain_id": chain_id,
    "parent1_id": anna_mid,
    "parent2_id": peter_mid,
    "children": [{"name": "Mia"}, {"name": "Tom"}],
})
check("POST /coparent-relations 200", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
cp = r.json()
coparent_id = cp.get("id")
check("coparent has id", bool(coparent_id))
check("coparent parent1", cp.get("parent1_id") == anna_mid)
check("coparent children len=2", len(cp.get("children", [])) == 2)

r = req("GET", f"/chains/{chain_id}/coparent-relations")
check("GET coparent-relations 200", r.status_code == 200)
cps = r.json()
check("coparent list contains created", any(c.get("id") == coparent_id for c in cps))

# Create a second coparent to delete
r = req("POST", "/coparent-relations", json={
    "chain_id": chain_id, "parent1_id": sara_mid, "parent2_id": tom_mid,
    "children": [{"name": "Leo"}],
})
second_cp = r.json().get("id")
r = req("DELETE", f"/coparent-relations/{second_cp}")
check("DELETE coparent 200", r.status_code == 200)
r = req("GET", f"/chains/{chain_id}/coparent-relations")
check("deleted coparent removed",
      all(c.get("id") != second_cp for c in r.json()))

# Couple relations
# Anna & Sara couple with sync_pref=same (NOTE: Anna current_logic=even, Sara=odd → sync broken)
r = req("POST", "/couple-relations", json={
    "chain_id": chain_id, "partner1_id": anna_mid, "partner2_id": sara_mid,
    "sync_pref": "same",
})
check("POST couple same 200", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
couple_same = r.json()
couple_same_id = couple_same.get("id")
check("couple confirmed_by_both=False by default",
      couple_same.get("confirmed_by_both") is False,
      f"got {couple_same.get('confirmed_by_both')}")
check("couple sync_pref stored", couple_same.get("sync_pref") == "same")

# Confirm this couple
r = req("PUT", f"/couple-relations/{couple_same_id}/confirm")
check("PUT confirm 200", r.status_code == 200)
confirmed = r.json()
check("couple confirmed_by_both=True after confirm",
      confirmed.get("confirmed_by_both") is True)

# Peter & Tom couple, sync_pref=opposite (Peter even, Tom even → split broken)
r = req("POST", "/couple-relations", json={
    "chain_id": chain_id, "partner1_id": peter_mid, "partner2_id": tom_mid,
    "sync_pref": "opposite",
})
couple_opp = r.json()
couple_opp_id = couple_opp.get("id")
# Confirm opposite so unconfirmed issue doesn't fire for it
req("PUT", f"/couple-relations/{couple_opp_id}/confirm")

# Lisa & Max couple, sync_pref=none (unconfirmed – should only produce couple_unconfirmed issue)
r = req("POST", "/couple-relations", json={
    "chain_id": chain_id, "partner1_id": lisa_mid, "partner2_id": max_mid,
    "sync_pref": "none",
})
couple_unc = r.json()
couple_unc_id = couple_unc.get("id")
check("unconfirmed couple created",
      couple_unc.get("confirmed_by_both") is False)

r = req("GET", f"/chains/{chain_id}/couple-relations")
check("GET couple-relations 200", r.status_code == 200)
couples = r.json()
check("all 3 couples listed", len(couples) >= 3, f"got {len(couples)}")

# ── 3. CONSISTENCY CHECK ──────────────────────────────────────────────────────
print("\n=== Consistency Check ===")

r = req("GET", f"/chains/{chain_id}/consistency-check")
check("GET consistency-check 200", r.status_code == 200)
cc = r.json()
check("response has issues list", isinstance(cc.get("issues"), list))
check("response has couples_count", cc.get("couples_count") == 3,
      f"got {cc.get('couples_count')}")
check("response has coparents_count", cc.get("coparents_count") == 1,
      f"got {cc.get('coparents_count')}")

issues = cc.get("issues", [])
issue_types = [i.get("type") for i in issues]

# 1) couple_sync_broken (Anna even, Sara odd, sync=same) -- confirmed, so ONLY sync_broken
sync_broken = [i for i in issues if i.get("type") == "couple_sync_broken"]
check("at least one couple_sync_broken issue", len(sync_broken) >= 1,
      f"issues={issue_types}")
if sync_broken:
    sb = sync_broken[0]
    check("couple_sync_broken severity=warning", sb.get("severity") == "warning")
    check("couple_sync_broken members includes anna & sara",
          set(sb.get("members", [])) == {anna_mid, sara_mid},
          f"got {sb.get('members')}")

# 2) couple_split_broken (Peter even, Tom even, sync=opposite) -- confirmed
split_broken = [i for i in issues if i.get("type") == "couple_split_broken"]
check("at least one couple_split_broken issue", len(split_broken) >= 1,
      f"issues={issue_types}")
if split_broken:
    sp = split_broken[0]
    check("couple_split_broken severity=warning", sp.get("severity") == "warning")
    check("couple_split_broken members includes peter & tom",
          set(sp.get("members", [])) == {peter_mid, tom_mid})

# 3) couple_unconfirmed (Lisa & Max, not confirmed)
unconfirmed = [i for i in issues if i.get("type") == "couple_unconfirmed"]
check("at least one couple_unconfirmed issue", len(unconfirmed) >= 1,
      f"issues={issue_types}")
if unconfirmed:
    un = unconfirmed[0]
    check("couple_unconfirmed severity=info", un.get("severity") == "info")
    # Specifically, the Lisa/Max pair should be the only unconfirmed
    lisa_max = next((i for i in unconfirmed
                     if set(i.get("members", [])) == {lisa_mid, max_mid}), None)
    check("Lisa & Max couple flagged as unconfirmed", lisa_max is not None,
          f"unconfirmed members={[i.get('members') for i in unconfirmed]}")


# Now cleanup a couple to test DELETE
r = req("DELETE", f"/couple-relations/{couple_unc_id}")
check("DELETE couple 200", r.status_code == 200)
r = req("GET", f"/chains/{chain_id}/couple-relations")
check("deleted couple removed",
      all(c.get("id") != couple_unc_id for c in r.json()))


# ── 4. VOTE LOGIC (logic_changes field) ──────────────────────────────────────
print("\n=== Vote logic_changes behaviour ===")

# Use a fresh seed (the previous one may have mutated)
seed_r = req("POST", "/dev/seed-test-chain")
seed = seed_r.json()
chain_id = seed["chain_id"]
members = seed["members"]
anna_mid = members[0]["member_id"]  # host
peter_mid = members[1]["member_id"]  # court_strict (blocker)
sara_mid = members[2]["member_id"]
tom_mid = members[3]["member_id"]
lisa_mid = members[4]["member_id"]
max_mid = members[5]["member_id"]

# Calculate a plan (2_ungern scenario: Anna is pivot)
r = req("POST", f"/chains/{chain_id}/calculate-plan")
check("calculate-plan 200", r.status_code == 200)
plan = r.json()
plan_id = plan["id"]
stage = plan.get("escalation_stage")
check("stage is 2_ungern", stage == "2_ungern", f"got {stage}")

votes = plan.get("votes", [])
# Every vote should have logic_changes field
all_have_lc = all("logic_changes" in v for v in votes)
check("every vote has logic_changes field", all_have_lc,
      f"votes missing: {[v for v in votes if 'logic_changes' not in v]}")

# Pivot (Anna) should be active AND logic_changes=True
pivot_vote = next((v for v in votes if v["member_id"] == plan["pivot_member_id"]), None)
check("pivot vote exists", pivot_vote is not None)
if pivot_vote:
    check("pivot is_active=True", pivot_vote.get("is_active") is True)
    check("pivot logic_changes=True (pivot switches logic)",
          pivot_vote.get("logic_changes") is True,
          f"got {pivot_vote.get('logic_changes')}")

# Non-pivot votes should all be is_active=False and logic_changes=False
non_pivot_votes = [v for v in votes if v["member_id"] != plan["pivot_member_id"]]
all_np_inactive = all(v.get("is_active") is False for v in non_pivot_votes)
check("non-pivot votes is_active=False", all_np_inactive)
all_np_no_change = all(v.get("logic_changes") is False for v in non_pivot_votes)
check("non-pivot votes logic_changes=False", all_np_no_change,
      f"violations: {[(v['member_name'], v.get('logic_changes')) for v in non_pivot_votes if v.get('logic_changes')]}")

# Pivot accepts → status should become 'accepted' because only pivot is active AND required (logic_changes=True)
r = req("POST", f"/weekend-plans/{plan_id}/vote", json={
    "member_id": plan["pivot_member_id"],
    "vote": "accepted",
})
check("pivot accepts vote 200", r.status_code == 200)
after = r.json()
check("plan accepted when pivot accepts (all active voters voted AND required accepted)",
      after.get("status") == "accepted",
      f"got status={after.get('status')}")

# Stage 2 acceptance path → public kido_message
check("kido_message updated to public announcement",
      "Dank des Entgegenkommens" in (after.get("kido_message") or ""),
      f"got: {after.get('kido_message')}")

# --- Now test declined path: re-seed and decline ---
seed_r = req("POST", "/dev/seed-test-chain")
seed = seed_r.json()
chain_id = seed["chain_id"]
anna_mid = seed["members"][0]["member_id"]
r = req("POST", f"/chains/{chain_id}/calculate-plan")
plan = r.json()
plan_id = plan["id"]
r = req("POST", f"/weekend-plans/{plan_id}/vote", json={
    "member_id": plan["pivot_member_id"], "vote": "declined",
})
after = r.json()
check("plan status=partial when pivot declines",
      after.get("status") == "partial",
      f"got {after.get('status')}")

# Ensure inactive votes weren't required
check("all_voted check ignores is_active=False votes (partial due to decline, not pending)",
      after.get("status") == "partial")


# ── Summary ───────────────────────────────────────────────────────────────────
print("\n" + "=" * 60)
passed = sum(1 for _, ok, _ in results if ok)
failed = sum(1 for _, ok, _ in results if not ok)
print(f"TOTAL: {passed + failed} | PASSED: {passed} | FAILED: {failed}")
if failed:
    print("\nFailed tests:")
    for n, ok, d in results:
        if not ok:
            print(f"  - {n}  [{d}]")
sys.exit(0 if failed == 0 else 1)
