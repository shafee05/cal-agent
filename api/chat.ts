import { createSession } from "../src/agent.js";

// Minimal request/response shape — keeps this file free of the @vercel/node
// dependency; Vercel's runtime objects satisfy this interface.
interface ChatRequest {
  method?: string;
  body?: { message?: unknown };
}
interface ChatResponse {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => { json: (body: unknown) => void };
}

// One session per serverless instance; the JSON store persists per instance
// (demo data — see README for the persistence note).
const session = createSession();

export default async function handler(req: ChatRequest, res: ChatResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed. POST { message } to this endpoint." });
  }
  const message = String((req.body as { message?: unknown } | undefined)?.message ?? "").trim();
  if (!message) {
    return res.status(400).json({ error: "message is required" });
  }
  try {
    const out = await session.run(message);
    return res.status(200).json({ reply: out.reply, bookings: out.bookings, usedLlm: out.usedLlm });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}
