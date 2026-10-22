/**
 * Gọi ra địa chỉ do người dùng nhập (link ảnh / tệp mẫu, webhook) mà không để bị lợi dụng dò mạng nội bộ:
 * - chặn localhost, mạng LAN, link-local, đa hướng… cả IPv4 lẫn IPv6 (kể cả IPv4 viết trong IPv6 như [::ffff:7f00:1]);
 * - kiểm địa chỉ ngay lúc kết nối (lookup riêng), không kiểm trước rồi để fetch tự tra lại DNS (chống DNS rebinding);
 * - chuyển hướng: tự theo tối đa N lần, mỗi lần kiểm lại; giới hạn dung lượng và thời gian.
 */
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

const blocked = new net.BlockList();
for (const [a, p] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(a, p, "ipv4");
for (const [a, p] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["64:ff9b::", 96], // NAT64
  ["2002::", 16], // 6to4
] as const)
  blocked.addSubnet(a, p, "ipv6");

/** IPv6 → 8 nhóm số (hỗ trợ "::" và đuôi a.b.c.d); null nếu không hợp lệ. */
function expand6(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const p = v4[1].split(".").map(Number);
    s = s.slice(0, -v4[1].length) + ((p[0] << 8) | p[1]).toString(16) + ":" + ((p[2] << 8) | p[3]).toString(16);
  }
  const [head, tail] = s.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined ? (tail ? tail.split(":") : []) : [];
  if (s.split("::").length > 2) return null;
  const fill = tail !== undefined ? 8 - h.length - t.length : 0;
  const all = [...h, ...Array(Math.max(fill, 0)).fill("0"), ...t];
  if (all.length !== 8 || all.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.map((g) => parseInt(g, 16));
}

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return blocked.check(ip, "ipv4");
  const g = expand6(ip);
  if (!g) return true; // không đọc được: coi như không an toàn
  // IPv4 nằm trong IPv6: ::ffff:a.b.c.d (mapped) hoặc ::a.b.c.d (kiểu cũ) → kiểm theo IPv4
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    const v4 = `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
    if (g[5] === 0xffff || g[6] !== 0 || g[7] > 1) return blocked.check(v4, "ipv4");
  }
  return blocked.check(g.map((x) => x.toString(16)).join(":"), "ipv6");
}

/** DNS lookup chỉ trả địa chỉ công khai (dùng ngay lúc mở kết nối). */
const guardedLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return (callback as any)(err);
    const list = addresses as dns.LookupAddress[];
    if (!list.length || list.some((a) => isPrivateAddress(a.address))) {
      return (callback as any)(Object.assign(new Error("Địa chỉ trỏ vào mạng nội bộ, không gọi"), { code: "EPRIVATE" }));
    }
    if ((options as dns.LookupOptions).all) return (callback as any)(null, list);
    (callback as any)(null, list[0].address, list[0].family);
  });
};

/** Kiểm tra nhanh một link (lúc lưu cấu hình), báo lỗi dễ hiểu. */
export async function assertPublicUrl(raw: string) {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error("Link không hợp lệ");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Link phải là http(s)");
  if (u.username || u.password) throw new Error("Link không được chứa tài khoản");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const ips = net.isIP(host) ? [host] : (await dns.promises.lookup(host, { all: true })).map((a) => a.address);
  if (!ips.length || ips.some(isPrivateAddress)) throw new Error("Link trỏ vào mạng nội bộ, không dùng được");
  return u;
}

export type SafeResponse = { status: number; headers: http.IncomingHttpHeaders; body: Buffer; url: URL };

/** Gọi HTTP(S) an toàn: chỉ địa chỉ công khai, theo tối đa `maxRedirects` lần chuyển hướng, tối đa `maxBytes`. */
export async function safeRequest(
  raw: string | URL,
  opts: { method?: string; headers?: Record<string, string>; body?: string | Buffer; maxBytes?: number; timeoutMs?: number; maxRedirects?: number } = {},
): Promise<SafeResponse> {
  let url = typeof raw === "string" ? await assertPublicUrl(raw) : raw;
  let method = opts.method ?? "GET";
  let body = opts.body;
  const maxBytes = opts.maxBytes ?? 1024 * 1024;
  for (let hop = 0; ; hop++) {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(host) && isPrivateAddress(host)) throw new Error("Địa chỉ trỏ vào mạng nội bộ, không gọi");
    const res = await new Promise<SafeResponse>((resolve, reject) => {
      const lib = url.protocol === "https:" ? https : http;
      const req = lib.request(
        url,
        { method, headers: { "user-agent": "ChatSieuToc/1.0", ...opts.headers }, lookup: guardedLookup, timeout: opts.timeoutMs ?? 15_000 },
        (r) => {
          const chunks: Buffer[] = [];
          let size = 0;
          r.on("data", (c: Buffer) => {
            size += c.length;
            if (size > maxBytes) {
              req.destroy(new Error(`Dữ liệu quá ${Math.round(maxBytes / 1048576)} MB`));
              return;
            }
            chunks.push(c);
          });
          r.on("end", () => resolve({ status: r.statusCode ?? 0, headers: r.headers, body: Buffer.concat(chunks), url }));
          r.on("error", reject);
        },
      );
      req.on("timeout", () => req.destroy(new Error("Quá thời gian chờ")));
      req.on("error", reject);
      if (body !== undefined && method !== "GET") req.end(body);
      else req.end();
    });
    const loc = res.headers.location;
    if (res.status >= 300 && res.status < 400 && loc) {
      if (hop >= (opts.maxRedirects ?? 0)) throw new Error(`Bị chuyển hướng (mã ${res.status})`);
      url = await assertPublicUrl(new URL(loc, url).toString());
      if (res.status !== 307 && res.status !== 308) {
        method = "GET";
        body = undefined;
      }
      continue;
    }
    return res;
  }
}
