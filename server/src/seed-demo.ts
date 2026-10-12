/**
 * Tạo dữ liệu mẫu để xem thử giao diện khi chưa kết nối Zalo.
 * Chạy: npm run seed:demo   (chỉ dùng trên máy dev / DATA_DIR riêng)
 */
import bcrypt from "bcryptjs";
import { ensureAdmin, get, run } from "./db.js";
import { saveMessage } from "./store.js";

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

const lan = user("lan", "Ngọc Lan");
const minh = user("minh", "Quang Minh");

type Line = [who: "c" | "lan" | "minh" | "phone", text: string, minutesAfter: number];

const scripts: { id: string; name: string; lines: Line[]; status?: string; assign?: number; tags?: string[] }[] = [
  {
    id: "demo-1001",
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
    id: "demo-1002",
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
    id: "demo-1003",
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
  let t = now - (idx + 1) * 3 * 3600_000;
  s.lines.forEach(([who, text, after], i) => {
    const ts = t + after * 60_000;
    saveMessage({
      conversationId: s.id,
      conversationType: 0,
      zaloMsgId: `${s.id}-${i}`,
      direction: who === "c" ? "in" : "out",
      senderUid: who === "c" ? s.id : "shop",
      senderName: who === "c" ? s.name : "MemoryZone",
      agentId: who === "lan" ? lan : who === "minh" ? minh : null,
      source: who === "c" ? "customer" : who === "phone" ? "phone" : "web",
      msgType: "webchat",
      content: text,
      ts,
    });
  });
  run(
    "UPDATE conversations SET name = ?, assigned_to = ?, status = ?, tags = ? WHERE id = ?",
    s.name,
    s.assign ?? null,
    s.status ?? "open",
    JSON.stringify(s.tags ?? []),
    s.id,
  );
});

run(
  "INSERT INTO templates(shortcut, content, created_at) SELECT 'chao', 'Dạ MemoryZone xin chào bạn, bạn cần tư vấn sản phẩm nào ạ?', ? WHERE NOT EXISTS (SELECT 1 FROM templates WHERE shortcut = 'chao')",
  Date.now(),
);
run(
  "INSERT INTO templates(shortcut, content, created_at) SELECT 'tragop', 'Dạ bên mình hỗ trợ trả góp 0% qua thẻ tín dụng 6–12 tháng, không phí chuyển đổi ạ.', ? WHERE NOT EXISTS (SELECT 1 FROM templates WHERE shortcut = 'tragop')",
  Date.now(),
);

console.log("Đã tạo dữ liệu mẫu: 3 hội thoại, nhân viên lan/minh (mật khẩu demo1234).");
