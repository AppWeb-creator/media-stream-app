import type { TournamentGroup, TournamentMatch, TournamentReveal } from './types';

/** مقاعد القرعة بترتيب ظهورها في السحب المتحرك: كل اسم لاعب مقعد مستقل يُكشف تباعاً (A ثم B لكل مباراة). */
export function drawRevealSlots(bracket: TournamentMatch[], groups: TournamentGroup[]): string[] {
  const slots: string[] = [];
  for (const m of bracket) {
    if (m.playerA) slots.push(`${m.id}:A`);
    if (m.playerB) slots.push(`${m.id}:B`);
  }
  for (const g of groups) {
    for (const m of g.matches) {
      if (m.playerA) slots.push(`${m.id}:A`);
      if (m.playerB) slots.push(`${m.id}:B`);
    }
  }
  return slots;
}

/**
 * نسبة تقدم القرعة اللحظية: يُكشف مقعد واحد كل 2000ms بدءاً من `startedAt + 500ms`
 * (نفس إيقاع لوحة الإدارة) — يساوي `1 + floor((now - startedAt - 500) / 2000)`.
 * تعيد عدد المقاعد المكشوفة إلى الآن، وهل ما زالت القرعة جارية، ومتى تنتهي.
 */
export function revealProgressAt(reveal: TournamentReveal | null | undefined, now: number): { revealed: number; total: number; active: boolean; doneAt: number } {
  const total = reveal?.total ?? 0;
  if (!reveal || total <= 0) return { revealed: 0, total: 0, active: false, doneAt: 0 };
  const doneAt = reveal.startedAt + 500 + total * 2000;
  const raw = now - reveal.startedAt - 500;
  const revealed = raw < 0 ? 0 : Math.min(total, 1 + Math.floor(raw / 2000));
  return { revealed, total, active: now < doneAt, doneAt };
}

/** ترتيب ظهور اللاعبين داخل مجموعة من reveal (نظام المجموعات). */
export function revealPlayerIndex(orders: { gId: string; player: string }[] | undefined): Map<string, number> {
  const map = new Map<string, number>();
  (orders ?? []).forEach((s, i) => map.set(`${s.gId}:${s.player}`, i));
  return map;
}

/** ترتيب ظهور مقاعد مباريات المجموعات من reveal (نظام المجموعات). */
export function revealMatchIndex(orders: { gId: string; matchId: string; side: 'A' | 'B' }[] | undefined): Map<string, number> {
  const map = new Map<string, number>();
  (orders ?? []).forEach((s, i) => map.set(`${s.gId}:${s.matchId}:${s.side}`, i));
  return map;
}