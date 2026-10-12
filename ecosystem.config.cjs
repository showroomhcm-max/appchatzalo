// Chạy production bằng pm2: tự khởi động lại nếu app bị lỗi/thoát.
const path = require("node:path");
const fs = require("node:fs");

// Có token Cloudflare Tunnel (tên miền cố định) thì dùng; chưa có thì chạy Quick Tunnel (link ngẫu nhiên).
const tokenFile = path.join(__dirname, "tools", "cloudflare-tunnel-token.txt");
const tunnelArgs = fs.existsSync(tokenFile)
  ? `tunnel --no-autoupdate run --token-file "${tokenFile}"`
  : "tunnel --no-autoupdate --url http://localhost:3000";

module.exports = {
  apps: [
    {
      name: "zalo-cskh",
      cwd: path.join(__dirname, "server"),
      script: "dist/index.js",
      node_args: "--env-file-if-exists=../.env",
      env: { NODE_ENV: "production" },
      autorestart: true,
      max_restarts: 50,
      restart_delay: 5000,
      time: true,
    },
    {
      // Đưa app ra internet qua Cloudflare. Nhập token tên miền cố định: scripts/nhap-token-cloudflare.cmd
      name: "zalo-cskh-tunnel",
      cwd: __dirname,
      script: path.join(__dirname, "tools", "cloudflared.exe"),
      args: tunnelArgs,
      interpreter: "none",
      autorestart: true,
      restart_delay: 10000,
      out_file: path.join(__dirname, "logs", "tunnel.log"),
      error_file: path.join(__dirname, "logs", "tunnel.log"),
      time: true,
    },
  ],
};
