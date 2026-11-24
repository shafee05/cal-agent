import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { now, parseDateTime, toDateStr } from "./time.js";

export interface Booking {
  id: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM (24h, hour start)
  title: string;
  attendee: string;
  createdAt: string; // ISO timestamp
}

export interface CalendarData {
  bookings: Booking[];
}

export const BUSINESS_OPEN_HOUR = 9; // 09:00
export const BUSINESS_CLOSE_HOUR = 18; // last slot starts 17:00
export const SLOT_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17];

function defaultDataDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/ -> project root, then data/
  return join(here, "..", "data");
}

/**
 * JSON-file-backed calendar store.
 * - data/calendar.json is the live state (gitignored runtime state).
 * - data/seed.json is the committed seed, copied in when no live state exists.
 * - Pass a custom dir (tests/eval) for isolated, deterministic runs.
 */
export class CalendarStore {
  private file: string;
  private data: CalendarData;

  constructor(dataDir: string = process.env.CAL_AGENT_DATA_DIR ?? defaultDataDir()) {
    mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, "calendar.json");
    if (existsSync(this.file)) {
      this.data = JSON.parse(readFileSync(this.file, "utf-8")) as CalendarData;
    } else {
      const seedPath = join(dataDir, "seed.json");
      this.data = existsSync(seedPath)
        ? (JSON.parse(readFileSync(seedPath, "utf-8")) as CalendarData)
        : { bookings: [] };
      // Demo seed: drop bookings that are now in the past, and if nothing is
      // left, create two fresh demo bookings so the UI is never empty.
      const today = toDateStr(now());
      this.data.bookings = this.data.bookings.filter((b) => b.date >= today);
      if (this.data.bookings.length === 0) {
        const tomorrow = new Date(now());
        tomorrow.setDate(tomorrow.getDate() + 1);
        const dayAfter = new Date(now());
        dayAfter.setDate(dayAfter.getDate() + 2);
        this.data.bookings = [
          {
            id: "bk-seed-001",
            date: toDateStr(tomorrow),
            time: "10:00",
            title: "Team standup",
            attendee: "Priya",
            createdAt: new Date().toISOString(),
          },
          {
            id: "bk-seed-002",
            date: toDateStr(dayAfter),
            time: "14:00",
            title: "Product demo",
            attendee: "Rahul",
            createdAt: new Date().toISOString(),
          },
        ];
      }
      this.save();
    }
  }

  private save(): void {
    writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  /** Replace all bookings (used by eval setup). */
  reset(bookings: Booking[]): void {
    this.data = { bookings: [...bookings] };
    this.save();
  }

  listBookings(): Booking[] {
    return [...this.data.bookings].sort((a, b) =>
      `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`),
    );
  }

  getBooking(id: string): Booking | undefined {
    return this.data.bookings.find((b) => b.id === id);
  }

  /** Hourly slots 09:00–17:00 for a date, minus booked and past slots. */
  availableSlots(date: string): string[] {
    const today = toDateStr(now());
    return SLOT_HOURS.map((h) => `${String(h).padStart(2, "0")}:00`).filter((time) => {
      if (this.data.bookings.some((b) => b.date === date && b.time === time)) return false;
      if (date === today) {
        const slotStart = parseDateTime(date, time);
        if (slotStart && slotStart.getTime() <= now().getTime()) return false;
      }
      return true;
    });
  }

  book(date: string, time: string, title: string, attendee: string): Booking {
    const booking: Booking = {
      id: `bk-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)
        .toString(36)
        .padStart(3, "0")}`,
      date,
      time,
      title: title.trim(),
      attendee: attendee.trim(),
      createdAt: new Date().toISOString(),
    };
    this.data.bookings.push(booking);
    this.save();
    return booking;
  }

  cancel(id: string): Booking | null {
    const idx = this.data.bookings.findIndex((b) => b.id === id);
    if (idx === -1) return null;
    const [removed] = this.data.bookings.splice(idx, 1);
    this.save();
    return removed;
  }
}
