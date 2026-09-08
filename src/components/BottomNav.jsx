import NavIcon from './NavIcon.jsx'
import './BottomNav.css'

const TABS = [
  { id: 'today', label: '今日学习', icon: 'study' },
  { id: 'library', label: '生词本', icon: 'library' },
  { id: 'speaking', label: '听说', icon: 'speaking' },
  { id: 'stats', label: '统计', icon: 'stats' },
  { id: 'profile', label: '我的', icon: 'profile' },
]

// 底部主导航 5 tab：选中染绿 + 顶部指示条（硬性要求 C）
export default function BottomNav({ active, onChange }) {
  return (
    <nav className="nav" aria-label="主导航">
      {TABS.map((t) => {
        const isActive = t.id === active
        return (
          <button
            key={t.id}
            className={`nav-item${isActive ? ' active' : ''}`}
            onClick={() => onChange(t.id)}
            aria-current={isActive ? 'page' : undefined}
          >
            <span className="nav-indicator" aria-hidden="true" />
            <NavIcon name={t.icon} size={24} />
            <span className="nav-label">{t.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
