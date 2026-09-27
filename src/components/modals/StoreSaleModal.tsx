import React, { useState } from 'react';
import { useStore } from '../../store/cafe';
import { money } from '../../lib/format';
import { PosMenu } from '../pos/PosMenu';
import type { ItemCategory } from '../../lib/types';

type PosCategory = 'all' | ItemCategory;
type Step = 'category' | 'catalog' | 'checkout';

interface Props {
  onClose: () => void;
}

/** نقطة بيع مباشر (POS) بثلاث خطوات: اختيار الفئة ← الكتالوج والسلة ← الفاتورة والخصم. */
export function StoreSaleModal({ onClose }: Props) {
  const { inventory, directStoreSale, config } = useStore();
  const [step, setStep] = useState<Step>('category');
  const [category, setCategory] = useState<PosCategory>('all');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [foodDiscount, setFoodDiscount] = useState('');
  const [drinksDiscount, setDrinksDiscount] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [printSale, setPrintSale] = useState(true);

  const cartItems = inventory.filter((i) => (cart[i.id] ?? 0) > 0);
  const subtotal = cartItems.reduce((s, i) => s + i.price * (cart[i.id] ?? 0), 0);
  const foodSubtotal = cartItems.filter((i) => i.category === 'food').reduce((s, i) => s + i.price * (cart[i.id] ?? 0), 0);
  const drinksSubtotal = cartItems.filter((i) => i.category === 'drinks').reduce((s, i) => s + i.price * (cart[i.id] ?? 0), 0);
  // خصم المأكولات وخصم المشروبات مستقلان ويتقدّمان معاً — كلٌّ يُحصَّر في مجموع فئته في الفاتورة.
  const clamp = (v: string, limit: number) => Math.min(Math.max(0, Math.round((Number(v) || 0) * 100) / 100), limit);
  const foodDiscNum = clamp(foodDiscount, foodSubtotal);
  const drinksDiscNum = clamp(drinksDiscount, drinksSubtotal);
  const discountNum = Math.round((foodDiscNum + drinksDiscNum) * 100) / 100;
  const netTotal = Math.max(0, Math.round((subtotal - discountNum) * 100) / 100);

  const catLabel: Record<PosCategory, string> = { all: 'الكل', food: 'المأكولات', drinks: 'المشروبات' };
  const catIcon: Record<PosCategory, string> = { all: '🗂', food: '🍔', drinks: '🥤' };
  const catCount = (c: Exclude<PosCategory, 'all'>) => inventory.filter((i) => i.category === c).length;

  const openCategory = (c: PosCategory) => {
    setCategory(c);
    setErr('');
    setStep('catalog');
  };

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

  const complete = async () => {
    const list = cartItems.map((i) => ({ itemId: i.id, qty: cart[i.id] }));
    if (list.length === 0) {
      setErr('أضف منتجاً واحداً على الأقل');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await directStoreSale(list, printSale, foodDiscNum, drinksDiscNum);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'فشل عملية البيع');
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal modal-wide pos-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>🛒 بيع مباشر</h3>
          <button className="x" onClick={onClose}>×</button>
        </div>

        <div className="pos-step" key={step}>
          {step === 'category' && (
            <>
              <p className="device-hint" style={{ marginBottom: 14 }}>
                اختر فئة المنتجات للبدء — يمكنك دمج أصناف من فئات مختلفة في سلة واحدة.
              </p>
              <div className="pos-cats">
                <button className="pos-cat" onClick={() => openCategory('all')}>
                  <span className="pos-cat-ico">{catIcon.all}</span>
                  <strong>{catLabel.all}</strong>
                  <span className="pos-cat-count">{inventory.length} منتج</span>
                </button>
                <button className="pos-cat" onClick={() => openCategory('food')}>
                  <span className="pos-cat-ico">{catIcon.food}</span>
                  <strong>{catLabel.food}</strong>
                  <span className="pos-cat-count">{catCount('food')} منتج</span>
                </button>
                <button className="pos-cat" onClick={() => openCategory('drinks')}>
                  <span className="pos-cat-ico">{catIcon.drinks}</span>
                  <strong>{catLabel.drinks}</strong>
                  <span className="pos-cat-count">{catCount('drinks')} منتج</span>
                </button>
              </div>
            </>
          )}

          {step === 'catalog' && (
            <>
              <div className="pos-head">
                <button className="btn ghost tiny" onClick={() => setStep('category')}>← الفئات</button>
                <span className="pos-title">اختر المنتجات ثم اضغط تأكيد الطلب</span>
              </div>

              <PosMenu
                inventory={inventory}
                cart={cart}
                onSetQty={setQty}
                onRemoveItem={removeItem}
                currency={config.currency}
                initialTab={category}
                footer={
                  <button
                    className="btn primary full"
                    disabled={cartItems.length === 0 || busy}
                    onClick={() => { setErr(''); setStep('checkout'); }}
                  >
                    تأكيد الطلب ✓
                  </button>
                }
              />
            </>
          )}

          {step === 'checkout' && (
            <div className="pos-checkout">
              <div className="pos-head">
                <button className="btn ghost tiny" onClick={() => setStep('catalog')}>← تعديل الطلب</button>
                <span className="pos-title">الفاتورة النهائية</span>
              </div>

              <div className="pos-inv">
                {cartItems.map((item) => (
                  <div key={item.id} className="pos-inv-line">
                    <span>{item.name} <small>×{cart[item.id]}</small></span>
                    <span className="pos-inv-unit">{money(item.price, config.currency)}</span>
                    <strong>{money(item.price * (cart[item.id] ?? 0), config.currency)}</strong>
                  </div>
                ))}

                <div className="pos-inv-divider" />

                <div className="pos-inv-line">
                  <span>الإجمالي الفرعي</span>
                  <span className="pos-inv-unit">{cartItems.length} صنف</span>
                  <strong>{money(subtotal, config.currency)}</strong>
                </div>

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

                <div className="pos-inv-divider" />

                <div className="pos-inv-line net">
                  <span>إجمالي الدفع بعد الخصم</span>
                  <strong>{money(netTotal, config.currency)}</strong>
                </div>
                {foodDiscNum > 0 && (
                  <div className="pos-inv-line">
                    <span>قيمة خصم المأكولات</span>
                    <span className="pos-inv-unit">المأكولات</span>
                    <strong style={{ color: 'var(--red)' }}>−{money(foodDiscNum, config.currency)}</strong>
                  </div>
                )}
                {drinksDiscNum > 0 && (
                  <div className="pos-inv-line">
                    <span>قيمة خصم المشروبات</span>
                    <span className="pos-inv-unit">المشروبات</span>
                    <strong style={{ color: 'var(--red)' }}>−{money(drinksDiscNum, config.currency)}</strong>
                  </div>
                )}
              </div>

              {err && <p className="modal-error">{err}</p>}

              <label className="pos-print-toggle">
                <input
                  type="checkbox"
                  checked={printSale}
                  onChange={(e) => setPrintSale(e.target.checked)}
                />
                🖨 طباعة الفاتورة
              </label>

              <div className="modal-actions">
                <button className="btn ghost" onClick={onClose}>إلغاء</button>
                <button className="btn success" disabled={busy} onClick={() => void complete()}>
                  {busy ? 'جارٍ إتمام البيع…' : 'إتمام البيع ✓'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}