#!/bin/sh
# Tự cập nhật Chat Siêu Tốc trên NAS khi GitHub có bản build mới.
# DSM › Bảng điều khiển › Bộ lập lịch tác vụ › Tạo › Tác vụ đã lên lịch › Tập lệnh do người dùng xác định:
#   người dùng root, lặp lại mỗi vài phút, lệnh:  sh "/volume2/Chat Sieu Toc/VPS Chat Sieu Toc/cap-nhat.sh"
# Bản mới của file này (nếu có) được lưu ra cap-nhat.sh.moi để quản trị viên tự xem rồi chép đè.
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"
cd "$(dirname "$0")" || exit 1
LOG=cap-nhat.log
now() { date '+%Y-%m-%d %H:%M:%S'; }

# Mỗi lần chỉ một lượt: lượt trước còn đang tải / đổi bản mới thì lượt này bỏ qua.
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

# Ảnh app theo docker-compose.yml (có thể ghim bản bằng APP_TAG trong .env)
IMG=$($DC config --images 2>/dev/null | grep chatcskh | head -n 1)
running=$(docker container inspect -f '{{.Image}}' chat-sieutoc 2>/dev/null)
latest=$(docker image inspect -f '{{.Id}}' "$IMG" 2>/dev/null)

# Cấu hình trong docker-compose.yml đổi (vd thêm user / bỏ đặc quyền) cũng phải dựng lại container
# (So nội dung docker-compose.yml + .env với lần dựng trước, lưu ở .cau-hinh.md5. Không so "config hash" của Docker:
# app và đường hầm dùng mạng của net nên mã đó không bao giờ khớp → dựng lại mỗi phút.)
CONFIG_CHANGED=""
conf=$(cat docker-compose.yml .env 2>/dev/null | md5sum | awk '{print $1}')
if [ ! -f .cau-hinh.md5 ]; then
  echo "$conf" > .cau-hinh.md5 # lần đầu dùng bản này: ghi nhận cấu hình đang chạy, không dựng lại
elif [ "$(cat .cau-hinh.md5)" != "$conf" ]; then
  CONFIG_CHANGED=1
fi

NEW_IMAGE=""
[ -n "$latest" ] && [ "$running" != "$latest" ] && NEW_IMAGE=1

if [ -n "$NEW_IMAGE" ] || [ -n "$CONFIG_CHANGED" ]; then
  # Gỡ hẳn container cũ rồi tạo mới (không để Docker đổi tên tạm "<mã>_chat-sieutoc",
  # Container Manager của DSM không theo kịp kiểu đổi tên đó và báo đỏ).
  {
    if [ -n "$NEW_IMAGE" ]; then echo "$(now) Có bản mới, đang cập nhật…"; else echo "$(now) Cấu hình đổi, dựng lại container…"; fi
    $DC stop tunnel app net 2>&1
    $DC rm -f tunnel app net 2>&1
    $DC up -d 2>&1
  } >> "$LOG"
  echo "$(now) Đã cập nhật xong" >> "$LOG"
  echo "$conf" > .cau-hinh.md5
  docker image prune -f >/dev/null 2>&1
  # Bản mới có kèm cap-nhat.sh khác bản đang dùng: KHÔNG tự thay (script chạy bằng quyền root trên NAS,
  # ảnh tải về không được tự cấp quyền root cho mình). Lưu ra cap-nhat.sh.moi để quản trị viên xem rồi tự chép đè.
  if docker run --rm --entrypoint cat "$IMG" /app/deploy/cap-nhat.sh > .cap-nhat.new 2>/dev/null \
    && [ -s .cap-nhat.new ] && ! cmp -s .cap-nhat.new cap-nhat.sh; then
    mv .cap-nhat.new cap-nhat.sh.moi && echo "$(now) Có bản cap-nhat.sh mới (cap-nhat.sh.moi): xem rồi chép đè lên cap-nhat.sh nếu đồng ý" >> "$LOG"
  fi
  rm -f .cap-nhat.new
else
  # Không có gì mới: chỉ bảo đảm 3 container đang chạy (vd sau khi NAS khởi động lại)
  out=$($DC up -d 2>&1)
  if echo "$out" | grep -qiE "creating|created|starting|started|error"; then
    echo "$(now) Bật lại container:" >> "$LOG"
    echo "$out" >> "$LOG"
  fi
fi

# Container "lạc mạng": app và đường hầm Cloudflare dùng chung mạng của chat-sieutoc-net. Nếu riêng net bị khởi động lại
# (dừng / bật tay trong Container Manager…), container nào còn chạy trên mạng cũ thì mất internet mà Docker vẫn báo
# "đang chạy" → web báo lỗi Cloudflare 1033. Phát hiện bằng cách so mạng của từng container rồi khởi động lại container lạc.
netns() {
  pid=$(docker container inspect -f '{{if .State.Running}}{{.State.Pid}}{{end}}' "$1" 2>/dev/null)
  [ -n "$pid" ] && [ "$pid" != "0" ] && readlink "/proc/$pid/ns/net" 2>/dev/null
}
base=$(netns chat-sieutoc-net)
if [ -n "$base" ]; then
  for name in chat-sieutoc chat-sieutoc-tunnel; do
    ns=$(netns "$name")
    if [ -n "$ns" ] && [ "$ns" != "$base" ]; then
      docker restart "$name" >/dev/null 2>&1 && echo "$(now) $name chạy trên mạng cũ (net đã khởi động lại): đã khởi động lại" >> "$LOG"
    fi
  done
fi

# Dọn container kẹt tên tạm còn sót (vd "d0e803f0337e_chat-sieutoc") khi container đúng tên đang chạy
for name in chat-sieutoc chat-sieutoc-net chat-sieutoc-tunnel; do
  if docker container inspect "$name" >/dev/null 2>&1; then
    for stuck in $(docker ps -a --format '{{.Names}}' | grep -E "^[0-9a-f]{12}_${name}\$"); do
      docker rm -f "$stuck" >/dev/null 2>&1 && echo "$(now) Đã gỡ container sót $stuck" >> "$LOG"
    done
  fi
done
# Ảnh "chat-sieutoc" build trên NAS lúc mới chuyển: còn thì xóa
if docker image inspect chat-sieutoc:latest >/dev/null 2>&1 && docker image rm chat-sieutoc:latest >/dev/null 2>&1; then
  echo "$(now) Đã xóa ảnh cũ chat-sieutoc:latest" >> "$LOG"
fi
# Sao lưu ra ngoài NAS: app chạy bằng uid 1000 nên Cloud Sync không đọc được data/backups. Chép bản mới nhất
# sang sao-luu-drive/ (tạo bằng root, quyền theo thư mục chia sẻ) để Cloud Sync đẩy lên Google Drive.
# Khi NAS chết hẳn: tải app-moi-nhat.db ở đây về, chạy bằng "Bộ dự phòng" (xem SU-CO.md).
mkdir -p sao-luu-drive
# Bản mỗi giờ + 7 bản theo ngày gần nhất; bản nào mới hơn bản đã chép thì chép lại
keep="app-moi-nhat.db $(ls -1 data/backups/auto/ 2>/dev/null | grep -E '^app-20[0-9-]+\.db$' | sort -r | head -n 7 | tr '\n' ' ')"
for name in $keep; do
  f="data/backups/auto/$name"
  [ -f "$f" ] || continue
  dst="sao-luu-drive/$name"
  if [ ! -f "$dst" ] || [ "$f" -nt "$dst" ]; then
    cp -f "$f" "$dst.tmp" && chmod 644 "$dst.tmp" && mv -f "$dst.tmp" "$dst"
  fi
done
for old in sao-luu-drive/*.db; do
  [ -f "$old" ] || continue
  case " $keep " in *" $(basename "$old") "*) ;; *) rm -f "$old" ;; esac
done

# Giữ nhật ký gọn
tail -n 500 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
