# Voice Crew team: deploy the agents and run them

This kit puts your nine teammates (Michael, Mia, Leo, Jimmy, Raphaella, Jason, Sara, your personal assistant Freya and your sheets and data specialist Martina) on **Claude Managed Agents**, where each one is a real agent with its own sandbox, and connects the Voice Crew screen to them so you can talk to them from your phone.

```
Phone / browser ──► your server (holds the key) ──► Managed Agents: one session per teammate
   Voice Crew screen      server/app.py                 Mia, Leo, Jimmy ... each with a sandbox
```

| Folder | What it is |
| --- | --- |
| `agents/*.md` | The nine teammates: model, tools and instructions. Edit these to change who they are. |
| `environment.yaml` | The cloud sandbox they work in. |
| `scripts/apply.sh` | Creates or updates all nine agents and the environment. |
| `scripts/run_task.py` | Gives one teammate a real task and prints what they do. |
| `server/` | The small server and the Voice Crew screen it hosts. |
| `Dockerfile` | To put the server online. |
| `tests/` | Checks for the server (`pip install pytest httpx && pytest -q tests`). |

## 0. Try the screen first (no account needed)

```bash
cd server
pip install -r requirements.txt
MOCK=1 uvicorn app:app --port 8000
```

Open http://localhost:8000. The teammates answer with a demo line, but everything else works: calls, notes, the 3D view. Stop it with Ctrl+C.

To see the "Now working" panel move, make the demo teammates take their time: `MOCK=1 MOCK_DELAY=6 uvicorn app:app --port 8000` (each answer then takes about six seconds and acts out reading, writing and checking).

## 1. What you need

- A Claude Console account with API credits (platform.claude.com). API usage is billed separately from a chat subscription.
- An API key (Console, Settings, API keys).
- Python 3.10 or newer, and the `ant` command-line tool:
  - macOS: `brew install anthropics/tap/ant`
  - Linux: see the install steps in the Managed Agents quickstart.

## 2. Deploy the teammates

```bash
ant auth login            # or: export ANTHROPIC_API_KEY=your-key
./scripts/apply.sh
```

This creates the nine agents and the sandbox environment. It prints an ID for each one, and also saves them in `claude-lock.json`.

**Without a terminal (from a phone):** this repository can do the same step on GitHub.

1. On GitHub, open the repository, then Settings, Secrets and variables, Actions, New repository secret. Name it `ANTHROPIC_API_KEY` and paste your key as the value. Nobody can read it back afterwards.
2. Open the Actions tab, choose **Publish teammates**, and tap **Run workflow**. It also runs by itself whenever a file in `agents/` or `environment.yaml` changes on the main branch.
3. When it finishes, open the run. Its summary lists the `ENVIRONMENT_ID` and the nine `AGENT_ID_*` lines for step 3, and the IDs are saved in `claude-lock.json` so a later run updates the same teammates instead of making new ones.

## 3. Fill in `.env`

```bash
cp .env.example .env
```

Paste in your API key, the environment ID and the nine agent IDs, and choose a `CREW_KEY` (the passcode your phone will ask for). Never commit `.env`.

## 4. Run a real task

```bash
pip install anthropic
python scripts/run_task.py mia "Sketch the architecture for a voice chat app"
python scripts/run_task.py leo "Build a one-page prototype of the call screen and run it"
```

You see what the teammate says and which tools they use. They work in their own sandbox, so files they create live there.

## 5. Run the screen with the real agents

```bash
cd server
uvicorn app:app --port 8000
```

Open http://localhost:8000 on this computer. From here, calling a teammate by name or opening a call goes to their real agent session. (Without `CREW_KEY` the server only answers requests from this computer.)

## 6. Put it online for your phone

Your phone cannot reach `localhost`, and the microphone only works over **https**. Use any host that runs a Docker container and gives you an https address (Fly.io, Render, Railway, Google Cloud Run and others all work):

1. Build the image from this folder: `docker build -t voice-crew .`
2. Set these environment variables on the host (never in the image): `ANTHROPIC_API_KEY`, `ENVIRONMENT_ID`, the nine `AGENT_ID_*`, and `CREW_KEY`.
3. If the host offers a small persistent disk, mount it at `/data` so conversations survive restarts.
4. Open the https address on your phone. The first time, enter your passcode.
5. For voice, use Chrome on Android. Then add the page to your home screen from the browser menu.

## Freya, your personal assistant

Freya is not part of the builders' chain. She is yours: she keeps the notes you give her, plans your day, drafts emails, texts and replies in your voice, and turns your notes into a ready answer when a client asks something. Say "Freya" to talk to her, or ask "Freya, open a call". Michael brings her in for personal and client requests, never for software work. If you take her offline, Martina covers for her. From the page she cannot set alarms, send messages or open your calendar, and she says so.

## Martina, your sheets and data person

Martina does data entry and sheet work: she turns what you tell her into clean rows and columns, builds sheets with formulas and totals, cleans and reshapes messy data, edits and restyles, and checks totals. Say "Martina" to talk to her. Michael brings her in for spreadsheet and data requests, never for software work. If you take her offline, Freya covers for her. She never invents numbers: if a value is missing, she asks. From the page she cannot open or change your files, so she gives you the table as CSV (with a Copy button) or the exact formulas, ready to paste into Google Sheets or Excel. With the real agents she can also build a file in her own sandbox, but that file stays in the sandbox, so she gives you the content as text as well.

## Calls, the "Now working" panel and leaving the tab

- **Calls are hands-free.** On a call you never press Send: when you stop talking (or stop dictating on the keyboard), the message goes by itself. Text typed key by key waits about five seconds so you are not cut off mid-sentence. Say "goodbye", "bye", "that's all", "talk to you later" or "end the call" and the call ends, even while the team is still working, and the teammate says goodbye.
- **Now working.** While the team works, a panel on the left of the screen shows who is on it. Each person has a progress bar, how long they have been at it, and a small preview of what they are doing. Tap a card to open that teammate. With the real agents the preview shows what the server sees on their event stream (for example "Reading files", "Running a command" and the latest sentence they wrote); the server offers it at `/api/progress`, and the screen asks for it about once a second only while a request is running.
- **Leaving the tab.** The page keeps a very quiet sound playing and registers with the phone's media controls while the team is talking or working, so the browser is less likely to put the page to sleep. A line the browser cut off while the page was hidden is said again when you come back. This is a best effort: see the limits below.

Limits: iPhone Safari does not let a web page speak while it is in the background, and no browser lets a page keep the microphone open in the background. On a phone, keep the screen on during a call (the page asks the phone to), or use Android Chrome or a computer. Desktop Chrome keeps speaking when the tab is in the background or the window is minimized.

## Samsara: let the team look things up by themselves

Ask "truck 88113, safety report for Nov 11 to 12" and the team no longer says "I can't open Samsara". Before a teammate answers, **the server** looks the truck up in your Samsara accounts, reads its safety events for that window, and puts the result in front of the teammate as plain text. Michael then answers from it, and the full list opens under his answer ("Full details").

- **Only after you allow it.** Until you grant Samsara access the server does not look anything up. The team says it needs access and waits; when you say "grant Samsara access" (or tap the button that appears), it carries on with the same request by itself. See "Obedience, access and reports" below. To start with it already on, put `GRANTED=samsara` in `.env`.
- **Read-only, and the team never sees a token.** Tokens live in `.env` on your server. The lookup only sends `GET` requests, and only to `samsara.com`. The agents receive what Samsara returned (truck, times, drivers, places), never the token.
- **Several companies.** Put one line per company in `.env`, for example `SAMSARA_TOKEN_ABBAS_TRANSPORT=...`. The server searches all of them at once for the truck name, so you do not have to say which company it belongs to. If a token is refused, the answer says which company could not be read instead of hiding it.
- **Give each token only two permissions:** "Read Vehicles" and "Read Safety Events & Scores". Nothing that can change anything.
- **What it understands:** a truck as "truck 88113", "unit #88113" or just the number next to a word like safety, report or events; and a window as "Nov 11 to 12", "Nov 11", "yesterday", "today", "last 48 hours", "last week". With no window it reads the last 24 hours. A follow-up like "and yesterday?" keeps the same truck. Dates are read in `CREW_TZ` (default America/Chicago): set it to the time zone your trucks work in.
- **Check it yourself first.** From your own computer, in the `voice-crew-team` folder: `python scripts/samsara_check.py` lists each company and whether its token works, and `python scripts/samsara_check.py 88113 "nov 11 to 12"` prints exactly what the team would read. Do this once before relying on it.
- **Your agents need the new instructions.** Run `./scripts/apply.sh` again after updating, so they know how to treat the Samsara block.
- **Limits.** It matches the truck by its name in Samsara (or licence plate, or an external ID). The first request after a restart is slower because it lists your trucks; the list is remembered for 15 minutes and answers for 5. Only safety events are read for now, not trips, locations or hours of service. This works in the version that runs on your server; the page published inside Claude cannot reach Samsara at all.

## Obedience, access and reports

The team works like a small staff: **you decide, they do it, and they tell you what they did.**

- **They do what you ask, inside the access you gave.** A teammate does not stall or lecture. If a job needs access they do not have, they say exactly which one and wait. Once you grant it, the request that was waiting goes ahead on its own.
- **Grant and take back, by voice or by tap.** Say "grant Samsara access", "give the team Samsara access", "you can use Samsara", or just "yes" right after they ask. Say "revoke Samsara access" or "take back the access" and it stops at once. The **Report** button opens the Access list with an on/off switch for each one. The server remembers your choice (in `GRANTS_FILE`), even after a restart.
- **Never illegal.** Every teammate is told, in their own instructions, never to do anything illegal and never to falsify, hide or alter records (for example drivers' logs, hours of service or safety events), never to get into anyone's accounts or data without permission, and to say no in one plain sentence and offer the lawful way instead.
- **They report everything.** Say "report to me", "what did you do" or "what has everyone done", or tap **Report**. You get a list with the time, who did it and what: who decided what, which Samsara lookups ran (truck, window, how many events), what was refused, and when you granted or took back access. After every task the teammate also states what they did, in their own words.
- **Two kinds of line, labelled.** "Recorded" lines are written by **your server** from what it actually saw (who was asked, which tools they used, which lookups ran, every grant and revoke). They do not depend on what a teammate says about themselves. "Their words" lines are what the teammate says they did. If the two ever disagree, trust the recorded lines. Keys and tokens are blanked out of the record. It keeps the newest 2,000 entries (in `ACTIVITY_FILE`), and the same list is at `/api/activity` (it needs your passcode).
- **Run `./scripts/apply.sh` again** after updating, so the nine teammates get the new rules.

What this does **not** do, honestly:

- The teammates are AI models. They follow instructions and refuse clearly illegal or harmful requests, but a model can misjudge, misunderstand or word a report wrongly. That is why the server keeps its own record.
- **Only what your server controls can be switched on and off.** Today that is the Samsara lookup. A teammate's sandbox (its shell and files) is fixed in its agent file and cannot be granted or taken back while it runs. Web search and fetch are off. Nothing here can reach your computer, your browser or your other accounts, so there is nothing of that kind to grant.
- The page published inside Claude cannot grant or enforce anything. Access, the record and "report to me" with server facts work in the version that runs on your server.
- The record lists tools by name. Whether the agent service also returns the details of each tool call is not verified, so those lines may be short.

## Teach the team

The **Teach** button (and "Teach Jimmy: when I ask for a truck report, start with the worst event") saves a lesson for one teammate or for everyone. Lessons are kept on the device you use, handed to the right teammate with every request, and the newest wins if two clash. Michael sees all of them so he knows who does what. Delete or change them any time from the same button. Lessons shape how they answer; they do not give anyone new abilities, such as Samsara access.

## How it works

- The screen sends each teammate's prompt to `/api/sample`. The server finds which teammate it is for, sends it to that teammate's session, waits until they finish, and returns their answer.
- Each teammate keeps one conversation, so they remember earlier turns. After `SESSION_MAX_USES` requests (5) the server starts a fresh conversation with them, so the history does not grow and cost more with every answer. The screen sends its notes and the last ten lines of the conversation along each time, so nothing you told them is lost.
- Voices and the microphone come from the browser, so there is nothing else to connect. Michael, Leo, Jimmy and Jason get male voices, and Mia, Raphaella, Sara, Freya and Martina get female voices, if the device has them. Freya and Martina each have their own slot among the female voices and a slightly different pitch, so they sound like their own people. Which voices exist depends on the phone.
- The teammates may use their sandbox when you ask them to build, run or test something. For everyday conversation they just answer.

## Costs and safety

- You pay normal token rates plus $0.08 per session-hour of active running time. Calls are short, but watch usage in the Console during the first days.
- **Built to be cheap.** Seven teammates (Michael, Leo, Raphaella, Jason, Sara, Freya and Martina) run on the small Haiku model, which costs about a twentieth of Sonnet. Only Mia and Jimmy, who do the deep design and the server code, run on Sonnet, at medium effort. The agent service caches each teammate's instructions and earlier turns by itself, so repeated text is billed at a fraction of the price; there is nothing to switch on.
- **One request can never fan out.** Michael brings in at most two teammates, a handoff is only a note on the screen (it does not start another teammate by itself), and Michael wraps up once: at most four answers per request, unless you call more teammates by name yourself. Answers are held to a few sentences by their instructions.
- **A hard cap per conversation.** `SESSION_BUDGET_CENTS` (100, so $1.00) is the most one teammate's conversation may spend. The agent service enforces it: at the cap the teammate stops, the record says so, and your next request starts a fresh conversation. Set it to 0 for no cap. `/api/health` shows `spend_cap`; if it says `refused`, the service would not take a cap and the team is running without one.
- Also set a monthly spending limit in the Claude Console. That is the only limit that covers everything.
- `MAX_REQUESTS_PER_MIN` (40) stops runaway use. Lower it if you like.
- Anyone who has your server address and passcode spends your money. Use a long passcode, and do not share the address.
- The sandbox starts with limited network access (package managers only). Read what the teammates write before you run or ship it. Sessions stay until you delete them in the Console.
- Managed Agents is a public beta, so details can change. It is not covered by zero data retention or a HIPAA agreement.

## Changing things

- **A teammate's model or instructions:** edit `agents/<name>.md`, then run `./scripts/apply.sh` again (or the Publish teammates job on GitHub). To give a teammate the larger model, replace its `model: claude-haiku-5-5` line with the three `model:` lines from `agents/mia.md`.
- **Let them search the web:** in the agent files, change `enabled: false` to `true` for `web_search` and `web_fetch`.
- **Working on one codebase:** each session has its own sandbox, so teammates do not share files. Either give them a shared git repository (this needs the environment's network settings to allow your git host; see the Managed Agents environment docs), or use the multi-agent feature, which is a research preview that must be requested.
- **A newer version of the screen:** save the page's HTML and run `python scripts/make_index.py voice-crew.html server/public/index.html`.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| "Your session expired" on the screen | Wrong or missing passcode. Clear the site's data and enter `CREW_KEY` again. |
| "Connection problem" | Open `/api/health` on your server. It lists which teammates are set up. A missing one means its `AGENT_ID_*` or `ENVIRONMENT_ID` is not set. |
| The team says it needs Samsara access | That is the grant at work. Say "grant Samsara access" or tap the button under the message. If it says Samsara is not set up on the server, add the tokens to `.env` first. |
| Report is empty or short | Nothing has been done since the record was started, or the server was started with a different `ACTIVITY_FILE`. |
| Michael says he cannot open Samsara | The Samsara lookup runs on your server, not in the page published inside Claude. Open the version from your server, and run `python scripts/samsara_check.py` to see whether the tokens work. |
| An error mentioning a beta header | `pip install -U anthropic`. The library sends the header for you. |
| No sound on the phone | Use Chrome on Android. iPhone browsers have limited speech support. Check the media volume. |
| Answers take long | Teammates use tools only when asked to build something. For plain conversation, try a faster model in the agent file. |

## What was and was not tested

The hands-free call, the goodbye, the "Now working" panel and the replay of a cut-off line were tested in a simulated browser, and the progress feed against the stand-in server. How a real phone or browser treats a minimized tab was **not** tested: that differs by device.

The Samsara lookup was tested against a stand-in that follows Samsara's published response formats: finding a truck across companies, paging, the date window, the older-endpoint fallback, a refused token, and keeping tokens out of what the team reads. It was **not** run against a real Samsara account, because that needs your tokens, so run `scripts/samsara_check.py` once. Teach was tested in a simulated browser (saving by voice-style text and from the panel, who receives which lesson, phone width).

Access and the record were tested two ways: against the real server code with a stand-in for Samsara and for the agent (asking before access, the refusal, granting by voice, the request carrying on by itself, the record showing both, taking it back by voice, and no lookup afterwards) and in a simulated browser at desktop and phone size (the Access list, the Report dialog, the grant and revoke phrases, and that ordinary sentences are not mistaken for them). The rules in the nine agent files were checked to be present. Whether a real teammate follows a rule in every case was **not** tested, and how the live service reports tool use was **not** tested.

The server, the answer parsing, the session handling, the passcode and the screen were tested against a stand-in for the agent service, and the library calls were checked against the installed SDK. It was **not** run against the live Managed Agents service, because that needs your account. If something fails on the first real run, `scripts/run_task.py` is the quickest way to see the exact error.
