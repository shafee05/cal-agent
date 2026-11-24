/**
 * Time helpers. "Now" can be pinned with CAL_AGENT_TODAY (an ISO date-time
 * string) so evals are deterministic; otherwise the real clock is used.
 */
export function now(): Date {
  const pinned = process.env.CAL_AGENT_TODAY;
  if (pinned) {
    const d = new Date(pinned);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function toTimeStr(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function weekdayName(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "long" });
}

/** "2026-11-24" + "10:00" -> Date in local time. */
export function parseDateTime(dateStr: string, timeStr: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  const t = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(timeStr);
  if (!m || !t) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2]), 0, 0);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export function isValidDateStr(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return (
    d.getFullYear() === Number(m[1]) &&
    d.getMonth() === Number(m[2]) - 1 &&
    d.getDate() === Number(m[3])
  );
}
