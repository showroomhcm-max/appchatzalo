/**
 * Tạo dữ liệu mẫu để xem thử giao diện khi chưa kết nối Zalo.
 * Chạy: npm run seed:demo   (chỉ dùng trên máy dev / DATA_DIR riêng)
 */
import bcrypt from "bcryptjs";
import { ensureAdmin, get, run } from "./db.js";
import { conversationKey, saveMessage } from "./store.js";

ensureAdmin();

function user(username: string, name: string) {
  const existing = get<{ id: number }>("SELECT id FROM users WHERE username = ?", username);
  if (existing) return existing.id;
  const r = run(
    "INSERT INTO users(username, password_hash, display_name, role, created_at) VALUES(?, ?, ?, 'agent', ?)",
    username,
    bcrypt.hashSync("demo1234", 10),
    name,
    Date.now(),
  );
  return Number(r.lastInsertRowid);
}

function upsert(table: string, keyCol: string, key: string, insertSql: string, ...params: any[]) {
  const row = get<{ id: number }>(`SELECT id FROM ${table} WHERE ${keyCol} = ?`, key);
  return row ? row.id : Number(run(insertSql, ...params).lastInsertRowid);
}

const ban = upsert("departments", "name", "Bán hàng", "INSERT INTO departments(name, color, created_at) VALUES(?, ?, ?)", "Bán hàng", "#0a804a", Date.now());
const bh = upsert("departments", "name", "Bảo hành", "INSERT INTO departments(name, color, created_at) VALUES(?, ?, ?)", "Bảo hành", "#2563c9", Date.now());
const ch1 = upsert("channels", "name", "Zalo Bán hàng (demo)", "INSERT INTO channels(name, default_department_id, created_at) VALUES(?, ?, ?)", "Zalo Bán hàng (demo)", ban, Date.now());
const ch2 = upsert("channels", "name", "Zalo Kỹ thuật (demo)", "INSERT INTO channels(name, default_department_id, created_at) VALUES(?, ?, ?)", "Zalo Kỹ thuật (demo)", bh, Date.now());
run("INSERT OR IGNORE INTO department_channels(department_id, channel_id) VALUES(?, ?)", ban, ch1);
run("INSERT OR IGNORE INTO department_channels(department_id, channel_id) VALUES(?, ?)", bh, ch1);
run("INSERT OR IGNORE INTO department_channels(department_id, channel_id) VALUES(?, ?)", bh, ch2);

const lan = user("lan", "Ngọc Lan");
const minh = user("minh", "Quang Minh");
run("INSERT OR IGNORE INTO user_departments(user_id, department_id) VALUES(?, ?)", lan, ban);
run("INSERT OR IGNORE INTO user_departments(user_id, department_id) VALUES(?, ?)", minh, bh);

for (const [name, color, dept] of [
  ["laptop", "#0a804a", ban],
  ["trả góp", "#97c354", ban],
  ["bảo hành", "#2563c9", bh],
  ["VIP", "#e0900a", null],
] as [string, string, number | null][]) {
  const id = upsert("tags", "name", name, "INSERT INTO tags(name, color, created_at) VALUES(?, ?, ?)", name, color, Date.now());
  if (dept) run("INSERT OR IGNORE INTO tag_departments(tag_id, department_id) VALUES(?, ?)", id, dept);
}

type Line = [who: "c" | "lan" | "minh" | "phone", text: string, minutesAfter: number];

const scripts: { channel: number; thread: string; name: string; lines: Line[]; status?: string; assign?: number; tags?: string[] }[] = [
  {
    channel: ch1,
    thread: "1001",
    name: "Trần Thu Hà",
    assign: lan,
    tags: ["laptop", "trả góp"],
    lines: [
      ["c", "Shop ơi cho mình hỏi laptop Asus Vivobook 15 còn hàng không ạ?", 0],
      ["lan", "Dạ MemoryZone chào bạn Hà. Mẫu Vivobook 15 bản i5/16GB hiện còn hàng tại showroom Q.10 và giao siêu tốc 2h nội thành ạ.", 2],
      ["c", "Có trả góp 0% không shop?", 4],
      ["lan", "Dạ có ạ, bạn trả góp 0% qua thẻ tín dụng 6–12 tháng, không phí chuyển đổi. Bạn muốn mình gửi bảng tính góp không ạ?", 5],
      ["c", "Ok gửi mình nhé", 9],
    ],
  },
  {
    channel: ch2,
    thread: "1002",
    name: "Lê Hoàng Phúc",
    assign: minh,
    status: "closed",
    tags: ["bảo hành"],
    lines: [
      ["c", "SSD mình mua tháng trước bị lỗi, bảo hành thế nào vậy?", 0],
      ["minh", "Dạ bạn cho mình xin số điện thoại đặt hàng để kiểm tra đơn nhé.", 18],
      ["c", "0909xxxxxx", 20],
      ["minh", "Dạ đơn còn bảo hành 36 tháng. Bạn mang sản phẩm qua showroom hoặc gửi bưu điện, bên mình đổi mới trong 24h ạ.", 23],
      ["c", "Cảm ơn shop", 25],
    ],
  },
  {
    channel: ch1,
    thread: "1003",
    name: "Nguyễn Văn Tài",
    lines: [
      ["c", "Bàn phím cơ Akko còn màu hồng không?", 0],
      ["phone", "Còn bạn nha", 40],
      ["c", "Giá bao nhiêu vậy?", 300],
    ],
  },
];

const now = Date.now();
scripts.forEach((s, idx) => {
  const t = now - (idx + 1) * 3 * 3600_000;
  s.lines.forEach(([who, text, after], i) => {
    saveMessage({
      channelId: s.channel,
      threadId: s.thread,
      conversationType: 0,
      zaloMsgId: `${s.thread}-${i}`,
      direction: who === "c" ? "in" : "out",
      senderUid: who === "c" ? s.thread : "shop",
      senderName: who === "c" ? s.name : "MemoryZone",
      agentId: who === "lan" ? lan : who === "minh" ? minh : null,
      source: who === "c" ? "customer" : who === "phone" ? "phone" : "web",
      msgType: "webchat",
      content: text,
      ts: t + after * 60_000,
    });
  });
  run(
    "UPDATE conversations SET name = ?, assigned_to = ?, status = ?, tags = ? WHERE id = ?",
    s.name,
    s.assign ?? null,
    s.status ?? "open",
    JSON.stringify(s.tags ?? []),
    conversationKey(s.channel, s.thread),
  );
});

for (const [shortcut, content, dept] of [
  ["chao", "Dạ MemoryZone xin chào bạn, bạn cần tư vấn sản phẩm nào ạ?", null],
  ["tragop", "Dạ bên mình hỗ trợ trả góp 0% qua thẻ tín dụng 6–12 tháng, không phí chuyển đổi ạ.", ban],
  ["baohanh", "Dạ bạn cho mình xin số điện thoại đặt hàng để kiểm tra thời hạn bảo hành nhé.", bh],
] as [string, string, number | null][]) {
  const id = upsert("templates", "shortcut", shortcut, "INSERT INTO templates(shortcut, content, created_at) VALUES(?, ?, ?)", shortcut, content, Date.now());
  if (dept) run("INSERT OR IGNORE INTO template_departments(template_id, department_id) VALUES(?, ?)", id, dept);
}

console.log("Đã tạo dữ liệu mẫu: 2 kênh, 2 bộ phận, 3 hội thoại, nhân viên lan (Bán hàng) / minh (Bảo hành), mật khẩu demo1234.");
