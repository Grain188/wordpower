import { useEffect, useState } from 'react'
import { setSettings } from './lib/settings.js'
import { useSettings } from './hooks/useSettings.js'
import BottomNav from './components/BottomNav.jsx'
import ImportSheet from './components/ImportSheet.jsx'
import Onboarding from './pages/Onboarding.jsx'
import TodayPage from './pages/TodayPage.jsx'
import LibraryPage from './pages/LibraryPage.jsx'
import SpeakingPage from './pages/SpeakingPage.jsx'
import StatsPage from './pages/StatsPage.jsx'
import ProfilePage from './pages/ProfilePage.jsx'

const PAGES = {
  today: TodayPage,
  library: LibraryPage,
  speaking: SpeakingPage,
  stats: StatsPage,
  profile: ProfilePage,
}

// App 壳：首次启动走 Onboarding 门；之后 5 Tab + 全局导入向导（Boss/结算等覆盖层后续接入）
export default function App() {
  const settings = useSettings()
  const [tab, setTab] = useState('today')
  const [importOpen, setImportOpen] = useState(false)

  // 深色模式：data-theme 挂到 <html>，tokens.css 靠它整体切换（auto=跟随系统）
  useEffect(() => {
    const root = document.documentElement
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark =
        settings.ui.dark === 'dark' || (settings.ui.dark === 'auto' && mq.matches)
      root.dataset.theme = dark ? 'dark' : 'light'
      root.style.colorScheme = dark ? 'dark' : 'light'
    }
    apply()
    if (settings.ui.dark === 'auto') {
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
  }, [settings.ui.dark])

  // 引导完成→（若选拍照试用）直接打开导入向导
  if (!settings.onboarded) {
    return (
      <Onboarding
        onTryImport={() => {
          setSettings({ onboarded: true })
          setImportOpen(true)
        }}
        onSkip={() => setSettings({ onboarded: true })}
      />
    )
  }

  const Page = PAGES[tab] || TodayPage
  return (
    <div className="app">
      <Page openImport={() => setImportOpen(true)} goTab={setTab} />
      <BottomNav active={tab} onChange={setTab} />
      <ImportSheet open={importOpen} onClose={() => setImportOpen(false)} goTab={setTab} />
    </div>
  )
}
