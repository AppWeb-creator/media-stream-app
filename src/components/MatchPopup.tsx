import React, { lazy, Suspense, useEffect, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import type { MatchEntry } from '../lib/types';
import { fmtClock } from '../lib/format';
import { broadcastChannel, getMutedMatchIds, setMatchMuted } from '../lib/matches';
import { useStore } from '../store/cafe';
import { StreamChip } from './StreamChip';

const VideoPlayerModal = lazy(() => import('./VideoPlayerModal').then((m) => ({ default: m.VideoPlayerModal })));

interface Props {
  matches: MatchEntry[];
  onClose: () => void;
}

/** لمبة فريق داخل النافذة: شعار الصورة إن وُجد وإلا أول حرف من الاسم. */
function PopupTeam({ name, logo }: { name: string; logo?: string }) {
  if (logo) {
    return (
      <span className="mp-team-crest">
        <img src={logo} alt={name} />
      </span>
    );
  }
  return <span className="mp-team-crest">{name.trim().slice(0, 1)}</span>;
}

/**
 * نافذة منبثقة موحّدة لمباراة قادمة (تلقائية أو يدوية): شعارا الفريقين، الموعد والتاريخ،
 * شارة البطولة، قناة البث، وصورة خلفية مخصصة إن وُجدت. تُفتح بالنقر على الجرس أو تلقائياً.
 */
export function MatchPopup({ matches, onClose }: Props) {
  const { user } = useStore();
  const [index, setIndex] = useState(0);
  const [mutedIds, setMutedIds] = useState<Set<string>>(() => getMutedMatchIds());
  const [watching, setWatching] = useState<{ title: string; url: string } | null>(null);
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    if (index >= matches.length) setIndex(0);
  }, [index, matches.length]);

  if (matches.length === 0) {
    return (
      <div className="overlay" onClick={onClose}>
        <div className="match-popup" onClick={(e) => e.stopPropagation()}>
          <button className="x mp-close" onClick={onClose}>×</button>
          <div className="mp-empty">
            <span className="mp-empty-ico">🔔</span>
            <strong>لا توجد مباريات قادمة حالياً</strong>
            <p>يمكن للمدير إضافة المباريات يدوياً من لوحة الإدارة.</p>
            <button className="btn primary" onClick={onClose}>إغلاق</button>
          </div>
        </div>
      </div>
    );
  }

  const m = matches[Math.min(index, matches.length - 1)];
  const day = new Date(m.startTime).toLocaleDateString('ar-EG', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const channel = broadcastChannel(m);
  const leagueInitial = m.league.trim().slice(0, 1);
  const multi = matches.length > 1;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="match-popup" onClick={(e) => e.stopPropagation()}>
        <button className="x mp-close" onClick={onClose}>×</button>

        <div
          className={`mp-media ${m.bannerImage ? 'with-image' : ''}`}
          style={m.bannerImage ? { backgroundImage: `url(${m.bannerImage})` } : undefined}
        >
          <div className="mp-inner">
            <span className="mp-league">
              <span className="mp-badge">{m.leagueBadge || leagueInitial}</span>
              {m.league}
            </span>

            <div className="mp-teams">
              <div className="mp-side">
                <PopupTeam name={m.homeTeam} logo={m.homeLogo} />
                <strong className="mp-team">{m.homeTeam}</strong>
              </div>
              <span className="mp-vs">⚽</span>
              <div className="mp-side">
                <PopupTeam name={m.awayTeam} logo={m.awayLogo} />
                <strong className="mp-team">{m.awayTeam}</strong>
              </div>
            </div>

            <strong className="mp-time">🕐 {fmtClock(m.startTime)}</strong>
            <span className="mp-date">{day}</span>
            <span className={`mp-channel ${m.domestic ? 'domestic' : 'global'}`}>📺 {channel}</span>
            {isAdmin && (
              <StreamChip
                url={m.streamUrl}
                title={`${m.homeTeam} ضد ${m.awayTeam}`}
                onWatch={() => m.streamUrl && setWatching({ title: `${m.homeTeam} ضد ${m.awayTeam}`, url: m.streamUrl })}
              />
            )}
          </div>
        </div>

        {multi && (
          <>
            <button className="mp-arrow prev" onClick={() => setIndex((index - 1 + matches.length) % matches.length)}>‹</button>
            <button className="mp-arrow next" onClick={() => setIndex((index + 1) % matches.length)}>›</button>
          </>
        )}

        {multi && (
          <div className="mb-dots mp-dots">
            {matches.map((mm, i) => (
              <button key={mm.id} className={`mb-dot ${i === index ? 'on' : ''}`} onClick={() => setIndex(i)} aria-label={`مباراة ${i + 1}`} />
            ))}
          </div>
        )}

        <div className="match-popup-footer">
          <span className="mp-count">{index + 1} / {matches.length}</span>
          <button
            type="button"
            className={`mp-mute ${mutedIds.has(m.id) ? 'on' : ''}`}
            title={mutedIds.has(m.id) ? 'إلغاء كتم صوت هذه المباراة' : 'كتم صوت هذه المباراة'}
            aria-pressed={mutedIds.has(m.id)}
            onClick={() => {
              setMatchMuted(m.id, !mutedIds.has(m.id));
              setMutedIds(new Set(getMutedMatchIds()));
            }}
          >
            {mutedIds.has(m.id) ? <VolumeX size={16} /> : <Volume2 size={16} />}
            <span>{mutedIds.has(m.id) ? 'مكتومة' : 'تنبيه نشط'}</span>
          </button>
          <button className="btn ghost" onClick={onClose}>إغلاق</button>
        </div>
      </div>

      {watching && (
        <Suspense fallback={null}>
          <VideoPlayerModal title={watching.title} url={watching.url} onClose={() => setWatching(null)} />
        </Suspense>
      )}
    </div>
  );
}