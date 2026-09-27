import React, { useState } from 'react';
import { Tv, Play, X } from 'lucide-react';

interface StreamChipProps {
  url?: string;
  title: string;
  editable?: boolean;
  onWatch?: () => void;
  onAssign?: (url: string) => void;
  onClear?: () => void;
}

/**
 * أيقونة تلفاز + LED لحالة البث تُعرض دائماً على كل بطاقة مباراة:
 *  - أحمر نابض: لا يوجد رابط بث مخصص لهذه المباراة.
 *  - أخضر متوهّج: رابط بث مباشر مفعّل ومخصص للمباراة.
 * في وضع التحرير (الإدارة) يفتح النقر فوراً حقل إدخال سريع لحفظ/تعديل الرابط
 * مع زر تشغيل منفصل لمعاينة البث إن كان مفعّلاً. في اللوحة (عرض فقط) يفتح
 * النقر مشغّل الفيديو مباشرة عند وجود بث.
 */
export function StreamChip({ url, title, editable, onWatch, onAssign, onClear }: StreamChipProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(url ?? '');
  const has = !!url && url.trim().length > 0;

  /** الإدارة: فتح حقل الإدخال دائماً (تعديل/إضافة). اللوحة: تشغيل البث عند وجوده. */
  const open = () => {
    if (editable && onAssign) {
      setDraft(url ?? '');
      setEditing(true);
      return;
    }
    if (has) onWatch?.();
  };

  const commit = (raw: string) => {
    onAssign?.(raw.trim());
    setEditing(false);
  };

  return (
    <span className="stream-chip">
      {(editable && has && onWatch) && (
        <button
          type="button"
          className="stream-play"
          onClick={onWatch}
          title="معاينة البث المباشر لهذه المباراة"
        >
          <Play size={12} fill="currentColor" />
        </button>
      )}
      <button
        type="button"
        className={`stream-tv ${has ? 'on' : 'off'}`}
        onClick={open}
        title={!has && editable ? 'إضافة رابط بث لهذه المباراة' : has ? 'فتح البث المباشر لهذه المباراة' : 'لا يوجد بث لهذه المباراة'}
      >
        <Tv size={16} />
        <i className={`stream-led ${has ? 'stream-led-on' : 'stream-led-off'}`} />
      </button>
      {editable && has && onClear && (
        <button type="button" className="stream-clear" title="إزالة رابط البث" onClick={onClear}>
          <X size={13} />
        </button>
      )}
      {editing && onAssign && (
        <span className="stream-edit">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="رابط البث (m3u8 / ts / mp4)"
            onKeyDown={(e) => { if (e.key === 'Enter') commit(draft); if (e.key === 'Escape') setEditing(false); }}
          />
          <button className="btn tiny primary" onClick={() => commit(draft)}>حفظ</button>
          <button className="btn tiny ghost" onClick={() => setEditing(false)}>إلغاء</button>
        </span>
      )}
      <span className="sr-only">{title}</span>
    </span>
  );
}