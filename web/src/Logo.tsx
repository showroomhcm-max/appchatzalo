/** Mark "M" của MemoryZone (màu lime chính thức, không đổi màu). */
export function MzMark({ size = 32, title = 'MemoryZone' }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 600 600" role="img" aria-label={title}>
      <g fill="#97C354">
        <path d="M273 82V258C273 278 264 294 250 305L0 517V340C0 322 8 306 22 295Z" />
        <path d="M547 82V258C547 278 538 294 524 305L274 517V340C274 322 282 306 296 295Z" />
        <circle cx="539" cy="432" r="61" />
      </g>
    </svg>
  )
}

export const APP_NAME = 'Chat Siêu Tốc'
