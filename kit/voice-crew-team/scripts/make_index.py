#!/usr/bin/env python3
"""Turn the Voice Crew page into the screen your server hosts.

    python scripts/make_index.py voice-crew.html server/public/index.html

The input is the page's HTML as you have it (the published page's source). The output wraps it in a
normal web page, loads shim.js first (it connects the screen to your server and to the device's
voice), and tells the teammates they may use their sandbox when asked to build something.
"""
import sys
from pathlib import Path

OLD_LIMITS = "In this chat you cannot run code, open files, or deploy anything. If that matters, say so in a sentence and offer a plan or code to copy instead."
NEW_LIMITS = ("You have a sandbox with a shell and file tools. Use it only when the owner asks you to build, run or test something; "
              "for conversation and quick questions just answer. Whatever you do, your final message must be the JSON object this request asks for.")

HEAD = (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
    '<meta name="theme-color" content="#050912">'
    '<meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes">'
    '<style>:root{color-scheme:dark;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
    'body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>'
    '<script src="/shim.js"></script></head><body>'
)
TAIL = "</body></html>\n"


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    src = Path(sys.argv[1]).read_text(encoding="utf8")
    if OLD_LIMITS not in src:
        print("note: the sandbox sentence was not found, so the teammates keep the chat-only wording", file=sys.stderr)
    src = src.replace(OLD_LIMITS, NEW_LIMITS)
    out = Path(sys.argv[2])
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(HEAD + src + TAIL, encoding="utf8")
    print("wrote", out, len(HEAD + src + TAIL), "bytes")


if __name__ == "__main__":
    main()
