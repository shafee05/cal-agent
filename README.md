# cal-agent

A small TypeScript LLM agent that reads a calendar and books slots — built to show real tool-calling agent work: an agent loop, typed tools with validation, a pluggable LLM client, a deterministic eval set, and a deployable web demo.

## What it does

Chat with Cal and it will:

- **Check free slots** — "Am I free Friday at 3pm?"
- **Book a meeting** — "Book tomorrow at 10:00 for Team sync with Priya"
- **List bookings** — "What are my bookings?"
- **Cancel a booking** — "Cancel booking bk-abc123"
- **Tell the time** — "What time is it?"

Booking rules are enforced for real: no double-booking, no past slots, one-hour slots only, business hours 09:00–18:00.

## Architecture

```
src/
  agent.ts      Agent loop: tries the LLM first, falls back to the rule-based planner
  llm.ts        OpenAI-compatible chat-completions client (function calling)
  fallback.ts   Deterministic rule-based planner — date/time parsing, intent routing
  tools.ts      5 tools with JSON schemas + validation
                listAvailableSlots, bookSlot, cancelBooking, listBookings, getCurrentTime
  store.ts      JSON-file-backed calendar store (data/calendar.json, seeded from data/seed.json)
  time.ts       Time helpers; "now" can be pinned with CAL_AGENT_TODAY for deterministic evals
  eval.ts       Eval runner — 12 cases, prints per-case pass/fail + accuracy
  server.ts     Plain Node dev server (serves the UI + /api/chat)
api/
  chat.ts       Vercel serverless function (POST { message } -> reply + bookings)
public/
  index.html    Minimal chat UI (no frameworks, plain CSS) + bookings side list
tests/
  eval-cases.json   12 eval cases (booking, availability, refusal, cancel, multi-turn)
  booking.test.ts   5 unit tests for booking validation (node:test)
```

**LLM vs fallback, stated honestly:** when `OPENAI_API_KEY` is set, the agent calls a real LLM (OpenAI-compatible `/chat/completions`, function calling, up to 5 tool steps). When no key is set — including the public demo and `npm run eval` — it uses the built-in rule-based planner in `src/fallback.ts`. The demo never pretends the fallback is an LLM; the UI says so.

## Run locally

```bash
npm install
npm run build
npm start            # demo at http://localhost:3000
```

With a real LLM:

```bash
OPENAI_API_KEY=sk-... OPENAI_MODEL=gpt-4o-mini npm start
# OPENAI_BASE_URL can point at any OpenAI-compatible endpoint.
```

No key is ever hardcoded. Copy `.env.example` if you want one — there is no `.env` file in this repo.

## Eval

`npm run eval` runs 12 scripted cases through the agent with the fallback planner (no API key needed). "Today" is pinned to Monday 2026-11-23 09:00 so relative dates are stable. Each case checks the tool called, the outcome, and the reply.

**Latest result (2026-11-23): 12/12 correct (100%)**

| Case | User message | Expected | Result |
|---|---|---|---|
| book-tomorrow | Book tomorrow at 10:00 for Team sync with Priya | bookSlot, booked | ✅ |
| free-friday | Am I free Friday at 3pm? | listAvailableSlots, lists 15:00 | ✅ |
| book-friday | Book Friday 3pm for Demo with Rahul | bookSlot, booked | ✅ |
| double-booking-refused | Book Tuesday at 10:00 (already booked) | refused, "already booked" | ✅ |
| past-date-refused | Book yesterday at 10:00 | refused, "in the past" | ✅ |
| outside-hours-refused | Book tomorrow at 19:00 | refused, "outside business hours" | ✅ |
| list-bookings | What are my bookings? | lists existing booking | ✅ |
| cancel-by-id | Cancel booking bk-eval-001 | cancelled | ✅ |
| book-wednesday | Book Wednesday at 9:00 for Interview with Sara | bookSlot, booked | ✅ |
| current-time | What time is it? | answers with the date | ✅ |
| missing-details-clarifies | Book a slot | asks for date + time, books nothing | ✅ |
| multi-turn-book-then-list | Book tomorrow 11:00, then "What are my bookings?" | booked, then listed | ✅ |

Unit tests: `npm test` — 5 tests covering double-booking, past slots, business hours, cancel-and-rebook, and slot exclusion. **5/5 passing.**

## Example conversation

```
You:  Am I free Friday at 3pm?
Cal:  Free slots on 2026-11-27 (Friday): 09:00, 10:00, 11:00, 12:00, 13:00,
      14:00, 15:00, 16:00, 17:00.

You:  Book Friday 3pm for Demo with Rahul
Cal:  Booked: "Demo" on 2026-11-27 at 15:00 (Friday), with Rahul.
      Booking ID: bk-...

You:  Book Friday 3pm for Demo with Rahul
Cal:  Slot 2026-11-27 15:00 is already booked.
```

## Deploy on Vercel

```bash
vercel deploy
```

`vercel.json` routes `/api/chat` to the serverless function in `api/chat.ts`; `public/index.html` is served statically. No environment variables are required — the demo runs on the fallback planner. Set `OPENAI_API_KEY` in the Vercel dashboard to enable the real LLM.

## Honest limitations

- **The calendar is a JSON file, not a real calendar.** `data/calendar.json` is local demo state; it is not Google Calendar or Outlook. Wiring a real calendar API is the obvious next step.
- **On Vercel, bookings live only as long as the serverless instance does.** The JSON store is per-instance and ephemeral — fine for a demo, not for production. A database (e.g. Vercel KV / Postgres) would fix this.
- **The fallback planner is rule-based, not an LLM.** It handles the common phrasings in the eval set ("tomorrow", "Friday 3pm", "cancel booking …") but will ask for clarification on unusual wording instead of guessing.
- **No auth.** Anyone with the demo URL can book or cancel demo slots. That is intentional for a demo; a real deployment needs user sessions.

## What I'd add next

1. Google Calendar integration (read real availability, write real events).
2. Persistent storage (Vercel KV or Postgres) so bookings survive across instances.
3. More eval cases — natural phrasing ("grab me half an hour with Priya next week"), timezones, recurring meetings.
4. A second tool: email the attendee a calendar invite after booking.
5. Per-user sessions so each visitor gets their own calendar.

## License

MIT — see [LICENSE](LICENSE).
