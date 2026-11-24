import { plan } from "./fallback.js";
import { runLlmAgent } from "./llm.js";
import { CalendarStore } from "./store.js";
import { buildTools, type ToolResult } from "./tools.js";

export interface AgentCall {
  name: string;
  args: Record<string, unknown>;
  result: ToolResult;
}

export interface AgentResponse {
  reply: string;
  toolCalls: AgentCall[];
  bookings: ReturnType<CalendarStore["listBookings"]>;
  usedLlm: boolean;
}

export interface AgentSession {
  store: CalendarStore;
  run: (message: string) => Promise<AgentResponse>;
}

export function createSession(dataDir?: string): AgentSession {
  const store = new CalendarStore(dataDir);
  const tools = buildTools();
  const byName = new Map(tools.map((t) => [t.name, t]));

  function execute(name: string, args: Record<string, unknown>): ToolResult {
    // Pseudo-tool used by the rule-based planner: resolve a title to an ID.
    if (name === "cancelBookingByTitle") {
      const title = String(args.title ?? "").toLowerCase();
      const match = store
        .listBookings()
        .find((b) => b.title.toLowerCase().includes(title) || title.includes(b.title.toLowerCase()));
      if (!match) {
        return { ok: false, message: `I couldn't find a booking matching "${args.title}".` };
      }
      return byName.get("cancelBooking")!.execute({ id: match.id }, { store });
    }
    const tool = byName.get(name);
    if (!tool) return { ok: false, message: `Unknown tool "${name}".` };
    return tool.execute(args, { store });
  }

  async function run(message: string): Promise<AgentResponse> {
    const toolCalls: AgentCall[] = [];
    let reply = "";
    let usedLlm = false;

    // Try the real LLM first when a key is configured; any failure falls
    // back to the deterministic rule-based planner so the demo never dies.
    try {
      const llm = await runLlmAgent(message, tools, (name, args) => {
        const result = execute(name, args);
        toolCalls.push({ name, args, result });
        return result;
      });
      if (llm) {
        usedLlm = true;
        reply = llm.reply || summarize(toolCalls);
      }
    } catch (err) {
      console.error("[cal-agent] LLM failed, using fallback planner:", (err as Error).message);
    }

    if (!usedLlm) {
      const p = plan(message);
      if (p.clarify) {
        reply = p.clarify;
      } else {
        for (const call of p.calls ?? []) {
          const result = execute(call.name, call.args);
          toolCalls.push({ name: call.name, args: call.args, result });
        }
        reply = summarize(toolCalls);
      }
    }

    return { reply, toolCalls, bookings: store.listBookings(), usedLlm };
  }

  return { store, run };
}

function summarize(toolCalls: AgentCall[]): string {
  if (toolCalls.length === 0) return "I couldn't work out what to do with that.";
  return toolCalls.map((c) => c.result.message).join("\n");
}
