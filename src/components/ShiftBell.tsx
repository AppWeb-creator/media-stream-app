import React, { useEffect, useState } from 'react';
import { Bell, Trash2 } from 'lucide-react';
import { useStore } from '../store/cafe';
import { fmtDateTime } from '../lib/format';
import { ShiftSummaryModal } from './ShiftSummaryModal';
import type { Shift } from '../lib/types';

const DISMISSED_KEY = 'verdent_shift_notif_dismissed_v1';

type NotifKind = 'start' | 'end';

interface ShiftNotif {
  id: string;
  kind: NotifKind;
  shiftId: string;
  staff: string;
  at: number;
}

function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function kindLabel(k: NotifKind): string {
  return k === 'start' ? 'فُتحت وردية' : 'انتهت وردية';
}

function kindIcon(k: NotifKind): string {
  return k === 'start' ? '🚀' : '🏁';
}

/**
 * جرس إشعارات الورديات — خاص بالمدير فقط، يعرض إشعاراً واحداً فقط لكل وردية: إشعار فتح الوردية
 * أو إشعار «انتهاء الوردية». لا تُنشأ إشعارات مكررة (لا إشعار «تقرير الوردية» منفصل مع «انتهاء الوردية»).
 * النقر على إشعار انتهاء الوردية يفتح تقرير الوردية الشامل (23 حقل) مباشرة، والضغط على زر الحذف (X)
 * يُؤرشف التقرير الكامل في «تقارير الورديات» بلوحة الإدارة ويُزيل الإشعار نهائياً من الجرس.
 */
export function ShiftBell() {
  const { user, shifts, openShifts, saveShiftReport } = useStore();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissed());
  const [view, setView] = useState<Shift | null>(null);

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open]);

  if (user?.role !== 'admin') return null;

  const items: ShiftNotif[] = [];
  for (const os of openShifts) {
    items.push({ id: `start_${os.id}`, kind: 'start', shiftId: os.id, staff: os.staff, at: os.startedAt });
  }
  for (const s of shifts) {
    if (s.status !== 'closed') continue;
    const endAt = s.endedAt ?? s.startedAt;
    // إشعار واحد فقط لكل وردية مغلقة: «انتهاء الوردية» — بلا إشعار «تقرير الوردية» المكرر.
    items.push({ id: `end_${s.id}`, kind: 'end', shiftId: s.id, staff: s.staff, at: endAt });
  }
  const visible = items.filter((n) => !dismissed.has(n.id)).sort((a, b) => b.at - a.at);

  const persist = (next: Set<string>) => {
    setDismissed(next);
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]));
    } catch {
      /* تجاهل */
    }
  };

  const dismiss = (n: ShiftNotif) => {
    const next = new Set(dismissed);
    next.add(n.id);
    persist(next);
    // رفض إشعار «انتهاء الوردية» يُؤرشف تقرير الوردية الكامل في «تقارير الورديات» بلوحة الإدارة
    // (upsert برقم الوردية) ــ مع بقاء الرفض محفوظاً محلياً فلا يعود الإشعار.
    if (n.kind !== 'start') {
      const s = shifts.find((x) => x.id === n.shiftId);
      if (s) void saveShiftReport(s);
    }
  };

  const openShiftItem = (n: ShiftNotif) => {
    if (n.kind === 'start') return;
    const s = shifts.find((x) => x.id === n.shiftId);
    if (s) setView(s);
  };

  return (
    <>
      <button
        type="button"
        className="match-bell shift-bell-btn"
        onClick={() => setOpen(true)}
        aria-label="إشعارات الورديات"
      >
        <span className="match-bell-ico shift-bell-ico">
          <Bell size={22} strokeWidth={2.2} aria-hidden="true" />
        </span>
        {visible.length > 0 && <span className="match-bell-badge">{visible.length}</span>}
      </button>

      {open && (
        <div className="overlay" onClick={() => setOpen(false)}>
          <div className="match-popup shift-popup" onClick={(e) => e.stopPropagation()}>
            <button className="x mp-close" onClick={() => setOpen(false)} aria-label="إغلاق">×</button>

            <div className="shift-popup-head">
              <span className="shift-popup-ico">🔔</span>
              <strong>إشعارات الورديات</strong>
              {visible.length > 0 && <span className="shift-popup-count">{visible.length}</span>}
            </div>

            <div className="shift-popup-body">
              {visible.length === 0 && (
                <div className="mp-empty">
                  <span className="mp-empty-ico">🔔</span>
                  <strong>لا توجد إشعارات للورديات حالياً</strong>
                </div>
              )}
              {visible.map((n) => (
                <div
                  key={n.id}
                  className={`notif-card notif-card-${n.kind} ${n.kind !== 'start' ? 'clickable' : ''}`}
                  onClick={() => openShiftItem(n)}
                >
                  <button
                    className="notif-card-delete"
                    onClick={(e) => { e.stopPropagation(); dismiss(n); }}
                    title="حذف/تجاهل هذا الإشعار نهائياً"
                    aria-label="حذف الإشعار"
                  >
                    <Trash2 size={15} strokeWidth={2.2} aria-hidden="true" />
                  </button>
                  <span className="notif-card-ico">{kindIcon(n.kind)}</span>
                  <div className="notif-card-body">
                    <span className="notif-card-title">{kindLabel(n.kind)}</span>
                    <span className="notif-card-sub">{n.staff} · {fmtDateTime(n.at)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {view && <ShiftSummaryModal shift={view} onClose={() => setView(null)} />}
    </>
  );
}