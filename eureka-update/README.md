# EUREKA · Study Chat

The EUREKA study workspace: an AI tutor chat (React Bits **PromptBar** + **open AI models on Groq**, with the green **Hyperspeed** road behind it), workspaces you can share, an exam calendar with reminders, Google sign-in, Free / Pro / Max plans, and Terms, Privacy and Contact pages.

## Run it

```bash
npm install
cp .env.example .env     # then put your Groq key in GROQ_API_KEY=
npm run dev              # http://localhost:5173 — includes the /api/ai backend
npm run test:ai          # makes real Groq requests and checks the setup
npm run build            # production bundle → dist/ (contains no API key)
```

The AI runs on **Groq** (groq.com — not to be confused with xAI’s Grok). The key lives **only on the server** in the `GROQ_API_KEY` environment variable — never bundled into the website, stored in the browser, or sent in browser requests. The browser calls `/api/ai/*` on your own site; the server adds the key and calls xAI’s Responses API (`https://api.x.ai/v1/responses`).


**Opening a file directly:** double-clicking `index.html` can’t work — it’s the entry point for the source code, so it only shows instructions. To look around without installing anything, double-click **`eureka-standalone.html`** instead: the whole site in one file (made with `npm run build:preview`). Everything except the AI and Google sign-in works there, because those need the server that holds your key.
## What's wired up

| Piece | Behaviour |
|---|---|
| **Models** | **Free:** GPT-OSS 20B. **Pro:** Qwen 3.8 (default) + GPT-OSS 20B. **Max:** GPT-OSS 120B (default) + everything below. Each plan opens on its best model. Two automatic switches: messages with **images** go to Qwen 3.8 (the only one that reads images — on every plan), and **web/spec searches** go to a GPT-OSS model (Qwen has no web search on Groq; Pro searches use GPT-OSS 120B). If a model isn’t available on the key, EUREKA tries Groq’s other names for that tier (Qwen 3.6 for 3.8), then steps down. Mapping: `MODEL_PLAN` / `PLAN_DEFAULT_MODEL` in `src/lib/plans.js`; capabilities in `FALLBACK_MODELS` in `server/ai.js`. Qwen 3.8 is a *preview* model on Groq and may be withdrawn at short notice — the fallback covers that. |
| **Thinking level** | Low (default, fastest), Medium, High — Groq’s `reasoning_effort`; the model’s reasoning is hidden from the student. Free plan: up to Medium. |
| **Streaming** | Replies stream in as they're written. The Hyperspeed road speeds up while the AI is working. The send button becomes a stop button. |
| **@ Sources** | *Photos & files*: PDF, DOCX, PPTX, TXT/MD/CSV and images. PDFs are read in the browser (pdf.js) with page labels, images are scaled to ≤2048 px / ~3 MB in the browser and go to Qwen 3.8 as images; DOCX/PPTX are converted to text with slide labels so answers can cite "Slide 12". *Web search*: grounds the answer in Google results and shows numbered source links. |
| **/ Commands** | `/teach` `/quiz` `/explain` `/hard` `/weak` `/flashcards` `/plan` `/hint` `/spec` `/planner` (opens the exam planner) |
| **Suggested prompts** | The chips above the bar send immediately. **+** saves your own prompts (starred, removable). |
| **Subject context** | Choosing a subject in the branched menu tells the tutor which subject you're studying. Each conversation remembers its own subject. |
| **Conversations** | Stored in localStorage. Create, rename (double-click), pin, delete, search by title, subject or content. |
| **Tutor behaviour** | The system prompt makes the AI guide students through homework rather than hand over answers, ask one quiz question at a time, and cite attached materials. |
| **Dictation** | The mic uses the browser's speech recognition (Chrome, Edge, Safari); it's hidden where unsupported. |

Attached files stay available to the tutor until you reload the page. After a reload the chat still notes which files were attached, and the tutor will ask you to attach them again if it needs them.

## Revision system (`#/study`)

Everything the student does feeds one **student model** — per-topic red/amber/green rating, mastery (0–100%), spaced-repetition schedule, marks, minutes and logged mistakes, plus current and target grades. The timetable, the tutor and the coach all read from it, so the plan changes as the student studies. The scheduling is deterministic and explainable (`src/lib/study.js`); the AI does the parts that need judgement (spec topics, questions, marking, flashcards, coaching) through `POST /api/ai/task`.

| Piece | How it works |
|---|---|
| **Setup** | Onboarding step 3 asks for current/predicted and target grades per subject (GCSE 9–1, A-Level A*–E, IB 7–1, AP 5–1, IGCSE, SQA; free text for custom subjects) and offers an optional study roadmap. Grades can be edited in Revision → Topics. |
| **Exam planner** | Revision → *Create my revision plan* (or `/planner`): 1) exams and tests with dates and scope — saved to the calendar as Exam events with reminders; 2) topics, fetched from the board’s specification by the AI (web search pointed at the board’s site), each rated R/A/G with difficulty; 3) study time per weekday, session length, start time, days off; 4) workload check — if the topics need more hours than the student has, it says so and how many minutes a day would cover it — then *Generate*. |
| **Time allocation** | Each topic’s required time comes from its RAG rating, difficulty, exam weight, grade gap and current mastery. Each session is split into learn → explain (Feynman) → active recall → flashcards → exam questions → fix mistakes → consolidate, weighted by mastery, difficulty, logged mistakes and days to the exam (more learning when weak, more exam practice as the exam nears, no new content in the last 3 days). Every block shows why it’s there. |
| **Timetable** | Priority = need × urgency; spaced repeats (1, 3, 6, 10, 14 days); subjects alternate (interleaving); due spaced reviews come first; mixed exam-practice sessions twice a week in the last fortnight; a light final review the day before each exam. |
| **Guided sessions** | *Start* opens a step-by-step panel (it follows you into the chat): objective, technique and how to do it, a timer per step (pause/resume), and *Do this step with the tutor*, which sends a step-specific prompt. It ends with a 1–5 recall rating per topic that updates mastery, RAG and the next review. |
| **Exam practice** | The AI writes an original board-style question for the chosen topic, pitched at the target grade, the topic’s RAG rating and past mistakes; then marks the answer like an examiner: score, marks earned, missing marks and how to get them, examiner’s tip, full-marks answer, and mistake tags that go into the student model. |
| **Flashcards & spaced repetition** | SM-2 scheduling per card (Again/Hard/Good/Easy) and per topic. Cards can be generated by the AI, written by hand, or saved from a marked question. |
| **Adaptive updates** | Exam marks count most, then card reviews, then self-ratings. A topic rated green that keeps scoring under 55% is moved back automatically. After every assessment the plan is rebuilt from tomorrow (today stays stable). |
| **Smart rescheduling** | Sessions not done by the end of their day are marked *missed* and the rest of the plan is rebuilt around them on the next visit. Skipping a session does the same. |
| **Dashboard (Today)** | Streak, study time, exam accuracy, retention, topics mastered; exam countdowns with subject mastery; today’s sessions; reviews due; weak areas; outstanding homework/coursework from the calendar; the top coach insight. |
| **Analytics** | Accuracy, retention, 14-day study time, mastery and RAG mix per subject, time per activity, exam-question trend, recurring mistakes. |
| **Coach** | Always-on rules spot inefficient habits (too much passive learning, overdue reviews, massed practice, avoided red topics, over-revised greens, little exam practice close to an exam, missed sessions, overconfidence, recurring mistakes) and explain *why*. *Ask the AI coach* sends a summary of the data to the AI for personalised advice. Includes a library of 11 evidence-based techniques (what, why, how, when). |
| **Focus timer** | Pomodoro sets: a set is N focus blocks (default 4 × 25 min) with short breaks between, then one long break — then it stops with a *Set complete* summary instead of looping. Custom lengths and block count, pause/resume, skip, stop, sound and desktop notification. A block that ran out more than an hour ago (tab closed, laptop asleep) isn’t counted. It keeps time from timestamps, so it survives navigation and reloads, and logs focus minutes to analytics. |
| **Roadmap** | Optional phases from today to each exam: Foundation → Consolidation → Exam mastery → Final review, each with its focus and techniques. |
| **The tutor knows** | Every chat request carries a compact summary of the student model (`studentModel`): RAG lists for the current subject, recurring mistakes, weakest topics, grades, and whether a guided session is running. The system prompt tells the AI to explain reds from first principles, consolidate ambers, stretch greens, pitch at the target grade, and recommend evidence-based methods. |

AI tasks count as AI messages on the student’s plan. Study data is stored in the browser with everything else (`state.study`).

## Subjects, exam boards and specifications

- **First-run pop-up** (`src/components/Onboarding.jsx`): students pick their qualifications (GCSE, IGCSE / International GCSE, A-Level, International AS & A Level, IB Diploma, AP, SQA National 5 / Higher), then their exam board and subjects — boards can differ per subject — plus HL/SL for IB. Subjects not in the list can be typed in. Edit later from the sidebar (*Subject context → Edit*) or Settings.
- The sidebar subject menu, chat subject, calendar subjects and tutor context all come from the student’s own choices; there are no preset subjects.
- **Hidden specification catalog** (`server/specs.js`, server only): 573 board × qualification × subject entries with specification codes and each board’s official site. The browser only receives subject names (`/api/ai/catalog`). Every chat request tells the AI the student’s courses and the current one, so answers follow that exact spec — content, key terms, required practicals, command words and mark-scheme style.
- **Spec questions** (“what’s on the spec…”, required practicals, assessment objectives, `/spec`) make the AI check the board’s official specification with Groq’s browser search, pointed at the board’s own site (`site:` queries), before answering. Each lookup counts as one web search on the student’s plan.
- The full specification documents are not copied into EUREKA (they’re large, revised regularly and copyrighted by the boards); the tutor reads them from the boards’ websites when needed. To add or correct a spec code, edit `RAW` in `server/specs.js`.

## Accounts, plans, sharing, calendar

| Feature | How it works |
|---|---|
| **Bottom-left account pop-up** | Opens on first visit. Sign in / Create account with Google, current plan with today’s usage, Change plan, Share workspace, Settings, Contact us, Terms, Privacy, Sign out. |
| **Google sign-in** | Google Identity Services. Create an OAuth *Web* client in Google Cloud Console, add your site (and `http://localhost:5173`) to *Authorised JavaScript origins*, then put the client ID in `.env` as `VITE_GOOGLE_CLIENT_ID` or paste it in Settings → Developer settings. It doesn’t work from a `file://` page. |
| **Plans** | Free · Pro $29.99/mo · Max $44.79/mo. Yearly is 10% off: Pro $26.99/mo ($323.89/yr), Max $40.31/mo ($483.73/yr). Limits are in `src/lib/plans.js` and enforced in the app: daily messages and web searches, sources per message, file size, models, thinking effort, workspaces, saved chats, custom prompts, people per shared workspace, custom tutor instructions (Max). |
| **Checkout (Whop)** | Plans are switched on by license key — see *Customer mode* above. Upgrade opens your Whop checkout in a new tab: Pro monthly `plan_VbdKDteONjAvL`, Max monthly `plan_T4rb2neFS9qdz`, Pro yearly `plan_P5x4nksgIGQsS`, Max yearly `plan_x1TBsQJ6buHF3` (defaults in `CHECKOUT` in `src/lib/plans.js`; override with the `VITE_CHECKOUT_*` variables). EUREKA copies the student’s best promo code to the clipboard and tells them to paste it at checkout, and adds an `onSuccess` URL back to `?checkout=return`, which opens the activation box. In Whop, create the promo codes from the table below, and set each plan’s redirect/success URL to your site if the `onSuccess` parameter isn’t honoured. When you run `npm run dev`, Settings → Developer settings → *Preview a plan* lets you try Pro and Max (the dev server honours it; live sites never do). |
| **Workspaces** | Switcher at the top of the sidebar: create, switch, rename (double-click or pencil), delete (with confirmation). Each workspace has its own chats, deadlines and members. |
| **Sharing by email** | Share workspace → enter an email and role (Admin / Editor / Viewer). Your email app opens with an invite. If EUREKA is hosted, the invite has a link that imports a copy of the workspace; otherwise a `.eureka.json` file downloads for you to attach. Change roles or remove people at any time. |
| **Calendar** | Month grid + Upcoming list. Deadlines have title, type (Exam, Test, Homework, Coursework, Project, Assignment, Revision, Other), subject, date, time, priority, notes, completion and reminders (1 week, 3 days, 1 day, on the day, or custom). |
| **Reminders** | The bell shows reminders as they fall due. Turn on Desktop notifications in the bell to get browser notifications while EUREKA is open. **Add to my calendar app** exports an `.ics` file with the same alarms, so your phone or computer reminds you even when EUREKA is closed. The tutor also sees your next 3 weeks of deadlines and suggests revision sessions. |
| **Terms / Privacy / Contact** | `#/terms`, `#/privacy` and the Contact dialog (opens an email to eurekasofficial@gmail.com). The Privacy page has a working “Delete all my EUREKA data” button. |

## Sales, bonuses, rewards and loyalty

All rules live in `src/lib/promos.js`. **One discount per purchase** — EUREKA picks the student’s best one and copies its code for the student to paste at checkout (create the same promo codes in Whop, applying to the first billing period).

| Offer | When | Discount · code | Limited-time bonus |
|---|---|---|---|
| Back to School | 20 Aug – 30 Sep | 25% · `BACK2SCHOOL25` | Double Leaves |
| Midterm Sale | 20 Oct – 10 Nov | 15% · `MIDTERM15` | +25% daily AI messages |
| Black Friday | Fri before Thanksgiving → Cyber Monday | 40% · `BLACKFRIDAY40` | Double Leaves |
| Winter Holiday | 18 Dec – 6 Jan | 20% · `WINTER20` | +25% daily AI messages |
| Spring Midterm | 10 – 28 Feb | 15% · `MIDTERM15` | Double Leaves |
| Exam Season | 15 Apr – 20 Jun | 20% · `EXAMSEASON20` | +50% daily AI messages |
| Summer Holiday | 21 Jun – 19 Aug | 20% · `SUMMER20` | Double Leaves |
| Welcome offer | first 72 hours after a first visit | 30% first month · `WELCOME30` | — |
| Exam Year | student ticks “this is my exam year” | 15% yearly plans · `EXAMYEAR15` | — |

**Rewards (Leaves):** +2 per tutor question (60/day max), +10 for each new study day plus a streak bonus, +15 per completed deadline, +50 per invite, +25 for choosing subjects, +150 per paid month. Tiers: Seedling (0), Sprout (250: +5 messages/day, +2 prompts), Sapling (1,000: +10, +5, 5% off · `LEAVES5`), Evergreen (2,500: +20, +10, 10% off · `LEAVES10`), Ancient Oak (6,000: +30, +20, 15% off · `LEAVES15`).

**Loyalty (continuous Pro/Max):** Bronze 3 months 5% off renewals (`LOYAL5`), Silver 6 months 10% (`LOYAL10`), Gold 12 months 15% (`LOYAL15`). Apply these on renewal from your Whop webhook, since checkout codes only discount the first payment.

Leaves, streaks and the exam-year flag are kept in the browser for now, so they can be edited by a determined user. Move them to the server with accounts before treating them as real money-off.

## Token budget (Groq rate limits)

Groq counts each request’s **input tokens plus the reply it reserves (`max_completion_tokens`)** against the model’s tokens-per-minute (TPM) limit — 8,000 on the free tier. EUREKA used to reserve 8,192 reply tokens and re-send the whole conversation and every attachment on every message, so even “thanks!” was rejected (“Request too large… Limit 8000, Requested 8886”). Now:

| What | How |
|---|---|
| **Input budget** | ≤ ~5,500 tokens per request (`INPUT_BUDGET` in `server/context.js`). The reply reservation is sized so input + reply + a safety margin fit the model’s TPM. |
| **Conversation memory** | The last 6–10 messages are sent (long tutor replies shortened first, so at least 6 always fit). Older messages become a short summary in the system prompt — built from the turns themselves, no extra AI call, so replies stay fast. |
| **Study materials** | PDFs, Word, PowerPoint and text files are split into page/slide pieces once in the browser (`src/lib/context.js`). Each question sends only the relevant pieces (keyword ranking; “page 27” / “slide 4” jumps to that page; broad requests like “summarise this” get a spread across the document). Messages unrelated to the materials send none. Images are sent only with the message they were attached to. |
| **Priority when space is short** | tutor + course instructions → the new message → student model, deadlines, custom instructions (each capped) → material excerpts → recent turns → summary. |
| **413 “too large”** | The server learns the model’s real limit from Groq’s message, shrinks the context (fewer turns, shorter excerpts, smaller reply) and retries — up to twice — before the student sees anything. |
| **429 “rate limit”** | Waits up to 8 s on the server and retries once; otherwise tries the next model (each has its own limit). If it’s still busy, the student sees “EUREKA will try again in N seconds…” and it retries automatically once (waits up to 30 s). Longer waits get a friendly message with the time. Raw Groq errors are never shown to students (only on `npm run dev`). |
| **Paid Groq tier** | Set `GROQ_TPM_LIMIT` (e.g. `250000`) so EUREKA reserves longer replies. It also learns higher limits automatically. |

On Groq’s free tier, 8,000 tokens per minute is roughly **one or two tutor replies per minute for the whole site** — fine for testing, not for real students. Upgrade at console.groq.com → Settings → Billing (Developer tier) before launch.

Each response carries an `x-eureka-context` header (e.g. `kept=8;summarised=46;materials=5/8;input=4945`) so you can see what was sent in your browser’s network tab.

## Customer mode: plans are verified, not trusted

The live site is built for customers only:

- **No developer tools.** Settings shows only subjects and tutor instructions. *Test AI connection*, *Test all models*, *Preview a plan* and the Google client ID field appear **only when you run `npm run dev`**, so you can still test everything on your own computer.
- **Connection tests are locked.** `/api/ai/health?test=1` and `?test=all` spend real AI requests, so the server refuses them on the live site unless you set an `ADMIN_TOKEN` environment variable and add `&admin=<your token>` to the address.
- **Plans can't be switched for free.** A paid plan is only switched on when the server has checked the customer's **Whop license key** with Whop. The server then gives the browser a signed *plan pass* (valid until the membership's renewal date, at most 31 days, then silently re-checked). Every AI request carries the pass, and the server only uses the models that plan includes — editing the site's saved data, or typing the old `?checkout=success` address, does nothing. Without a valid pass, a request is treated as Free.

**Set it up (once):**
1. **Whop → your EUREKA product → add the *Software licensing* (license keys) experience**, so every buyer gets a license key in their receipt and under whop.com → Your orders.
2. **Whop → Developer → API keys → create a company API key** with the `member:basic:read` permission.
3. On your host, add environment variables: `WHOP_API_KEY` (that key) and, recommended, `PLAN_SECRET` (any long random text — it signs plan passes; if you leave it out, `WHOP_API_KEY` is used). Redeploy.
4. Customers: pay → come back to EUREKA (the *Thanks for your purchase* box opens) → paste the license key → *Activate*. They can also use account menu → **Activate a purchase** on any device.

The four Whop plan IDs are built in (`DEFAULT_WHOP_PLANS` in `server/ai.js`); if you create new Whop plans, set `WHOP_PLAN_PRO_MONTHLY`, `WHOP_PLAN_PRO_YEARLY`, `WHOP_PLAN_MAX_MONTHLY`, `WHOP_PLAN_MAX_YEARLY`. Without `WHOP_API_KEY`, activation says “isn’t set up yet” and everyone stays on Free.

What is *not* enforced on the server yet: the daily message/source counters are kept in the browser, so a determined user could reset them — but only on the models their verified plan allows. Server-side daily counters need a small database (e.g. Upstash Redis or Cloudflare KV).

## Before launch

Everything is stored in the browser (localStorage), and plan limits are checked in the browser. That works for one device, but it can be bypassed and doesn’t sync. For a real launch you need a small backend that:

1. verifies Google ID tokens and stores accounts, workspaces and members (so sharing is live, not a copy),
2. receives Whop webhooks (`membership.went_valid`, `membership.went_invalid`, `payment.succeeded`) and sets the plan from the Whop plan ID — then remove the `?checkout=success` handling in `App.jsx`, which anyone can type into the address bar,
3. counts AI usage per signed-in user in `server/ai.js` (the key is already server-side; plan limits are still checked in the browser),
4. sends reminder emails / push notifications when the app is closed.

Have a lawyer review the Terms and Privacy Policy, and add your company name, address and governing law.

## Deploy — pick a host

EUREKA works on **Vercel**, **Cloudflare**, **Render**, **Railway**, **Netlify**, or any server that runs Node 20+. On every host, the one thing to set is the environment variable **`GROQ_API_KEY`** (your `gsk_…` key), then deploy or redeploy. **Never** upload the `.env` file. After deploying, open the site → account button (bottom left) → **Settings → Test AI connection**.

Most hosts deploy from GitHub, so first put the project on GitHub: create a new repository on github.com, then upload the project folder (*Add file → Upload files*, drag in everything **except** `node_modules`, `dist` and `.env`), or push it with Git. `.gitignore` already leaves out `.env`.

### Vercel (closest to Netlify)
1. vercel.com → *Add New → Project* → import your GitHub repository. Vercel detects Vite and uses `vercel.json` (build `npm run build`, output `dist`).
2. Before pressing Deploy, open *Environment Variables* and add `GROQ_API_KEY`.
3. Deploy. The AI runs as the function in `api/ai.js` (60-second limit per reply).
- Changed the key later? *Settings → Environment Variables*, then *Deployments → ⋯ → Redeploy*.

### Cloudflare (free, fast; Workers with static assets)
From the project folder on your computer:
```bash
npm install
npx wrangler login
npx wrangler secret put GROQ_API_KEY     # paste your gsk_ key when asked
npm run deploy:cloudflare                # builds and deploys; prints your *.workers.dev address
```
Config is in `wrangler.jsonc` (change `"name"` to change the address); the AI endpoint is `worker/index.js`. You can also connect the GitHub repository under *Workers & Pages → Create → Import a repository* (build command `npm run build`, deploy command `npx wrangler deploy`) and add `GROQ_API_KEY` under the Worker's *Settings → Variables and Secrets*.

### Render
1. render.com → *New → Blueprint* → pick your GitHub repository. It reads `render.yaml`.
2. When asked, paste your key for `GROQ_API_KEY` → *Apply*.
- Or *New → Web Service*: build command `npm install && npm run build`, start command `npm start`, and add `GROQ_API_KEY` under *Environment*.
- Render's free plan sleeps after ~15 minutes without visitors; the first visit after that takes up to a minute.

### Railway
railway.com → *New Project → Deploy from GitHub repo* → pick the repository. Under the service's *Variables*, add `GROQ_API_KEY`. Railway runs `npm run build` and `npm start` automatically. Then *Settings → Networking → Generate Domain*.

### Any Node server (VPS, Fly.io, your own computer)
```bash
npm install
npm run build
GROQ_API_KEY=gsk_… npm start             # serves the site + AI on http://localhost:3000 (or $PORT)
```
`server/node.js` serves `dist/` and the AI endpoint, reads `.env` if present, and works behind HTTPS proxies.

## Deploy (Netlify)

The AI backend is a Netlify **Edge Function** (`netlify/edge-functions/ai.js`, served at `/api/ai/*`). Edge Functions stream long replies without the 10-second limit on streamed serverless Functions. **Netlify Drop (drag-and-drop) doesn’t deploy functions**, so deploy with Git or the CLI:

**Option A — GitHub (recommended):** push this folder to a GitHub repo (`.env` is git-ignored), then in Netlify choose *Add new site → Import an existing project*. Build command `npm run build`, publish directory `dist` (already set in `netlify.toml`).

**Option B — CLI:**
```bash
npx netlify-cli login
npx netlify-cli link            # reuse your existing site (or: init for a new one)
npx netlify-cli deploy --build --prod
```

Then, in Netlify → **Site configuration → Environment variables**, add `GROQ_API_KEY` (scope: Functions or *All*) and **redeploy**. Remove the old `XAI_API_KEY` and `GEMINI_API_KEY` there. Optional: `ALLOWED_ORIGINS`, `RATE_LIMIT_PER_MINUTE` (default 30 per visitor).

**Groq account:** keys come from console.groq.com/keys (they start with `gsk_`). The free plan works but has low rate limits (requests and tokens per minute/day) — with real students you’ll hit them quickly and see “rate limit reached”; move to Groq’s Developer (pay-as-you-go) plan under Settings → Billing for higher limits. Check console.groq.com → Settings → Limits for each model’s limits.

**Google sign-in** (client ID `931768065843-721uksotvjdh09s07bs51fo8rl0hmrfa.apps.googleusercontent.com` is built in):
1. Google Cloud Console → APIs & Services → **Credentials** → open that OAuth client → **Authorised JavaScript origins** → add your exact site address (e.g. `https://your-site.netlify.app`, no trailing slash) and `http://localhost:5173`. Save; it can take a few minutes.
2. **OAuth consent screen**: fill in the app name, support email (eurekasofficial@gmail.com) and links to `/#/privacy` and `/#/terms`. While it’s in *Testing*, only listed **test users** can sign in — add them, or click *Publish app*.
3. Each sign-in is verified on the server with Google (`/api/ai/auth`) before the student is signed in.
4. If Google shows **“Error 400: origin_mismatch”**, step 1 is missing your site’s address; **“access blocked / app not verified”** means step 2.

## Test it

1. **Locally against the real API:** `npm run test:ai` — checks `GROQ_API_KEY`, makes a real Groq request, tests every model in the lineup, streams a chat reply, runs a spec lookup with web search on the board’s site, and confirms a wrong key gives a clear error.
2. **Your deployed site:** `npm run test:ai -- https://your-site.netlify.app` — also calls the live `/api/ai/health?test=1` and checks the key isn’t in the site’s JavaScript.
3. **In the browser:** open `https://your-site/api/ai/health?test=all`, or in the app: account pop-up → Settings → **Test AI connection** / **Test all models**.

## Troubleshooting

1. **Settings → Test all models** (or `/api/ai/health?test=all`) shows, for each model, whether your key can use it and Groq’s exact error if not.
2. **“EUREKA’s AI server isn’t running on this site”** — deployed without the edge function (e.g. drag-and-drop). Deploy through GitHub or the CLI.
3. **“The AI isn’t set up on the server”** — add `GROQ_API_KEY` in Netlify → Environment variables, then redeploy.
4. **“Groq rejected the API key”** — wrong or revoked key. Groq keys start with `gsk_`; create one at console.groq.com/keys. (A key from xAI/Grok, which starts with `xai-`, won’t work.)
5. **“Rate limit reached”** — the Groq plan’s per-minute or per-day limit for that model. Wait, or upgrade the Groq plan (Settings → Billing).
6. **A model “isn’t available for this key”** — the key’s model permissions exclude it. EUREKA tries the same tier under Groq’s other names (e.g. Qwen 3.6 for 3.8), then steps down the lineup, and tells the student.
7. **Web search unavailable** — browser search failed or isn’t allowed on the key; EUREKA answers without search and says so.

## AI integration details

- Endpoint: `POST https://api.groq.com/openai/v1/chat/completions` (OpenAI-compatible) with `stream: true`, `Authorization: Bearer $GROQ_API_KEY` (server-side only).
- Input: a `system` message with the tutor instructions (built on the server, including the student’s courses, deadlines and student model), then the conversation. Images go as `image_url` data URLs (vision model only); PDFs are read in the browser with pdf.js and sent as text with `--- Page N ---` labels; DOCX/PPTX as text with slide labels.
- Reasoning: Low / Medium / High maps to `reasoning_effort`. Reasoning text is never shown (`include_reasoning: false` for GPT-OSS, `reasoning_format: "hidden"` for Qwen, and any `<think>…</think>` is stripped as a safety net). If a model rejects an option, EUREKA retries without it.
- Web search: `@Web search` and spec questions add Groq’s built-in `{ "type": "browser_search" }` tool (GPT-OSS models). It can’t be limited to one domain, so spec lookups tell the model to search with `site:` the board’s domain. Groq doesn’t always return citations, so source links appear only when it does.
- Groq’s chunks (`choices[0].delta.content`) are converted on the server into the simple format the web app reads.
- Errors are mapped to clear messages: missing key, invalid key, billing, key not allowed, rate limit (with retry time), unavailable model (same-tier alias, then step down), unsupported settings (automatic retry), outage (one retry), network failure, oversized upload.
- Protection: Origin check, per-visitor rate limit, input validation, 20 MB request cap.

## The “AbortSignal could not be cloned” fix

Some previews (like opening the HTML inside a chat window) run the page in a sandbox that relays network requests through `postMessage`, which can’t carry a fetch `AbortSignal`. `src/lib/ai.js` retries without the signal in that case, stops a reply by cancelling the stream itself, and reads the whole reply at once if streaming isn’t available.

## Security note

The API keys used during development were shared in chat (and the old Gemini key was shipped in early builds), so treat them as public: **revoke them** (Google AI Studio for Gemini; console.x.ai for xAI; console.groq.com/keys for Groq) and create new ones. Put the new key only in `.env` (local) and Netlify’s environment variables. Never commit `.env`, and never prefix the variable with `VITE_`.

## Files

```
server/node.js               Node server for Render / Railway / any VPS (npm start)
api/ai.js + vercel.json      Vercel function + config
worker/index.js + wrangler.jsonc  Cloudflare Worker + config
render.yaml                  Render blueprint
server/context.js            token budget: history window, summary, material excerpts, reply size
src/lib/context.js           what the browser sends: recent turns, relevant material excerpts
server/ai.js                 AI backend (Groq): key, request format, stream conversion, errors, fallbacks
server/vite-plugin.js        runs the backend during npm run dev / preview
netlify/edge-functions/ai.js the backend on Netlify (/api/ai/*)
scripts/test-ai.mjs          real-API integration test (npm run test:ai)
src/
  App.jsx / App.css          study chat screen, sidebar, theme
  lib/ai.js                  browser client for /api/ai (no key), models, errors
  lib/files.js               file → message parts (PDF via pdf.js, DOCX, PPTX, text, images)
  lib/plans.js               plans, prices, limits, checkout links
  lib/storage.js             saved state, workspaces, daily usage
  lib/auth.js                Google sign-in
  lib/reminders.js           reminder times, notifications, .ics export
  lib/share.js               share links and workspace files
  lib/study.js               revision engine: student model, SRS, allocation, timetable, rescheduling, analytics, coach, techniques, roadmap
  views/StudyView.jsx        Revision: Today, Timetable, Topics (RAG), Exam practice, Flashcards, Analytics, Coach, Roadmap
  views/Planner.jsx          AI exam planner wizard
  components/SessionRunner.jsx guided step-by-step study sessions
  components/Pomodoro.jsx    focus timer
  study.css                  revision styles + logo wordmark
public/brand/                logo files (SVG + PNG): dark, transparent, light, app icon
  components/AccountMenu.jsx bottom-left account pop-up
  components/Dialogs.jsx     plans, share, contact, settings, confirm
  views/CalendarView.jsx     calendar and deadline editor
  views/Legal.jsx            Terms & Conditions, Privacy Policy
  components/PromptBar.*     React Bits PromptBar (unchanged)
  components/Hyperspeed.*    React Bits Hyperspeed (unchanged, themed via props)
  components/BranchedMenu.*  React Bits BranchedMenu (unchanged)
```
