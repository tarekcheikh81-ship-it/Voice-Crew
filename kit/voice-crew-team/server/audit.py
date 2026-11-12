"""What the team is allowed to do, and a record of what it actually did.

Access: the owner grants or revokes each capability the server controls (for now: reading Samsara). Nothing that is not
granted is done, and the teammates are told to ask and wait.

Ledger: an append-only record kept by the SERVER, from what it saw happen (who was asked, which tools they used, which Samsara
lookups ran, which access was granted or taken back). It does not depend on what a teammate says about themselves, so it is
the record to trust when the two differ.
"""
import json
import re
import threading
import time
from pathlib import Path

CAPS = {"samsara": "Samsara, read-only lookups"}

_SECRET = re.compile(r"(?i)\b(bearer)\s+\S+|\b(token|api[_-]?key|secret|password|passwd|authorization)\b\s*[:=]\s*(?:bearer\s+)?\S+|\b[A-Za-z0-9_\-]{28,}\b")


def redact(text, n=200):
    """One short line, with anything that looks like a key or token blanked out."""
    s = re.sub(r"[\x00-\x1f\x7f]+", " ", str(text if text is not None else ""))
    s = _SECRET.sub("[hidden]", s)
    return re.sub(r"\s+", " ", s).strip()[:n]


class Ledger:
    def __init__(self, path, cap=2000):
        self.path = Path(path)
        self.cap = cap
        self.lock = threading.Lock()
        self.count = None

    def _lines(self):
        try:
            return [l for l in self.path.read_text(encoding="utf8").splitlines() if l.strip()]
        except FileNotFoundError:
            return []
        except Exception:
            return []

    def add(self, kind, agent="", text="", **extra):
        entry = {"ts": round(time.time(), 1), "kind": kind, "agent": agent, "text": redact(text, 300)}
        for k, v in extra.items():
            if v is None or v == [] or v == "":
                continue
            entry[k] = [redact(x, 160) for x in v] if isinstance(v, list) else (redact(v, 160) if isinstance(v, str) else v)
        line = json.dumps(entry, ensure_ascii=False)
        try:
            with self.lock:
                if self.count is None:
                    self.count = len(self._lines())
                self.path.parent.mkdir(parents=True, exist_ok=True)
                with self.path.open("a", encoding="utf8") as f:
                    f.write(line + "\n")
                self.count += 1
                if self.count > self.cap + 200:            # keep the newest `cap`
                    keep = self._lines()[-self.cap:]
                    self.path.write_text("\n".join(keep) + "\n", encoding="utf8")
                    self.count = len(keep)
        except Exception:      # a record that cannot be written must never stop the work
            pass
        return entry

    def recent(self, limit=80, agent=None):
        with self.lock:
            lines = self._lines()
        out = []
        for l in reversed(lines):
            try:
                e = json.loads(l)
            except ValueError:
                continue
            if agent and e.get("agent") != agent:
                continue
            out.append(e)
            if len(out) >= limit:
                break
        return out


class Access:
    def __init__(self, path, ledger=None, preset=""):
        self.path = Path(path)
        self.ledger = ledger
        self.lock = threading.Lock()
        self.on = {}
        try:
            self.on = {k: bool(v) for k, v in json.loads(self.path.read_text(encoding="utf8")).items() if k in CAPS}
        except Exception:
            # first run: only what the owner pre-approved in .env (GRANTED=samsara)
            self.on = {c: True for c in re.split(r"[,\s]+", preset.lower()) if c in CAPS}

    def granted(self, cap):
        with self.lock:
            return bool(self.on.get(cap))

    def set(self, cap, on, agent=""):
        if cap not in CAPS:
            raise KeyError(cap)
        with self.lock:
            changed = bool(self.on.get(cap)) != bool(on)
            self.on[cap] = bool(on)
            try:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                self.path.write_text(json.dumps(self.on), encoding="utf8")
            except Exception:
                pass
        if self.ledger and changed:
            self.ledger.add("grant" if on else "revoke", "owner", "%s access %s" % (CAPS[cap], "granted" if on else "taken back"))
        return changed

    def listing(self, configured):
        return [{"id": c, "label": label, "configured": bool(configured.get(c)), "granted": self.granted(c)} for c, label in CAPS.items()]
