import React, { useMemo } from 'react';
import { useStore, useTick } from '../store/cafe';
import { rankGroup } from '../lib/tournament';
import { drawRevealSlots, revealProgressAt, revealPlayerIndex, revealMatchIndex } from '../lib/reveal';
import type { Tournament, TournamentMatch } from '../lib/types';

const STAGE_LABEL: Record<Tournament['stage'], string> = {
  pending: 'في انتظار القرعة',
  groups: 'دور المجموعات',
  playoff: 'مرحلة الإقصاء',
  done: 'منتهية',
};

const FORMAT_LABEL: Record<Tournament['format'], string> = {
  knockout: 'خروج المغلوب المباشر',
  groups: 'نظام المجموعات',
};

/** اختيار الدورة الأجدر للعرض على اللوحة: قرعة نشطة أولاً، ثم آخر دورة حيّة/منتهية، ثم آخر دورة منشأة. */
function pickDisplay(list: Tournament[], now: number): Tournament | null {
  const revealing = list.find((t) => t.reveal && revealProgressAt(t.reveal, now).active);
  if (revealing) return revealing;
  const sorted = [...list].sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
  return sorted.find((t) => t.stage !== 'pending') ?? sorted[0] ?? null;
}

/** عرض لحظي للبطولة على لوحة التشغيل الرئيسية — يقرأ tournaments من المتجر (اشتراك Firestore حي)
 *  ويحاكي إيقاع الكشف 2000ms لكل مقعد من مصدر وقت موحّد فيقرعه، تماماً مثل لوحة الإدارة. */
export function TournamentWidget() {
  const { tournaments } = useStore();
  const now = useTick(250);
  const t = useMemo(() => pickDisplay(tournaments, now), [tournaments, now]);
  const progress = useMemo(() => revealProgressAt(t?.reveal ?? null, now), [t, now]);

  const ledClass = !t ? 'led-off'
    : progress.active ? 'led-yellow'
    : t.stage === 'done' ? 'led-red'
    : t.stage === 'pending' ? 'led-off'
    : 'led-green';

  const slotIndex = useMemo(() => {
    if (!t) return new Map<string, number>();
    const map = new Map<string, number>();
    drawRevealSlots(t.bracket, []).forEach((key, i) => map.set(key, i));
    return map;
  }, [t]);
  const pIndex = useMemo(() => revealPlayerIndex(t?.reveal?.playerOrder), [t]);
  const mIndex = useMemo(() => revealMatchIndex(t?.reveal?.matchOrder), [t]);

  const isSlotRevealed = (id: string, side: 'A' | 'B'): boolean => {
    if (!progress.active) return true;
    const idx = slotIndex.get(`${id}:${side}`);
    return idx === undefined ? false : idx < progress.revealed;
  };

  const revealedCount = progress.active ? progress.revealed : Infinity;
  // أثناء كشف شجرة أو قرعة حسم: كل الجداول تبقى ظاهرة كخلفية ثابتة (لا تُخفى الصفوف/المباريات).
  const staticReveal = !!t?.reveal && (t.reveal.kind === 'tie' || t.reveal.kind === 'playoff' || (t.reveal.kind === 'draw' && t.bracket.length > 0 && t.reveal.playerOrder?.length === 0));
  const containersShown = !progress.active || staticReveal || revealedCount >= 1;
  const isPlayerRevealed = (gId: string, player: string): boolean => {
    if (!progress.active || staticReveal) return true;
    const idx = pIndex.get(`${gId}:${player}`);
    return idx === undefined ? false : idx < revealedCount - 1;
  };
  const isMatchSlotRevealed = (gId: string, matchId: string, side: 'A' | 'B'): boolean => {
    if (!progress.active || staticReveal) return true;
    const idx = mIndex.get(`${gId}:${matchId}:${side}`);
    if (idx === undefined) return false;
    return idx < revealedCount - (1 + (t?.reveal?.playerOrder?.length ?? 0));
  };

  if (!t) {
    return (
      <section className="tournament-widget dismissed">
        <div className="tw-head">
          <span className={`tournament-led led-off`} />
          <strong>🏆 البطولة</strong>
          <span className="tw-empty">لا توجد بطولة نشطة بعد — أنشئها من الإدارة.</span>
        </div>
      </section>
    );
  }

  const rounds = t.bracket.length ? [...new Set(t.bracket.map((m) => m.round))].sort((a, b) => a - b) : [];
  const isTieReveal = t.reveal?.kind === 'tie' && progress.active;
  const tie = t.reveal?.tie;

  return (
    <section className={`tournament-widget ${ledClass.replace('led-', 'tw-')}`}>
      <div className="tw-head">
        <span className={`tournament-led ${ledClass}`} title={progress.active ? 'جاري سحب القرعة…' : t.stage === 'done' ? 'الدورة منتهية' : t.stage === 'pending' ? 'بانتظار القرعة' : 'الدورة جارية'} />
        <strong>🏆 {t.name}</strong>
        <span className={`stage-chip ${t.stage === 'done' ? 'stage-chip-done' : t.stage === 'pending' ? 'stage-chip-pending' : 'stage-chip-active'}`}>
          {STAGE_LABEL[t.stage]}
        </span>
        <span className="tw-sub">{FORMAT_LABEL[t.format]} · {t.participants.length} مشترك</span>
        {progress.active && (
          <div className="tw-progress">
            <span className="reveal-progress-label">
              {progress.revealed < 1 ? 'جاري تجهيز القرعة…' : `جاري سحب القرعة… (${Math.min(progress.revealed, progress.total)}/${progress.total})`}
            </span>
          </div>
        )}
      </div>

      {progress.active && (
        <div className="reveal-progress tw-progress">
          <span className="reveal-progress-track">
            <span className="reveal-progress-fill" style={{ width: `${progress.total > 0 ? Math.min(100, (progress.revealed / progress.total) * 100) : 0}%` }} />
          </span>
        </div>
      )}

      {isTieReveal && tie && (
        <div className="tw-tie">
          <strong>🎲 قرعة حسم المتأهلين — {Math.min(progress.revealed, progress.total)}/{progress.total}</strong>
          <div className="tie-order">
            {tie.order.map((p, i) => (
              <span key={p} className={i < progress.revealed ? 'reveal-item' : 'slot-pending'}>
                {i < progress.revealed ? p : '؟'}
              </span>
            ))}
          </div>
        </div>
      )}

      {t.groups.length > 0 && (
        <div className="tw-groups">
          {t.groups.map((g) => {
            const ranking = rankGroup(g);
            return (
              <div key={g.id} className="tournament-group tw-group">
                <h5>{g.name} <span className="device-hint">({g.players.length})</span></h5>
                {containersShown && ranking.length > 0 ? (
                  <div className="tw-xscroll">
                    <table className="tw-rank">
                      <thead>
                        <tr><th>#</th><th>المشترك</th><th>لعب</th><th>فاز</th><th>تعادل</th><th>خسر</th><th>له</th><th>عليه</th><th>فرق</th><th>نقاط</th></tr>
                      </thead>
                      <tbody>
                        {ranking.map((r) => {
                          if (!isPlayerRevealed(g.id, r.player)) return null;
                          return (
                            <tr key={r.player} className={r.rank <= 2 ? 'qualify-row' : undefined}>
                              <td>{r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank}</td>
                              <td>{r.player}</td>
                              <td>{r.played}</td>
                              <td>{r.won}</td>
                              <td>{r.drawn}</td>
                              <td>{r.lost}</td>
                              <td>{r.for}</td>
                              <td>{r.against}</td>
                              <td>{r.diff}</td>
                              <td><strong>{r.points}</strong></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="device-hint">بانتظار القرعة…</p>
                )}
                {g.matches.length > 0 && (
                  <div className="tw-gm">
                    {g.matches.map((m) => {
                      const aR = isMatchSlotRevealed(g.id, m.id, 'A');
                      const bR = isMatchSlotRevealed(g.id, m.id, 'B');
                      if (!aR && !bR) return null;
                      return (
                        <div key={m.id} className="group-match">
                          <div className="gm-side">
                            {aR ? <span className="bracket-name reveal-item">{m.playerA}</span> : <span className="bracket-name slot-pending">؟</span>}
                            <span className="bracket-score tw-score">{m.scoreA ?? '–'}</span>
                          </div>
                          <span className="gm-sep">–</span>
                          <div className="gm-side">
                            <span className="bracket-score tw-score">{m.scoreB ?? '–'}</span>
                            {bR ? <span className="bracket-name reveal-item">{m.playerB}</span> : <span className="bracket-name slot-pending">؟</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {t.bracket.length > 0 && rounds.length > 0 && (
        <div className="tw-bracket">
          {rounds.map((r) => {
            const matches = t.bracket.filter((m) => m.round === r).sort((a, b) => a.bracketIndex - b.bracketIndex);
            return (
              <div key={r} className="bracket-round">
                <strong className="bracket-round-label">{matches[0]?.label ?? ''}</strong>
                <div className="bracket-matches">
                  {matches.map((m) => (
                    <Playout
                      key={`${m.id}:${m.playerA}:${m.playerB}:${m.scoreA}:${m.scoreB}`}
                      m={m}
                      aR={isSlotRevealed(m.id, 'A')}
                      bR={isSlotRevealed(m.id, 'B')}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {t.stage === 'pending' && t.bracket.length === 0 && t.groups.length === 0 && (
        <p className="device-hint tw-empty">الدورة بانتظار سحب القرعة.</p>
      )}
    </section>
  );
}

/** مقعدان (A/B) لمباراة واحدة في شجرة الإقصاء — فقط عرض حي بالفائز بدون أي حقول إدخال. */
function Playout({ m, aR, bR }: { m: TournamentMatch; aR: boolean; bR: boolean }) {
  const wA = !!m.winner && m.winner === m.playerA;
  const wB = !!m.winner && m.winner === m.playerB;
  return (
    <div className={`bracket-match ${m.winner ? 'decided' : ''} ${m.auto ? 'auto' : ''}`}>
      <div className={`bracket-slot ${wA ? 'win' : ''}`}>
        {aR ? <span className="bracket-name">{m.playerA ?? '—'}</span> : <span className="bracket-name slot-pending">؟</span>}
        <span className="bracket-score tw-score">{m.scoreA ?? '–'}</span>
        {wA && <span className="bracket-tag">فائز</span>}
      </div>
      <div className={`bracket-slot ${wB ? 'win' : ''}`}>
        {bR ? <span className="bracket-name">{m.playerB ?? '—'}</span> : <span className="bracket-name slot-pending">؟</span>}
        <span className="bracket-score tw-score">{m.scoreB ?? '–'}</span>
        {wB && <span className="bracket-tag">فائز</span>}
      </div>
    </div>
  );
}