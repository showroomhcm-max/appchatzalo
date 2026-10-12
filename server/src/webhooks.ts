import crypto from "node:crypto";
import { all, run } from "./db.js";
import { bus } from "./bus.js";

type Hook = { id: number; url: string; secret: string; events: string };

/**
 * Gửi sự kiện sang các web app khác.
 * Header X-Zalo-CSKH-Signature = "sha256=" + HMAC_SHA256(secret, body) để bên nhận xác minh.
 */
async function deliver(hook: Hook, event: string, payload: unknown) {
  const body = JSON.stringify({ event, timestamp: Date.now(), data: payload });
  const signature = "sha256=" + crypto.createHmac("sha256", hook.secret).update(body).digest("hex");
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(hook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Zalo-CSKH-Event": event,
          "X-Zalo-CSKH-Signature": signature,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        run("UPDATE webhooks SET last_status = ? WHERE id = ?", `OK ${res.status} @ ${new Date().toISOString()}`, hook.id);
        return;
      }
      lastError = `HTTP ${res.status}`;
    } catch (e: any) {
      lastError = e?.message ?? String(e);
    }
    await new Promise((r) => setTimeout(r, attempt * 2000));
  }
  run("UPDATE webhooks SET last_status = ? WHERE id = ?", `LỖI ${lastError} @ ${new Date().toISOString()}`, hook.id);
}

export function dispatch(event: string, payload: unknown) {
  const hooks = all<Hook>("SELECT id, url, secret, events FROM webhooks WHERE active = 1");
  for (const hook of hooks) {
    const events = JSON.parse(hook.events) as string[];
    if (events.includes("*") || events.includes(event)) void deliver(hook, event, payload);
  }
}

export const WEBHOOK_EVENTS = [
  "message.received",
  "message.sent",
  "conversation.assigned",
  "conversation.status_changed",
  "conversation.updated",
] as const;

export function setupWebhooks() {
  bus.on("message.created", (message, conversation) => {
    if (message.source === "history") return;
    dispatch(message.direction === "in" ? "message.received" : "message.sent", { message, conversation });
  });
  bus.on("conversation.updated", (conversation, change) => {
    if (!change) return;
    const event =
      change.type === "assign"
        ? "conversation.assigned"
        : change.type === "status"
          ? "conversation.status_changed"
          : "conversation.updated";
    dispatch(event, { conversation, change });
  });
}
