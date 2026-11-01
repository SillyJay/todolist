import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { TERMS, TERMS_TITLE, TERMS_VERSION } from '../lib/terms'

export default function TermsDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element | null {
  if (!open) return null
  return createPortal(
    <div
      className="overlay overlay-top"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="dialog terms-dialog">
        <div className="dialog-head">
          <div className="dialog-title">{TERMS_TITLE}</div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <X size={15} />
          </button>
        </div>
        <div className="dialog-body terms-body">
          {TERMS.map((p) => (
            <p key={p.slice(0, 12)} className="terms-p">{p}</p>
          ))}
          <p className="terms-version">版本 {TERMS_VERSION}</p>
        </div>
        <div className="dialog-foot">
          <button className="btn btn-primary sm" onClick={onClose}>
            我知道了
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
