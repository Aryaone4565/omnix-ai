const BRAIN_URL = "https://omnix-brain.aryaone4565.workers.dev";
const ALLOWED_ORIGIN = "https://aryaone4565.github.io";
const CONNECTOR_USER_ID = "b3a1d927-0d3e-4e2f-9c67-2a8d7f0145c6";
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

function rpcResult(id, result) {
  return json({ jsonrpc: "2.0", id, result });
}

function rpcError(id, code, message) {
  return json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, 200);
}

function textResult(text, structuredContent) {
  const result = { content: [{ type: "text", text }] };
  if (structuredContent) result.structuredContent = structuredContent;
  return result;
}

function isAuthorized(request, env) {
  const expected = String(env.MCP_ACCESS_TOKEN || "");
  const header = request.headers.get("Authorization") || "";
  if (!expected || expected.length < 32) return false;
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (supplied.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}

const TOOLS = [
  {
    name: "omnix_status",
    description: "Check whether the OMNIX connector is online and which safe starter features it exposes.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "omnix_capabilities",
    description: "List OMNIX integration areas and their current setup status. This does not connect or change any external account.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "omnix_chat",
    description: "Send a message to the OMNIX AI brain and return its reply. This does not send messages to other people or change connected accounts.",
    inputSchema: {
      type: "object",
      properties: { message: { type: "string", minLength: 1, maxLength: 3000 } },
      required: ["message"],
      additionalProperties: false
    }
  }
];

async function callTool(name, args, env) {
  if (name === "omnix_status") {
    return textResult("OMNIX MCP connector is online. OMNIX AI chat forwarding is available. No external account messages are sent by this tool.", {
      online: true,
      service: "OMNIX",
      creator: "Arya Gupta",
      year: 2026,
      features: ["status", "integration capability listing", "AI chat forwarding"]
    });
  }

  if (name === "omnix_capabilities") {
    return textResult("Starter connector status: Gmail, WhatsApp Business, Instagram, and Facebook Messenger are planned integration areas. Their live account access must be configured separately in OMNIX. This tool does not claim that any account is connected.", {
      integrations: [
        { id: "gmail", status: "requires account setup" },
        { id: "whatsapp_business", status: "requires account setup" },
        { id: "instagram", status: "requires account setup" },
        { id: "facebook_messenger", status: "requires account setup" }
      ]
    });
  }

  if (name === "omnix_chat") {
    const message = typeof args?.message === "string" ? args.message.trim().slice(0, 3000) : "";
    if (!message) throw new Error("Provide a non-empty message.");
    const response = await fetch(BRAIN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Origin": ALLOWED_ORIGIN },
      body: JSON.stringify({
        userId: CONNECTOR_USER_ID,
        message,
        messages: [{ role: "user", content: message }]
      }),
      signal: AbortSignal.timeout(25000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
      return textResult("OMNIX AI could not answer this request: " + String(data.error || ("HTTP " + response.status)).slice(0, 500), { ok: false });
    }
    const reply = String(data.reply || "").slice(0, 12000);
    if (!reply) return textResult("OMNIX returned an empty reply.", { ok: false });
    return textResult(reply, { ok: true, model: data.model || "OMNIX AI", webSearchUsed: Boolean(data.webSearchUsed) });
  }

  throw new Error("Unknown tool: " + String(name));
}

export default {
  async fetch(request, env) {
    if (request.method === "GET") {
      return json({ service: "OMNIX MCP", status: "online", endpoint: "/", auth: "Bearer token required", protocol: "MCP Streamable HTTP" });
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }
    if (!isAuthorized(request, env)) {
      return json({ error: "Unauthorized. Configure a valid MCP_ACCESS_TOKEN secret." }, 401);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Expected a JSON-RPC request body." }, 400);
    }
    if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
      return rpcError(body?.id, -32600, "Invalid JSON-RPC request.");
    }

    // Notifications have no id and must not receive a JSON-RPC response.
    if (!Object.prototype.hasOwnProperty.call(body, "id")) {
      return new Response(null, { status: 202, headers: { "Cache-Control": "no-store" } });
    }

    const id = body.id;
    try {
      if (body.method === "initialize") {
        const requested = String(body.params?.protocolVersion || "");
        const protocolVersion = PROTOCOL_VERSIONS.includes(requested) ? requested : "2025-03-26";
        return rpcResult(id, {
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "OMNIX", title: "OMNIX Personal AI", version: "1.0.0" },
          instructions: "OMNIX is Arya Gupta's personal AI project. Use omnix_chat for OMNIX AI replies. It does not send messages to people or modify external accounts."
        });
      }
      if (body.method === "ping") return rpcResult(id, {});
      if (body.method === "tools/list") return rpcResult(id, { tools: TOOLS });
      if (body.method === "tools/call") {
        const name = String(body.params?.name || "");
        const args = body.params?.arguments || {};
        try {
          return rpcResult(id, { content: (await callTool(name, args, env)).content, ...(await structuredToolResult(name, args, env)) });
        } catch (error) {
          return rpcResult(id, { isError: true, content: [{ type: "text", text: String(error?.message || "Tool failed").slice(0, 500) }] });
        }
      }
      return rpcError(id, -32601, "Method not found: " + body.method);
    } catch (error) {
      return rpcError(id, -32603, String(error?.message || "Internal error").slice(0, 500));
    }
  }
};

// Preserve MCP structuredContent when a tool provides it.
async function structuredToolResult(name, args, env) {
  const result = await callTool(name, args, env);
  return result.structuredContent ? { structuredContent: result.structuredContent } : {};
}
