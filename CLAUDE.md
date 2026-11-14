# Voice Crew: project handoff

Read this first. It is everything the previous session (a Claude chat) knew about this project.

## Who and what
- The owner is a life-insurance sales rep in Beirut (US company). He is not an engineer: explain in plain language, short, no jargon.
- He also owns about 30 trucking companies, each its own Samsara organisation (one API token per company).
- He works mostly from an iPhone and a Windows PC.
- **Voice Crew** is a voice/text chat with nine virtual teammates shown as a 3D network (three.js): Michael (lead), Mia (Architect), Leo (Frontend), Jimmy (Backend), Raphaella (Tester), Jason (Reviewer), Sara (DevOps), Freya (`Assistant`: notes, plans, drafts) and Martina (`Sheets`: data entry and sheet work).
- It exists in two forms:
  1. **The page**, `voice-crew.html`, one self-contained file. It is published as a private Claude Artifact (https://claude.ai/artifact/S8HXZaJSWNKSsCBGJwroCR, version 22). There it talks to Claude through `window.claude` (sample, dictation, tts). It cannot reach the owner's PC, accounts or Samsara.
  2. **The hosted kit**, `kit/voice-crew-team/`: a FastAPI server plus nine Claude Managed Agents, which the owner deploys from his iPhone. The server serves the same page as `server/public/index.html` with `server/public/shim.js` in front, which provides `window.claude` from the server instead.

## Layout
```
voice-crew.html                 the page, source of truth (edit it directly)
kit/voice-crew-team/
  README.md                     the owner's guide (deploy, .env, Samsara, access, troubleshooting)
  agents/*.md                   the nine teammates' instructions (applied with scripts/apply.sh)
  server/app.py                 API: /api/sample, /api/progress, /api/grants, /api/activity, /api/health
  server/samsara.py             read-only Samsara lookup (GET only, samsara.com only)
  server/audit.py               Access (grants) and Ledger (record of what the team did)
  server/public/index.html      GENERATED from voice-crew.html (see below)
  server/public/shim.js         window.claude provider, window.crewApi, crewNeeds hook
  scripts/                      apply.sh, make_index.py, run_task.py, samsara_check.py
  tests/                        pytest, 85 tests
vc/                             browser tests (Playwright) + three.min.js + a fake-Samsara test server
.github/workflows/publish-teammates.yml   runs `ant apply` on GitHub with the ANTHROPIC_API_KEY repository secret,
                                then commits kit/voice-crew-team/claude-lock.json (the teammates' IDs)
.github/workflows/lock-actions.yml        runs GitHub's `gh actions-lock` and prints the result as a patch
.github/workflows/actions.lock            GENERATED workflow lockfile: never edit by hand. After changing any
                                `uses:` line or adding a workflow, run "Lock workflow actions" and commit its
                                patch (a job cannot push to .github/workflows itself)
```

## Commands
- Server tests: `cd kit/voice-crew-team && pip install -r server/requirements.txt pytest httpx && python -m pytest -q tests` (expect 85 passed).
- After any change to `voice-crew.html`, regenerate the hosted copy: `cd kit/voice-crew-team && python scripts/make_index.py ../../voice-crew.html server/public/index.html`. That script swaps one sentence in the page's LIMITS text ("In this chat you cannot run code, open files, or deploy anything. If that matters, say so in a sentence and offer a plan or code to copy instead.") for the hosted sandbox wording, and stops with an error if that sentence is missing, so keep it in LIMITS.
- Page tests (need Node and `npm i playwright`, then Chromium): `node vc/w3c.js` (access, record, report, charter), `w3t.js` (Teach), `w3g.js`, `w3h.js`, `w3q.js`, `w3w.js`, `w3z.js`, `t_end.js`. They print PASS/FAIL and `ALL PASS`. They open the page with a stubbed `window.claude` and a software WebGL renderer, so they take a minute each.
- Hosted end-to-end: `python vc/e2e_samsara_server.py` (port 8014, fake Samsara, stand-in agent), then `node vc/w3s.js`. `w3x.js` needs the mock server on 8013: `MOCK=1 python -m uvicorn app:app --port 8013` from `kit/voice-crew-team/server`.
- Running the real thing: see `kit/voice-crew-team/README.md`. `.env.example` lists every setting.

## How the page is built
- One HTML file: `<title>Voice Crew</title>`, one dark theme, one `<style>` block that closes with a single `</style>`, three.js pinned to `three@0.128.0` from cdnjs, no other external scripts.
- Artifact rules if it is republished from claude.ai: CDN allowlist (cdnjs, jsDelivr, unpkg), no alert/confirm/prompt, no print, side gutters of at least 16px, works at 400px width, `[hidden]` toggling, localStorage only for light per-device conveniences and always in try/catch.
- It was originally produced by a patch pipeline (a base file plus text fragments). That pipeline is gone from this folder on purpose: **edit `voice-crew.html` directly from now on.** There is no Artifact tool in Claude Code. To publish a new version, open the same artifact from a claude.ai chat or ask there, or give the file to the owner.
- The teammates' prompts, the lead's JSON plan format (`intro, picks, noted, answered, details, did`), Teach lessons and the Report logic are all inside this one file. Search for `LIMITS`, `ctxBlock`, `lessonsBlock`, `reportBlock`, `accessCommand`, `crewNeeds`.

## What is built and working (tested in a simulated browser and against stand-ins)
- Hands-free calls, a "Now working" panel, minimising the tab without losing a line, no silent call drop, honest answers about what the team can and cannot reach (the sandbox, not the owner's PC).
- Samsara lookup on the hosted server: the server finds the truck across all companies, reads safety events for a date window, and puts the result into the prompt as a "Live Samsara data" block (data, never instructions; the agents never see tokens).
- Teach: the owner teaches a teammate or everyone ("Teach Jimmy: ..."); lessons are stored on the device and added to prompts.
- Obedience, access, record, report (latest work): teammates do what the owner asks inside the access he grants; Samsara lookups run only after "grant Samsara access" (or the button), auto-resume the waiting request, and "revoke" stops it; the server keeps a ledger of what actually happened; the Report button and "report to me" show recorded lines (from the server) and "their words" (the teammates' own `did` lists) separately; the charter (obey, never illegal, report honestly) is in the page's LIMITS and in all nine `agents/*.md`.

## Cost controls (added on the owner's request)
- Models: seven teammates on `claude-haiku-5-5`; Mia and Jimmy on `claude-sonnet-5-5` at medium effort. A test pins this split, so change the test with it.
- The owner's names for the models: Falcon 4.7 = `claude-haiku-5-5`, Hawk 5.6 = `claude-sonnet-5-5`, Eagle Eye = `claude-opus-5-5` (nobody assigned). Use his names when talking to him and in the owner's guide. They are labels only: `model:` in `agents/*.md` must stay the real ID. Each agent file tells the teammate its crew model name, never to name the vendor, and to say yes when sincerely asked whether it is an AI; keep that last part.
- Prompt caching and context compaction are done by the Managed Agents service itself; there is no switch for them in this kit.
- History: the page sends the last 10 lines plus its notes; the server starts a fresh session after `SESSION_MAX_USES` (5) requests.
- Fan-out: the page caps the lead's picks at 2, handoffs are display-only, so one lead-routed request is at most 4 model answers (teammates the owner calls by name are not capped).
- `SESSION_BUDGET_CENTS` (100) is a hard per-session cap enforced by the service; the server drops a capped session and never retries it by itself.
- There is no per-answer token limit in Managed Agents: answer length is held by the word limits in the prompts.

## NOT tested (say so plainly when asked)
- A real Samsara account (needs the owner's tokens; he should run `scripts/samsara_check.py` once).
- The live Managed Agents service, and whether its tool-use events carry the tool input (`tool_summary` falls back to the tool name only). That includes the session budget and how well Haiku follows the lead's JSON plan format and the charter.
- A real phone. iPhone Safari cannot speak while the page is in the background; no browser keeps the microphone open in the background.
- Whether each AI teammate follows every rule in every case. They are Claude models: they follow instructions and refuse clearly illegal requests, but can misjudge or word a report wrongly. That is why the server keeps its own record, and why only server-mediated things (Samsara) can really be switched on and off.

## Hard rules for the owner's safety
- **Never ask for, print or store his Anthropic API key or Samsara tokens in chat or in files you create.** He keeps them in a private note and pastes them only into his own terminal or `.env`. Never commit `.env`.
- `CREW_KEY` (a passcode) protects the server once it is online.
- Samsara access stays read-only (GET only, "Read Vehicles" and "Read Safety Events & Scores" permissions). Never add anything that changes a truck's, driver's or safety record.
- The team must never falsify, hide or alter records (drivers' logs, hours of service, safety events) and never access accounts or data without permission.
- Do not drive his browser or computer to open Samsara without his explicit go-ahead.

## Open questions for the owner
1. Freya: does he want **A** (his insurance clients ask him something and the app prepares his answer) or **B** (people ask his team to build something)? Not yet answered.
2. Truck 88113: which company does it belong to? Needed only if someone is to search Samsara by hand.

## Ideas not done
- More grantable access beyond Samsara, each one server-mediated (so it can truly be switched off).
- A phone push when a long task finishes.
- Confirm the live service's tool-use event format and show the real tool input in the record.
