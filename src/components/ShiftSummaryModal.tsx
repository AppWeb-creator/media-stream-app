import React, { useEffect } from 'react';
import { useStore } from '../store/cafe';
import type { InventoryItem, ItemCategory, Sale, Shift, Withdrawal } from '../lib/types';
import { classifyItem, orderLineNet } from '../lib/types';
import { money, fmtDuration, fmtDateTimeFull } from '../lib/format';

export interface ShiftSummaryStats {
  sessionCount: number;
  sessionsRevenue: number;
  foodRevenue: number;
  foodCount: number;
  drinkRevenue: number;
  drinkCount: number;
  fawryRevenue: number;
  printerRevenue: number;
  matchViewingRevenue: number;
  miscRevenue: number;
  withdrawalsTotal: number;
  depositsTotal: number;
  netRevenue: number;
  grandTotal: number;
  cancelledCount: number;
  foodProfit: number;
  drinksProfit: number;
  durationMs: number;
  firstSessionAt: number | null;
  lastSessionAt: number | null;
}

function sum(list: number[]): number {
  return list.reduce((a, b) => a + b, 0);
}

function costOf(itemId: string, inventory: InventoryItem[]): number {
  const it = inventory.find((i) => i.id === itemId);
  return it && it.cost > 0 ? it.cost : 0;
}

/** تجميع ديناميكي دقيق لتقرير الوردية الكامل من السجلات المنزّلة (مبيعات + حركات خزنة + مخزون). */
export function shiftSummary(shift: Shift, sales: Sale[], withdrawals: Withdrawal[], inventory: InventoryItem[], now: number): ShiftSummaryStats {
  const shiftSales = sales.filter((s) => s.shiftId === shift.id);
  const shiftMoves = withdrawals.filter((w) => w.shiftId === shift.id);

  const sessionSales = shiftSales.filter((s) => s.type === 'session');
  // إيراد أجهزة اللعب الصافي = تكلفة الوقت الفعلية فقط (بالدقيقة أو بالجيم) — مع الاستبعاد الصريح
  // لطلبات المأكولات والمشروبات المرفقة بالجلسة ورسوم الخدمة، حتى لا يُحتسب الطلب مرتين.
  const sessionsRevenue = sum(sessionSales.map((s) => (s.timeCost ?? 0) + (s.gamesCost ?? 0)));
  const sessionCount = sessionSales.length;

  let foodRevenue = 0;
  let foodCount = 0;
  let foodProfit = 0;
  let drinkRevenue = 0;
  let drinkCount = 0;
  let drinksProfit = 0;
  // المأكولات والمشروبات تُجمَّع من كل الفواتير بلا استثناء: بيع الكاشير المباشر + الطلبات
  // المضافة داخل الجلسات — كل طلب يُحتسب في فئته مرة واحدة فقط.
  for (const s of shiftSales) {
    let saleFood = 0;
    let saleDrinks = 0;
    for (const o of s.orders ?? []) {
      const cat: ItemCategory = o.category ?? classifyItem(o.name);
      const net = orderLineNet(o);
      const totalCost = costOf(o.itemId, inventory) * o.qty;
      if (cat === 'food') {
        saleFood += net;
        foodCount += o.qty;
        foodProfit += net - totalCost;
      } else {
        saleDrinks += net;
        drinkCount += o.qty;
        drinksProfit += net - totalCost;
      }
    }
    // بيع الكاشير المباشر: خصم الفئة (مأكولات/مشروبات) يُطرح من صافي إيراد فئته على مستوى الفاتورة.
    if (s.type === 'store') {
      saleFood = Math.max(0, saleFood - (s.discountByCategory?.food ?? 0));
      saleDrinks = Math.max(0, saleDrinks - (s.discountByCategory?.drinks ?? 0));
    }
    foodRevenue += saleFood;
    drinkRevenue += saleDrinks;
  }

  const fawryRevenue = sum(shiftSales.filter((s) => s.type === 'fawry').map((s) => s.total ?? 0));
  const printerRevenue = sum(shiftSales.filter((s) => s.type === 'printer').map((s) => s.total ?? 0));
  const matchViewingRevenue = sum(shiftSales.filter((s) => s.type === 'matchViewing').map((s) => s.total ?? 0));
  const miscRevenue = sum(shiftSales.filter((s) => s.type === 'misc').map((s) => s.total ?? 0));

  const withdrawalsTotal = sum(shiftMoves.filter((w) => (w.type ?? 'withdraw') === 'withdraw').map((w) => w.amount ?? 0));
  const depositsTotal = sum(shiftMoves.filter((w) => (w.type ?? 'deposit') === 'deposit' && (!w.activateAt || w.activateAt <= now)).map((w) => w.amount ?? 0));

  // الإيراد الكلي = صافي وقت الأجهزة + المأكولات + المشروبات + فوري + طابعة + مباريات +
  // إيراد آخر + الإضافات − السحوبات — كل عنصر يُحتسب مرة واحدة بلا ازدواج.
  const netRevenue = sessionsRevenue + foodRevenue + drinkRevenue + fawryRevenue + printerRevenue + matchViewingRevenue + miscRevenue + depositsTotal - withdrawalsTotal;
  const grandTotal = netRevenue + (shift.openingFloat ?? 0);

  const durationMs = shift.endedAt ? Math.max(0, shift.endedAt - shift.startedAt) : Math.max(0, now - shift.startedAt);

  const startTimes = sessionSales.map((s) => s.startedAt ?? s.at).filter((t): t is number => Number.isFinite(t));

  return {
    sessionCount,
    sessionsRevenue,
    foodRevenue,
    foodCount,
    drinkRevenue,
    drinkCount,
    fawryRevenue,
    printerRevenue,
    matchViewingRevenue,
    miscRevenue,
    withdrawalsTotal,
    depositsTotal,
    netRevenue,
    grandTotal,
    cancelledCount: shift.cancelledCount ?? 0,
    foodProfit,
    drinksProfit,
    durationMs,
    firstSessionAt: startTimes.length ? Math.min(...startTimes) : null,
    lastSessionAt: startTimes.length ? Math.max(...startTimes) : null,
  };
}

/**
 * نافذة التقرير الشامل للوردية — تعرض 23 بنداً محسوباً ديناميكياً من سجلات الوردية المباشرة
 * (المبيعات وحركات الخزنة والمخزون)، وتُفتح من إشعار «تقرير الوردية» في جرّس إشعارات الورديات.
 */
export function ShiftSummaryModal({ shift, onClose }: { shift: Shift; onClose: () => void }) {
  const { sales, withdrawals, inventory, config } = useStore();

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const now = Date.now();
  const stats = shiftSummary(shift, sales, withdrawals, inventory, now);
  const currency = config.currency;
  const open = shift.status === 'open' || shift.endedAt == null;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal modal-wide ss-wrap" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>📋 تقرير الوردية الكامل</h3>
          <button className="x" onClick={onClose}>×</button>
        </div>

        <div className="sd-hero">
          <div className="sd-hero-main">
            <span className="sd-id" title={shift.id}>{shift.id}</span>
            <div className="sd-hero-title">
              <strong>{shift.staff}</strong>
              <span className={`pill ${shift.role === 'admin' ? 'role-admin' : 'role-staff'}`}>
                {shift.role === 'admin' ? 'مدير' : 'موظف'}
              </span>
              <span className={`sd-pill ${open ? 'open' : 'closed'}`}>
                {open ? '● وردية مفتوحة' : '● وردية مغلقة'}
              </span>
            </div>
          </div>
          <div className="sd-times">
            <div><span>بداية الوردية</span><strong>{fmtDateTimeFull(shift.startedAt)}</strong></div>
            <div><span>نهاية الوردية</span><strong>{shift.endedAt ? fmtDateTimeFull(shift.endedAt) : '— مفتوحة'}</strong></div>
            <div><span>مدة الوردية</span><strong>{fmtDuration(stats.durationMs)}</strong></div>
          </div>
        </div>

        <p className="sd-sec-title">المبالغ والإيرادات</p>
        <div className="sd-grid">
          <div className="sd-card hero"><span>1 · النقدية الافتتاحية</span><strong>{money(shift.openingFloat ?? 0, currency)}</strong></div>
          <div className="sd-card"><span>2 · مبالغ الجلسات (أجهزة فقط)</span><strong>{money(stats.sessionsRevenue, currency)}</strong></div>
          <div className="sd-card"><span>3 · عدد الجلسات المسجلة</span><strong>{stats.sessionCount}</strong></div>
          <div className="sd-card"><span>4 · إيراد المأكولات</span><strong>{money(stats.foodRevenue, currency)}</strong></div>
          <div className="sd-card"><span>5 · عدد المأكولات المباعة</span><strong>{stats.foodCount}</strong></div>
          <div className="sd-card"><span>6 · إيراد المشروبات</span><strong>{money(stats.drinkRevenue, currency)}</strong></div>
          <div className="sd-card"><span>7 · عدد المشروبات المباعة</span><strong>{stats.drinkCount}</strong></div>
          <div className="sd-card"><span>8 · إيراد فوري</span><strong>{money(stats.fawryRevenue, currency)}</strong></div>
          <div className="sd-card"><span>9 · إيراد الطابعة</span><strong>{money(stats.printerRevenue, currency)}</strong></div>
          <div className="sd-card"><span>10 · إيراد مشاهدة المباريات</span><strong>{money(stats.matchViewingRevenue, currency)}</strong></div>
          {stats.miscRevenue > 0 && <div className="sd-card"><span>إيراد آخر</span><strong>{money(stats.miscRevenue, currency)}</strong></div>}
          <div className="sd-card danger"><span>11 · السحوبات / المصروفات</span><strong>− {money(stats.withdrawalsTotal, currency)}</strong></div>
          <div className="sd-card accent"><span>12 · الإضافات النقدية</span><strong>+ {money(stats.depositsTotal, currency)}</strong></div>
          <div className="sd-card hero"><span>13 · الإيراد الكلي للوردية</span><strong>{money(stats.netRevenue, currency)}</strong></div>
          <div className="sd-card hero"><span>14 · الإجمالي في الخزنة (مع الافتتاحي)</span><strong>{money(stats.grandTotal, currency)}</strong></div>
        </div>

        <p className="sd-sec-title">الإحصائيات</p>
        <div className="sd-grid">
          <div className="sd-card"><span>15 · جلسات ملغاة دون تحصيل</span><strong>{stats.cancelledCount}</strong></div>
          <div className="sd-card"><span>16 · صافي ربح المأكولات</span><strong>{money(stats.foodProfit, currency)}</strong></div>
          <div className="sd-card"><span>17 · صافي ربح المشروبات</span><strong>{money(stats.drinksProfit, currency)}</strong></div>
          <div className="sd-card"><span>18 · مدة الوردية بالظبط</span><strong>{fmtDuration(stats.durationMs)}</strong></div>
          <div className="sd-card"><span>19 · وقت أول جلسة</span><strong>{stats.firstSessionAt ? fmtDateTimeFull(stats.firstSessionAt) : '—'}</strong></div>
          <div className="sd-card"><span>20 · وقت آخر جلسة</span><strong>{stats.lastSessionAt ? fmtDateTimeFull(stats.lastSessionAt) : '—'}</strong></div>
        </div>

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>إغلاق</button>
        </div>
      </div>
    </div>
  );
}