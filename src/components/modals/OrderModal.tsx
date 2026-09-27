import React, { useState } from 'react';
import { useStore } from '../../store/cafe';
import { money } from '../../lib/format';
import { PosMenu } from '../pos/PosMenu';
import type { Session } from '../../lib/types';

interface Props {
  session: Session;
  onClose: () => void;
}

/** طلب جلسة جهاز — نفس واجهة POS المستخدمة في «بيع مباشر» لكن الطلب يُضاف للجلسة بدل تصريفه فوراً.
 *  خصم المأكولات وخصم المشروبات مستقلان ويظهران داخل لوحة ملخص السلة بجانب الإجمالي. */
export function OrderModal({ session, onClose }: Props) {
  const { inventory, addOrders, config } = useStore();
  const [cart, setCart] = useState<Record<string, number>>({});
  const [foodDiscount, setFoodDiscount] = useState('');
  const [drinksDiscount, setDrinksDiscount] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [printOrder, setPrintOrder] = useState(true);

  const cartItems = inventory.filter((i) => (cart[i.id] ?? 0) > 0);
  const foodSubtotal = cartItems.filter((i) => i.category === 'food').reduce((s, i) => s + i.price * (cart[i.id] ?? 0), 0);
  const drinksSubtotal = cartItems.filter((i) => i.category === 'drinks').reduce((s, i) => s + i.price * (cart[i.id] ?? 0), 0);
  // خصم المأكولات وخصم المشروبات مستقلان ويُطبَّقان معاً — كلٌّ يُحصَّر في مجموع فئته في السلة.
  const clamp = (v: string, limit: number) => Math.min(Math.max(0, Math.round((Number(v) || 0) * 100) / 100), limit);
  const foodDiscNum = clamp(foodDiscount, foodSubtotal);
  const drinksDiscNum = clamp(drinksDiscount, drinksSubtotal);
  const discountNum = Math.round((foodDiscNum + drinksDiscNum) * 100) / 100;

  const setQty = (id: string, delta: number) => {
    const item = inventory.find((i) => i.id === id);
    const max = item?.stock ?? 0;
    setCart((p) => {
      const next = Math.min(max, Math.max(0, (p[id] ?? 0) + delta));
      return { ...p, [id]: next };
    });
  };

  const removeItem = (id: string) => {
    setCart((p) => {
      const next = { ...p };
      delete next[id];
      return next;
    });
  };

  const addToSession = async () => {
    if (cartItems.length === 0) {
      setErr('أضف منتجاً واحداً على الأقل');
      return;
    }
    setBusy(true);
    setErr('');
    setDone('');
    try {
      // دمج كل أصناف السلة في جلسة الجهاز دفعة واحدة — لا تستبدل الأصناف بعضها البعض.
      await addOrders(
        session,
        cartItems.map((i) => ({ itemId: i.id, qty: cart[i.id] })),
        foodDiscNum,
        drinksDiscNum,
        printOrder,
      );
      setCart({});
      setFoodDiscount('');
      setDrinksDiscount('');
      setDone('تمت إضافة الطلب إلى جلسة الجهاز ✓');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'فشل إضافة الطلب إلى الجلسة');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal modal-wide pos-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>طلب لجهاز {session.deviceName}</h3>
          <button className="x" onClick={onClose}>×</button>
        </div>

        <PosMenu
          inventory={inventory}
          cart={cart}
          onSetQty={setQty}
          onRemoveItem={removeItem}
          currency={config.currency}
          footerTop={
            cartItems.length > 0 && (
              <div className="pos-session-disc">
                <div className="two-col">
                  <div className="pos-discount">
                    <label className="field-label">خصم المأكولات</label>
                    <input
                      type="number"
                      min={0}
                      step="1"
                      dir="ltr"
                      placeholder="0"
                      value={foodDiscount}
                      onChange={(e) => { setFoodDiscount(e.target.value); setErr(''); }}
                    />
                  </div>
                  <div className="pos-discount">
                    <label className="field-label">خصم المشروبات</label>
                    <input
                      type="number"
                      min={0}
                      step="1"
                      dir="ltr"
                      placeholder="0"
                      value={drinksDiscount}
                      onChange={(e) => { setDrinksDiscount(e.target.value); setErr(''); }}
                    />
                  </div>
                </div>
                {discountNum > 0 && (
                  <div className="pos-session-breakdown">
                    {foodDiscNum > 0 && (
                      <div className="orders-line">
                        <span>خصم المأكولات</span>
                        <span style={{ color: 'var(--red)' }}>−{money(foodDiscNum, config.currency)}</span>
                      </div>
                    )}
                    {drinksDiscNum > 0 && (
                      <div className="orders-line">
                        <span>خصم المشروبات</span>
                        <span style={{ color: 'var(--red)' }}>−{money(drinksDiscNum, config.currency)}</span>
                      </div>
                    )}
                    <div className="orders-line total">
                      <span>الصافي بعد الخصم</span>
                      <span>{money(Math.max(0, foodSubtotal + drinksSubtotal - discountNum), config.currency)}</span>
                    </div>
                  </div>
                )}
              </div>
            )
          }
          footer={
            <>
              {cartItems.length > 0 && (
                <label className="pos-print-toggle">
                  <input
                    type="checkbox"
                    checked={printOrder}
                    onChange={(e) => setPrintOrder(e.target.checked)}
                  />
                  🖨 طباعة الفاتورة
                </label>
              )}
              <button className="btn primary full" disabled={cartItems.length === 0 || busy} onClick={() => void addToSession()}>
                {busy ? 'جارٍ إضافة الطلب…' : 'إضافة الطلب للجلسة ✓'}
              </button>
            </>
          }
        />

        {done && <p className="ok-msg">{done}</p>}
        {err && <p className="modal-error">{err}</p>}
      </div>
    </div>
  );
}