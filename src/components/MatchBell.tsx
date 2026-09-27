import React, { useEffect, useRef, useState } from 'react';
import type { MatchEntry } from '../lib/types';
import { MatchPopup } from './MatchPopup';

const SHOWN_KEY = 'verdent_match_popup_shown_v1';

function loadShown(): Set<string> {
  try {
    const raw = sessionStorage.getItem(SHOWN_KEY);
    return new Set(raw ? raw.split(',') : []);
  } catch {
    return new Set();
  }
}

function persistShown(ids: string[]): void {
  try {
    sessionStorage.setItem(SHOWN_KEY, ids.join(','));
  } catch {
    /* تجاهل */
  }
}

/** كرة قدم متحركة (SVG ترسم كرة بخيوطها) — تُستخدم كأيقونة جرس المباريات بدل الجرس العادي. */
function FootballIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" className="football-ico" aria-hidden="true">
      <circle cx="12" cy="12" r="9.2" />
      <path d="M7.7 5.4l4.3 1.6 4.3-1.6 1 4.4 3.2 3.1L16.4 16l-.7 4.5L12 18.6 8.3 20.5 7.6 16 4.5 12.9 7.7 9.8z" fill="rgba(255,255,255,0.07)" />
      <path d="M9.2 6.2l2.8 1 2.8-1M8.5 9.6l1.7 2.5M15.5 9.6l-1.7 2.5M12 12.1l3.6 2.6M12 12.1L8.4 14.7M12 12.1L12.6 7.9" />
    </svg>
  );
}

/**
 * جرس تنبيه المباريات أسفل شعار/اسم المحل مباشرة — أيقونة نابضة من lucide-react تُعرض دائماً،
 * ومعها شارة عدد المباريات القادمة عند وجود مباريات نشطة. يفتح نافذة المباريات بالنقر،
 * ويفتحها تلقائياً مرة واحدة لكل مباراة جديدة في الجلسة.
 */
export function MatchBell({ matches }: { matches: MatchEntry[] }) {
  const [open, setOpen] = useState(false);
  const shown = useRef<Set<string>>(loadShown());

  useEffect(() => {
    if (matches.length === 0) return;
    const unseenIds = matches.filter((m) => !shown.current.has(m.id)).map((m) => m.id);
    if (unseenIds.length === 0) return;
    unseenIds.forEach((id) => shown.current.add(id));
    persistShown([...shown.current]);
    const t = window.setTimeout(() => setOpen(true), 1200);
    return () => window.clearTimeout(t);
  }, [matches]);

  return (
    <>
      <button type="button" className="match-bell" onClick={() => setOpen(true)} aria-label="مباريات قادمة">
        <span className="match-bell-ico">
          <FootballIcon />
        </span>
        {matches.length > 0 && <span className="match-bell-badge">{matches.length}</span>}
      </button>
      {open && <MatchPopup matches={matches} onClose={() => setOpen(false)} />}
    </>
  );
}