/* ═══════════════════════════════════════════════════════════════════════════
 * USAGE-PING SANDBOX RECEIVER — a LOCAL stand-in for the real endpoint.
 * ---------------------------------------------------------------------------
 * This is ONLY for testing the ping on your own machine. It is NOT the production
 * endpoint and never touches Salesforce. It receives the exact anonymous packet the
 * tool would send — { iid, v, page, day } — tallies it, and prints a live summary so
 * you can SEE "active users" being counted (unique iid), including returning ones.
 *
 * Run:   node usage-ping-sandbox/receiver.js
 * Then open usage-ping-sandbox/test.html in a browser (see its instructions).
 *
 * A real endpoint (Cloudflare Worker / counter service) would do the same tally but
 * persist it. This one keeps the tally in memory + appends raw pings to pings.log.
 * ═══════════════════════════════════════════════════════════════════════════ */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 8787;
const LOG = path.join(__dirname, "pings.log");

// in-memory tally
const users = new Set();          // unique iid  → "active users"
const byPage = {};                // page bucket → count
const byDay = {};                 // day → Set(iid)  → DAU
let total = 0;

function record(p) {
  total++;
  if (p.iid) users.add(p.iid);
  if (p.page) byPage[p.page] = (byPage[p.page] || 0) + 1;
  if (p.day) { (byDay[p.day] = byDay[p.day] || new Set()).add(p.iid); }
  try { fs.appendFileSync(LOG, JSON.stringify({ ...p, recvAt: new Date().toISOString() }) + "\n"); } catch (e) {}
}

function dashboard() {
  const lines = [];
  lines.push("────────────────────────────────────────────");
  lines.push("  USAGE-PING SANDBOX — live tally");
  lines.push("────────────────────────────────────────────");
  lines.push("  ACTIVE USERS (unique iid): " + users.size);
  lines.push("  total pings received:      " + total);
  lines.push("  by page:");
  Object.keys(byPage).sort().forEach(k => lines.push("      " + k.padEnd(20) + byPage[k]));
  lines.push("  daily active users (DAU):");
  Object.keys(byDay).sort().forEach(d => lines.push("      " + d + "   " + byDay[d].size));
  lines.push("────────────────────────────────────────────");
  lines.push("  raw log: usage-ping-sandbox/pings.log");
  return lines.join("\n");
}

const server = http.createServer((req, res) => {
  // CORS so a file:// or localhost page can POST here in the sandbox
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // GET /stats → JSON tally (the test page polls this to show the count live)
  if (req.method === "GET" && req.url.startsWith("/stats")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ activeUsers: users.size, total, byPage, dau: Object.fromEntries(Object.entries(byDay).map(([d, s]) => [d, s.size])) }, null, 2));
    return;
  }

  // POST /ping → a usage ping (same shape sendBeacon sends)
  if (req.method === "POST") {
    let body = "";
    req.on("data", c => { body += c; if (body.length > 10000) req.destroy(); });
    req.on("end", () => {
      let p = {};
      try { p = JSON.parse(body || "{}"); } catch (e) { p = { parseError: true, raw: body.slice(0, 200) }; }
      record(p);
      console.clear();
      console.log(dashboard());
      console.log("\n  last ping: " + JSON.stringify(p));
      res.writeHead(204); res.end();  // fire-and-forget: no body (matches no-cors/sendBeacon)
    });
    return;
  }

  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("usage-ping sandbox receiver. POST /ping  |  GET /stats\n");
});

server.listen(PORT, () => {
  console.clear();
  console.log(dashboard());
  console.log("\n  Receiver listening on http://localhost:" + PORT);
  console.log("  → open usage-ping-sandbox/test.html in your browser and click the buttons.");
});
