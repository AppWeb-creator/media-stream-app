import React from 'react';

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** نافذة تأكيد مخصصة بنمط التطبيق — بديل جاهز لـ window.confirm في عمليات الحذف. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'تأكيد الحذف',
  danger = true,
  onConfirm,
  onClose,
}: Props) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal modal-confirm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>🗑 {title}</h3>
          <button className="x" onClick={onClose}>×</button>
        </div>
        <p className="confirm-msg">{message}</p>
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>إلغاء</button>
          <button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}