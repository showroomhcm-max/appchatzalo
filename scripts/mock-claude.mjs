// Máy AI giả (giống API Claude, Grok và DeepSeek) cho bản demo: trả kết quả chấm / phân tích dựng từ chính đoạn chat gửi lên.
// Không gọi ra internet, không tốn tiền. Dùng: node scripts/demo.mjs --mock-ai (tự bật máy này ở cổng 3994).
import http from "node:http";
import crypto from "node:crypto";

const rand = (seed) => crypto.createHash("md5").update(seed).digest()[0] / 255;

/** Lấy các dòng "#id [giờ] NV …: nội dung" trong thẻ <tag>. */
function lines(text, tag) {
  const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return (m?.[1] ?? "")
    .split("\n")
    .map((l) => l.match(/^#(\d+) \[[^\]]+\] (NV|KH)[^:]*: (.*)$/))
    .filter(Boolean)
    .map((x) => ({ id: Number(x[1]), who: x[2], text: x[3] }));
}

function grade(body) {
  const tool = body.tools[0];
  const user = String(body.messages?.[0]?.content ?? "");
  const msgs = lines(user, "phien_chat");
  const nv = msgs.filter((m) => m.who === "NV" && !m.text.startsWith("[") && m.text.length >= 6);
  const kh = msgs.filter((m) => m.who === "KH").map((m) => m.text.toLowerCase()).join(" ");
  const sale = /giá|mua|còn hàng|bao nhiêu|tư vấn|laptop|ssd|ổ |máy|ram|card|bán/.test(kh);
  const keys = tool.input_schema.properties.steps.items.properties.key.enum;
  const seed = String(msgs[0]?.id ?? 0);
  const steps = keys.map((key, i) => {
    const r = rand(seed + key);
    const saleStep = i > 0 && i < keys.length - 1;
    if (saleStep && !sale) return { key, result: "na", note: "Khách không hỏi mua" };
    if (r < 0.62 && nv.length) {
      const m = nv[Math.floor(rand(key + seed) * nv.length)];
      return { key, result: "pass", message_id: m.id, quote: m.text.slice(0, 60) };
    }
    if (r < 0.92) return { key, result: "fail", note: "Chưa thấy nhân viên làm bước này (máy AI giả lập)" };
    return { key, result: "pass", message_id: nv[0]?.id ?? 0, quote: "câu này không có trong hội thoại" };
  });
  // Nhiều kịch bản: chọn theo nội dung khách nhắn (giống AI thật chọn theo "Dùng khi")
  const ids = tool.input_schema.properties.script?.enum ?? [];
  const want = /bảo hành|lỗi|hỏng|sửa/.test(kh) ? "bao_hanh" : /đơn|giao|ship|hóa đơn/.test(kh) ? "don_hang" : "ban_hang";
  return {
    ...(ids.length ? { script: ids.includes(want) ? want : ids[0] } : {}),
    kind: sale ? "hoi_mua" : rand(seed) < 0.5 ? "bao_hanh" : "khac",
    missing_start: false,
    steps,
    summary: `(Demo) Khách nhắn ${msgs.filter((m) => m.who === "KH").length} tin, nhân viên trả lời ${msgs.filter((m) => m.who === "NV").length} tin.`,
    tip: rand(seed + "tip") < 0.6 ? "(Demo) Nên chủ động xin số điện thoại và mời khách đặt hàng." : "",
  };
}

function answer(body) {
  const name = body.tools?.[0]?.name;
  if (name === "ket_qua_cham") return grade(body);
  if (name === "kiem_tra") return { ok: true };
  if (name === "ket_qua_phan_tich") return { risk: "none", summary: "(Demo) Hội thoại bình thường.", outcome: "dang_tu_van", quality_score: 7, issues: [] };
  if (name === "tong_hop_ngay") return { overview: "(Demo) Ngày làm việc bình thường.", score: 7, concerns: [], highlights: [], coaching: [] };
  return {};
}

http
  .createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    res.setHeader("Content-Type", "application/json");
    // Grok (xAI): danh sách model và chat/completions kiểu OpenAI
    if (req.url === "/v1/models") return res.end(JSON.stringify({ data: ["grok-4", "grok-4-fast-non-reasoning", "grok-4-fast-reasoning", "grok-2-image"].map((id) => ({ id })) }));
    // DeepSeek: cùng kiểu OpenAI nhưng không có /v1
    if (req.url === "/models") return res.end(JSON.stringify({ data: ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-reasoner"].map((id) => ({ id })) }));
    if ((req.url === "/v1/chat/completions" || req.url === "/chat/completions") && req.method === "POST") {
      const b = JSON.parse(raw);
      const fn = b.tools[0].function;
      const input = answer({ tools: [{ name: fn.name, input_schema: fn.parameters }], messages: [{ content: b.messages.find((m) => m.role === "user")?.content }] });
      await new Promise((r) => setTimeout(r, 300 + Math.random() * 700));
      return res.end(
        JSON.stringify({
          choices: [{ message: { role: "assistant", tool_calls: [{ id: "call_demo", type: "function", function: { name: fn.name, arguments: JSON.stringify(input) } }] } }],
          usage: { prompt_tokens: Math.round(raw.length / 3), completion_tokens: 300 },
        }),
      );
    }
    if (req.url !== "/v1/messages" || req.method !== "POST") return res.writeHead(404).end('{"error":{"message":"not found"}}');
    const body = JSON.parse(raw);
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 700));
    res.end(
      JSON.stringify({
        content: [{ type: "tool_use", id: "toolu_demo", name: body.tools[0].name, input: answer(body) }],
        usage: { input_tokens: Math.round(raw.length / 3), output_tokens: 300 },
      }),
    );
  })
  .listen(3994, "127.0.0.1", () => console.log("Máy AI giả: http://127.0.0.1:3994"));
