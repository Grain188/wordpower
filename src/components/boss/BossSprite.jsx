// BossSprite —— 几何 SVG 小怪兽（零外部图片）
// 状态随血量变化：满血蓝色沉稳 → 残血红眼狂暴；颜色走 tokens，禁止散写。
export default function BossSprite({ hpRatio, size = 150 }) {
  const angry = hpRatio < 0.5
  const dying = hpRatio < 0.25
  const body = dying ? 'var(--color-danger)' : 'var(--color-accent)'
  const dark = dying ? '#d13a3a' : 'var(--blue-dark)'
  return (
    <svg
      width={size}
      height={size * 0.86}
      viewBox="0 0 120 104"
      role="img"
      aria-label="Boss 怪兽"
      style={{ filter: 'drop-shadow(0 6px 8px var(--shadow))' }}
    >
      {/* 脚 */}
      <ellipse cx="40" cy="98" rx="14" ry="6" fill={dark} />
      <ellipse cx="80" cy="98" rx="14" ry="6" fill={dark} />
      {/* 尾巴 */}
      <path d="M104 62 q14 -4 10 12 q-5 10 -14 2" fill={dark} />
      {/* 角 */}
      <path d="M34 26 L24 10 L42 20 Z" fill="var(--color-danger)" />
      <path d="M86 26 L96 10 L78 20 Z" fill="var(--color-danger)" />
      {/* 触角 */}
      <circle cx="34" cy="18" r="4" fill="var(--color-energy)" />
      <circle cx="86" cy="18" r="4" fill="var(--color-energy)" />
      {/* 身体 */}
      <ellipse cx="60" cy="62" rx="44" ry="40" fill={body} />
      {/* 肚皮 */}
      <ellipse cx="60" cy="72" rx="24" ry="20" fill="var(--bg-card)" opacity="0.9" />
      {/* 手臂 */}
      <ellipse cx="16" cy="66" rx="10" ry="16" fill={body} transform="rotate(18 16 66)" />
      <ellipse cx="104" cy="66" rx="10" ry="16" fill={body} transform="rotate(-18 104 66)" />
      {/* 眼睛 */}
      <g>
        <circle cx="43" cy="48" r="10" fill="#fff" />
        <circle cx="77" cy="48" r="10" fill="#fff" />
        <circle cx={angry ? 47 : 45} cy={angry ? 50 : 49} r="4" fill="var(--text)" />
        <circle cx={angry ? 81 : 79} cy={angry ? 50 : 49} r="4" fill="var(--text)" />
        {/* 狂暴眉毛 */}
        {angry && (
          <>
            <path d="M32 38 L52 46" stroke="var(--color-danger)" strokeWidth="4" strokeLinecap="round" />
            <path d="M88 38 L68 46" stroke="var(--color-danger)" strokeWidth="4" strokeLinecap="round" />
          </>
        )}
      </g>
      {/* 嘴 */}
      <path
        d={dying ? 'M48 82 Q60 70 72 82' : 'M48 82 Q60 90 72 82'}
        stroke="var(--text)"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
      {dying && (
        <>
          <path d="M38 60 q3 3 0 6" stroke="var(--color-energy)" strokeWidth="2" fill="none" />
          <path d="M82 60 q3 3 0 6" stroke="var(--color-energy)" strokeWidth="2" fill="none" />
        </>
      )}
    </svg>
  )
}
