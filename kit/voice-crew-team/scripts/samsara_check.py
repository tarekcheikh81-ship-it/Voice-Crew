#!/usr/bin/env python3
"""Check your Samsara tokens from your own terminal. It only reads, and never prints a token.

  python scripts/samsara_check.py                          every company: is the token accepted, how many trucks
  python scripts/samsara_check.py 88113                    also shows what the team would read about truck 88113 (last 24 hours)
  python scripts/samsara_check.py 88113 "nov 11 to 12"     the same for a date range

Run it from the voice-crew-team folder, after putting the tokens in .env (see .env.example).
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "server"))
import samsara  # noqa: E402


def load_env():
    for p in (ROOT / ".env", ROOT / "server" / ".env"):
        if p.exists():
            for line in p.read_text(encoding="utf8").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def main(argv):
    load_env()
    fleet = samsara.Samsara()
    if not fleet.configured():
        print("No Samsara tokens found. Add lines like SAMSARA_TOKEN_YOUR_COMPANY=... to .env (see .env.example).")
        return 1
    print("Reading from %s, time zone %s\n" % (fleet.base, os.environ.get("CREW_TZ", "America/Chicago")))
    bad = 0
    for company in sorted(fleet.tokens):
        try:
            n = len(fleet.vehicles(company))
            print("  OK       %-28s %d trucks" % (company, n))
        except samsara.SamsaraError as e:
            bad += 1
            print("  PROBLEM  %-28s %s" % (company, samsara._friendly(e)))
    if len(argv) > 1:
        ask = "truck %s safety report %s" % (argv[1], " ".join(argv[2:]))
        print("\nAsking: " + ask + "\n")
        print(fleet.report(ask, progress=lambda t: print("  ... " + t)) or "(not understood as a truck question)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
