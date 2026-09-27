import type { Sale, Config, OrderItem } from './types';
import { orderLineNet } from './types';
import { fmtDateTime, money } from './format';
import logoUrl from '../assets/logo.png';

/**
 * يفتح نافذة فاتورة مصغرة (80mm) ويطلق نافذة طباعة المتصفح (window.print).
 * يُستخدم لإيصالات الفواتير (البيع المباشر/الجلسات) وطلبات الجلسات معاً.
 */
function openPrintWindow(config: Config, rows: string[], total: string): void {
  const w = window.open('', '_blank', 'width=420,height=640');
  if (!w) return;
  w.document.write(`<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>فاتورة</title>
<style>
  @page { size: 80mm auto; margin: 3mm; }
  * {
    font-family: 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif;
    font-size: 12px;
    color: #000;
  }
  body { width: 72mm; margin: 0 auto; }
  .center { text-align: center; }
  .title { font-size: 17px; font-weight: 800; letter-spacing: 0.5px; }
  .row { display: flex; justify-content: space-between; margin: 2px 0; }
  .total { font-size: 15px; font-weight: 800; }
  hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
  .thanks { text-align: center; margin-top: 10px; font-weight: 600; }
  .logo { display: block; margin: 0 auto 6px; width: 40mm; height: auto; }
</style>
</head>
<body>
  <img class="logo" src="${config.logoUrl || logoUrl}" alt="" />
  <div class="center title">${config.siteName || 'بلايستيشن'}</div>
  <div class="center">نظام إدارة بلايستيشن</div>
  <hr />
  ${rows.join('\n  ')}
  <div class="row total"><span>الإجمالي المستحق</span><span>${total}</span></div>
  <div class="thanks">شكراً لكم — نتمنى لكم وقتاً ممتعاً!</div>
</body>
</html>`);
  w.document.close();
  w.focus();
  setTimeout(() => {
    w.print();
  }, 250);
}

/**
 * Renders an Arabic RTL thermal-printer friendly receipt (80mm) in a popup
 * window and triggers the browser print dialog.
 */
export function printReceipt(sale: Sale, config: Config): void {
  const cur = config.currency;
  const rows: string[] = [];

  const titleMap: Record<Sale['type'], string> = {
    session: 'جلسة بلايستيشن',
    store: 'بيع مباشر',
    fawry: 'عملية ماكنة فوري',
    printer: 'خدمة الطابعة',
    matchViewing: 'مشاهدة مباريات',
    misc: 'إيراد آخر',
  };
  rows.push(`<div class="center"><strong>${titleMap[sale.type]}</strong></div>`);
  if (sale.type === 'session' || sale.type === 'store') {
    rows.push(kv('الجهاز', sale.deviceName ?? 'الكاشير'));
  }
  if (sale.source || sale.note) {
    rows.push(kv('البيان', [sale.source, sale.note].filter(Boolean).join(' — ')));
  }
  rows.push(kv('التاريخ', fmtDateTime(sale.at)));
  rows.push(kv('الموظف', sale.staff));
  rows.push('<hr />');

  if (sale.type === 'session' && sale.minutes > 0 && sale.rateType !== 'game') {
    rows.push(kv(`وقت اللعب (${Math.floor(sale.minutes)} دقيقة)`, money(sale.timeCost, cur)));
  }
  if (sale.gamesCount > 0) {
    rows.push(kv(`عدد الجيمات (${sale.gamesCount})`, money(sale.gamesCost, cur)));
  }
  if (sale.controllerCost && sale.controllerCost > 0) {
    rows.push(kv('أذرع إضافية', money(sale.controllerCost, cur)));
  }
  for (const it of sale.orders) {
    rows.push(kv(`${it.name} ×${it.qty}`, money(orderLineNet(it), cur)));
  }
  if (sale.type === 'session' || sale.type === 'store') {
    rows.push('<hr />');
    rows.push(kv('الإجمالي الفرعي', money(sale.subtotal, cur)));
    if (sale.serviceFee > 0) rows.push(kv('رسوم خدمة', `+${money(sale.serviceFee, cur)}`));
    if (sale.discount > 0) {
      rows.push(kv('الخصم', `-${money(sale.discount, cur)}`));
      const foodDisc = sale.discountByCategory?.food ?? 0;
      const drinksDisc = sale.discountByCategory?.drinks ?? 0;
      if (sale.type === 'store' && foodDisc > 0) rows.push(kv('خصم المأكولات', `-${money(foodDisc, cur)}`));
      if (sale.type === 'store' && drinksDisc > 0) rows.push(kv('خصم المشروبات', `-${money(drinksDisc, cur)}`));
    }
  }
  rows.push('<hr />');

  openPrintWindow(config, rows, money(sale.total, cur));
}

/**
 * إيصال «طلب إضافة للجلسة» — يُطبع فور حفظ الطلب داخل الجلسة عندما يكون خيار
 * «طباعة الفاتورة» مفعلاً؛ يعرض الأصناف المضافـة وخصومات فئتي المأكولات والمشروبات.
 */
export function printOrderTicket(
  order: {
    deviceName?: string;
    staff: string;
    at: number;
    items: OrderItem[];
    subtotal: number;
    discountByCategory?: { food?: number; drinks?: number };
    total: number;
  },
  config: Config,
): void {
  const cur = config.currency;
  const rows: string[] = [];

  rows.push('<div class="center"><strong>طلب جلسة بلايستيشن</strong></div>');
  if (order.deviceName) rows.push(kv('الجهاز', order.deviceName));
  rows.push(kv('التاريخ', fmtDateTime(order.at)));
  rows.push(kv('الموظف', order.staff));
  rows.push('<hr />');

  for (const it of order.items) {
    rows.push(kv(`${it.name} ×${it.qty}`, money(orderLineNet(it), cur)));
  }
  rows.push('<hr />');
  rows.push(kv('الإجمالي الفرعي', money(order.subtotal, cur)));
  const foodDisc = order.discountByCategory?.food ?? 0;
  const drinksDisc = order.discountByCategory?.drinks ?? 0;
  if (foodDisc > 0) rows.push(kv('خصم المأكولات', `-${money(foodDisc, cur)}`));
  if (drinksDisc > 0) rows.push(kv('خصم المشروبات', `-${money(drinksDisc, cur)}`));
  rows.push('<hr />');

  openPrintWindow(config, rows, money(order.total, cur));
}

function kv(k: string, v: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<div class="row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`;
}
