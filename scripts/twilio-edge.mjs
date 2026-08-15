import http from "node:http";
import { URL } from "node:url";

const host = process.env.TWILIO_EDGE_HOST ?? "127.0.0.1";
const port = Number(process.env.TWILIO_EDGE_PORT ?? 8788);
const upstream = new URL(process.env.TWILIO_EDGE_UPSTREAM ?? "http://127.0.0.1:8787");

function isAllowed(method, pathname) {
  if (method === "POST" && pathname === "/api/twilio/webhook") return true;
  return method === "GET" && /^\/api\/twilio\/media\/[^/]+$/.test(pathname);
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? host}`);
  if (!isAllowed(request.method, requestUrl.pathname)) {
    response.writeHead(404, {
      "cache-control": "no-store",
      "content-type": "application/json"
    });
    response.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  const proxy = http.request({
    hostname: upstream.hostname,
    port: upstream.port,
    method: request.method,
    path: `${requestUrl.pathname}${requestUrl.search}`,
    headers: {
      ...request.headers,
      host: upstream.host
    }
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });

  proxy.on("error", () => {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    response.writeHead(502, {
      "cache-control": "no-store",
      "content-type": "application/json"
    });
    response.end(JSON.stringify({ error: "Twilio service unavailable" }));
  });

  request.pipe(proxy);
});

server.listen(port, host, () => {
  console.log(`Twilio-only edge listening at http://${host}:${port}`);
});
