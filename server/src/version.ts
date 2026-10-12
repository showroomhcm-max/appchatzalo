import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { config } from "./config.js";

const startedAt = new Date().toISOString();

function readJson(file: string) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

const rootPkg = readJson(path.join(process.cwd(), "..", "package.json")) ?? readJson(path.join(process.cwd(), "package.json"));
const commit = (() => {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return process.env.GIT_COMMIT ?? "";
  }
})();

/**
 * Phiên bản máy chủ + bản giao diện đang được phục vụ (web/dist/version.json đọc lại mỗi lần,
 * nên build lại giao diện là trình duyệt đang mở biết ngay có bản mới).
 */
export function appVersion() {
  return {
    version: String(rootPkg?.version ?? "0.0.0"),
    commit,
    startedAt,
    web: readJson(path.join(config.webDist, "version.json")),
  };
}
