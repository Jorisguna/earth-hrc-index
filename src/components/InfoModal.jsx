import { useEffect } from 'react'

export default function InfoModal({ title, body, onClose }) {
  // Close on Escape key
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="info-overlay" onClick={onClose}>
      <div className="info-modal" onClick={e => e.stopPropagation()}>
        <button className="info-modal-close" onClick={onClose} aria-label="Close">✕</button>
        <h2 className="info-modal-title">{title}</h2>
        <div className="info-modal-body">
          {body.split('\n').map((line, i) => (
            line.trim() === ''
              ? <br key={i} />
              : <p key={i}>{line}</p>
          ))}
        </div>
      </div>
    </div>
  )
}
