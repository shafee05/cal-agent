import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession } from "./agent.js";
import type { Booking } from "./store.js";

interface EvalCase {
  id: string;
  messages: string[];
  setupBookings?: Booking[];
  expectTool: string;
  expectOutcome: "booked" | "refused" | "listed" | "cancelled" | "answered" | "clarified";
  expectContains?: string;
}

// Pin "today" so relative dates (tomorrow, Friday, yesterday) are stable.
process.env.CAL_AGENT_TODAY = process.env.CAL_AGENT_TODAY ?? "2026-11-23T09:00:00";

const casesPath = new URL("../../tests/eval-cases.json", import.meta.url);
const cases = JSON.parse(readFileSync(casesPath, "utf-8")) as EvalCase[];

let passed = 0;
const failures: string[] = [];

for (const c of cases) {
  const dir = mkdtempSync(join(tmpdir(), "cal-agent-eval-"));
  try {
    const session = createSession(dir);
    session.store.reset(c.setupBookings ?? []);
    let lastReply = "";
    let lastToolCalls: Awaited<ReturnType<typeof session.run>>["toolCalls"] = [];
    for (const msg of c.messages) {
      const res = await session.run(msg);
      lastReply = res.reply;
      lastToolCalls = res.toolCalls;
    }

    const problems: string[] = [];
    const calledNames = lastToolCalls.map((t) => t.name);
    if (c.expectTool === "none") {
      if (calledNames.length > 0) problems.push(`expected no tool call, got ${calledNames.join(", ")}`);
    } else if (!calledNames.includes(c.expectTool)) {
      problems.push(`expected tool ${c.expectTool}, got ${calledNames.join(", ") || "none"}`);
    }

    const lastCall = lastToolCalls[lastToolCalls.length - 1];
    switch (c.expectOutcome) {
      case "booked":
        if (!(lastCall?.name === "bookSlot" && lastCall.result.ok)) problems.push("expected a successful booking");
        break;
      case "refused":
        if (!lastToolCalls.some((t) => !t.result.ok)) problems.push("expected the tool call to be refused");
        break;
      case "listed":
        if (!lastCall?.result.ok) problems.push("expected a successful listing");
        break;
      case "cancelled":
        if (!(lastCall?.name === "cancelBooking" && lastCall.result.ok)) problems.push("expected a successful cancellation");
        break;
      case "answered":
        if (!(lastCall?.name === "getCurrentTime" && lastCall.result.ok)) problems.push("expected the current time to be answered");
        break;
      case "clarified":
        if (calledNames.length > 0) problems.push("expected a clarification question, not a tool call");
        break;
    }

    if (c.expectContains && !lastReply.toLowerCase().includes(c.expectContains.toLowerCase())) {
      problems.push(`reply did not contain "${c.expectContains}" (got: "${lastReply.slice(0, 120)}")`);
    }

    if (problems.length === 0) {
      passed++;
      console.log(`PASS  ${c.id}`);
    } else {
      failures.push(c.id);
      console.log(`FAIL  ${c.id} — ${problems.join("; ")}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const pct = Math.round((passed / cases.length) * 100);
console.log(`\n${passed}/${cases.length} correct (${pct}%)`);
if (failures.length > 0) {
  console.log(`Failed cases: ${failures.join(", ")}`);
  process.exit(1);
}
