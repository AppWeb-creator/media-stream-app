import { fmtClock } from './format';
import type { MatchEntry, MatchSettings } from './types';

/**
 * نظام مباريات البنر والتنبيهات الصوتية — مباريات يدوية فقط تُحفظ من لوحة الإدارة
 * في Firestore (manualMatches) مع روابط البث المستقلة (matchStreams). لا يوجد أي
 * جلب تلقائي من مصادر خارجية (أُزيل جلب يلا كورة بالكامل من المشروع ولوحة الإدارة).
 */

/** الفواصل الزمنية المسموحة بين التنبيهات الصوتية (بالدقائق) — بالإضافة لخيار «مخصص». */
export const MATCH_ALERT_INTERVALS = [3, 15, 30, 45, 60, 120, 240] as const;

/** توقع قناة البث: المحلية → OnTime Sports، العالمية → beIN Sports. */
export function broadcastChannel(match: Pick<MatchEntry, 'domestic'>): string {
  return match.domestic ? 'OnTime Sports' : 'beIN Sports';
}

/**
 * قائمة المباريات الفعلية للعرض والتنبيه: المباريات اليدوية من لوحة الإدارة فقط.
 * تدعم الاسم الجديد `manualMatches` مع قراءة الاسم القديم `customMatches` للتوافق.
 * تُدمج روابط البث المخصصة (خريطة matchStreams) في كل مباراة وترتب حسب الموعد.
 */
export function effectiveMatches(settings: MatchSettings | undefined): MatchEntry[] {
  const legacy = (settings as (MatchSettings & { customMatches?: MatchEntry[] }) | undefined)?.customMatches;
  const manual = settings?.manualMatches ?? legacy ?? [];
  const streams = settings?.matchStreams ?? {};
  return [...manual]
    .map((m) => {
      const url = streams[m.id];
      return url ? { ...m, streamUrl: url } : m;
    })
    .sort((a, b) => a.startTime - b.startTime);
}

/** مفتاح تخزين آخر لحظة أُعلن فيها صوتياً عن كل مباراة (id → timestamp) — لتكريم فاصل التكرار. */
export const MATCH_ANNOUNCE_TS_KEY = 'verdent_match_announce_ts_v1';

/** قراءة خريطة آخر توقيت إعلان لكل مباراة، مع إسقاط القيم الأقدم من يومين للحفاظ على حجم التخزين. */
function readAnnounceMap(now: number): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(MATCH_ANNOUNCE_TS_KEY) ?? '{}') as Record<string, number>;
    const map: Record<string, number> = {};
    for (const [id, ts] of Object.entries(raw)) {
      if (typeof ts === 'number' && ts > now - 2 * 86400000) map[id] = ts;
    }
    return map;
  } catch {
    return {};
  }
}

/** آخر مرة أُعلن فيها عن المباراة صوتياً (0 إن لم يسبق الإعلان). */
export function getLastAnnounceTime(id: string, now: number = Date.now()): number {
  return readAnnounceMap(now)[id] ?? 0;
}

/** تسجيل أن المباراة أُعلن عنها صوتياً الآن — يُعاد التذكير بها بعد فاصل التكرار لا «إلى الأبد». */
export function recordMatchAnnounced(id: string, now: number = Date.now()): void {
  try {
    const map = readAnnounceMap(now);
    map[id] = now;
    localStorage.setItem(MATCH_ANNOUNCE_TS_KEY, JSON.stringify(map));
  } catch {
    /* تجاهل */
  }
}

/** هل أُعلن عن المباراة قبل أقل من فاصل التكرار؟ — تُستبعد فقط تلك التي لم يمضِ فاصلُها. */
function isAnnouncedRecently(id: string, now: number, repeatIntervalMs: number, map: Record<string, number>): boolean {
  const last = map[id];
  return typeof last === 'number' && now - last < repeatIntervalMs;
}

/** الفرق بالأيام (بالتقويم المحلي) بين موعد المباراة و«اليوم»: 0 = اليوم، 1 = غداً، 2 = بعد غد. */
function matchDayDiff(startTime: number, now: number): number {
  const n = new Date(now);
  const startToday = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  const start = new Date(startTime);
  const matchDay = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  return Math.round((matchDay - startToday) / 86400000);
}

/**
 * نص التذكير الصوتي لمباراة قادمة: «اليوم» دائماً، و«غداً» و«بعد غد» عند توفرهما في القائمة —
 * بلا نافذة أيام قابلة للتهيئة. يُنطق عبر طابور الأصوات المركزي نفسه الذي تعمل عليه بقية
 * تنبيهات النظام الصوتية العاملة في الموقع.
 */
export function matchAlertText(match: MatchEntry, now: number): string | null {
  if (match.startTime < now) return null;
  const diff = matchDayDiff(match.startTime, now);
  if (diff < 0 || diff > 2) return null;
  const time = fmtClock(match.startTime);
  if (diff === 0) return `تذكير: لديك اليوم مباراة ${match.homeTeam} ضد ${match.awayTeam} الساعة ${time}`;
  if (diff === 1) return `تذكير: غداً مباراة ${match.homeTeam} ضد ${match.awayTeam} الساعة ${time}`;
  return `تذكير: بعد غد مباراة ${match.homeTeam} ضد ${match.awayTeam} الساعة ${time}`;
}

/**
 * التذكيرات الصوتية المستحقة الآن (تُستدعى عند تحميل المباريات أو تحديثها): كل المباريات القادمة
 * (اليوم وغداً وبعد غد — بلا نافذة أيام) التي مضى على آخر إعلان عنها فاصلُ التكرار المحدد
 * (repeatIntervalMs — يُقرأ من إعداد «فاصل تكرار التنبيه الصوتي»، مثال: 3 دقائق). أُعيد تذكير
 * المباراة عند مضي الفاصل وليس «إلى الأبد» بعد أول نطق؛ المباراة المكتومة تُستبعد هنا، ويُمرَّر
 * النص مباشرة إلى speakAr(r.text, r.id) التي تتكفل أيضاً بالمفتاح الرئيسي وعزل الكتم قبل الدخول
 * في الطابور المركزي تماماً كتنبيهات الجلسات العاملة.
 */
export function dueMatchAlert(
  matches: MatchEntry[],
  now: number,
  repeatIntervalMs: number,
): { id: string; text: string }[] {
  const interval = Math.max(0, repeatIntervalMs) || 180000;
  const announced = readAnnounceMap(now);
  return matches
    .filter((m) => !isMatchMuted(m.id) && !isAnnouncedRecently(m.id, now, interval, announced))
    .map((m) => ({ m, text: matchAlertText(m, now) }))
    .filter((x): x is { m: MatchEntry; text: string } => x.text !== null)
    .sort((a, b) => a.m.startTime - b.m.startTime)
    .map((x) => ({ id: x.m.id, text: x.text }));
}

/** مفتاح تخزين معرّفات المباريات المكتومة صوتياً لكل مباراة على حدة. */
const MATCH_MUTED_KEY = 'verdent_match_muted_ids_v1';

/** قراءة مجموعة معرّفات المباريات المكتومة صوتياً من التخزين المحلي. */
export function getMutedMatchIds(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(MATCH_MUTED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

/** هل المباراة مكتومة الأسط صوتياً؟ — تُمنع عنها التنبيهات الصوتية فقط وتُعرَض كالمعتاد. */
export function isMatchMuted(id: string): boolean {
  return getMutedMatchIds().has(id);
}

/** ضبط الكتم الصوتي لمباراة واحدة (يُحفظ في التخزين المحلي). */
export function setMatchMuted(id: string, muted: boolean): void {
  try {
    const ids = getMutedMatchIds();
    if (muted) ids.add(id);
    else ids.delete(id);
    localStorage.setItem(MATCH_MUTED_KEY, JSON.stringify([...ids]));
  } catch {
    /* تجاهل */
  }
}