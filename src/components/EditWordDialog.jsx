import { useEffect, useState } from 'react'
import { updateWordInfo } from '../db/repo.js'
import { CEFR_LEVELS, THEMES } from '../lib/words.js'
import './EditWordDialog.css'

const POS_LIST = ['n.', 'v.', 'adj.', 'adv.', 'prep.', 'conj.', 'pron.', 'num.', 'art.', 'interj.', 'phr.', 'other']

/** 词条编辑（D3）：word/音标/词性/释义/难度/主题/例句，不改 FSRS 排期 */
export default function EditWordDialog({ word, onClose, onSaved }) {
  const [form, setForm] = useState(null)

  useEffect(() => {
    if (word) {
      setForm({
        word: word.word || '',
        phonetic: word.phonetic || '',
        pos: word.pos || '',
        meaningZh: word.meaningZh || '',
        cefr: word.cefr || '',
        theme: word.theme || '',
        example: word.example || '',
      })
    }
  }, [word])

  if (!word || !form) return null
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  async function save() {
    const cleaned = {
      ...form,
      word: form.word.trim(),
      meaningZh: form.meaningZh.trim(),
      phonetic: form.phonetic.trim(),
      example: form.example.trim(),
    }
    if (!cleaned.word) return
    const updated = await updateWordInfo(word.id, cleaned)
    onSaved?.(updated)
    onClose()
  }

  return (
    <div className="dlg-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dlg" role="dialog" aria-modal="true" aria-label="编辑词条">
        <div className="dlg-head">
          <h3 className="h-display dlg-title">编辑词条</h3>
          <button className="sheet-x" aria-label="关闭" onClick={onClose}>✕</button>
        </div>
        <div className="dlg-body">
          <div className="dlg-row2">
            <label className="fld">
              <span>单词 *</span>
              <input className="field" value={form.word} onChange={set('word')} autoFocus />
            </label>
            <label className="fld">
              <span>音标</span>
              <input className="field" value={form.phonetic} onChange={set('phonetic')} placeholder="/ˈwɜːd/" />
            </label>
          </div>
          <label className="fld">
            <span>词性</span>
            <input className="field" list="pos-list" value={form.pos} onChange={set('pos')} placeholder="n. / v. / adj. …" />
            <datalist id="pos-list">
              {POS_LIST.map((p) => <option key={p} value={p} />)}
            </datalist>
          </label>
          <label className="fld">
            <span>中文释义</span>
            <textarea className="field" rows={2} value={form.meaningZh} onChange={set('meaningZh')} placeholder="简明中文释义" />
          </label>
          <div className="dlg-row2">
            <label className="fld">
              <span>CEFR</span>
              <select className="field" value={form.cefr} onChange={set('cefr')}>
                <option value="">未分级</option>
                {CEFR_LEVELS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="fld">
              <span>主题</span>
              <select className="field" value={form.theme} onChange={set('theme')}>
                <option value="">未分类</option>
                {THEMES.map((t) => <option key={t.id} value={t.id}>{t.zh}</option>)}
              </select>
            </label>
          </div>
          <label className="fld">
            <span>例句</span>
            <input className="field" value={form.example} onChange={set('example')} placeholder="含该词的一句话例句（可选）" />
          </label>
        </div>
        <div className="dlg-foot">
          <button className="btn btn-plain" onClick={onClose}>取消</button>
          <button className="btn btn-primary" disabled={!form.word.trim()} onClick={save}>保存</button>
        </div>
      </div>
    </div>
  )
}
