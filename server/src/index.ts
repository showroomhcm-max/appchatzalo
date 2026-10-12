import "./logger-init.js";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { ensureAdmin, applySuperAdmins } from "./db.js";
import { appRouter, publicRouter, errorHandler } from "./routes.js";
import { setupRealtime } from "./realtime.js";
import { setupWebhooks } from "./webhooks.js";
import { zalo } from "./zalo.js";
import { appVersion } from "./version.js";
import { oauthRouter, webhookRouter } from "./platform-routes.js";

ensureAdmin();
applySuperAdmins();

const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: config.corsOrigins.length ? config.corsOrigins : true }));
// Webhook các nền tảng cần body thô để kiểm tra chữ ký → gắn trước express.json
app.use("/webhooks", webhookRouter);
app.use(express.json({ limit: "2mb" }));

app.get("/healthz", (_req, res) => res.json({ ok: true, version: appVersion().version, zalo: zalo.summary() }));
// Phiên bản đang chạy (công khai): trình duyệt so với bản mình đang mở để báo "có bản mới".
app.get("/api/version", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(appVersion());
});
app.use("/uploads", express.static(config.uploadDir, { maxAge: "30d", index: false }));
app.use("/api/oauth", oauthRouter);
app.use("/api/v1", publicRouter);
app.use("/api", appRouter);
app.use("/api", errorHandler);

// Phục vụ giao diện đã build (web/dist) ở cùng cổng.
if (fs.existsSync(config.webDist)) {
  app.use(express.static(config.webDist, { index: false }));
  app.get(/^(?!\/api|\/socket\.io|\/uploads|\/webhooks).*/, (_req, res) => res.sendFile(path.join(config.webDist, "index.html")));
}

const server = http.createServer(app);
setupRealtime(server);
setupWebhooks();

server.listen(config.port, () => {
  console.log(`[server] Zalo CSKH chạy tại http://localhost:${config.port}`);
  void zalo.initAll();
});
