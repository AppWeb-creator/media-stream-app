import React from 'react';
import { useTick } from '../store/cafe';

const WEEKDAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

const pad = (n: number): string => String(n).padStart(2, '0');

/** ساعة رقمية حية تُحدَّث كل ثانية — تُعرض أسفل شبكة أجهزة البلايستيشن مباشرة. */
export function LiveClock() {
  const now = useTick(1000);
  const d = new Date(now);
  const h24 = d.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const period = h24 >= 12 ? 'م' : 'ص';

  return (
    <div className="live-clock">
      <div className="live-clock-glyph">🕐</div>
      <div className="live-clock-main">
        <div className="live-clock-time">
          <span>{pad(h12)}</span>
          <span className="live-clock-colon">:</span>
          <span>{pad(d.getMinutes())}</span>
          <span className="live-clock-colon">:</span>
          <span>{pad(d.getSeconds())}</span>
          <span className="live-clock-period">{period}</span>
        </div>
        <div className="live-clock-date">
          {WEEKDAYS[d.getDay()]} · {d.getDate()} {MONTHS[d.getMonth()]} {d.getFullYear()}
        </div>
      </div>
    </div>
  );
}
