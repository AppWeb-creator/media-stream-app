import React, { useMemo, useState } from 'react';
import { useStore, useTick } from '../../store/cafe';
import { money } from '../../lib/format';
import type { Session } from '../../lib/types';
import { orderLineNet } from '../../lib/types';

interface Props {
  session: Session;
  onClose: () => void;
}

export function SettleModal({ session, onClose }: Props) {
  const { subtotalOf, config, settleSession } = useStore();
  const now = useTick(1000);
  const [discount, setDiscount] = useState('0');
  const [serviceFee, setServiceFee] = useState('0');
  const [print, setPrint] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const live = useMemo(() => subtotalOf(session, now), [session, now, subtotalOf]);
  const d = Number(discount) || 0;
  const f = Number(serviceFee) || 0;
  const total = Math.max(0, live.subtotal + f - d);

  const go = async () => {
    setBusy(true);
    setErr('');
    try {
      await settleSession(session, d, f, print);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'فشل حساب الفاتورة');
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>حساب الفاتورة — {session.deviceName}</h3>
          <button className="x" onClick={onClose}>×</button>
        </div>

        <div className="bill-box">
          {live.gamesCost > 0 ? (
            <div className="orders-line"><span>الجيمات ({session.gamesCount ?? 0} × {money(config.gameRate, config.currency)})</span><span>{money(live.gamesCost, config.currency)}</span></div>
          ) : (
            <div className="orders-line"><span>تكلفة الوقت</span><span>{money(live.timeCost, config.currency)}</span></div>
          )}
          {session.orders.map((o) => (
            <div key={o.itemId} className="orders-line">
              <span>{o.name} ×{o.qty}</span>
              <span>{money(orderLineNet(o), config.currency)}</span>
            </div>
          ))}
          <div className="orders-line total"><span>الإجمالي الفرعي</span><span>{money(live.subtotal, config.currency)}</span></div>
        </div>

        <div className="two-col">
          <div>
            <label className="field-label">الخصم ({config.currency})</label>
            <input type="number" min={0} value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </div>
          <div>
            <label className="field-label">رسوم خدمة ({config.currency})</label>
            <input type="number" min={0} value={serviceFee} onChange={(e) => setServiceFee(e.target.value)} />
          </div>
        </div>

        <label className="check">
          <input type="checkbox" checked={print} onChange={(e) => setPrint(e.target.checked)} />
          طباعة فاتورة حرارية
        </label>

        <div className="grand-total">
          <span>الإجمالي المستحق</span>
          <strong>{money(total, config.currency)}</strong>
        </div>

        {err && <p className="modal-error">{err}</p>}

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>رجوع</button>
          <button className="btn primary" disabled={busy} onClick={() => void go()}>
            {busy ? 'جارٍ التحصيل…' : 'تأكيد وإغلاق الجلسة'}
          </button>
        </div>
      </div>
    </div>
  );
}
