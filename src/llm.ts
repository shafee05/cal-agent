import type { Tool } from "./tools.js";

export interface LlmToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface LlmOutcome {
  reply: string;
  toolCalls: LlmToolCall[];
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

const SYSTEM_PROMPT = `You are Cal, a calendar booking assistant. You help the user check free slots, book meetings, list bookings, and cancel bookings.
Always use the provided tools to answer — never invent availability or booking IDs. If the user asks to book, you need a date (YYYY-MM-DD), a time on the hour (09:00–17:00), and a title; ask for anything missing instead of guessing.
Reply in plain, friendly language and confirm what you did.`;

function toOpenAiTools(tools: Tool[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/**
 * Pluggable OpenAI-compatible chat-completions client.
 * Reads OPENAI_API_KEY, OPENAI_BASE_URL (default https://api.openai.com/v1),
 * OPENAI_MODEL (default gpt-4o-mini). Returns null when no key is set, so the
 * caller can fall back to the rule-based planner.
 */
export async function runLlmAgent(
  userMessage: string,
  tools: Tool[],
  execute: (name: string, args: Record<string, unknown>) => { ok: boolean; message: string },
): Promise<LlmOutcome | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ];
  const toolCalls: LlmToolCall[] = [];
  let reply = "";

  for (let step = 0; step < 5; step++) {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        tools: toOpenAiTools(tools),
        tool_choice: "auto",
        temperature: 0,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`LLM request failed (${res.status}): ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      choices: Array<{ message: ChatMessage }>;
    };
    const msg = json.choices?.[0]?.message;
    if (!msg) throw new Error("LLM returned no message.");

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      messages.push(msg);
      for (const tc of msg.tool_calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
        } catch {
          args = {};
        }
        toolCalls.push({ name: tc.function.name, args });
        const result = execute(tc.function.name, args);
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result.message,
        });
      }
      continue;
    }
    reply = msg.content ?? "";
    break;
  }
  return { reply, toolCalls };
}
