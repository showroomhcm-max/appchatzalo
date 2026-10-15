/**
 * Nhận diện bố cục (theo bộ khung SieuTocCorp/sieutoc-ui, js/bo-cuc.js), gắn lớp lên <html>:
 *   (không lớp)  → máy tính
 *   compact      → máy tính bảng và điện thoại (nút cao 44px cho ngón tay)
 *   narrow       → chỉ điện thoại (luôn kèm compact): thanh dưới đáy, một màn một lúc
 *   thap         → màn thấp (điện thoại nằm ngang)
 *
 * Bài học từ bộ khung (đo trên máy thật, đừng đổi nếu chưa thử lại trên đúng loại máy):
 * - Đếm điểm chạm (maxTouchPoints), đừng chỉ tin pointer:coarse: iPad gắn bàn phím, máy có bút S Pen
 *   báo "pointer:fine". Trừ Windows: laptop màn cảm ứng vẫn là máy tính.
 * - Điện thoại nằm ngang tới 960px (iPhone Pro Max 932, máy gập chưa mở xoay ngang ~880×384).
 * - Máy cảm ứng tới 1400px vẫn là máy tính bảng (iPad Pro 11" ngang 1194–1210, 13" 1366–1376).
 * - CHỈ đo cửa sổ (media query), KHÔNG đo `screen`: máy gập vừa mở ra `screen` còn đọc màn ngoài → kẹt bố cục điện thoại.
 * - Đổi lớp ngay trong sự kiện (không hoãn, không hiệu ứng mờ dần), soát lại sau 0,4 giây và khi quay lại app.
 */
const root = document.documentElement
const mq = (q: string) => window.matchMedia(q)
const mqCompact = mq('(max-width: 820px)')
const mqNarrow = mq('(max-width: 760px)')
const mqTouch = mq('(pointer: coarse)')
const mqNoHover = mq('(hover: none)')
const mqPhoneW = mq('(max-width: 960px)')
const mqPhoneH = mq('(max-height: 500px)')
const mqLow = mq('(max-height: 560px)')
const mqTabletTouch = mq('(max-width: 1400px)')

let realTouch = false
try {
  realTouch = (navigator.maxTouchPoints || 0) > 0 && !/Windows/i.test(navigator.userAgent || '')
} catch {
  /* bỏ qua */
}

export type Layout = 'desktop' | 'tablet' | 'phone'
let last = ''

/** Gắn lớp bố cục; trả true khi bố cục thật sự đổi hạng. */
export function applyLayout() {
  const touch = mqTouch.matches || mqNoHover.matches || realTouch
  const narrow = mqNarrow.matches || (touch && mqPhoneW.matches && mqPhoneH.matches)
  const compact = narrow || mqCompact.matches || (touch && mqTabletTouch.matches)
  root.classList.toggle('compact', compact)
  root.classList.toggle('narrow', narrow)
  root.classList.toggle('thap', compact && mqLow.matches)
  root.classList.toggle('touch', touch)
  const now = `${compact}|${narrow}|${root.classList.contains('thap')}`
  const changed = now !== last
  last = now
  if (changed) window.dispatchEvent(new Event('layoutchange'))
  return changed
}

export function currentLayout(): Layout {
  return root.classList.contains('narrow') ? 'phone' : root.classList.contains('compact') ? 'tablet' : 'desktop'
}

let started = false
export function startLayout() {
  if (started) return
  started = true
  applyLayout()
  const again = () => {
    applyLayout()
    // Máy gập mở / gập không bắn đúng một sự kiện: soát lại sau 0,4 giây
    window.setTimeout(applyLayout, 400)
  }
  window.addEventListener('resize', again)
  window.addEventListener('orientationchange', again)
  for (const q of [mqCompact, mqNarrow, mqTouch, mqNoHover, mqPhoneW, mqPhoneH, mqLow, mqTabletTouch]) q.addEventListener('change', again)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && again())
}
