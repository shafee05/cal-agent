import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSession } from "../src/agent.js";

// Pin "today" to Monday 2026-11-23 09:00 so past/future checks are stable.
process.env.CAL_AGENT_TODAY = "2026-11-23T09:00:00";

function freshSession() {
  const dir = mkdtempSync(join(tmpdir(), "cal-agent-test-"));
  const session = createSession(dir);
  session.store.reset([]);
  return { dir, session };
}

test("bookSlot refuses a double booking", async () => {
  const { dir, session } = freshSession();
  try {
    const first = await session.run("Book tomorrow at 10:00 for Standup with Anil");
    assert.equal(first.toolCalls[0]?.result.ok, true);
    const second = await session.run("Book tomorrow at 10:00 for Demo with Rahul");
    assert.equal(second.toolCalls[0]?.result.ok, false);
    assert.match(second.reply, /already booked/i);
    assert.equal(session.store.listBookings().length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bookSlot refuses a slot in the past", async () => {
  const { dir, session } = freshSession();
  try {
    const res = await session.run("Book yesterday at 10:00 for Review");
    assert.equal(res.toolCalls[0]?.result.ok, false);
    assert.match(res.reply, /past/i);
    assert.equal(session.store.listBookings().length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bookSlot refuses slots outside business hours", async () => {
  const { dir, session } = freshSession();
  try {
    const late = await session.run("Book tomorrow at 19:00 for Late call");
    assert.equal(late.toolCalls[0]?.result.ok, false);
    assert.match(late.reply, /business hours/i);
    const early = await session.run("Book tomorrow at 8:00 for Early call");
    assert.equal(early.toolCalls[0]?.result.ok, false);
    assert.equal(session.store.listBookings().length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cancelBooking removes the booking and frees the slot", async () => {
  const { dir, session } = freshSession();
  try {
    const booked = await session.run("Book tomorrow at 11:00 for Call with Anil");
    const id = (booked.toolCalls[0]?.result.data as { id: string }).id;
    const cancelled = await session.run(`Cancel booking ${id}`);
    assert.equal(cancelled.toolCalls[0]?.result.ok, true);
    assert.equal(session.store.listBookings().length, 0);
    const rebooked = await session.run("Book tomorrow at 11:00 for Call with Anil");
    assert.equal(rebooked.toolCalls[0]?.result.ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listAvailableSlots excludes booked slots", async () => {
  const { dir, session } = freshSession();
  try {
    await session.run("Book tomorrow at 10:00 for Standup with Anil");
    const res = await session.run("What slots are open tomorrow?");
    const data = res.toolCalls[0]?.result.data as { slots: string[] };
    assert.ok(!data.slots.includes("10:00"));
    assert.ok(data.slots.includes("11:00"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
