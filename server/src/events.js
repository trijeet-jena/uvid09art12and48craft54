/* ============================================================
   UVID — tiny in-process event bus for SSE live updates.
   Any catalog mutation publishes; /api/events streams it to
   every connected customer/admin tab.
   ============================================================ */
"use strict";

const subscribers = new Set();

function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function publish(type) {
  const chunk = `event: catalog\ndata: ${JSON.stringify({ type, at: new Date().toISOString() })}\n\n`;
  for (const fn of subscribers) {
    try { fn(chunk); } catch (_e) { /* socket already gone */ }
  }
}

module.exports = { subscribe, publish };
