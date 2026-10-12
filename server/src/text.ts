/**
 * Bỏ dấu + chữ thường để tìm kiếm giống Zalo: gõ "dien thoai" ra "Điện thoại".
 * Đổi từng ký tự một nên độ dài chuỗi giữ nguyên (giao diện dùng cùng cách để tô đậm đúng vị trí).
 */
export function fold(s: string | null | undefined): string {
  if (!s) return "";
  let out = "";
  for (const ch of s.normalize("NFC")) {
    const base = ch.normalize("NFD").replace(/\p{Mn}/gu, "");
    out += (base === "đ" || base === "Đ" ? "d" : base.length === 1 ? base : ch).toLowerCase();
  }
  return out;
}

/** Chuẩn bị chuỗi cho LIKE: bỏ dấu và thoát ký tự đặc biệt % _ \ */
export function likePattern(q: string) {
  return `%${fold(q).replace(/[\\%_]/g, (c) => "\\" + c)}%`;
}
