#!/bin/sh
# Tự cập nhật Chat Siêu Tốc trên NAS khi GitHub có bản build mới.
# DSM › Bảng điều khiển › Bộ lập lịch tác vụ › Tạo › Tác vụ đã lên lịch › Tập lệnh do người dùng xác định:
#   người dùng root, lặp lại mỗi vài phút, lệnh:  sh "/volume2/Chat Sieu Toc/VPS Chat Sieu Toc/cap-nhat.sh"
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"
cd "$(dirname "$0")" || exit 1
LOG=cap-nhat.log
now() { date '+%Y-%m-%d %H:%M:%S'; }

# Mỗi lần chỉ một lượt: lượt trước còn đang tải / đổi bản mới thì lượt này bỏ qua.
# (Hai lượt chạy chồng nhau từng làm container kẹt tên tạm "<mã>_chat-sieutoc".)
LOCK=.cap-nhat.lock
if ! mkdir "$LOCK" 2>/dev/null; then
  # Khóa quá 20 phút: lượt trước bị ngắt giữa chừng (NAS khởi động lại…) → gỡ khóa rồi chạy tiếp
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +20 2>/dev/null)" ]; then
    rmdir "$LOCK" 2>/dev/null
    mkdir "$LOCK" 2>/dev/null || exit 0
  else
    exit 0
  fi
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

if docker compose version >/dev/null 2>&1; then DC="docker compose"; else DC="docker-compose"; fi

# Container kẹt tên tạm (vd "d0e803f0337e_chat-sieutoc") thì đổi lại đúng tên; đổi tên không làm app ngừng.
for name in chat-sieutoc chat-sieutoc-net chat-sieutoc-tunnel; do
  if ! docker container inspect "$name" >/dev/null 2>&1; then
    stuck=$(docker ps -a --format '{{.Names}}' | grep -E "^[0-9a-f]{12}_${name}\$" | head -n 1)
    if [ -n "$stuck" ] && docker rename "$stuck" "$name" 2>>"$LOG"; then
      echo "$(now) Đổi tên container kẹt $stuck → $name" >> "$LOG"
    fi
  fi
done

# Đăng nhập GitHub Container Registry bằng mã chỉ-đọc trong ghcr.env (GHCR_USER=..., GHCR_TOKEN=...)
if [ -f ghcr.env ]; then
  GHCR_USER=$(sed -n 's/^GHCR_USER=//p' ghcr.env | tr -d '\r\n ')
  sed -n 's/^GHCR_TOKEN=//p' ghcr.env | tr -d '\r\n ' | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null 2>&1 \
    || echo "$(now) Không đăng nhập được ghcr.io: kiểm tra ghcr.env" >> "$LOG"
fi

if ! $DC pull -q app >/dev/null 2>>"$LOG"; then
  echo "$(now) Không tải được bản mới" >> "$LOG"
  exit 1
fi
# "up -d" chỉ tạo lại container khi ảnh hoặc cấu hình đổi; không có gì mới thì không đụng tới app.
out=$($DC up -d 2>&1)
if echo "$out" | grep -qiE "recreate|creating|created|starting|started|error"; then
  echo "$(now) Đã cập nhật:" >> "$LOG"
  echo "$out" >> "$LOG"
  docker image prune -f >/dev/null 2>&1
fi
# Ảnh "chat-sieutoc" build trên NAS lúc mới chuyển (nay dùng bản build sẵn từ GitHub): còn thì xóa, không container nào dùng
if docker image inspect chat-sieutoc:latest >/dev/null 2>&1 && docker image rm chat-sieutoc:latest >/dev/null 2>&1; then
  echo "$(now) Đã xóa ảnh cũ chat-sieutoc:latest (bản build trên NAS lúc mới chuyển)" >> "$LOG"
fi
# Giữ nhật ký gọn
tail -n 500 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
