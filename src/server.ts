import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import "dotenv/config";
import { GeminiLlmAdapter } from "./llm/provider.js";
import { AgentRunner } from "./agent/runner.js";

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const rootDir = process.cwd();

const llm = new GeminiLlmAdapter();
const runner = new AgentRunner(rootDir, llm);

function setCorsHeaders(res: http.ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
  setCorsHeaders(res);
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function serveStatic(res: http.ServerResponse, filePath: string, contentType: string): void {
  setCorsHeaders(res);
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("404 Not Found");
    return;
  }
  const content = fs.readFileSync(filePath);
  res.writeHead(200, { "Content-Type": contentType });
  res.end(content);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    setCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = parsedUrl.pathname;

  // -------------------------------------------------------------
  // API: GET /api/health
  // -------------------------------------------------------------
  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      provider: "google-gemini",
      model: process.env.GEMINI_MODEL || "gemini-3.5-flash",
      hasKeyConfigured: Boolean(process.env.GEMINI_API_KEY),
      status: "ready"
    });
    return;
  }

  // -------------------------------------------------------------
  // API: GET /api/sessions/:id
  // -------------------------------------------------------------
  if (req.method === "GET" && pathname.startsWith("/api/sessions/")) {
    const sessionId = pathname.substring("/api/sessions/".length);
    const messages = runner.getSession(sessionId);
    sendJson(res, 200, { sessionId, messages });
    return;
  }

  // -------------------------------------------------------------
  // API: POST /api/chat
  // -------------------------------------------------------------
  if (req.method === "POST" && pathname === "/api/chat") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}") as { sessionId?: string; message?: string };
        const sessionId = payload.sessionId || `sess-${Date.now()}`;
        const message = payload.message || "";

        if (!message.trim()) {
          sendJson(res, 400, { ok: false, error: "Mensaje vacío" });
          return;
        }

        const result = await runner.processMessage(sessionId, message);
        sendJson(res, 200, {
          sessionId,
          reply: result.reply,
          toolCalls: result.toolCalls,
          needsConfirmation: result.needsConfirmation
        });
      } catch (err) {
        sendJson(res, 500, { ok: false, error: (err as Error).message });
      }
    });
    return;
  }

  // -------------------------------------------------------------
  // Servir frontend web/
  // -------------------------------------------------------------
  const webDir = path.resolve(rootDir, "web");

  if (pathname === "/" || pathname === "/index.html") {
    serveStatic(res, path.resolve(webDir, "index.html"), "text/html; charset=utf-8");
    return;
  }
  if (pathname === "/style.css") {
    serveStatic(res, path.resolve(webDir, "style.css"), "text/css; charset=utf-8");
    return;
  }
  if (pathname === "/app.js") {
    serveStatic(res, path.resolve(webDir, "app.js"), "application/javascript; charset=utf-8");
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Ruta no encontrada");
});

server.listen(PORT, HOST, () => {
  console.log(`\n==================================================`);
  console.log(` 🌐 Servidor Agente SAP activo en http://${HOST}:${PORT}`);
  console.log(`    API Chat: http://${HOST}:${PORT}/api/chat`);
  console.log(`    Health:   http://${HOST}:${PORT}/api/health`);
  console.log(`    Web Chat: http://localhost:${PORT}`);
  console.log(`==================================================\n`);
});

