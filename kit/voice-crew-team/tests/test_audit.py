"""The record of what the team did, and the owner's grants."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))

import audit


def test_entries_are_kept_newest_first(tmp_path):
    led = audit.Ledger(tmp_path / "a.jsonl")
    led.add("worked", "mia", "answered", ask="build the login screen", tools=["bash: ls"], secs=3, ok=True)
    led.add("samsara", "michael", "Looked up truck 88113")
    got = led.recent()
    assert [e["kind"] for e in got] == ["samsara", "worked"]
    assert got[1]["tools"] == ["bash: ls"] and got[1]["secs"] == 3 and got[1]["ok"] is True
    assert led.recent(1)[0]["agent"] == "michael" and led.recent(agent="mia")[0]["kind"] == "worked"


def test_it_survives_a_restart_and_keeps_only_the_newest(tmp_path):
    p = tmp_path / "a.jsonl"
    led = audit.Ledger(p, cap=5)
    for i in range(300):
        led.add("worked", "mia", "step %d" % i)
    again = audit.Ledger(p, cap=5)
    texts = [e["text"] for e in again.recent(1000)]
    assert texts[0] == "step 299" and len(texts) <= 5 + 200 and "step 0" not in texts
    assert len(p.read_text().splitlines()) <= 205


def test_keys_and_tokens_are_blanked(tmp_path):
    led = audit.Ledger(tmp_path / "a.jsonl")
    e = led.add("worked", "jimmy", "ran it", tools=["bash: curl -H 'Authorization: Bearer abc123def' x", "bash: export API_KEY=sk-ant-" + "a" * 40])
    blob = json.dumps(e)
    assert "abc123def" not in blob and "sk-ant" not in blob
    assert audit.redact("the token was refused") == "the token was refused"
    assert audit.redact("line one\nline two") == "line one line two"


def test_a_broken_disk_never_stops_the_work(tmp_path):
    bad = tmp_path / "a-file"
    bad.write_text("x")
    led = audit.Ledger(bad / "sub" / "a.jsonl")      # the parent is a file: cannot be created
    assert led.add("worked", "mia", "hi")["kind"] == "worked"
    assert led.recent() == []


def test_access_defaults_to_nothing_granted(tmp_path):
    a = audit.Access(tmp_path / "g.json", audit.Ledger(tmp_path / "a.jsonl"))
    assert a.granted("samsara") is False and a.granted("anything-else") is False


def test_access_can_be_pre_approved_in_env(tmp_path):
    a = audit.Access(tmp_path / "g.json", None, "samsara, nonsense")
    assert a.granted("samsara") is True
    a.set("samsara", False)
    assert audit.Access(tmp_path / "g.json", None, "samsara").granted("samsara") is False      # a saved choice beats the preset


def test_grants_and_revokes_are_recorded_once(tmp_path):
    led = audit.Ledger(tmp_path / "a.jsonl")
    a = audit.Access(tmp_path / "g.json", led)
    assert a.set("samsara", True) is True and a.set("samsara", True) is False
    a.set("samsara", False)
    got = led.recent()
    assert [e["kind"] for e in got] == ["revoke", "grant"] and got[0]["agent"] == "owner"
    assert "granted" in got[1]["text"] and "taken back" in got[0]["text"]


def test_unknown_access_is_refused(tmp_path):
    a = audit.Access(tmp_path / "g.json", None)
    try:
        a.set("bank-transfers", True)
        assert False, "should not be possible"
    except KeyError:
        pass
