import React, { useState } from 'react';
import { useStore } from '../../store/cafe';
import { incomeStreamOf } from '../../lib/types';
import type { QuickIncomeButton } from '../../lib/types';

interface Props {
  button: QuickIncomeButton;
  onClose: () => void;
}

/** نافذة موحّدة لتسجيل أي إيراد سريع (فوري/طابعة/مباريات/إيرادات أخرى) بنفس القالب تماماً:
 * حقل المبلغ، ملاحظة اختيارية، خيار طباعة الإيصال، وزر تسجيل الإيراد. */
export function IncomeModal({ button, onClose }: Props) {
  const { addIncome, config } = useStore();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [print, setPrint] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    setErr('');
    try {
      await addIncome(incomeStreamOf(button.id), Number(amount) || 0, note, print, button.label);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'فشلت العملية');
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{button.icon} تسجيل إيراد {button.label}</h3>
          <button className="x" onClick={onClose}>×</button>
        </div>

        <label className="field-label">المبلغ ({config.currency})</label>
        <input
          type="number" min={0} value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0"
        />

        <label className="field-label">ملاحظة (اختياري)</label>
        <input
          value={note} onChange={(e) => setNote(e.target.value)}
          placeholder={`مثال: تفاصيل عملية ${button.label}`}
        />

        <label className="check">
          <input type="checkbox" checked={print} onChange={(e) => setPrint(e.target.checked)} />
          طباعة إيصال
        </label>

        {err && <p className="modal-error">{err}</p>}

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>إلغاء</button>
          <button className="btn primary" disabled={busy} onClick={() => void go()}>
            {busy ? 'جارٍ الحفظ…' : 'تسجيل الإيراد'}
          </button>
        </div>
      </div>
    </div>
  );
}