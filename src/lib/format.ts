export const CURRENCY = 'جنيه';
const LOCALE = 'ar-EG-u-nu-latn';

export function money(n: number, currency: string = CURRENCY): string {
  const v = Math.round((n + Number.EPSILON) * 100) / 100;
  const s = v.toFixed(v % 1 === 0 ? 0 : 2);
  return `${s} ${currency}`;
}

/**
 * مبلغ موقَّع: يعرض '+' قبل القيم الموجبة و '−' قبل السالبة لإبراز صافي التدفق النقدي،
 * وبدون علامة عند الصفر.
 */
export function signedMoney(n: number, currency: string = CURRENCY): string {
  if (n > 0) return `+ ${money(n, currency)}`;
  if (n < 0) return `− ${money(Math.abs(n), currency)}`;
  return money(n, currency);
}

export function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function fmtMinutes(mins: number): string {
  if (mins < 60) return `${Math.round(mins)} دقيقة`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m ? `${h} ساعة و${m} د` : `${h} ساعة`;
}

export function fmtDateTime(ms: number): string {
  return new Date(ms).toLocaleString(LOCALE, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
}

/** تاريخ ووقت كامل بالثواني — لمواعيد فتح وإغلاق الورديات. */
export function fmtDateTimeFull(ms: number): string {
  return new Date(ms).toLocaleString(LOCALE, {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
