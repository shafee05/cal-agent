import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSession } from "./agent.js";

const PORT = Number(process.env.PORT ?? 3000);
const session = createSession();

const publicDir = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "public");

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    const file = join(publicDir, "index.html");
    if (!existsSync(file)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("public/index.html not found. Run `npm run build` first.");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    createReadStream(file).pipe(res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/chat") {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}") as {
          message?: string;
        };
        const message = String(body.message ?? "").trim();
        if (!message) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "message is required" }));
          return;
        }
        const out = await session.run(message);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ reply: out.reply, bookings: out.bookings, usedLlm: out.usedLlm }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`cal-agent demo running at http://localhost:${PORT}`);
  console.log(
    process.env.OPENAI_API_KEY
      ? "LLM: enabled (OPENAI_API_KEY set)"
      : "LLM: not configured — using the rule-based fallback planner",
  );
});
