import React, { useState } from 'react';
import { useStore } from '../../store/cafe';
import type { CashMoveType } from '../../lib/types';

interface Props {
  onClose: () => void;
}

/**
 * نافذة «سحب وإضافة مبلغ» الموحّدة — متاحة للموظف والمدير معاً:
 * - تبويبان: «سحب مبلغ» (افتراضي) يُخصم فوراً من إيراد الوردية عند التقفيل،
 *   و«إضافة مبلغ» يُسجَّل «قيد التفعيل» ولا يُحتسب إلا بعد انتهاء مهلة التأجيل (دقيقتان).
 * - الملاحظة إلزامية للشفافية في سجل حركة الخزنة.
 */
export function CashMoveModal({ onClose }: Props) {
  const { moveCash, config, myOpenShift } = useStore();
  const [type, setType] = useState<CashMoveType>('withdraw');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const go = async () => {
    if (!myOpenShift) {
      setErr('افتح وردية أولاً قبل تنفيذ أي حركة نقدية.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await moveCash(type, Number(amount) || 0, note);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'فشلت العملية');
      setBusy(false);
    }
  };

  const deposit = type === 'deposit';

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>💸 سحب وإضافة مبلغ من الخزنة</h3>
          <button className="x" onClick={onClose}>×</button>
        </div>

        <div className="pos-cats" style={{ gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          <button
            className={`pos-cat ${!deposit ? 'on' : ''}`}
            onClick={() => { setType('withdraw'); setErr(''); }}
          >
            <span className="pos-cat-ico">➖</span>
            <strong>سحب مبلغ</strong>
            <span className="pos-cat-count">خصم فوري من الإيراد</span>
          </button>
          <button
            className={`pos-cat ${deposit ? 'on' : ''}`}
            onClick={() => { setType('deposit'); setErr(''); }}
          >
            <span className="pos-cat-ico">➕</span>
            <strong>إضافة مبلغ</strong>
            <span className="pos-cat-count">تُفعَّل بعد دقيقتين</span>
          </button>
        </div>

        <p className="device-hint">
          {deposit
            ? 'تسجَّل الإضافة في سجل الخزنة بحالة «قيد التفعيل» ولا تُدخل في أرقام الوردية إلا بعد انقضاء دقيقتين (تؤثر صافياً بزيادة الإيراد عند التقفيل).'
            : 'يُنفَّذ السحب فوراً ويُخصم تلقائياً من إجمالي إيراد الوردية الحالية عند التقفيل، مع تسجيل اسم الموظف المنفذ.'}
        </p>

        <label className="field-label">المبلغ ({config.currency})</label>
        <input
          type="number" min={0} value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0"
          autoFocus
        />

        <label className="field-label">الملاحظات (إلزامية للشفافية)</label>
        <input
          value={note} onChange={(e) => setNote(e.target.value)}
          placeholder={deposit ? 'مثال: إيداع نقدي في الدرج من الخارج' : 'مثال: سحب مصروف يومي'}
        />

        {err && <p className="modal-error">{err}</p>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>إلغاء</button>
          <button className={deposit ? 'btn success' : 'btn danger'} disabled={busy} onClick={() => void go()}>
            {busy ? 'جارٍ الحفظ…' : deposit ? 'تأكيد الإضافة' : 'تأكيد السحب'}
          </button>
        </div>
      </div>
    </div>
  );
}