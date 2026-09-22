import http from "node:http";

const port = Number(process.env.MOCK_LLM_PORT || 4010);
const expectedKey = process.env.MOCK_LLM_API_KEY || "ci-key";

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${expectedKey}`) {
    return json(res, 401, {
      error: { code: "invalid_api_key", message: "missing or invalid API key" },
    });
  }

  if (req.method === "GET" && req.url === "/v1/models") {
    return json(res, 200, {
      data: [
        { id: "mock-model", object: "model", owned_by: "ci" },
      ],
    });
  }

  if (req.method === "POST" && req.url === "/v1/chat/completions") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json(res, 400, { error: { message: "invalid json" } });
    }

    if (body.model !== "mock-model") {
      return json(res, 400, { error: { message: "unexpected model" } });
    }

    if (body.stream) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Request-Id": "mock-stream-request",
      });
      res.write('data: {"choices":[{"delta":{"content":"hello "}}]}\n\n');
      await new Promise((resolve) => setTimeout(resolve, 20));
      res.write('data: {"choices":[{"delta":{"content":"world"}}]}\n\n');
      res.end("data: [DONE]\n\n");
      return;
    }

    return json(res, 200, {
      choices: [
        { message: { role: "assistant", content: "hello world" } },
      ],
    });
  }

  json(res, 404, { error: { message: "not found" } });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Mock LLM listening on http://127.0.0.1:${port}`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
