#!/usr/bin/env python3
"""Give one teammate a real task and watch them work.

    python scripts/run_task.py mia "Sketch the architecture for a voice chat app"
    python scripts/run_task.py leo "Build a one-page prototype of the call screen and run it"

Reads ANTHROPIC_API_KEY, ENVIRONMENT_ID and AGENT_ID_<NAME> from .env or the environment.
Each run uses a fresh session, so it never mixes with the conversations the screen has.
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_env():
    for p in (ROOT / ".env", ROOT / "server" / ".env"):
        if p.exists():
            for line in p.read_text(encoding="utf8").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    who, task = sys.argv[1].lower(), " ".join(sys.argv[2:])
    load_env()
    agent_id = os.environ.get("AGENT_ID_" + who.upper())
    env_id = os.environ.get("ENVIRONMENT_ID")
    if not (agent_id and env_id and os.environ.get("ANTHROPIC_API_KEY")):
        sys.exit("Missing ANTHROPIC_API_KEY, ENVIRONMENT_ID or AGENT_ID_%s. See .env.example." % who.upper())
    import anthropic

    client = anthropic.Anthropic()
    session = client.beta.sessions.create(agent=agent_id, environment_id=env_id, title="Task for " + who)
    print("Session", session.id, "\n")
    with client.beta.sessions.events.stream(session.id) as stream:
        # open the stream first, then send the task
        client.beta.sessions.events.send(
            session.id,
            events=[{"type": "user.message", "content": [{"type": "text", "text": task}]}],
        )
        for event in stream:
            if event.type == "agent.message":
                for block in event.content:
                    if getattr(block, "type", "") == "text":
                        print(block.text, end="", flush=True)
            elif event.type == "agent.tool_use":
                print("\n[using tool: %s]" % getattr(event, "name", "?"), flush=True)
            elif event.type == "session.status_idle":
                print("\n\nDone.")
                break


if __name__ == "__main__":
    main()
