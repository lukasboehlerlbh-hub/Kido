"""Backend API tests for Kido Co-Parenting App"""
import pytest
import requests
import os

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', '').rstrip('/')

@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s

@pytest.fixture(scope="module")
def chain_data(session):
    """Create a test chain and return IDs"""
    r = session.post(f"{BASE_URL}/api/chains", json={
        "user_name": "TEST_Sarah Müller",
        "user_phone": "+41791111111",
        "avatar_color": "#1D9E75",
        "chain_name": "TEST_Familie Müller"
    })
    assert r.status_code == 200
    return r.json()

# Health
def test_health(session):
    r = session.get(f"{BASE_URL}/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"

# Chains
def test_create_chain(session):
    r = session.post(f"{BASE_URL}/api/chains", json={
        "user_name": "TEST_Hans Meier",
        "user_phone": "+41792222222",
        "avatar_color": "#8B5CF6"
    })
    assert r.status_code == 200
    d = r.json()
    assert "user_id" in d
    assert "chain_id" in d
    assert "member_id" in d
    assert "chain_name" in d

def test_get_chain(session, chain_data):
    r = session.get(f"{BASE_URL}/api/chains/{chain_data['chain_id']}")
    assert r.status_code == 200
    d = r.json()
    assert "members" in d
    assert len(d["members"]) >= 1
    assert d["members"][0]["user_name"] == "TEST_Sarah Müller"

def test_get_member(session, chain_data):
    r = session.get(f"{BASE_URL}/api/chain-members/{chain_data['member_id']}")
    assert r.status_code == 200
    d = r.json()
    assert d["user_name"] == "TEST_Sarah Müller"

# Invitations
def test_create_invitation(session, chain_data):
    r = session.post(f"{BASE_URL}/api/invitations", json={
        "chain_id": chain_data["chain_id"],
        "invited_by_id": chain_data["user_id"],
        "phone_number": "+41793333333"
    })
    assert r.status_code == 200
    d = r.json()
    assert "token" in d
    assert len(d["token"]) == 8

def test_get_invitation_by_token(session, chain_data):
    # Create invitation first
    r = session.post(f"{BASE_URL}/api/invitations", json={
        "chain_id": chain_data["chain_id"],
        "invited_by_id": chain_data["user_id"],
        "phone_number": "+41794444444"
    })
    token = r.json()["token"]
    # Get by token
    r2 = session.get(f"{BASE_URL}/api/invitations/{token}")
    assert r2.status_code == 200
    d = r2.json()
    assert d["token"] == token
    assert "chain_name" in d

# Preferences
def test_update_preferences(session, chain_data):
    r = session.put(f"{BASE_URL}/api/chain-members/{chain_data['member_id']}/preferences", json={
        "court_ruling": "shared",
        "current_logic": "even",
        "flex_level": "yes"
    })
    assert r.status_code == 200
    d = r.json()
    assert d["court_ruling"] == "shared"
    assert d["flex_level"] == "yes"

# Weekend Plans
def test_calculate_plan(session, chain_data):
    r = session.post(f"{BASE_URL}/api/chains/{chain_data['chain_id']}/calculate-plan", json={})
    assert r.status_code == 200
    d = r.json()
    assert "weekends" in d
    assert len(d["weekends"]) == 8
    assert "kido_message" in d
    assert "schedule" in d

def test_get_weekend_plan(session, chain_data):
    r = session.get(f"{BASE_URL}/api/chains/{chain_data['chain_id']}/weekend-plan")
    assert r.status_code == 200

def test_vote_plan(session, chain_data):
    # Calculate plan first
    r = session.post(f"{BASE_URL}/api/chains/{chain_data['chain_id']}/calculate-plan", json={})
    plan_id = r.json()["id"]
    # Vote
    r2 = session.post(f"{BASE_URL}/api/weekend-plans/{plan_id}/vote", json={
        "member_id": chain_data["member_id"],
        "vote": "accepted"
    })
    assert r2.status_code == 200

# Swiss Holidays
def test_get_swiss_holidays_zh(session):
    r = session.get(f"{BASE_URL}/api/swiss-holidays/ZH/2026")
    assert r.status_code == 200
    d = r.json()
    assert len(d) == 4
    assert d[0]["label"] == "Frühlingsferien"

def test_get_swiss_holidays_be(session):
    r = session.get(f"{BASE_URL}/api/swiss-holidays/BE/2026")
    assert r.status_code == 200
    assert len(r.json()) == 4

# Holiday Wishes
def test_create_holiday_wish(session, chain_data):
    r = session.post(f"{BASE_URL}/api/holiday-wishes", json={
        "member_id": chain_data["member_id"],
        "chain_id": chain_data["chain_id"],
        "year": 2026,
        "period_type": "sommer",
        "period_label": "Sommerferien",
        "date_from": "2026-07-13",
        "date_to": "2026-08-16",
        "wish": "first_half",
        "is_shared": True
    })
    assert r.status_code == 200
    d = r.json()
    assert d["wish"] == "first_half"
    assert d["status"] == "pending"

def test_get_holiday_wishes(session, chain_data):
    r = session.get(f"{BASE_URL}/api/chains/{chain_data['chain_id']}/holiday-wishes?year=2026")
    assert r.status_code == 200
    assert isinstance(r.json(), list)

# Messages
def test_send_chain_message(session, chain_data):
    r = session.post(f"{BASE_URL}/api/messages", json={
        "sender_id": chain_data["user_id"],
        "chain_id": chain_data["chain_id"],
        "text": "Hallo Kette!"
    })
    assert r.status_code == 200
    assert "message" in r.json()

def test_send_kido_message(session, chain_data):
    r = session.post(f"{BASE_URL}/api/messages", json={
        "sender_id": chain_data["user_id"],
        "recipient_id": "kido",
        "text": "Hallo Kido, ich habe ein Problem mit dem Wochenende"
    })
    assert r.status_code == 200
    d = r.json()
    assert "message" in d
    assert "kido_response" in d
    assert len(d["kido_response"]["text"]) > 0

def test_get_kido_messages(session, chain_data):
    r = session.get(f"{BASE_URL}/api/messages/kido/{chain_data['user_id']}")
    assert r.status_code == 200
    assert isinstance(r.json(), list)

def test_get_chain_messages(session, chain_data):
    r = session.get(f"{BASE_URL}/api/chains/{chain_data['chain_id']}/messages")
    assert r.status_code == 200
    assert isinstance(r.json(), list)

# Update User
def test_update_user(session, chain_data):
    r = session.put(f"{BASE_URL}/api/users/{chain_data['user_id']}", json={
        "name": "TEST_Sarah Müller Updated",
        "kanton": "BE"
    })
    assert r.status_code == 200
    d = r.json()
    assert d["kanton"] == "BE"
