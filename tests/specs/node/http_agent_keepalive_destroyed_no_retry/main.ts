// A request destroyed by the caller on a reused keepAlive socket must not be
// resent by the stale-socket retry path.
// Regression test for https://github.com/denoland/deno/issues/36786
import http from "node:http";
import { once } from "node:events";

const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
const received: string[] = [];
const server = http.createServer((req, res) => {
  let body = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => body += chunk);
  req.on("end", () => {
    received.push(body);
    // Withhold the response so the client times out and destroys the
    // request. A mistaken retry gets an immediate reply instead.
    if (received.length === 2) return;
    res.end("ok");
  });
});

server.listen(0, "127.0.0.1");
await once(server, "listening");
const { port } = server.address() as { port: number };

function post(body: string, timeout = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port,
      method: "POST",
      agent,
    }, (res) => {
      res.resume();
      res.on("end", resolve);
    });
    req.on("error", reject);
    if (timeout) {
      req.setTimeout(timeout, () => {
        req.destroy(new Error("intentional timeout"));
      });
    }
    req.end(body);
  });
}

const freed = once(agent, "free");
await post("warmup");
await freed;
try {
  await post("timeout", 100);
  console.log("unexpected response");
} catch (e) {
  console.log("error:", (e as Error).message);
}
// Give a mistaken retry time to reach the server.
await new Promise((r) => setTimeout(r, 200));
console.log("received:", JSON.stringify(received));

agent.destroy();
server.closeAllConnections();
server.close();
