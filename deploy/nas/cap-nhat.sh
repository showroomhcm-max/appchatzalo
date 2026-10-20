#!/bin/sh
# Tự cập nhật Chat Siêu Tốc trên NAS khi GitHub có bản build mới.
# DSM › Bảng điều khiển › Bộ lập lịch tác vụ › Tạo › Tác vụ đã lên lịch › Tập lệnh do người dùng xác định:
#   người dùng root, lặp lại mỗi vài phút, lệnh:  sh "/volume1/Chat Sieu Toc/VPS Chat Sieu Toc/cap-nhat.sh"
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"
cd "$(dirname "$0")" || exit 1
LOG=cap-nhat.log
now() { date '+%Y-%m-%d %H:%M:%S'; }
if docker compose version >/dev/null 2>&1; then DC="docker compose"; else DC="docker-compose"; fi

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
if echo "$out" | grep -qiE "recreate|creating|created|starting|started"; then
  echo "$(now) Đã cập nhật:" >> "$LOG"
  echo "$out" >> "$LOG"
  docker image prune -f >/dev/null 2>&1
fi
# Giữ nhật ký gọn
tail -n 500 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
