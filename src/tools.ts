import { BUSINESS_CLOSE_HOUR, BUSINESS_OPEN_HOUR, CalendarStore } from "./store.js";
import { isValidDateStr, now, parseDateTime, toDateStr, toTimeStr, weekdayName } from "./time.js";

export interface ToolResult {
  ok: boolean;
  message: string;
  data?: unknown;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>, ctx: { store: CalendarStore }) => ToolResult;
}

function isHourSlot(time: string): boolean {
  return /^([01]\d|2[0-3]):00$/.test(time);
}

function validateSlot(
  store: CalendarStore,
  date: string,
  time: string,
): string | null {
  if (!isValidDateStr(date)) return `Date "${date}" is not a valid YYYY-MM-DD date.`;
  if (!isHourSlot(time)) return `Time "${time}" must be on the hour (e.g. "10:00").`;
  const hour = Number(time.slice(0, 2));
  if (hour < BUSINESS_OPEN_HOUR || hour >= BUSINESS_CLOSE_HOUR) {
    return `Time ${time} is outside business hours (${BUSINESS_OPEN_HOUR}:00–${BUSINESS_CLOSE_HOUR}:00).`;
  }
  const slotStart = parseDateTime(date, time);
  if (slotStart && slotStart.getTime() <= now().getTime()) {
    return `Slot ${date} ${time} is in the past.`;
  }
  if (store.listBookings().some((b) => b.date === date && b.time === time)) {
    return `Slot ${date} ${time} is already booked.`;
  }
  return null;
}

export function buildTools(): Tool[] {
  return [
    {
      name: "listAvailableSlots",
      description:
        "List the free hourly booking slots (09:00–17:00) for a given date (YYYY-MM-DD). Past slots and already-booked slots are excluded.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Date to check, YYYY-MM-DD." },
        },
        required: ["date"],
        additionalProperties: false,
      },
      execute: (args, { store }) => {
        const date = String(args.date ?? "");
        if (!isValidDateStr(date)) {
          return { ok: false, message: `Date "${date}" is not a valid YYYY-MM-DD date.` };
        }
        const slots = store.availableSlots(date);
        return {
          ok: true,
          message:
            slots.length > 0
              ? `Free slots on ${date} (${weekdayName(parseDateTime(date, "09:00")!)}): ${slots.join(", ")}.`
              : `No free slots on ${date}.`,
          data: { date, slots },
        };
      },
    },
    {
      name: "bookSlot",
      description:
        "Book a one-hour slot. Fails if the slot is in the past, outside business hours (09:00–18:00), or already booked.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Date to book, YYYY-MM-DD." },
          time: { type: "string", description: "Start time, on the hour, e.g. \"10:00\"." },
          title: { type: "string", description: "Meeting title, e.g. \"Team sync\"." },
          attendee: { type: "string", description: "Who the meeting is with." },
        },
        required: ["date", "time", "title"],
        additionalProperties: false,
      },
      execute: (args, { store }) => {
        const date = String(args.date ?? "");
        const time = String(args.time ?? "");
        const title = String(args.title ?? "").trim();
        const attendee = String(args.attendee ?? "").trim();
        if (!title) return { ok: false, message: "A meeting title is required to book a slot." };
        const error = validateSlot(store, date, time);
        if (error) return { ok: false, message: error };
        const booking = store.book(date, time, title, attendee || "—");
        return {
          ok: true,
          message: `Booked: "${booking.title}" on ${booking.date} at ${booking.time} (${weekdayName(parseDateTime(booking.date, booking.time)!)}), with ${booking.attendee}. Booking ID: ${booking.id}.`,
          data: booking,
        };
      },
    },
    {
      name: "cancelBooking",
      description: "Cancel an existing booking by its booking ID.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Booking ID, e.g. \"bk-abc123\"." },
        },
        required: ["id"],
        additionalProperties: false,
      },
      execute: (args, { store }) => {
        const id = String(args.id ?? "");
        const removed = store.cancel(id);
        if (!removed) {
          return { ok: false, message: `No booking found with ID "${id}".` };
        }
        return {
          ok: true,
          message: `Cancelled: "${removed.title}" on ${removed.date} at ${removed.time}.`,
          data: removed,
        };
      },
    },
    {
      name: "listBookings",
      description: "List all current bookings, soonest first.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: (_args, { store }) => {
        const bookings = store.listBookings();
        return {
          ok: true,
          message:
            bookings.length > 0
              ? bookings
                  .map((b) => `• ${b.date} ${b.time} — "${b.title}" with ${b.attendee} (ID: ${b.id})`)
                  .join("\n")
              : "You have no bookings.",
          data: bookings,
        };
      },
    },
    {
      name: "getCurrentTime",
      description: "Get the current date and time, so relative dates like \"tomorrow\" can be resolved.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: () => {
        const d = now();
        return {
          ok: true,
          message: `It is ${weekdayName(d)}, ${toDateStr(d)} at ${toTimeStr(d)}.`,
          data: { date: toDateStr(d), time: toTimeStr(d), weekday: weekdayName(d) },
        };
      },
    },
  ];
}
