"""Run with:  pip install pytest httpx && pytest -q tests     (from the voice-crew-team folder)"""
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace as NS

os.environ["STATE_FILE"] = str(Path(__file__).parent / "_state.json")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))

import pytest
from fastapi.testclient import TestClient

import app as crew


@pytest.fixture(autouse=True)
def isolated_record(monkeypatch, tmp_path):
    """Every test gets its own empty activity record and its own grants (nothing granted)."""
    led = crew.audit.Ledger(tmp_path / "activity.jsonl")
    monkeypatch.setattr(crew, "ledger", led)
    monkeypatch.setattr(crew, "access", crew.audit.Access(tmp_path / "grants.json", led))
    monkeypatch.setattr(crew, "fleet", None)


def test_pick_agent():
    assert crew.pick_agent(None, "You are Mia, the architect") == "mia"
    assert crew.pick_agent(None, "You are Jim, the backend") == "jimmy"
    assert crew.pick_agent("Tester", "x") == "raphaella"
    assert crew.pick_agent(None, "no name here") == "michael"
    assert crew.pick_agent(None, "You are Freya, the owner\u2019s personal assistant") == "freya"
    assert crew.pick_agent(None, "You are Fraya, the assistant") == "freya"
    assert crew.pick_agent("Assistant", "x") == "freya"
    assert crew.pick_agent(None, "You are Martina, the owner\u2019s specialist for spreadsheets") == "martina"
    assert crew.pick_agent(None, "You are Martine, x") == "martina"
    assert crew.pick_agent("Sheets", "x") == "martina"


def test_every_teammate_has_an_agent_file():
    agents = Path(__file__).resolve().parent.parent / "agents"
    for key, name in crew.TEAM.items():
        text = (agents / (key + ".md")).read_text(encoding="utf8")
        assert text.startswith("---\nname: " + name), key
        assert "You are " + name + "," in text, key
        assert "Freya (Assistant)" in text, key
        assert "Martina (Sheets)" in text, key


def test_every_teammate_is_told_to_obey_stay_legal_and_report_honestly():
    agents = Path(__file__).resolve().parent.parent / "agents"
    for key in crew.TEAM:
        text = (agents / (key + ".md")).read_text(encoding="utf8")
        assert "The owner is the boss" in text, key
        assert "Stay inside the access you have been given" in text, key
        assert "Never do anything illegal" in text and "falsified, hidden or altered records" in text, key
        assert "Report honestly" in text, key
        assert text.index("Report honestly") < text.index("reply with only a JSON object"), key


@pytest.mark.parametrize("text,expected", [
    ('{"says": "hi"}', {"says": "hi"}),
    ('```json\n{"says": "hi"}\n```', {"says": "hi"}),
    ('Sure, here you go: {"says": "hi", "n": {"a": 1}}', {"says": "hi", "n": {"a": 1}}),
    ('I ran the tests first.\n\n{"intro": "ok", "picks": []}', {"intro": "ok", "picks": []}),
    ("no json here", None),
    ("", None),
])
def test_extract_json(text, expected):
    assert crew.extract_json(text) == expected


class FakeStream:
    def __init__(self, events): self.events = events
    def __enter__(self): return iter(self.events)
    def __exit__(self, *a): return False


def fake_client(reply, calls, fail_first=False):
    sent = {"n": 0}

    def create(**kw):
        calls.append(("create", kw))
        return NS(id="sess_%d" % len([c for c in calls if c[0] == "create"]))

    def send(session_id, events):
        calls.append(("send", session_id, events))
        sent["n"] += 1

    def stream(session_id):
        if fail_first and not any(c[0] == "failed" for c in calls):
            calls.append(("failed",))
            raise RuntimeError("session not found")
        return FakeStream([
            NS(type="session.status_running"),
            NS(type="agent.tool_use", name="bash"),
            NS(type="agent.message", content=[NS(type="text", text="thinking about it")]),
            NS(type="agent.message", content=[NS(type="text", text=reply)]),
            NS(type="session.status_idle"),
        ])
    return NS(beta=NS(sessions=NS(create=create, events=NS(send=send, stream=stream))))


@pytest.fixture()
def managed(monkeypatch, tmp_path):
    monkeypatch.setenv("ENVIRONMENT_ID", "env_1")
    for k in crew.TEAM:
        monkeypatch.setenv("AGENT_ID_" + k.upper(), "agent_" + k)
    monkeypatch.setenv("CREW_KEY", "secret")
    monkeypatch.setattr(crew, "STATE_FILE", tmp_path / "state.json")
    calls = []
    b = crew.ManagedBackend(client=fake_client('{"says": "Yeah, Mia here."}', calls))
    monkeypatch.setattr(crew, "backend", b)
    crew.limiter = crew.RateLimit(100)
    return TestClient(crew.app), b, calls


def test_needs_passcode(managed):
    c, _, _ = managed
    assert c.post("/api/sample", json={"prompt": "You are Mia, x"}).status_code == 401
    assert c.post("/api/sample", json={"prompt": "You are Mia, x"}, headers={"x-crew-key": "nope"}).status_code == 401


def test_sample_goes_to_the_right_agent_and_returns_json(managed):
    c, b, calls = managed
    r = c.post("/api/sample", json={"prompt": "You are Mia, the architect. Reply with JSON", "json_mode": True}, headers={"x-crew-key": "secret"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["agent"] == "mia" and d["json"] == {"says": "Yeah, Mia here."}
    creates = [x for x in calls if x[0] == "create"]
    assert creates[0][1]["agent"] == "agent_mia" and creates[0][1]["environment_id"] == "env_1"
    sends = [x for x in calls if x[0] == "send"]
    assert sends[0][2][0]["type"] == "user.message"
    assert sends[0][2][0]["content"][0]["text"].startswith("You are Mia")


def test_session_is_reused_then_rotated(managed, monkeypatch):
    c, b, calls = managed
    monkeypatch.setattr(crew, "SESSION_MAX_USES", 2)
    h = {"x-crew-key": "secret"}
    for _ in range(3):
        assert c.post("/api/sample", json={"prompt": "You are Leo, x"}, headers=h).status_code == 200
    assert len([x for x in calls if x[0] == "create"]) == 2      # created once, reused once, then a fresh one


def test_stale_session_is_replaced(monkeypatch, tmp_path):
    monkeypatch.setenv("ENVIRONMENT_ID", "env_1")
    monkeypatch.setenv("AGENT_ID_SARA", "agent_sara")
    monkeypatch.setattr(crew, "STATE_FILE", tmp_path / "state.json")
    calls = []
    b = crew.ManagedBackend(client=fake_client("ok", calls, fail_first=True))
    assert b.ask("sara", "hello") == "thinking about it\nok"
    assert len([x for x in calls if x[0] == "create"]) == 2


def test_not_configured_is_a_clear_error(managed, monkeypatch):
    c, b, _ = managed
    monkeypatch.delenv("AGENT_ID_JASON")
    r = c.post("/api/sample", json={"prompt": "You are Jason, x"}, headers={"x-crew-key": "secret"})
    assert r.status_code == 502 and "AGENT_ID_JASON" in r.json()["detail"]


def test_mock_mode(monkeypatch):
    monkeypatch.delenv("CREW_KEY", raising=False)
    monkeypatch.setattr(crew, "backend", crew.MockBackend())
    crew.limiter = crew.RateLimit(100)
    c = TestClient(crew.app)
    d = c.post("/api/sample", json={"prompt": 'You are Michael, the lead. {"intro": ...}', "json_mode": True}).json()
    assert d["json"]["picks"][0]["role"] == "Architect"
    assert c.get("/api/health").json()["mode"] == "mock"


def test_readable_pulls_the_sentence_out_of_half_written_json():
    assert crew.readable('{"says": "Yeah, I would keep it simple and') == "Yeah, I would keep it simple and"
    assert crew.readable('{"intro": "Bringing in Mia.", "picks": []}') == "Bringing in Mia."
    assert crew.readable("plain words  here") == "plain words here"
    assert len(crew.readable("x" * 500)) == 180


def test_progress_board_follows_a_request(managed):
    c, b, calls = managed
    h = {"x-crew-key": "secret"}
    crew.progress = crew.Progress()
    assert c.get("/api/progress").status_code == 401
    assert c.get("/api/progress", headers=h).json() == {"agents": {}}
    r = c.post("/api/sample", json={"prompt": "You are Mia, x"}, headers=h)
    assert r.status_code == 200
    mia = c.get("/api/progress", headers=h).json()["agents"]["mia"]
    assert mia["id"] == "Architect" and mia["state"] == "done" and mia["name"] == "Mia"
    # the fake stream used a tool and wrote two messages: the board saw both
    assert mia["tool"] == "Running a command" and mia["chars"] > 0


def test_progress_is_not_counted_against_the_request_limit(managed):
    c, _, _ = managed
    crew.limiter = crew.RateLimit(2)
    h = {"x-crew-key": "secret"}
    for _ in range(10):
        assert c.get("/api/progress", headers=h).status_code == 200


def test_failed_request_is_marked_failed(managed):
    c, b, _ = managed
    crew.progress = crew.Progress()
    h = {"x-crew-key": "secret"}
    b.ask = lambda key, prompt: (_ for _ in ()).throw(RuntimeError("boom"))
    assert c.post("/api/sample", json={"prompt": "You are Leo, x"}, headers=h).status_code == 502
    assert c.get("/api/progress", headers=h).json()["agents"]["leo"]["state"] == "failed"


def test_mock_delay_acts_out_work(monkeypatch):
    monkeypatch.setenv("MOCK_DELAY", "0.2")
    crew.progress = crew.Progress()
    m = crew.MockBackend()
    m.ask("mia", 'You are Mia, "says"')
    snap = crew.progress.snapshot()
    assert "mia" not in snap          # nothing started it: the endpoint does that
    crew.progress.start("mia")
    m.ask("mia", 'You are Mia, "says"')
    assert crew.progress.snapshot()["mia"]["tool"] == "Running a command"


# ---------------------------------------------------------------- Samsara through the server
def _fake_samsara_get():
    from datetime import datetime, timedelta, timezone
    recent = (datetime.now(timezone.utc) - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z")

    def get(url, token):
        assert token == "tok-river"
        if "/fleet/vehicles" in url:
            return {"data": [{"id": "12", "name": "88113"}], "pagination": {"endCursor": "", "hasNextPage": False}}
        return {"data": [{"id": "e1", "startMs": recent, "behaviorLabels": [{"label": "Speeding"}], "driver": {"name": "Ali Hassan"},
                          "maxAccelerationGForce": 0.2, "location": {}}], "pagination": {"endCursor": "", "hasNextPage": False}}
    return get


def test_health_says_how_many_companies_without_naming_them(managed, monkeypatch):
    import samsara as sm
    c, _, _ = managed
    monkeypatch.setattr(crew, "fleet", sm.Samsara(tokens={"RIVER FREIGHT": "tok-river", "OTHER": "tok-x"}, get=_fake_samsara_get()))
    d = c.get("/api/health").json()
    assert d["samsara"] == 2 and "RIVER" not in json.dumps(d) and "tok-" not in json.dumps(d)


def test_the_teammate_receives_the_live_data(managed, monkeypatch):
    import samsara as sm
    c, b, calls = managed
    crew.access.set("samsara", True)
    monkeypatch.setattr(crew, "fleet", sm.Samsara(tokens={"RIVER FREIGHT": "tok-river"}, get=_fake_samsara_get()))
    prompt = "You are Michael, the team lead.\n\nThe owner just said: truck 88113 safety report today\n\nReply with JSON"
    r = c.post("/api/sample", json={"prompt": prompt}, headers={"x-crew-key": "secret"})
    assert r.status_code == 200, r.text
    sent = [x for x in calls if x[0] == "send"][0][2][0]["content"][0]["text"]
    assert "Live Samsara data" in sent and "Truck 88113, company RIVER FREIGHT" in sent and "driver: Ali Hassan" in sent
    assert sent.index("Live Samsara data") < sent.index("The owner just said:")
    assert "tok-river" not in sent and "tok-river" not in r.text


def test_other_questions_reach_the_team_unchanged(managed, monkeypatch):
    import samsara as sm
    c, b, calls = managed
    monkeypatch.setattr(crew, "fleet", sm.Samsara(tokens={"RIVER FREIGHT": "tok-river"}, get=_fake_samsara_get()))
    prompt = "You are Mia, the architect.\n\nThe owner just said: build the login screen\n\nReply with JSON"
    c.post("/api/sample", json={"prompt": prompt}, headers={"x-crew-key": "secret"})
    assert [x for x in calls if x[0] == "send"][0][2][0]["content"][0]["text"] == prompt


def test_a_broken_lookup_does_not_stop_the_answer(managed, monkeypatch):
    c, b, calls = managed
    def boom(*a, **k):
        raise RuntimeError("samsara exploded")
    monkeypatch.setattr(crew.samsara_lookup, "inject", boom)
    r = c.post("/api/sample", json={"prompt": "You are Mia, x\nThe owner just said: truck 88113 safety report"}, headers={"x-crew-key": "secret"})
    assert r.status_code == 200 and r.json()["agent"] == "mia"


def test_the_lookup_shows_up_on_the_working_board(managed, monkeypatch):
    import samsara as sm
    c, b, calls = managed
    seen = []
    orig = crew.progress.update
    monkeypatch.setattr(crew.progress, "update", lambda key, text=None, tool=None: (seen.append((text, tool)), orig(key, text=text, tool=tool))[1])
    crew.access.set("samsara", True)
    monkeypatch.setattr(crew, "fleet", sm.Samsara(tokens={"RIVER FREIGHT": "tok-river"}, get=_fake_samsara_get()))
    c.post("/api/sample", json={"prompt": "You are Michael, x\nThe owner just said: truck 88113 safety report today"}, headers={"x-crew-key": "secret"})
    assert any(t == "samsara" for _, t in seen) and any(x and "88113" in x for x, _ in seen)
    assert crew.TOOL_LABELS["samsara"] == "Reading Samsara"


# ---------------------------------------------------------------- access, and the record of what was done
H = {"x-crew-key": "secret"}
TRUCK = "You are Michael, the team lead.\n\nThe owner just said: truck 88113 safety report today\n\nReply with JSON"


def test_without_a_grant_the_team_is_told_to_ask(managed, monkeypatch):
    import samsara as sm
    c, b, calls = managed
    monkeypatch.setattr(crew, "fleet", sm.Samsara(tokens={"RIVER FREIGHT": "tok-river"}, get=_fake_samsara_get()))
    r = c.post("/api/sample", json={"prompt": TRUCK}, headers=H)
    assert r.status_code == 200 and r.json()["needs"] == ["samsara"]
    sent = [x for x in calls if x[0] == "send"][0][2][0]["content"][0]["text"]
    assert "Samsara access: NOT granted" in sent and "grant Samsara access" in sent
    assert "Live Samsara data" not in sent and "Ali Hassan" not in sent
    log = c.get("/api/activity", headers=H).json()["entries"]
    assert any("Did not look up truck 88113: the owner has not granted" in e["text"] for e in log)


def test_granting_lets_them_proceed_and_revoking_stops_them(managed, monkeypatch):
    import samsara as sm
    c, b, calls = managed
    monkeypatch.setattr(crew, "fleet", sm.Samsara(tokens={"RIVER FREIGHT": "tok-river"}, get=_fake_samsara_get()))
    assert c.get("/api/grants").status_code == 401
    assert c.post("/api/grants", json={"id": "samsara", "granted": True}).status_code == 401
    assert c.get("/api/grants", headers=H).json()["caps"] == [{"id": "samsara", "label": "Samsara, read-only lookups", "configured": True, "granted": False}]
    assert c.post("/api/grants", json={"id": "bank", "granted": True}, headers=H).status_code == 400
    r = c.post("/api/grants", json={"id": "samsara", "granted": True}, headers=H)
    assert r.json()["caps"][0]["granted"] is True
    out = c.post("/api/sample", json={"prompt": TRUCK}, headers=H).json()
    assert out["needs"] == []
    assert "Live Samsara data" in [x for x in calls if x[0] == "send"][-1][2][0]["content"][0]["text"]
    c.post("/api/grants", json={"id": "samsara", "granted": False}, headers=H)
    out = c.post("/api/sample", json={"prompt": TRUCK.replace("today", "yesterday")}, headers=H).json()
    assert out["needs"] == ["samsara"]
    assert "NOT granted" in [x for x in calls if x[0] == "send"][-1][2][0]["content"][0]["text"]


def test_the_grant_survives_a_restart(tmp_path):
    led = crew.audit.Ledger(tmp_path / "a.jsonl")
    a = crew.audit.Access(tmp_path / "g.json", led)
    a.set("samsara", True)
    assert crew.audit.Access(tmp_path / "g.json", led).granted("samsara") is True


def test_the_record_shows_what_they_did(managed, monkeypatch):
    import samsara as sm
    c, b, calls = managed
    crew.access.set("samsara", True)
    monkeypatch.setattr(crew, "fleet", sm.Samsara(tokens={"RIVER FREIGHT": "tok-river"}, get=_fake_samsara_get()))
    c.post("/api/sample", json={"prompt": TRUCK}, headers=H)
    assert c.get("/api/activity").status_code == 401
    log = c.get("/api/activity", headers=H).json()["entries"]
    kinds = [e["kind"] for e in log]
    assert kinds[0] == "worked" and "samsara" in kinds and "grant" in kinds
    worked = log[0]
    assert worked["name"] == "Michael" and worked["text"] == "answered" and worked["ok"] is True and "truck 88113" in worked["ask"]
    assert worked["tools"] == ["bash"]            # what the fake agent service reported using
    lookup = [e for e in log if e["kind"] == "samsara"][0]
    assert "Looked up truck 88113" in lookup["text"] and "RIVER FREIGHT: 1 safety event(s)" in lookup["text"]
    assert "tok-" not in json.dumps(log)
    assert log[-1]["kind"] == "grant" and log[-1]["name"] == "You"


def test_a_failure_is_recorded_too(monkeypatch, tmp_path):
    monkeypatch.setenv("CREW_KEY", "secret")
    class Broken:
        mode = "x"
        def configured(self): return {}
        def ask(self, key, prompt): raise RuntimeError("service down")
    monkeypatch.setattr(crew, "backend", Broken())
    crew.limiter = crew.RateLimit(100)
    c = TestClient(crew.app)
    assert c.post("/api/sample", json={"prompt": "You are Mia, x\nThe owner just said: hi"}, headers=H).status_code == 502
    e = c.get("/api/activity", headers=H).json()["entries"][0]
    assert e["ok"] is False and e["name"] == "Mia" and "Could not do it" in e["text"]


def test_tool_use_is_described_without_secrets():
    ev = NS(name="bash", input={"command": "curl -H 'Authorization: Bearer abc123def456' https://example.com/data"})
    s = crew.tool_summary(ev)
    assert s.startswith("bash: curl") and "abc123def456" not in s and "example.com" in s
    assert crew.tool_summary(NS(name="write", input={"path": "/work/app.py"})) == "write: /work/app.py"
    assert crew.tool_summary(NS(name="web_search")) == "web_search"


def test_what_was_asked_and_the_kind_of_step():
    assert crew.step_of('x "picks": [') == "decided who takes it"
    assert crew.step_of('Reply with only one JSON object: {"wrap": string}') == "wrapped it up"
    assert crew.step_of("You are Mia ... {\"says\": string}") == "answered"


# ---------------------------------------------------------------- spending cap
CAP = {"type": "limit", "max_list_cost": {"amount": "100", "currency": "USD"}}


def test_every_new_conversation_carries_the_spending_cap(managed):
    c, b, calls = managed
    assert c.post("/api/sample", json={"prompt": "You are Mia, x"}, headers={"x-crew-key": "secret"}).status_code == 200
    assert [x for x in calls if x[0] == "create"][0][1]["budget"] == CAP
    assert c.get("/api/health").json()["spend_cap"] == 100


def test_the_cap_can_be_changed_or_switched_off(managed, monkeypatch):
    c, b, calls = managed
    h = {"x-crew-key": "secret"}
    monkeypatch.setattr(crew, "SESSION_BUDGET_CENTS", 250)
    c.post("/api/sample", json={"prompt": "You are Mia, x"}, headers=h)
    monkeypatch.setattr(crew, "SESSION_BUDGET_CENTS", 0)
    c.post("/api/sample", json={"prompt": "You are Leo, x"}, headers=h)
    creates = [x[1] for x in calls if x[0] == "create"]
    assert creates[0]["budget"]["max_list_cost"]["amount"] == "250" and "budget" not in creates[1]
    assert c.get("/api/health").json()["spend_cap"] == "off"


@pytest.mark.parametrize("refusal", [TypeError("create() got an unexpected keyword argument 'budget'"),
                                     type("BadRequest", (Exception,), {"status_code": 400})("budget is not available")])
def test_a_refused_cap_does_not_stop_the_team(managed, refusal):
    """An older library, or a service that will not take a cap: the teammate still answers, and health says so."""
    c, b, calls = managed
    plain = b.client.beta.sessions.create

    def create(**kw):
        if "budget" in kw:
            calls.append(("refused", kw))
            raise refusal
        return plain(**kw)

    b.client.beta.sessions.create = create
    h = {"x-crew-key": "secret"}
    assert c.post("/api/sample", json={"prompt": "You are Mia, x"}, headers=h).status_code == 200
    assert c.post("/api/sample", json={"prompt": "You are Leo, x"}, headers=h).status_code == 200
    assert len([x for x in calls if x[0] == "refused"]) == 1      # asked once, then stopped asking
    assert c.get("/api/health").json()["spend_cap"] == "refused"


def test_other_create_failures_are_not_mistaken_for_a_refused_cap(managed):
    c, b, calls = managed

    def create(**kw):
        calls.append(("create", kw))
        raise type("Forbidden", (Exception,), {"status_code": 403})("no access to this agent")

    b.client.beta.sessions.create = create
    r = c.post("/api/sample", json={"prompt": "You are Mia, x"}, headers={"x-crew-key": "secret"})
    assert r.status_code == 502 and b.cap_refused is False


@pytest.mark.parametrize("stop_reason", ["budget_reached", NS(type="budget_reached")])
def test_reaching_the_cap_stops_the_work_and_is_recorded(managed, stop_reason):
    c, b, calls = managed
    b.client.beta.sessions.events.stream = lambda session_id: FakeStream([
        NS(type="session.status_running"),
        NS(type="agent.message", content=[NS(type="text", text="half an answer")]),
        NS(type="session.usage"),
        NS(type="session.status_idle", stop_reason=stop_reason),
    ])
    h = {"x-crew-key": "secret"}
    r = c.post("/api/sample", json={"prompt": "You are Jimmy, build it"}, headers=h)
    assert r.status_code == 502 and r.json()["error"] == "budget"
    assert len([x for x in calls if x[0] == "create"]) == 1       # not retried by itself: that would spend a second cap
    assert "jimmy" not in b.state["sessions"]                      # the paused conversation is not reused
    entry = c.get("/api/activity", headers=h).json()["entries"][0]
    assert entry["ok"] is False and "spending cap" in entry["text"]


def test_an_ordinary_finish_is_not_mistaken_for_the_cap(managed):
    c, b, calls = managed
    b.client.beta.sessions.events.stream = lambda session_id: FakeStream([
        NS(type="agent.message", content=[NS(type="text", text='{"says": "Done."}')]),
        NS(type="session.status_idle", stop_reason=NS(type="end_turn")),
    ])
    r = c.post("/api/sample", json={"prompt": "You are Mia, x", "json_mode": True}, headers={"x-crew-key": "secret"})
    assert r.status_code == 200 and r.json()["json"] == {"says": "Done."}


def test_conversations_are_kept_short_by_default():
    assert crew.SESSION_MAX_USES == 5


def test_the_team_runs_mostly_on_the_small_model():
    """Seven teammates on the small model; only the two heavy thinkers on the larger one."""
    import re
    agents = Path(__file__).resolve().parent.parent / "agents"
    big = sorted(k for k in crew.TEAM if "claude-sonnet-5-5" in re.split(r"^---\s*$", (agents / (k + ".md")).read_text(encoding="utf8"), flags=re.M)[1])
    small = sorted(k for k in crew.TEAM if "claude-haiku-5-5" in re.split(r"^---\s*$", (agents / (k + ".md")).read_text(encoding="utf8"), flags=re.M)[1])
    assert big == ["jimmy", "mia"] and len(small) == 7 and "michael" in small


def test_each_teammate_knows_the_crews_name_for_its_model_and_never_names_the_vendor():
    agents = Path(__file__).resolve().parent.parent / "agents"
    for k in crew.TEAM:
        head, body = (agents / (k + ".md")).read_text(encoding="utf8").split("\n---\n", 1)
        name = "Hawk 5.6" if "claude-sonnet-5-5" in head else "Falcon 4.7"
        assert "say " + name + "," in body, k
        assert "never name the company or the product behind it" in body, k
        assert "sincerely asks whether you are an AI, say yes" in body, k
        for word in ("Claude", "Anthropic", "Haiku", "Sonnet", "Opus"):
            assert word not in body, (k, word)        # the instructions themselves never mention the vendor
