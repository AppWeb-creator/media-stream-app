import type { TournamentGroup, TournamentMatch, TournamentStage } from './types';

/** خلط عشوائي (Fisher–Yates) — يعيد مصفوفة جديدة ولا يعدّل الأصل. */
export function shuffle<T>(input: readonly T[]): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** عنوان الجولة في شجرة الإقصاء حسب عدد مواجهاتها (1=النهائي، 2=نصف النهائي، 4=ربع النهائي، 8=دور الـ16). */
export function roundLabelFor(matchesCount: number): string {
  if (matchesCount === 1) return 'النهائي';
  if (matchesCount === 2) return 'نصف النهائي';
  if (matchesCount === 4) return 'ربع النهائي';
  if (matchesCount === 8) return 'دور الـ 16';
  if (matchesCount === 16) return 'دور الـ 32';
  return `الجولة (${matchesCount} مواجهات)`;
}

export function groupIdOf(index: number): string {
  return String.fromCharCode(65 + index); // A, B, C, …
}

export function groupNameOf(index: number): string {
  return `المجموعة ${groupIdOf(index)}`;
}

/**
 * بناء شجرة خروج مغلوب مباشر كاملة من قائمة اللاعبين:
 * - يُكمَّل عدد المشتركين إلى أقرب قوة اثنين عبر مواجهات تأهل تلقائي (BYE) في الجولة الأولى فقط.
 * - تُوزَّع مقاعد BYE على جولات البداية بحيث لا تحوي مواجهة الجولة الأولى أكثر من مقعد فارغ واحد،
 *   فيتأهل صاحب الباي جولة واحدة فقط ويجد خصماً حقيقياً في الجولة التالية (لا يتقدم تلقائياً
 *   عدة جولات متتالية حتى النهائي).
 * - كل جولة تنصّف العدد، والفائز يُحجز تلقائياً في مقعد المواجهة التالية (أولاً مباشرة في البناء
 *   لمن تأهلوا تلقائياً، ثم لاحقاً عند تسجيل أي نتيجة عبر applyKnockoutResult).
 */
export function buildKnockoutBracket(players: string[]): TournamentMatch[] {
  const n = players.length;
  if (n < 2) return [];
  const rounds = Math.ceil(Math.log2(n));
  const size = 2 ** rounds;
  const byes = size - n;
  const bracket: TournamentMatch[] = [];

  // مقاعد الجولة الأولى: نوزّع اللاعبين بحيث يحوي كل زوج (مواجهة) مقعد BYE واحداً كحد أقصى عند الحاجة —
  // العدد الفعلي المستهلك = byes*1 + (half-byes)*2 = size - byes = n.
  let current: (string | null)[] = Array(size).fill(null);
  const firstHalf = size / 2;
  let cursor = 0;
  for (let i = 0; i < firstHalf; i++) {
    current[i * 2] = players[cursor] ?? null;
    cursor++;
    if (i < byes) {
      current[i * 2 + 1] = null;
    } else {
      current[i * 2 + 1] = players[cursor] ?? null;
      cursor++;
    }
  }

  let r = 0;
  while (current.length > 1) {
    const half = current.length / 2;
    const next: (string | null)[] = Array(half).fill(null);
    const label = roundLabelFor(half);
    for (let i = 0; i < half; i++) {
      const a = current[i * 2] ?? null;
      const b = current[i * 2 + 1] ?? null;
      const id = `r${r}m${i}`;
      let winner: string | undefined;
      let auto = false;
      // التأهل التلقائي (BYE) يحدث مرة واحدة فقط في الجولة الأولى — بعدها ينتظر صاحب المقعد الفارغ
      // خصماً حقيقياً ولا يتأهل تلقائياً لأي جولة لاحقة (ربع النهائي/نصف النهائي/النهائي).
      if (r === 0) {
        if (a != null && b == null) { winner = a; auto = true; }
        else if (a == null && b != null) { winner = b; auto = true; }
      }
      bracket.push({
        id,
        label,
        round: r,
        bracketIndex: i,
        playerA: a ?? undefined,
        playerB: b ?? undefined,
        ...(auto ? { auto: true, winner } : {}),
      });
      if (winner) next[i] = winner;
    }
    current = next;
    r++;
  }
  return bracket;
}

/**
 * تسجيل نتيجة مواجهة في شجرة الإقصاء: يحدّث النقاط والفائز، ويُحرّك الفائز تلقائياً إلى
 * مقعد المواجهة التالية (أو يمسح المقعد إن تعادلا/لم تكتمل النتيجة). يعيد شجرة جديدة.
 */
export function applyKnockoutResult(
  bracket: TournamentMatch[],
  matchId: string,
  scoreA: number | undefined,
  scoreB: number | undefined,
): TournamentMatch[] {
  const next = bracket.map((m) => ({ ...m }));
  const m = next.find((x) => x.id === matchId);
  if (!m || !m.playerA || !m.playerB) return next;
  const a = Math.max(0, Math.floor(Number(scoreA) || 0));
  const b = Math.max(0, Math.floor(Number(scoreB) || 0));
  m.scoreA = a;
  m.scoreB = b;
  const prev = m.winner;
  const winner = a === b ? undefined : (a > b ? m.playerA : m.playerB);
  m.winner = winner;
  if (winner !== prev) {
    const target = next.find((x) => x.round === m.round + 1 && x.bracketIndex === Math.floor(m.bracketIndex / 2));
    if (target) {
      const slot = m.bracketIndex % 2 === 0 ? 'playerA' : 'playerB';
      target[slot] = winner;
    }
  }
  return next;
}

/**
 * توليد مباريات دور كامل (الدوري) داخل مجموعة واحدة بترتيب يمنع اللعب المتتالي لنفس اللاعب (Back-to-Back) قدر الإمكان:
 * - للمجموعات من 5 لاعبين فأكثر: طريقة الدائرة (circle-method) تُقسّم الدوري إلى جولات، كل جولة خصم مختلف لكل
 *   لاعب (مطابقة تامة)، مع إعادة ترتيب داخل الجولات حتى لا يتصادم آخر مقعد جولة مع أول مقعد الجولة التالية —
 *   فينتج جدول بلا أي مباراتين متتاليتين لنفس اللاعب (فاصل راحة حقيقي).
 * - للمجموعات ذات 4 لاعبين: نمط التوزيع البديل المطلوب A-B، C-D، A-C، B-D، A-D، B-C (أفضل ما يمكن رياضياً
 *   لـ 4 لاعبين — تكراران حتميان، النظير الثاني لا يشارك لاعبي الأول).
 * - للمجموعات الأقل من 4 لاعبين (مثل 3): يسمح بالتتابع الطبيعي لأن تفاديه مستحيل رياضياً.
 */
function buildGroupMatches(players: string[]): TournamentMatch[] {
  const n = players.length;
  if (n < 4) return buildRoundRobin(players);

  const pairs: [number, number][] =
    n === 4
      ? [[0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2]] // A-B, C-D, A-C, B-D, A-D, B-C
      : circleScheduleOrder(n);

  return pairs.map(([i, j]) => ({
    id: `g${i}-${j}`,
    label: '',
    round: 0,
    bracketIndex: 0,
    playerA: players[i],
    playerB: players[j],
  }));
}

/** ترتيب مقاعد دور كامل بطريقة الدائرة (Round-Robin) لعدد n من اللاعبين — كل جولة مطابقة تامة،
 *  وتُرتب الجولات بحيث لا يتصادم المقعد الأخير لجولة مع الأول للجولة التالية (صفر مباراتين متتاليتين للاعب نفسه). */
function circleScheduleOrder(n: number): [number, number][] {
  const dummy = -1;
  const ring = Array.from({ length: n }, (_, i) => i);
  if (n % 2 === 1) ring.push(dummy); // مقعد راحة للعدد الفردي
  const N = ring.length;
  const rounds: [number, number][][] = [];
  for (let r = 0; r < N - 1; r++) {
    const round: [number, number][] = [];
    for (let i = 0; i < N / 2; i++) round.push([ring[i], ring[N - 1 - i]]);
    rounds.push(round.filter(([a, b]) => a !== dummy && b !== dummy));
    // دوران: يثبت الأول ويتحرك الأخير إلى الموضع التالي.
    const last = ring.pop()!;
    ring.splice(1, 0, last);
  }

  const overlaps = (a: readonly number[], b: readonly number[]) => a.some((x) => b.includes(x));
  const order: [number, number][] = [];
  let prevLast: [number, number] | null = null;
  for (const round of rounds) {
    if (round.length === 0) continue;
    const rest = [...round];
    if (prevLast) {
      // موعد يلي آخر جولة سابقة بلا لاعب مشترك (إن وُجد) ليضمن الراحة عبر الحدود.
      const last = prevLast;
      const idx = rest.findIndex((m) => !overlaps(m, last));
      if (idx !== -1) { order.push(rest.splice(idx, 1)[0]); }
    }
    order.push(...rest);
    prevLast = order[order.length - 1];
  }
  return order;
}

/** مباريات دور كامل (الدوري) داخل مجموعة بترتيب طبيعي — تُستخدم للمجموعات الأصغر من 4 لاعبين. */
function buildRoundRobin(players: string[]): TournamentMatch[] {
  const matches: TournamentMatch[] = [];
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      matches.push({
        id: `g${i}-${j}`,
        label: '',
        round: 0,
        bracketIndex: 0,
        playerA: players[i],
        playerB: players[j],
      });
    }
  }
  return matches;
}

/** توزيع اللاعبين على المجموعات بعد قرعة عشوائية (توزيع متوازن قدر الإمكان) مع بناء مباريات دور المجموعات. */
export function buildGroups(players: string[], groupCount: number): TournamentGroup[] {
  const n = players.length;
  const base = Math.floor(n / groupCount);
  const extra = n % groupCount;
  const rand = shuffle(players);
  const groups: TournamentGroup[] = [];
  let cursor = 0;
  for (let g = 0; g < groupCount; g++) {
    const take = base + (g < extra ? 1 : 0);
    const members = rand.slice(cursor, cursor + take);
    cursor += take;
    groups.push({
      id: groupIdOf(g),
      name: groupNameOf(g),
      players: members,
      matches: buildGroupMatches(members),
    });
  }
  return groups.filter((g) => g.players.length > 0);
}

/** صفّ ترتيب مشترك في المجموعة. */
export interface RankedRow {
  player: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  for: number;
  against: number;
  diff: number;
  points: number;
  rank: number;
}

/** ترتيب مجموعة (مرتبة تنازلياً بالنقاط ثم فرق الأهداف ثم الأهداف المسجلة ثم الاسم) مع رقم المركز.
 *  عند تساوي النقاط وفرق الأهداف والأهداف، تُستخدم قرعة الحسم الموفّرة في group.tiebreak (كلما قلّت القيمة ارتفع الترتيب). */
export function rankGroup(group: TournamentGroup): RankedRow[] {
  const zero = (player: string): RankedRow => ({ player, played: 0, won: 0, drawn: 0, lost: 0, for: 0, against: 0, diff: 0, points: 0, rank: 0 });
  const rows = new Map<string, RankedRow>();
  group.players.forEach((p) => rows.set(p, zero(p)));
  for (const m of group.matches) {
    if (m.scoreA === undefined || m.scoreB === undefined) continue;
    const a = rows.get(m.playerA ?? '');
    const b = rows.get(m.playerB ?? '');
    if (!a || !b) continue;
    const sa = m.scoreA;
    const sb = m.scoreB;
    a.played++; b.played++;
    a.for += sa; a.against += sb;
    b.for += sb; b.against += sa;
    if (sa > sb) { a.won++; b.lost++; }
    else if (sb > sa) { b.won++; a.lost++; }
    else { a.drawn++; b.drawn++; }
  }
  const tiebreak = group.tiebreak ?? {};
  const list = [...rows.values()];
  list.forEach((r) => { r.diff = r.for - r.against; r.points = r.won * 3 + r.drawn; });
  list.sort((x, y) =>
    y.points - x.points || y.diff - x.diff || y.for - x.for ||
    (tiebreak[x.player] ?? 0) - (tiebreak[y.player] ?? 0) ||
    x.player.localeCompare(y.player, 'ar'));
  list.forEach((r, i) => { r.rank = i + 1; });
  return list;
}

/**
 * كشف التكافؤ التام (نقاط متساوية وفرق أهداف متساوٍ) الذي يؤثر على مقاعد التأهل (أول مركزين).
 * يعيد قائمة المرشحين المتعادلين بالترتيب الراهن للجدول، أو null عند عدم وجود تكافؤ مؤهِّل.
 * لا يُعدّ تكافؤ بعد حسمه بقرعة (أي إذا رُبطت قيم tiebreak لكل المشتركين المتعادلين).
 */
export function findQualificationTie(group: TournamentGroup): string[] | null {
  const ranking = rankGroup(group);
  const tiebreak = group.tiebreak ?? {};
  let i = 0;
  while (i < ranking.length) {
    const base = ranking[i];
    let j = i + 1;
    while (j < ranking.length
      && ranking[j].points === base.points
      && ranking[j].diff === base.diff
      && ranking[j].for === base.for) j++;
    // تكافؤ يؤثر على التأهل فقط إذا شمل المركز الأول أو الثاني (أقرب مركزين مؤهلين).
    if (j - i >= 2 && i < 2) {
      const tied = ranking.slice(i, j).map((r) => r.player);
      // إن حُسم هذا التكافؤ فعلاً بقرعة سابقة (لكل اللاعبين قيمة tiebreak) فلا يُعاد افتتاح القرعة.
      if (tied.every((p) => tiebreak[p] !== undefined)) return null;
      return tied;
    }
    i = j;
  }
  return null;
}

/** لصق نتيجة قرعة حسم التكافؤ على المجموعة: الترتيب المسحوب يُخزَّن كقيم tiebreak
 *  (أوّل اسم يُسحب يحصل على أصغر قيمة = أعلى ترتيب) ليتفاعل rankGroup/buildPlayoffList معه. */
export function applyTiebreak(group: TournamentGroup, order: string[]): TournamentGroup {
  const tiebreak: Record<string, number> = {};
  order.forEach((player, i) => { tiebreak[player] = i; });
  return { ...group, tiebreak };
}

/** هل اكتملت كل مباريات كل المجموعات (كلها سُجّلت نتائجها)؟ */
export function allGroupMatchesDone(groups: TournamentGroup[]): boolean {
  return groups.length > 0 && groups.every((g) => g.matches.length > 0 && g.matches.every((m) => m.scoreA !== undefined && m.scoreB !== undefined));
}

/** قائمة الصاعدين لمرحلة الإقصاء بعد دور المجموعات: أول + ثاني كل مجموعة بتقاطع المجموعات
 *  المجاورة (أ.1 ضد ب.2، ب.1 ضد أ.2، ج.1 ضد د.2، د.1 ضد ج.2 …) بالترتيب الذي تستهلكه الشجرة. */
export function buildPlayoffList(groups: TournamentGroup[]): string[] {
  const ranked = groups.map((g) => rankGroup(g).map((r) => r.player));
  const list: string[] = [];
  for (let i = 0; i + 1 < ranked.length; i += 2) {
    const g1 = ranked[i];
    const g2 = ranked[i + 1];
    if (g1[0]) list.push(g1[0]);
    if (g2[1]) list.push(g2[1]);
    if (g1[1]) list.push(g1[1]);
    if (g2[0]) list.push(g2[0]);
  }
  return list;
}

/** المرحلة الحالية من الشجرة: «منتهية» إذا حُسم النهائي بفائز، وإلا «إقصاء». */
export function knockoutStageOf(bracket: TournamentMatch[]): TournamentStage {
  const finals = bracket.filter((m) => m.round === Math.max(0, ...bracket.map((x) => x.round)));
  return finals.some((m) => m.winner) ? 'done' : 'playoff';
}