import { now, toDateStr } from "./time.js";

export interface PlannedCall {
  name: string;
  args: Record<string, unknown>;
}

export interface Plan {
  calls?: PlannedCall[];
  /** If set, the agent replies with this instead of running tools. */
  clarify?: string;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

/** Resolve "today" / "tomorrow" / "yesterday" / weekday names / ISO dates. */
export function parseDate(text: string, ref: Date = now()): string | null {
  const lower = text.toLowerCase();
  const iso = /(\d{4}-\d{2}-\d{2})/.exec(lower);
  if (iso) return iso[1];
  if (/\byesterday\b/.test(lower)) return toDateStr(addDays(ref, -1));
  if (/\btoday\b/.test(lower)) return toDateStr(ref);
  if (/\btomorrow\b/.test(lower)) return toDateStr(addDays(ref, 1));
  for (let i = 0; i < WEEKDAYS.length; i++) {
    const name = WEEKDAYS[i];
    const nextRe = new RegExp(`\\bnext\\s+${name}\\b`);
    const plainRe = new RegExp(`\\b${name}\\b`);
    if (nextRe.test(lower)) {
      // The occurrence after this week's one.
      let delta = (i - ref.getDay() + 7) % 7;
      if (delta === 0) delta = 7;
      return toDateStr(addDays(ref, delta + 7));
    }
    if (plainRe.test(lower)) {
      let delta = (i - ref.getDay() + 7) % 7;
      return toDateStr(addDays(ref, delta));
    }
  }
  return null;
}

/** Parse "10:00", "10am", "3pm", "15:30" -> "HH:00" (hour slots only). */
export function parseTime(text: string): string | null {
  const lower = text.toLowerCase();
  const m = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/.exec(lower);
  if (!m) return null;
  let hour = Number(m[1]);
  const minutes = m[2] ? Number(m[2]) : 0;
  const meridiem = m[3];
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour < 0 || hour > 23 || minutes < 0 || minutes > 59) return null;
  // Slots are hourly; round a :30 time down to the hour and note it in the title.
  return `${String(hour).padStart(2, "0")}:00`;
}

/** Remove the date/time words from a message so the rest can become the title. */
function stripDateTime(text: string): string {
  return text
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b(next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, " ")
    .replace(/\b(today|tomorrow|yesterday)\b/gi, " ")
    .replace(/\b\d{1,2}(?::\d{2})?\s*(am|pm)\b/gi, " ")
    .replace(/\b\d{1,2}:\d{2}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractAttendee(text: string): { attendee: string; rest: string } {
  const m = /\bwith\s+([A-Za-z][A-Za-z ]*?)(?:\s+at\s+|\s+on\s+|$)/i.exec(text);
  if (!m) return { attendee: "", rest: text };
  const attendee = m[1].trim().replace(/[.,!?]+$/, "");
  return { attendee, rest: text.replace(m[0], " ").replace(/\s+/g, " ").trim() };
}

/**
 * Deterministic rule-based planner. Used when no LLM API key is configured
 * (demo + eval). It decides which tool(s) to call from the user's message.
 */
export function plan(message: string): Plan {
  const lower = message.toLowerCase();
  const ref = now();

  if (/\bcancel\b/.test(lower)) {
    const idMatch = /\b(bk-[a-z0-9-]+)\b/i.exec(message);
    if (idMatch) return { calls: [{ name: "cancelBooking", args: { id: idMatch[1] } }] };
    // Cancel by title: "cancel my team sync" / "cancel the demo"
    const titleGuess = stripDateTime(message)
      .replace(/\bcancel\b/gi, "")
      .replace(/\b(my|the|a|an|booking|meeting)\b/gi, "")
      .trim();
    if (titleGuess) {
      return { calls: [{ name: "cancelBookingByTitle", args: { title: titleGuess } }] };
    }
    return { clarify: "Which booking should I cancel? You can give me the booking ID or the meeting title." };
  }

  if (/\bwhat time|current time|time is it\b/.test(lower)) {
    return { calls: [{ name: "getCurrentTime", args: {} }] };
  }

  if (/\b(my\s+)?bookings?\b/.test(lower) && !/\bbook\b/.test(lower)) {
    return { calls: [{ name: "listBookings", args: {} }] };
  }
  if (/\blist\b.*\bbookings?\b|\bshow\b.*\bbookings?\b|\bwhat.*booked\b/.test(lower)) {
    return { calls: [{ name: "listBookings", args: {} }] };
  }

  // Booking intent is checked before availability: "Book a slot" contains
  // the word "slot", which would otherwise match the availability branch.
  if (/\b(book|schedule|reserve|set up|arrange)\b/.test(lower)) {
    const date = parseDate(message, ref);
    const time = parseTime(message);
    if (!date || !time) {
      return {
        clarify:
          "I need a date and a time to book — for example: \"Book tomorrow at 10:00 for Team sync with Priya\". I book one-hour slots between 09:00 and 17:00.",
      };
    }
    const { attendee, rest } = extractAttendee(message);
    const title = stripDateTime(rest)
      .replace(/\b(book|schedule|reserve|set up|arrange|a|an|the|slot|meeting|for|at)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    return {
      calls: [
        {
          name: "bookSlot",
          args: { date, time, title: title || "Meeting", attendee },
        },
      ],
    };
  }

  if (/\b(free|available|availability|slots?|open)\b/.test(lower)) {
    const date = parseDate(message, ref);
    if (!date) {
      return { clarify: "Which date should I check? For example: \"Am I free Friday?\" or \"What slots are open tomorrow?\"" };
    }
    return { calls: [{ name: "listAvailableSlots", args: { date } }] };
  }

  return {
    clarify:
      "I can check free slots, book a meeting, list your bookings, or cancel one. Try: \"Am I free Friday at 3pm?\" or \"Book tomorrow at 10:00 for Team sync with Priya\".",
  };
}
