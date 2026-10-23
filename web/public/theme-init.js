// Gắn giao diện sáng / tối trước khi trang vẽ (tránh nháy trắng khi dùng giao diện tối). Xem src/theme.ts.
;(function () {
  var p = null
  try {
    p = localStorage.getItem('zcskh.theme')
  } catch (e) {}
  var dark = p === 'dark' || (p !== 'light' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
})()
