"""Voice Crew server.

Holds the API key, keeps one conversation (session) per teammate, and relays what the
Voice Crew screen asks to the matching agent. The screen itself is served from ./public.

Run it:   uvicorn app:app --host 0.0.0.0 --port 8000
Demo run: MOCK=1 uvicorn app:app --port 8000       (built-in answers, no API key needed)
"""
import json
import os
import re
import secrets
import threading
import time
from collections import deque
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import audit
import samsara as samsara_lookup

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
PUBLIC = HERE / "public"


def load_env():
    """Tiny .env reader so there is nothing extra to install."""
    for p in (ROOT / ".env", HERE / ".env"):
        if p.exists():
            for line in p.read_text(encoding="utf8").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_env()

TEAM = {
    "michael": "Michael",
    "mia": "Mia",
    "leo": "Leo",
    "jimmy": "Jimmy",
    "raphaella": "Raphaella",
    "jason": "Jason",
    "sara": "Sara",
    "freya": "Freya",
    "martina": "Martina",
}
ROLE_TO_KEY = {
    "lead": "michael",
    "architect": "mia",
    "frontend": "leo",
    "backend": "jimmy",
    "tester": "raphaella",
    "reviewer": "jason",
    "devops": "sara",
    "assistant": "freya",
    "sheets": "martina",
}
ALIASES = {"jim": "jimmy", "raphaela": "raphaella", "rafaela": "raphaella", "rafaella": "raphaella", "sarah": "sara", "freyja": "freya", "freia": "freya", "freja": "freya", "fraya": "freya", "martine": "martina", "martena": "martina"}

# the screen's own id for each teammate, so it can show who is working
PAGE_ID = {"michael": "lead", "mia": "Architect", "leo": "Frontend", "jimmy": "Backend", "raphaella": "Tester",
           "jason": "Reviewer", "sara": "DevOps", "freya": "Assistant", "martina": "Sheets"}
TOOL_LABELS = {"bash": "Running a command", "write": "Writing a file", "edit": "Editing a file", "read": "Reading files",
               "glob": "Looking for files", "grep": "Searching files", "web_search": "Searching the web",
               "web_fetch": "Reading a web page", "samsara": "Reading Samsara"}

STATE_FILE = Path(os.environ.get("STATE_FILE", HERE / "state.json"))
ACTIVITY_FILE = Path(os.environ.get("ACTIVITY_FILE", STATE_FILE.parent / "activity.jsonl"))
GRANTS_FILE = Path(os.environ.get("GRANTS_FILE", STATE_FILE.parent / "grants.json"))
SESSION_MAX_USES = int(os.environ.get("SESSION_MAX_USES", "5"))
# hard spending cap for one teammate conversation, in US cents (0 = no cap); the agent service enforces it
SESSION_BUDGET_CENTS = int(os.environ.get("SESSION_BUDGET_CENTS", "100"))
ASK_TIMEOUT = float(os.environ.get("ASK_TIMEOUT", "180"))
MAX_REQUESTS_PER_MIN = int(os.environ.get("MAX_REQUESTS_PER_MIN", "40"))


# ---------------------------------------------------------------- helpers
def pick_agent(role, prompt):
    """Which teammate is this prompt for? The screen's prompts all start 'You are <Name>, ...'."""
    if role:
        r = str(role).strip().lower()
        r = ALIASES.get(r, r)
        if r in TEAM:
            return r
        if r in ROLE_TO_KEY:
            return ROLE_TO_KEY[r]
    m = re.search(r"You are (\w+),", prompt or "")
    if m:
        n = ALIASES.get(m.group(1).lower(), m.group(1).lower())
        if n in TEAM:
            return n
    return "michael"


def extract_json(text):
    """Pull the JSON object out of an agent's final message, tolerating fences and a little chatter."""
    if not text:
        return None
    t = text.strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t, flags=re.I).strip()
    try:
        v = json.loads(t)
        return v if isinstance(v, (dict, list)) else None
    except Exception:
        pass
    dec = json.JSONDecoder()
    best = None
    for m in re.finditer(r"\{", t):
        try:
            obj, end = dec.raw_decode(t, m.start())
        except Exception:
            continue
        if isinstance(obj, dict):
            if end >= len(t.rstrip()) - 3:
                return obj          # the object that runs to the end of the message
            best = best or obj
    return best


OWNER_ASK = re.compile(r"The owner (?:just said|asked): ([^\n]*)")


def tool_summary(event):
    """'bash: pip install requests': what a teammate used and on what, for the record (keys and tokens blanked out)."""
    name = str(getattr(event, "name", "") or "a tool")
    inp = getattr(event, "input", None)
    detail = ""
    if isinstance(inp, dict):
        for k in ("command", "path", "file_path", "query", "url", "pattern"):
            if inp.get(k):
                detail = str(inp[k])
                break
    detail = audit.redact(detail, 120)
    return name + (": " + detail if detail else "")


def step_of(prompt):
    """What kind of request this was, from the screen's own wording."""
    if '"picks"' in prompt:
        return "decided who takes it"
    if '{"wrap": string}' in prompt:
        return "wrapped it up"
    return "answered"


def readable(text):
    """The readable part of an agent's message while it is still being written: the screen asks for JSON,
    and people should see the sentence, not the braces."""
    text = text or ""
    for key in ("says", "intro", "wrap"):
        m = re.search(r'"%s"\s*:\s*"((?:[^"\\]|\\.)*)' % key, text)
        if m:
            text = m.group(1).replace("\\n", " ").replace('\\"', '"')
            break
    text = re.sub(r"\s+", " ", text).strip()
    return text[-180:]


class Progress:
    """What each teammate is doing right now, so the screen can show it while they work."""

    KEEP = 20   # seconds a finished entry stays on the board

    def __init__(self):
        self.lock = threading.Lock()
        self.items = {}

    def start(self, key):
        now = time.time()
        with self.lock:
            self.items[key] = {"state": "working", "since": now, "updated": now, "text": "", "tool": "", "chars": 0, "tools": 0}

    def update(self, key, text=None, tool=None):
        with self.lock:
            it = self.items.get(key)
            if not it or it["state"] != "working":
                return
            it["updated"] = time.time()
            if tool:
                it["tool"] = TOOL_LABELS.get(str(tool).lower(), "Using " + str(tool))
                it["tools"] += 1
            if text:
                it["text"] = readable(text)
                it["chars"] += len(text)

    def finish(self, key, ok=True):
        with self.lock:
            it = self.items.get(key)
            if it:
                it["state"] = "done" if ok else "failed"
                it["updated"] = time.time()

    def snapshot(self):
        now, out = time.time(), {}
        with self.lock:
            for k, it in list(self.items.items()):
                if it["state"] != "working" and now - it["updated"] > self.KEEP:
                    del self.items[k]
                    continue
                out[k] = {"id": PAGE_ID.get(k, k), "name": TEAM[k], "state": it["state"], "text": it["text"],
                          "tool": it["tool"], "chars": it["chars"] + 120 * it["tools"],
                          "seconds": round(now - it["since"], 1)}
        return out


progress = Progress()


class RateLimit:
    def __init__(self, per_min):
        self.per_min, self.hits, self.lock = per_min, deque(), threading.Lock()

    def ok(self):
        now = time.time()
        with self.lock:
            while self.hits and now - self.hits[0] > 60:
                self.hits.popleft()
            if len(self.hits) >= self.per_min:
                return False
            self.hits.append(now)
            return True


# ---------------------------------------------------------------- backends
class MockBackend:
    """Demo answers so the screen can be tried before anything is connected."""

    mode = "mock"

    def __init__(self):
        self._used = {}

    def pop_tools(self, key):
        return self._used.pop(key, [])

    def configured(self):
        return {k: True for k in TEAM}

    def ask(self, key, prompt):
        name = TEAM[key]
        delay = float(os.environ.get("MOCK_DELAY", "0") or 0)
        if delay > 0:   # act out some work so the "now working" panel has something to show
            steps = [("web_search", "Looking at what was asked"), ("read", "Checking what is already there"),
                     ("write", "Drafting the first version"), ("bash", "Checking that it works")]
            for tool, text in steps:
                progress.update(key, text=text, tool=tool)
                self._used.setdefault(key, []).append(tool + ": " + text)
                time.sleep(delay / len(steps))
        if '"intro"' in prompt:
            return json.dumps({
                "intro": "Let me bring in Mia on this one.",
                "picks": [{"role": "Architect", "ask": "Suggest the stack and the first steps.", "covering": None}],
                "noted": [], "answered": [],
            })
        if '"says"' in prompt:
            return json.dumps({
                "says": "This is %s in demo mode. Connect the real agents and I will answer for real." % name,
                "details": None, "code": None, "handoff": None, "noted": [], "answered": [],
            })
        return json.dumps({"wrap": "That is the plan for now. Connect the real agents to go further."})


class BudgetReached(RuntimeError):
    """The teammate's conversation hit its spending cap and the agent service paused it."""


class ManagedBackend:
    """One long-lived session per teammate, on Claude Managed Agents."""

    mode = "managed"

    def __init__(self, client=None):
        if client is None:
            import anthropic

            client = anthropic.Anthropic()
        self.client = client
        self.env_id = os.environ.get("ENVIRONMENT_ID", "")
        self.locks = {k: threading.Lock() for k in TEAM}
        self.state_lock = threading.Lock()
        self._used = {}
        self.cap_refused = False   # set when the service or an old library would not take a spending cap
        self.state = {"sessions": {}}
        try:
            self.state = json.loads(STATE_FILE.read_text(encoding="utf8"))
            self.state.setdefault("sessions", {})
        except Exception:
            pass

    def agent_id(self, key):
        return os.environ.get("AGENT_ID_" + key.upper(), "")

    def pop_tools(self, key):
        return self._used.pop(key, [])

    def configured(self):
        return {k: bool(self.agent_id(k) and self.env_id) for k in TEAM}

    def _save(self):
        try:
            with self.state_lock:
                STATE_FILE.write_text(json.dumps(self.state), encoding="utf8")
        except Exception:
            pass

    def spend_cap(self):
        """What /api/health reports: the cap in cents, "off", or "refused" when it could not be applied."""
        if SESSION_BUDGET_CENTS <= 0:
            return "off"
        return "refused" if self.cap_refused else SESSION_BUDGET_CENTS

    def _new_session(self, key):
        kw = dict(agent=self.agent_id(key), environment_id=self.env_id, title="Voice Crew: " + TEAM[key])
        if SESSION_BUDGET_CENTS > 0 and not self.cap_refused:
            kw["budget"] = {"type": "limit", "max_list_cost": {"amount": str(SESSION_BUDGET_CENTS), "currency": "USD"}}
        try:
            s = self.client.beta.sessions.create(**kw)
        except Exception as e:
            # an older library (TypeError) or a service that will not take a cap (400): the team keeps working
            # without one, and /api/health says so, rather than every request failing
            if "budget" not in kw or not (isinstance(e, TypeError) or getattr(e, "status_code", None) == 400):
                raise
            kw.pop("budget")
            s = self.client.beta.sessions.create(**kw)
            self.cap_refused = True
            print("spending cap not applied: %s" % str(e)[:200], flush=True)
        self.state["sessions"][key] = {"id": s.id, "uses": 0}
        self._save()
        return self.state["sessions"][key]

    def _session(self, key):
        s = self.state["sessions"].get(key)
        if not s or s.get("uses", 0) >= SESSION_MAX_USES:
            s = self._new_session(key)
        return s

    def reset(self):
        self.state["sessions"] = {}
        self._save()

    def _run(self, session_id, prompt, key=None):
        parts, deadline = [], time.time() + ASK_TIMEOUT
        with self.client.beta.sessions.events.stream(session_id) as stream:
            # open the stream first, then send the message
            self.client.beta.sessions.events.send(
                session_id,
                events=[{"type": "user.message", "content": [{"type": "text", "text": prompt}]}],
            )
            for event in stream:
                t = getattr(event, "type", "")
                if t == "agent.message":
                    for b in event.content:
                        if getattr(b, "type", "") == "text":
                            parts.append(b.text)
                            if key:
                                progress.update(key, text=b.text)
                elif t in ("agent.tool_use", "agent.mcp_tool_use", "agent.custom_tool_use") and key:
                    progress.update(key, tool=getattr(event, "name", "") or "a tool")
                    self._used.setdefault(key, []).append(tool_summary(event))
                elif t == "session.status_idle":
                    why = getattr(event, "stop_reason", None)
                    if getattr(why, "type", why) == "budget_reached":
                        raise BudgetReached("reached the spending cap for this conversation")
                    break
                elif t == "error" or t.endswith(".error") or t in ("session.status_terminated", "session.budget_reached"):
                    raise RuntimeError("agent stopped (%s)" % t)
                if time.time() > deadline:
                    try:   # best effort: ask the agent to stop what it is doing
                        self.client.beta.sessions.events.send(session_id, events=[{"type": "user.interrupt"}])
                    except Exception:
                        pass
                    raise TimeoutError("the agent took too long")
        return "\n".join(parts).strip()

    def ask(self, key, prompt):
        if not self.configured().get(key):
            raise RuntimeError("%s is not set up: add AGENT_ID_%s and ENVIRONMENT_ID to .env" % (TEAM[key], key.upper()))
        with self.locks[key]:                      # one request at a time per teammate
            self._used[key] = []
            s = self._session(key)
            try:
                text = self._run(s["id"], prompt, key)
            except (TimeoutError, BudgetReached):
                # do not reuse a session that may still be busy, or one paused at its cap; and never retry a
                # capped request by itself, or a runaway job would simply spend a second cap
                self.state["sessions"].pop(key, None)
                self._save()
                raise
            except Exception:
                # a stale or deleted session: start a fresh one and try once more
                s = self._new_session(key)
                text = self._run(s["id"], prompt, key)
            s["uses"] = s.get("uses", 0) + 1
            self._save()
            return text


def make_backend():
    if os.environ.get("MOCK") == "1":
        return MockBackend()
    return ManagedBackend()


backend = None
fleet = None          # the read-only Samsara lookup; tokens come from .env and never leave this server
ledger = audit.Ledger(ACTIVITY_FILE)                                  # what the team actually did, as seen by this server
access = audit.Access(GRANTS_FILE, ledger, os.environ.get("GRANTED", ""))   # what the owner has allowed
limiter = RateLimit(MAX_REQUESTS_PER_MIN)
app = FastAPI(title="Voice Crew", docs_url=None, redoc_url=None, openapi_url=None)


def get_backend():
    global backend
    if backend is None:
        backend = make_backend()
    return backend


def get_fleet():
    global fleet
    if fleet is None:
        fleet = samsara_lookup.Samsara()
    return fleet


def denied(request: Request, count=True):
    """Return a response when the caller may not use the API, else None."""
    key = os.environ.get("CREW_KEY", "")
    if key:
        if not secrets.compare_digest(request.headers.get("x-crew-key", ""), key):
            return JSONResponse({"error": "passcode"}, status_code=401)
    else:
        host = request.client.host if request.client else ""
        if host not in ("127.0.0.1", "::1", "localhost", "testclient"):
            return JSONResponse({"error": "passcode"}, status_code=401)
    if count and not limiter.ok():
        return JSONResponse({"error": "rate_limited"}, status_code=429)
    return None


class SampleIn(BaseModel):
    prompt: str
    json_mode: bool = False
    role: str | None = None


@app.get("/api/health")
def health():
    try:
        b = get_backend()
        return {"ok": True, "mode": b.mode, "agents": b.configured(), "locked": bool(os.environ.get("CREW_KEY")),
                "samsara": get_fleet().configured(), "spend_cap": b.spend_cap() if hasattr(b, "spend_cap") else "off"}
    except Exception as e:  # missing key, missing package...
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


def popped_tools(b, key):
    try:
        return list(b.pop_tools(key)) if hasattr(b, "pop_tools") else []
    except Exception:
        return []


@app.post("/api/sample")
def sample(body: SampleIn, request: Request):
    d = denied(request)
    if d:
        return d
    key = pick_agent(body.role, body.prompt)
    progress.start(key)
    prompt, needs = body.prompt, []
    asked = OWNER_ASK.search(body.prompt)
    brief = asked.group(1) if asked else ""
    try:
        # facts first: if the owner asked about a truck, read it from Samsara (read-only, and only once they have granted it)
        prompt = samsara_lookup.inject(prompt, get_fleet(), lambda t: progress.update(key, text=t, tool="samsara"),
                                       granted=access.granted("samsara"), needs=needs,
                                       audit=lambda t: ledger.add("samsara", key, t, ask=brief))
    except Exception as e:  # a lookup problem must never stop the answer
        print("samsara lookup failed: %s" % e, flush=True)
    started = time.time()
    b = get_backend()
    try:
        text = b.ask(key, prompt)
    except TimeoutError:
        progress.finish(key, False)
        ledger.add("worked", key, "Did not finish: took too long", ask=brief, tools=popped_tools(b, key), secs=round(time.time() - started), ok=False)
        return JSONResponse({"error": "timeout"}, status_code=504)
    except BudgetReached:
        progress.finish(key, False)
        ledger.add("worked", key, "Stopped: reached the spending cap for one conversation", ask=brief, tools=popped_tools(b, key), secs=round(time.time() - started), ok=False)
        return JSONResponse({"error": "budget", "detail": "spending cap reached"}, status_code=502)
    except Exception as e:
        progress.finish(key, False)
        print("ask failed for %s: %s" % (key, e), flush=True)
        ledger.add("worked", key, "Could not do it: the agent service failed", ask=brief, tools=popped_tools(b, key), secs=round(time.time() - started), ok=False)
        return JSONResponse({"error": "upstream", "detail": str(e)[:300]}, status_code=502)
    progress.finish(key, True)
    ledger.add("worked", key, step_of(body.prompt), ask=brief, tools=popped_tools(b, key), secs=round(time.time() - started), ok=True)
    return {"agent": key, "text": text, "json": extract_json(text) if body.json_mode else None, "needs": needs}


class GrantIn(BaseModel):
    id: str
    granted: bool


@app.get("/api/grants")
def get_grants(request: Request):
    """What the owner has allowed the team to do."""
    d = denied(request, count=False)
    if d:
        return d
    return {"caps": access.listing({"samsara": get_fleet().configured()})}


@app.post("/api/grants")
def set_grant(body: GrantIn, request: Request):
    d = denied(request, count=False)
    if d:
        return d
    try:
        access.set(body.id, body.granted)
    except KeyError:
        return JSONResponse({"error": "unknown"}, status_code=400)
    return {"caps": access.listing({"samsara": get_fleet().configured()})}


@app.get("/api/activity")
def get_activity(request: Request, limit: int = 80):
    """What the team did, newest first, as this server saw it."""
    d = denied(request, count=False)
    if d:
        return d
    out = []
    for e in ledger.recent(max(1, min(limit, 300))):
        e = dict(e)
        e["name"] = TEAM.get(e.get("agent"), "You" if e.get("agent") == "owner" else "")
        e["id"] = PAGE_ID.get(e.get("agent"), "")
        out.append(e)
    return {"entries": out}


@app.get("/api/progress")
def get_progress(request: Request):
    """Who is working right now and what they are doing, for the "Now working" panel."""
    d = denied(request, count=False)
    if d:
        return d
    return {"agents": progress.snapshot()}


@app.post("/api/reset")
def reset(request: Request):
    d = denied(request)
    if d:
        return d
    b = get_backend()
    if hasattr(b, "reset"):
        b.reset()
    return {"ok": True}


if PUBLIC.exists():
    app.mount("/", StaticFiles(directory=str(PUBLIC), html=True), name="public")
