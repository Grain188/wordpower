// 通用确认对话框（删除等危险动作）
export default function ConfirmDialog({ title, desc, okText = '确定', cancelText = '取消', danger = true, onOk, onCancel }) {
  return (
    <div className="dlg-mask" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="dlg" role="alertdialog" aria-modal="true">
        <h3 className="h-display dlg-title">{title}</h3>
        {desc && <p style={{ color: 'var(--text-sub)', fontSize: 14, lineHeight: 1.6 }}>{desc}</p>}
        <div className="dlg-foot">
          <button className="btn btn-plain" onClick={onCancel}>{cancelText}</button>
          <button className={`btn ${danger ? 'btn-danger-ghost' : 'btn-primary'}`} onClick={onOk}>{okText}</button>
        </div>
      </div>
    </div>
  )
}
