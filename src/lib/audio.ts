import type { AlertSounds } from './types';
import { isMatchMuted } from './matches';

/**
 * نظام طابور الأصوات (AudioQueue) — مخطّط تشغيل تسلسلي صارم مع عزل الكتم لكل جلسة:
 * - عنصر HTML5 Audio واحد جارٍ في كل لحظة (مدخلة واحدة كحد أقصى عبر activePlaybackMap) —
 *   لا يتزامن مقطعان من أي جهاز أو جلسة كانت.
 * - طابوران: عادي FIFO + طابور "انتهاء الوقت" ذي أولوية أعلى يُسحَب منه أولاً، وتُرتَّب عبره
 *   كل التنبيهات المتزامنة الواردة من أجهزة مختلفة وتُعزف بالتتابع (واحداً تلو الآخر).
 * - pump() لا يبدأ أي مقطع جديد ما دام صوت نشط (element أو نطق)؛ المقاطع تنتظر ended/error
 *   حتى يُطلق الجاري ثم pump() يتقدم بالمقطع التالي بالترتيب.
 * - كل مقطع يحمل sessionId إلزامياً (GLOBAL_SESSION_ID للأصوات العامة) وdeviceId اختيارياً
 *   لحل رابط الصوت المخصص للجهاز عند التشغيل.
 * - silenceSession(target) يلمس حصراً عنصر targetSessionId ومقاطعها فقط ثم pump() فوراً؛
 *   وإذا كان الصوت الجاري لجلسة أخرى يبقى يعزف دون أي مساس.
 * - الروابط الافتراضية (global) من لوحة الإدارة تشمل كل الأجهزة، مع إمكانية تخصيص روابط
 *   لكل جهاز على حدة (deviceAlertSounds)؛ الحدث بلا رابط مخصص عند الجهاز يعود للصوت العام.
 */

/** معرف "جميع الأجهزة (الافتراضي)" في قائمة اختيار الجهاز — يمثل الأصوات العامة للنظام. */
export const ALL_DEVICES_ID = '__all__';

type AlertEvent = keyof AlertSounds;

interface Clip {
  /** رابط ملف صوتي HTML5 (إذا كان الحدث صوت ملف)، غير ذلك يُنطق عبر text فقط. */
  url?: string;
  /** نص منطوق (إعلانات الورديات: فتح/قفل) عبر Web Speech. */
  text?: string;
  /** معرّف الجلسة الإلزامي — مفتاح العزل في الخريطة وقواعد الفلترة (GLOBAL_SESSION_ID للأصوات العامة). */
  sessionId: string;
  /** معرّف الجهاز المانح للتنبيه — لحل الصوت المخصص للجهاز (اختياري للأصوات العامة). */
  deviceId?: string;
  urgent?: boolean;
  /** عدد محاولات بدء تشغيل الملف الفاشلة — يُتجاوز المقطع بعد حد محدود. */
  tries?: number;
}

/** معرف احتياطي ثابت للأصوات العامة (خبطة النقد، أخطاء، نطق الوردية) — لا يطابق أي جلسة حقيقية. */
const GLOBAL_SESSION_ID = '__global__';

/** روابط الأحداث الافتراضية (global) — تُحدَّث من لوحة الإدارة عبر configureAlertSounds(). */
let alertUrls: AlertSounds = {
  sessionStarted: '',
  sessionExpired: '',
  almostUp: '',
  sessionExtended: '',
  sessionCancelled: '',
  paymentCollected: '',
  sessionPaused: '',
  sessionResumed: '',
};

/** روابط مخصصة لكل جهاز (مفتاح = Device.id) — أي حدث بلا رابط مخصص يعود للصوت العام. */
let deviceAlertUrls: Record<string, Partial<AlertSounds>> = {};

/** يُحدّث روابط الأصوات (العامة + المخصصة لكل جهاز) من إعدادات لوحة الإدارة. */
export function configureAlertSounds(urls: AlertSounds, deviceUrls: Record<string, Partial<AlertSounds>> = {}): void {
  alertUrls = urls;
  deviceAlertUrls = deviceUrls;
}

/**
 * يختار رابط الصوت لحدث معين: صوت الجهاز المخصص إن وُجد (غير فارغ) وإلا يعود للصوت العام —
 * منطق التجاوز (fallback): رئيسي للجهاز → افتراضي عام.
 */
function eventUrl(event: AlertEvent, deviceId?: string | null): string {
  if (deviceId && deviceId !== ALL_DEVICES_ID) {
    const custom = deviceAlertUrls[deviceId]?.[event];
    if (custom) return custom;
  }
  return alertUrls[event];
}

/**
 * مخطّط مركزي لإدارة طابور التشغيل المتسلسل للأصوات — يضمن عدم تزامن المقاطع ولا قطع أي صوت
 * جارٍ: أي تنبيه يصل أثناء تشغيل آخر يُرتَّب في الطابور ويعُزف بعده بالترتيب.
 */
class AudioQueue {
  private urgentQueue: Clip[] = [];
  private regularQueue: Clip[] = [];

  /** عنصر Audio للصوت الجاري فقط — مفتاح عزل الكتم: لكل جلسة معرّف يستهدفها وحدها. */
  private readonly activePlaybackMap = new Map<string, HTMLAudioElement>();

  /** هل يُنطق الآن نص عام (إعلان وردية) على قناة النطق؟ */
  private speaking = false;
  /** مرجع الجملة المنطوقة الجارية — يُلغى بشدة عند كتم الجلسة إن كانت تحمل معرّف الجلسة. */
  private currentSpeech: SpeechSynthesisUtterance | null = null;

  /** هل وجد أي محتوى معلّق (صوت جارٍ أو نطق أو مقاطع بانتظار)؟ — غذاء حالة "التنبيه نشط". */
  get active(): boolean {
    return this.activePlaybackMap.size > 0 || this.speaking || this.urgentQueue.length > 0 || this.regularQueue.length > 0;
  }

  /** هل يُشغَّل الآن عنصر تشغيل أو نطق؟ — يمنع بدء أي مقطع آخر حتى انتهائه. */
  private get busy(): boolean {
    return this.activePlaybackMap.size > 0 || this.speaking;
  }

  /**
   * يدفع مقطعاً إلى طابوره (urgent يُفرَّغ قبل العادي دائماً) ثم يحاول تشغيل الجاهز.
   * يضمن أن كل عنصر يملك sessionId إلزامياً — يُمنح المعرف الاحتياطي العام إن أُهمل.
   */
  enqueue(clip: { url?: string; text?: string; sessionId?: string | null; deviceId?: string; urgent?: boolean }): void {
    const item: Clip = { ...clip, sessionId: clip.sessionId ?? GLOBAL_SESSION_ID, urgent: clip.urgent ?? false };
    if (!item.url && !item.text) return;
    (item.urgent ? this.urgentQueue : this.regularQueue).push(item);
    this.pump();
  }

  /**
   * يُشغّل المقطع التالي إن كان المجال فارغاً: انتهاء الوقت أولاً (أولوية)، ثم البقية FIFO.
   * أثناء أي صوت نشط لا يبدأ أي مقطع جديد — المقاطع تنتظر ended/error ثم يتقدم المنظم.
   */
  private pump(): void {
    if (this.busy) return;
    const clip = this.urgentQueue.length ? this.urgentQueue.shift()! : this.regularQueue.shift();
    if (!clip) return;
    if (clip.text) {
      this.speakText(clip.text);
    } else if (clip.url) {
      this.startUrlClip(clip);
    } else {
      this.pump();
    }
  }

  /** يشغّل ملفاً على عنصر HTML5 مسجَّل في الخريطة بمعرّف الجلسة (مقطع واحد جارٍ في النظام). */
  private startUrlClip(clip: Clip): void {
    const el = new Audio(clip.url);
    this.activePlaybackMap.set(clip.sessionId, el);
    let finished = false;
    const free = (): void => {
      if (finished) return;
      finished = true;
      if (this.activePlaybackMap.get(clip.sessionId) === el) this.activePlaybackMap.delete(clip.sessionId);
      notify();
      this.pump();
    };
    el.addEventListener('ended', free, { once: true });
    el.addEventListener('error', free, { once: true });
    notify();
    el.play().catch(() => {
      // فشل بدء التشغيل (قيود المتصفح مثل منع التشغيل التلقائي) — لا نعتبر المقطع منتهياً
      // ولا نقطع صوتاً جارياً؛ يُعاد المقطع لمقدمة طابوره ويُجرَّب من جديد، ويتجاوز بعد حد محدود.
      if (this.activePlaybackMap.get(clip.sessionId) !== el) return; // كُتم أو تغيّر الوضع قبل البدء — لا تُلغِ شيئاً
      el.removeEventListener('ended', free);
      el.removeEventListener('error', free);
      clip.tries = (clip.tries ?? 0) + 1;
      this.activePlaybackMap.delete(clip.sessionId);
      notify();
      if (clip.tries >= 5) {
        el.removeAttribute('src');
        this.pump();
        return;
      }
      (clip.urgent ? this.urgentQueue : this.regularQueue).unshift(clip);
      window.setTimeout(() => this.pump(), 300 * (clip.tries ?? 0));
    });
  }

  /** ينطق نصاً عربياً عبر Web Speech (إعلانات الورديات) ويحرر القناة عند انتهائه. */
  private speakText(text: string): void {
    try {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        notify();
        this.pump();
        return;
      }
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'ar-EG';
      utter.rate = 1;
      utter.volume = 1;
      const voices = window.speechSynthesis.getVoices();
      const arabic = voices.find((v) => v.lang?.toLowerCase().startsWith('ar'));
      if (arabic) utter.voice = arabic;
      this.speaking = true;
      this.currentSpeech = utter;
      const free = (): void => {
        if (!this.speaking) return;
        this.speaking = false;
        this.currentSpeech = null;
        notify();
        this.pump();
      };
      utter.onend = free;
      utter.onerror = free;
      window.speechSynthesis.speak(utter);
      // ضمانة: إن لم يُطلق المتصفح onend لأي سبب، اعتبر النطق منتهياً بعد مدة تقديرية مريحة —
      // بلا قطع مبكر للنطق الجاري (مصمَّم بحيث يزيد عن أي نطق عربي نموذجي).
      window.setTimeout(free, utter.text.length * 110 + 1800);
    } catch {
      notify();
      this.pump();
    }
  }

  /**
   * كتم جلسة واحدة من بطاقتها — عزل صارم بالمعرّف:
   *  a) يُسقط من الخطين فقط المقاطع التي sessionId === المطلوب.
   *  b) إن كان الصوت الجاري يحمل معرّف الهدف: pause + currentTime=0 ثم إزالته فوراً و pump().
   *  c) إن كان الصوت الجاري لجلسة أخرى يبقى يعزف دون أن يُلمس إطلاقاً (لا يبدأ بديل).
   */
  silenceSession(targetSessionId: string): void {
    this.urgentQueue = this.urgentQueue.filter((c) => c.sessionId !== targetSessionId);
    this.regularQueue = this.regularQueue.filter((c) => c.sessionId !== targetSessionId);

    const el = this.activePlaybackMap.get(targetSessionId);
    if (el) {
      el.pause();
      el.currentTime = 0;
      this.activePlaybackMap.delete(targetSessionId);
      notify();
    }
    this.pump();
  }
}

/** النسخة الوحيدة من مخطّط الأصوات — كل عمليات التشغيل تمر عبره فتكون تسلسلية بلا تزاحم. */
const audioQueue = new AudioQueue();

/** حالة "هل يُشغَّل صوت الآن أو ينتظر صوت في أي من الخطين؟". */
let alarmActive = false;
const alarmListeners = new Set<(active: boolean) => void>();

function notify(): void {
  const next = audioQueue.active;
  if (next === alarmActive) return;
  alarmActive = next;
  for (const l of alarmListeners) l(alarmActive);
}

export function isAlarmActive(): boolean {
  return audioQueue.active;
}

/** يركّب مستمعاً لحالة التنبيه النشط؛ يُستدعى فوراً بالحالة الحالية عند الاشتراك. */
export function subscribeAlarmActive(listener: (active: boolean) => void): () => void {
  alarmListeners.add(listener);
  listener(alarmActive);
  return () => {
    alarmListeners.delete(listener);
  };
}

/** يُشغّل صوت حدث جلسة محددة (رابط مُحل مع مراعات الصوت المخصص للجهاز) — بدونه لا يُفعَّل. */
function playEvent(url: string, sessionId: string | null, urgent = false): void {
  audioQueue.enqueue({ url, sessionId, urgent });
}

export function alertSessionStarted(deviceId: string, sessionId: string): void {
  playEvent(eventUrl('sessionStarted', deviceId), sessionId);
}

/** حسابات الجلسة المنتهية بشكل صريح (تسوية/تقفيل) — نفس صوت انتهاء الوقت الأصلي. */
export function alertSessionEnded(deviceId: string, sessionId: string): void {
  playEvent(eventUrl('sessionExpired', deviceId), sessionId);
}

/** انتهاء الوقت الأصلي للجلسة — الأعلى أولوية: يُفرَّغ قبل أي تنبيه آخر. */
export function alertTimeExpired(deviceId: string, sessionId: string): void {
  playEvent(eventUrl('sessionExpired', deviceId), sessionId, true);
}

/** اقتراب انتهاء الوقت الأصلي للجلسة. */
export function alertTimeAlmostUp(deviceId: string, sessionId: string): void {
  playEvent(eventUrl('almostUp', deviceId), sessionId);
}

/** تمديد وقت الجلسة. */
export function alertExtended(deviceId: string, sessionId?: string): void {
  playEvent(eventUrl('sessionExtended', deviceId), sessionId ?? null);
}

/** إلغاء الجلسة بدون تحصيل. */
export function alertSessionCancelled(deviceId: string, sessionId: string): void {
  playEvent(eventUrl('sessionCancelled', deviceId), sessionId);
}

/** تم تحصيل المبلغ. */
export function alertPaymentCollected(deviceId: string, sessionId: string): void {
  playEvent(eventUrl('paymentCollected', deviceId), sessionId);
}

/** خبطات تأكيد الكاشير (مبيعات/إيرادات) — تعيد استخدام رابط التحصيل الافتراضي العام إن وُجد. */
export function alertCash(): void {
  playEvent(eventUrl('paymentCollected', null), null);
}

/** تنبيه خطأ — صوت الانتهاء الافتراضي. */
export function alertError(): void {
  playEvent(eventUrl('sessionExpired', null), null);
}

/** تنبيه تحذيري — صوت الانتهاء الافتراضي. */
export function alertWarning(): void {
  playEvent(eventUrl('sessionExpired', null), null);
}

/** توقف مؤقت للجلسة — صوت مستقل قابل للتخصيص من لوحة الإدارة. */
export function alertSessionPaused(deviceId: string, sessionId?: string): void {
  playEvent(eventUrl('sessionPaused', deviceId), sessionId ?? null);
}

/** استئناف الجلسة — صوت مستقل قابل للتخصيص من لوحة الإدارة. */
export function alertSessionResumed(deviceId: string, sessionId?: string): void {
  playEvent(eventUrl('sessionResumed', deviceId), sessionId ?? null);
}

/** نطق نصي عبر الطابور المركزي (أولوية عادية) — لا يقطع تنبيهات الأجهزة الجارية. */
function speakQueuedText(text: string): void {
  audioQueue.enqueue({ text });
}

/** إعلان صوتي لفتح الوردية باسم المسؤول — عبر الطابور مع بقية التنبيهات. */
export function alertShiftOpen(managerName: string): void {
  speakQueuedText(`تم فتح الوردية بواسطة ${managerName}`);
}

/** إعلان صوتي لقفل الوردية باسم المسؤول — عبر الطابور مع بقية التنبيهات. */
export function alertShiftClose(managerName: string): void {
  speakQueuedText(`تم قفل الوردية بواسطة ${managerName}`);
}

/** مفتاح تخزين المفتاح الرئيسي لصوت المباريات — يفرض الكتم العام فورياً على كل تنبيهات صوت المباريات. */
export const MATCH_AUDIO_MASTER_KEY = 'verdent_match_audio_master_v1';

/** حالة المفتاح الرئيسي لصوت المباريات — تُقرأ مباشرة من التخزين المحلي (افتراضياً: مفعّل). */
export function getMatchAudioMaster(): boolean {
  try {
    const raw = localStorage.getItem(MATCH_AUDIO_MASTER_KEY);
    return raw === null ? true : raw === '1';
  } catch {
    return true;
  }
}

/** ضبط المفتاح الرئيسي لصوت المباريات — يُحفظ في التخزين المحلي فوراً فيطبَّق الكتم العام فوراً. */
export function setMatchAudioMaster(on: boolean): void {
  try {
    localStorage.setItem(MATCH_AUDIO_MASTER_KEY, on ? '1' : '0');
  } catch {
    /* تجاهل */
  }
}

/**
 * نطق نصي عربي حر عبر الطابور المركزي (Web Speech) — يُستخدم لإعلانات وتذكيرات المباريات
 * القادمة ويتبارى بنفس القواعد مع بقية تنبيهات النظام: لا يقطع صوتاً جارياً ولا يُقطع بعده.
 * عند تمرير matchId يُفحص المفتاح الرئيسي لصوت المباريات وكتم المباراة قبل الإدخال في الطابور —
 * المفتاح المغلق أو المباراة المكتومة يُسقطان الصوت كلياً وتُعيد false؛ النجاح يُعيد true.
 */
export function speakAr(text: string, matchId?: string): boolean {
  if (matchId) {
    if (!getMatchAudioMaster()) {
      console.log('[audio] مفتاح صوت المباريات الرئيسي مغلق — تجاهل تذكير المباراة', matchId);
      return false;
    }
    if (isMatchMuted(matchId)) {
      console.log('[audio] المباراة مكتومة صوتياً — تجاهل', matchId);
      return false;
    }
  }
  speakQueuedText(text);
  return true;
}

/**
 * كتم جلسة محددة (حين تُحصَّل الجلسة أو تُوقَّف مؤقتاً من مكان آخر) — نفس سلوك كتم البطاقة
 * معزولاً عن بقية الجلسات، ويعيد التشغيل لأي تنبيه تالٍ.
 */
export function stopUrgentAlarms(sessionId: string): void {
  audioQueue.silenceSession(sessionId);
}

/** كتم جلسة واحدة من بطاقتها — يعزل الأصوات الخاصة بها فقط ويترك بقية الأجهزة تعزف. */
export function silenceSession(sessionId: string): void {
  audioQueue.silenceSession(sessionId);
}

let audioUnlocked = false;

/**
 * يفتح قناة الصوت (Web Audio) عند تفاعل المستخدم — يُطلق تصريح التشغيل التلقائي في
 * Edge/Chrome لكي تعمل تنبيهات المباريات المجدولة (تستحق من مؤقت وليس من نقرة مباشرة)
 * على طابور الأصوات المركزي نفسه الذي تشتغل عليه بقية تنبيهات الجلسات الفورية.
 */
export function unlockAudio(): void {
  if (audioUnlocked) return;
  audioUnlocked = true;
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, 22050);
    src.connect(ctx.destination);
    src.start(0);
    window.setTimeout(() => {
      try { void ctx.close().catch(() => undefined); } catch { /* تجاهل */ }
    }, 400);
  } catch {
    /* تجاهل */
  }
}

let unlockArmed = false;

/**
 * يركّب مستمعات فتح قناة الصوت على أول تفاعل مستخدم (نقرة/لمس/ضغطة مفتاح) — تُستدعى مرة
 * واحدة لكل تبويب حتى تُطلق تصريح النطق والتشغيل التلقائي في المتصفح.
 */
export function armAudioUnlock(): void {
  if (unlockArmed) return;
  unlockArmed = true;
  const unlock = (): void => unlockAudio();
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('touchstart', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}