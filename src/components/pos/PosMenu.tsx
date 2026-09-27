import React, { useState } from 'react';
import { money } from '../../lib/format';
import type { InventoryItem, ItemCategory } from '../../lib/types';

type Tab = 'all' | ItemCategory;

interface Props {
  inventory: InventoryItem[];
  cart: Record<string, number>;
  onSetQty: (id: string, delta: number) => void;
  onRemoveItem: (id: string) => void;
  currency: string;
  /** زر الإجراء الخاص بالسياق (بيع مباشر / إضافة طلب للجلسة) — يُعرض أسفل السلة. */
  footer?: React.ReactNode;
  /** محتوى إضافي يُعرض داخل لوحة السلة بين الإجمالي الفرعي وزر الإجراء (مثل خصومات طلبات الجلسة). */
  footerTop?: React.ReactNode;
  emptyText?: string;
  /** التبويب الابتدائي (كل / مأكولات / مشروبات). */
  initialTab?: Tab;
}

const TAB_LABEL: Record<Tab, string> = { all: 'الكل', food: 'المأكولات', drinks: 'المشروبات' };

/** كتالوج + سلة POS مشتركة تُستخدم في «بيع مباشر» وفي «طلب جلسة جهاز» لتوحيد التصميم. */
export function PosMenu({ inventory, cart, onSetQty, onRemoveItem, currency, footer, footerTop, emptyText, initialTab = 'all' }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const visible = inventory.filter(
    (i) => (tab === 'all' || i.category === tab) && (!q || i.name.toLowerCase().includes(q)),
  );
  const cartItems = inventory.filter((i) => (cart[i.id] ?? 0) > 0);
  const subtotal = cartItems.reduce((s, i) => s + i.price * (cart[i.id] ?? 0), 0);

  return (
    <div className="pos-body">
      <div className="pos-catalog">
        <div className="pos-toolbar">
          <input
            className="pos-search"
            type="search"
            dir="rtl"
            placeholder="🔍 ابحث عن منتج…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="chip-row pos-tabs">
            {(['all', 'food', 'drinks'] as Tab[]).map((t) => (
              <button key={t} className={`chip ${tab === t ? 'chip-on' : ''}`} onClick={() => setTab(t)}>
                {TAB_LABEL[t]}
              </button>
            ))}
          </div>
        </div>

        {inventory.length === 0 ? (
          <p className="device-hint">{emptyText ?? 'لا توجد منتجات في المخزون.'}</p>
        ) : visible.length === 0 ? (
          <p className="device-hint">لا توجد نتائج مطابقة للبحث.</p>
        ) : (
          <div className="pos-grid">
            {visible.map((item) => {
              const qty = cart[item.id] ?? 0;
              const out = item.stock <= 0;
              const disabled = out || qty >= item.stock;
              return (
                <button
                  key={item.id}
                  className={`pos-tile ${qty > 0 ? 'picked' : ''} ${disabled ? 'out' : ''}`}
                  onClick={() => onSetQty(item.id, 1)}
                  disabled={disabled}
                >
                  {qty > 0 && <span className="pos-tile-qty">{qty}</span>}
                  <span className="pos-tile-name">{item.name}</span>
                  <span className="pos-tile-price">{money(item.price, currency)}</span>
                  <span className={`pos-tile-stock ${out ? 'low' : ''}`}>
                    {out ? 'غير متوفر' : `متوفر ${item.stock}`}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <aside className="pos-cart">
        <div className="pos-cart-head">
          <strong>🧺 السلة</strong>
          <span className="pos-cart-count">{cartItems.length} صنف</span>
        </div>

        <div className="pos-cart-list">
          {cartItems.length === 0 ? (
            <p className="device-hint">السلة فارغة — اضغط على أي منتج لإضافته.</p>
          ) : (
            cartItems.map((item) => (
              <div key={item.id} className="pos-line">
                <div className="pos-line-top">
                  <span className="pos-line-name">{item.name}</span>
                  <span className="pos-line-price">{money(item.price, currency)} / وحدة</span>
                </div>
                <div className="pos-line-bot">
                  <div className="pos-line-qty">
                    <button onClick={() => onSetQty(item.id, -1)}>−</button>
                    <span>{cart[item.id]}</span>
                    <button onClick={() => onSetQty(item.id, 1)}>+</button>
                  </div>
                  <span className="pos-line-total">
                    {money(item.price * (cart[item.id] ?? 0), currency)}
                  </span>
                  <button
                    className="pos-line-remove"
                    title="إزالة من السلة"
                    onClick={() => onRemoveItem(item.id)}
                  >
                    🗑
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="pos-cart-foot">
          <div className="pos-subtotal">
            <span>الإجمالي الفرعي</span>
            <strong>{money(subtotal, currency)}</strong>
          </div>
          {footerTop}
          {footer}
        </div>
      </aside>
    </div>
  );
}