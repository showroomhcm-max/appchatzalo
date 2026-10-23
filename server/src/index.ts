import "./logger-init.js";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import cors from "cors";
import { localOnly, securityHeaders, uploadHeaders } from "./security.js";
import { config } from "./config.js";
import { ensureAdmin, applySuperAdmins } from "./db.js";
import { appRouter, publicRouter, errorHandler } from "./routes.js";
import { linkRouter } from "./report-link.js";
import { setupRealtime } from "./realtime.js";
import { setupWebhooks } from "./webhooks.js";
import { startAlerts } from "./alerts.js";
import { startAccountWatch } from "./company-accounts.js";
import { startPosSync } from "./odoo-pos.js";
import { startBackups } from "./backup.js";
import { startSearchIndex } from "./search-index.js";
import { startMonitor } from "./monitor.js";
import { startAiMonitor } from "./ai-monitor.js";
import { zalo } from "./zalo.js";
import { appVersion } from "./version.js";
import { oauthRouter, webhookRouter, zaloVerifierHandler } from "./platform-routes.js";

ensureAdmin();
applySuperAdmins();

const app = express();
app.disable("x-powered-by");
// Chỉ nhận kết nối qua Cloudflare Tunnel (localhost); máy khác trong mạng LAN bị chặn (ALLOW_LAN=1 để mở)
app.use(localOnly);
app.use(securityHeaders);
// CORS: API tích hợp (/api/v1, xác thực bằng API key) cho mọi nguồn hoặc theo CORS_ORIGINS;
// API nội bộ chỉ dùng từ chính giao diện app (cùng tên miền), trừ khi khai báo CORS_ORIGINS.
app.use("/api/v1", cors({ origin: config.corsOrigins.length ? config.corsOrigins : true }));
if (config.corsOrigins.length) app.use(cors({ origin: config.corsOrigins }));
// Webhook các nền tảng cần body thô để kiểm tra chữ ký → gắn trước express.json
app.use("/webhooks", webhookRouter);
app.use(zaloVerifierHandler);
app.use(express.json({ limit: "2mb" }));

app.get("/healthz", (_req, res) => res.json({ ok: true, version: appVersion().version, zalo: zalo.summary() }));
// Phiên bản đang chạy (công khai): trình duyệt so với bản mình đang mở để báo "có bản mới".
app.get("/api/version", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(appVersion());
});
// File khách gửi (ảnh giấy tờ, hóa đơn…): chỉ trình duyệt lưu tạm, không cho Cloudflare / máy trung gian lưu
app.use(
  "/uploads",
  express.static(config.uploadDir, {
    maxAge: "30d",
    index: false,
    dotfiles: "deny",
    setHeaders: (res, filePath) => {
      uploadHeaders(res, filePath);
      res.setHeader("Cache-Control", "private, max-age=2592000");
    },
  }),
);
app.use("/api/oauth", oauthRouter);
app.use("/api/v1", publicRouter);
// App báo cáo công việc CSKH (khóa kết nối riêng, chỉ các đường /api/link/*)
app.use("/api/link", linkRouter);
app.use("/api", appRouter);
app.use("/api", errorHandler);

// Phục vụ giao diện đã build (web/dist) ở cùng cổng.
if (fs.existsSync(config.webDist)) {
  // /assets/* có mã băm trong tên: lưu tạm lâu dài; thiếu file thì 404 (không trả index.html làm trang trắng)
  app.use("/assets", express.static(path.join(config.webDist, "assets"), { maxAge: "365d", immutable: true, index: false }));
  app.use("/assets", (_req, res) => res.status(404).type("text").send("Không có file này (trang đang mở là bản cũ, tải lại trang)"));
  app.use(express.static(config.webDist, { index: false, maxAge: 0 }));
  app.get(/^(?!\/api|\/socket\.io|\/uploads|\/webhooks|\/assets).*/, (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(config.webDist, "index.html"));
  });
}

const server = http.createServer(app);
setupRealtime(server);
setupWebhooks();
startAlerts();
startAccountWatch();
startPosSync();
startBackups();
startSearchIndex();
startMonitor();
startAiMonitor();

server.listen(config.port, () => {
  console.log(`[server] Chat Siêu Tốc chạy tại http://localhost:${config.port}`);
  void zalo.initAll();
});
