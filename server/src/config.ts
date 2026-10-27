import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), "data"));
fs.mkdirSync(dataDir, { recursive: true });

function loadJwtSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  // Không có JWT_SECRET trong .env → tạo một lần và lưu vào thư mục data để token không bị mất khi khởi động lại.
  const file = path.join(dataDir, ".jwt-secret");
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  const secret = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  dataDir,
  dbFile: path.join(dataDir, "app.db"),
  uploadDir: path.join(dataDir, "uploads"),
  jwtSecret: loadJwtSecret(),
  adminUsername: process.env.ADMIN_USERNAME ?? "admin",
  adminPassword: process.env.ADMIN_PASSWORD ?? "",
  // Đăng nhập bằng tài khoản Odoo
  odooUrl: (process.env.ODOO_URL ?? "https://erp.sieutoc.com").replace(/\/+$/, ""),
  odooDb: process.env.ODOO_DB ?? "SieuToc",
  // Login Odoo được tự động duyệt làm quản trị viên (cách nhau dấu phẩy)
  odooAdmins: (process.env.ODOO_ADMINS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  // Super Admin (quyền cao nhất): tên đăng nhập / email Odoo, cách nhau dấu phẩy
  superAdmins: (process.env.SUPER_ADMINS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  // Nguồn gốc web được phép gọi API (CORS), phân tách bằng dấu phẩy. Để trống = cho phép tất cả.
  corsOrigins: (process.env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  // Log của Cloudflare Quick Tunnel (pm2 ghi ra) để hiển thị link public trong app.
  tunnelLog: path.resolve(process.env.TUNNEL_LOG ?? path.join(process.cwd(), "..", "logs", "tunnel.log")),
  webDist: path.resolve(process.env.WEB_DIST ?? path.join(process.cwd(), "..", "web", "dist")),
  // API Claude (Anthropic) cho Trợ lý AI giám sát; đổi địa chỉ chỉ khi chạy thử với máy giả lập
  aiBaseUrl: (process.env.AI_BASE_URL ?? "https://api.anthropic.com").replace(/\/+$/, ""),
  // API Grok (xAI): đổi địa chỉ chỉ khi chạy thử với máy giả lập
  xaiBaseUrl: (process.env.XAI_BASE_URL ?? "https://api.x.ai").replace(/\/+$/, ""),
  // API DeepSeek: đổi địa chỉ chỉ khi chạy thử với máy giả lập
  deepseekBaseUrl: (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/+$/, ""),
};

fs.mkdirSync(config.uploadDir, { recursive: true });
