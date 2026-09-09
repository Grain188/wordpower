import { useEffect, useMemo, useState } from 'react'
import {
  allWords,
  getStats,
  setKnown,
  deleteWord,
  takeRecentImported,
} from '../db/repo.js'
import { CEFR_LEVELS, THEMES, classifyPos, POS_GROUP_ZH, themeZh } from '../lib/words.js'
import { setScenarioWords } from '../lib/scenarioIntent.js'
import WordRow from '../components/WordRow.jsx'
import EditWordDialog from '../components/EditWordDialog.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import './LibraryPage.css'

const DIMS = [
  { id: 'cefr', zh: '难度' },
  { id: 'pos', zh: '词性' },
  { id: 'theme', zh: '主题' },
]
const CEFR_ORDER = [...CEFR_LEVELS, '']
const POS_ORDER = ['noun', 'verb', 'adj', 'adv', 'prep', 'conj', 'pron', 'other']
const THEME_ORDER = [...THEMES.map((t) => t.id), '']

function dimKey(dim, w) {
  if (dim === 'cefr') return w.cefr || ''
  if (dim === 'pos') return classifyPos(w.pos)
  return w.theme || ''
}
function dimLabel(dim, k) {
  if (dim === 'cefr') return k || '未分级'
  if (dim === 'pos') return POS_GROUP_ZH[k] || k
  return k ? themeZh(k) || k : '未分类'
}
function dimOrder(dim) {
  if (dim === 'cefr') return CEFR_ORDER
  if (dim === 'pos') return POS_ORDER
  return THEME_ORDER
}

export default function LibraryPage({ openImport, goTab }) {
  const [words, setWords] = useState([])
  const [stats, setStats] = useState(null)
  const [dim, setDim] = useState('cefr')
  const [scope, setScope] = useState('all') // all | learning | known
  const [q, setQ] = useState('')
  const [expanded, setExpanded] = useState(() => new Set())
  const [recentIds, setRecentIds] = useState(() => new Set())
  const [editing, setEditing] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)
  // 多选 → 编情景（3-5 个词）
  const [multi, setMulti] = useState(false)
  const [selected, setSelected] = useState(() => new Set())

  useEffect(() => {
    ;(async () => {
      const [wds, st] = await Promise.all([allWords(), getStats()])
      setWords(wds)
      setStats(st)
      // 刚导入的词 → chip 逐个弹入（stagger 30ms 由 delay 提供）
      setRecentIds(new Set(takeRecentImported()))
    })()
  }, [])

  function toggleMulti() {
    setMulti((m) => {
      const next = !m
      if (!next) setSelected(new Set())
      return next
    })
  }
  function toggleSelect(w) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(w.id) ? next.delete(w.id) : next.add(w.id)
      return next
    })
  }
  function goScenario() {
    const chosen = words.filter((w) => selected.has(w.id))
    if (chosen.length < 3 || chosen.length > 5) return
    setScenarioWords(chosen)
    setMulti(false)
    setSelected(new Set())
    goTab('speaking')
  }

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return words
      .filter((w) => (scope === 'learning' ? !w.known : scope === 'known' ? w.known : true))
      .filter(
        (w) =>
          !kw ||
          w.word.toLowerCase().includes(kw) ||
          (w.meaningZh || '').toLowerCase().includes(kw) ||
          (w.phonetic || '').toLowerCase().includes(kw)
      )
      .sort((a, b) => a.word.localeCompare(b.word))
  }, [words, scope, q])

  const groups = useMemo(() => {
    const byKey = new Map()
    for (const w of filtered) {
      const k = dimKey(dim, w)
      if (!byKey.has(k)) byKey.set(k, [])
      byKey.get(k).push(w)
    }
    return dimOrder(dim)
      .map((k) => ({ key: k, label: dimLabel(dim, k), items: byKey.get(k) || [] }))
      .filter((g) => g.items.length > 0)
  }, [filtered, dim])

  const orderIdx = useMemo(() => {
    const m = new Map()
    groups.forEach((g) => g.items.forEach((w, i) => m.set(w.wordNorm, i)))
    return m
  }, [groups])

  function toggleGroup(key) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }
  const allOpen = groups.length > 0 && groups.every((g) => expanded.has(g.key))
  function toggleAll() {
    setExpanded(allOpen ? new Set() : new Set(groups.map((g) => g.key)))
  }

  function patchWord(updated) {
    setWords((arr) => arr.map((w) => (w.id === updated.id ? { ...w, ...updated } : w)))
    setStats(null)
    getStats().then(setStats)
  }
  function removeWord(id) {
    setWords((arr) => arr.filter((w) => w.id !== id))
    setConfirmDel(null)
    getStats().then(setStats)
  }

  return (
    <section className="page">
      <header className="topbar">
        <h1 className="h-display topbar-title">
          生词本
          {stats && stats.total > 0 && <span className="lib-count num"> {stats.total}</span>}
        </h1>
        <div className="topbar-actions">
          <button
            className={`btn ${multi ? 'btn-ghost' : 'btn-plain'} topbar-text-btn`}
            onClick={toggleMulti}
            aria-pressed={multi}
          >
            {multi ? '取消多选' : '多选编情景'}
          </button>
          <button className="topbar-icon-btn" aria-label="拍照导入生词" onClick={openImport}>＋</button>
        </div>
      </header>

      <div className="pad lib-pad">
        {/* 统计头 */}
        {stats && (
          <div className="lib-stats">
            <button className="stat-chip" onClick={() => stats.dueToday > 0 && goTab('today')}>
              <b className="num">{stats.dueToday}</b>
              <span>今日到期{stats.dueToday > 0 ? ' →' : ''}</span>
            </button>
            <button className="stat-chip" onClick={() => setScope('learning')}>
              <b className="num">{stats.total - stats.knownCount}</b>
              <span>学习中</span>
            </button>
            <button className="stat-chip" onClick={() => setScope('known')}>
              <b className="num">{stats.mastered}</b>
              <span>掌握 {stats.masteryRate}%</span>
            </button>
          </div>
        )}

        {/* 搜索 + 范围 */}
        <input
          className="field lib-search"
          type="search"
          placeholder="搜索单词 / 释义 / 音标"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="seg" role="tablist" aria-label="范围">
          {[
            { id: 'all', zh: `全部 ${words.length}` },
            { id: 'learning', zh: '学习中' },
            { id: 'known', zh: '已掌握' },
          ].map((s) => (
            <button
              key={s.id}
              className={`seg-btn${scope === s.id ? ' on' : ''}`}
              onClick={() => setScope(s.id)}
            >
              {s.zh}
            </button>
          ))}
        </div>

        {/* 分组维度 */}
        <div className="seg dims" role="tablist" aria-label="分组维度">
          {DIMS.map((d) => (
            <button key={d.id} className={`seg-btn${dim === d.id ? ' on' : ''}`} onClick={() => setDim(d.id)}>
              {d.zh}
            </button>
          ))}
        </div>

        {words.length === 0 ? (
          <div className="ph" style={{ minHeight: 280 }}>
            <h2 className="h-display ph-title">生词本是空的</h2>
            <p className="ph-sub">拍课本或粘贴文字，自动整理成词卡开始积累</p>
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={openImport}>
              ＋ 拍照导入生词
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <p className="lib-empty">没有匹配的词</p>
        ) : (
          <>
            <div className="lib-groups-head">
              <span className="lib-hint">{groups.length} 组 · {filtered.length} 词</span>
              <button className="lib-toggle" onClick={toggleAll}>
                {allOpen ? '全部收起' : '全部展开'}
              </button>
            </div>
            {groups.map((g) => (
              <div key={`${dim}-${g.key}`} className="lib-group">
                <button className="lib-group-head" onClick={() => toggleGroup(g.key)}>
                  <span className={`chevron${expanded.has(g.key) ? ' on' : ''}`}>▸</span>
                  <b className="h-display">{g.label}</b>
                  <span className="tag num">{g.items.length}</span>
                </button>
                {expanded.has(g.key) && (
                  <ul className="lib-list">
                    {g.items.map((w) => (
                      <WordRow
                        key={w.id}
                        word={w}
                        recent={recentIds.has(w.id)}
                        delayMs={(orderIdx.get(w.wordNorm) || 0) * 30}
                        onEdit={(word) => setEditing(word)}
                        onToggleKnown={async (word) => patchWord(await setKnown(word.id, word.known ? 0 : 1))}
                        onAskDelete={(word) => setConfirmDel(word)}
                        selectable={multi}
                        selected={selected.has(w.id)}
                        onToggleSelect={toggleSelect}
                      />
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </>
        )}

        {/* 多选操作条：3-5 个词 → 编情景 */}
        {multi && (
          <div className="multi-bar">
            <span className="num">已选 {selected.size} / 3–5 词</span>
            <button
              className="btn btn-primary"
              disabled={selected.size < 3 || selected.size > 5}
              onClick={goScenario}
            >
              🎭 用这 {selected.size} 个词编个情景聊聊
            </button>
          </div>
        )}
      </div>

      {editing && (
        <EditWordDialog word={editing} onClose={() => setEditing(null)} onSaved={patchWord} />
      )}
      {confirmDel && (
        <ConfirmDialog
          title={`删除 ${confirmDel.word}？`}
          desc="删除后该词的复习记录会一并移除，无法撤销。"
          okText="删除"
          onOk={() => deleteWord(confirmDel.id).then(() => removeWord(confirmDel.id))}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </section>
  )
}
