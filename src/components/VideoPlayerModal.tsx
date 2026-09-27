import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import { Maximize, Minimize, X } from 'lucide-react';
import { useStore } from '../store/cafe';

/** حالة صحة البث داخل المشغّل: أخضر سليم / أصفر تخزين أو إعادة اتصال / أحمر انقطاع. */
type StreamHealth = 'green' | 'yellow' | 'red';

/** محركات فكّ البث المتاحة داخل المتصفح — تُجرب بالترتيب حتى ينجح أول تشغيل. */
type Engine = 'mpegts' | 'hls' | 'progressive';

interface ModalProps {
  title: string;
  url: string;
  onClose: () => void;
}

const HEALTH_LABEL: Record<StreamHealth, string> = {
  green: 'البث سليم',
  yellow: 'جاري التخزين المؤقت…',
  red: 'انقطع البث',
};

/** تنبيه عربي يُعرض عند حجب المتصفح للبث (CORS / محتوى مختلط / سيرفر IPTV غير جاهز). */
const IPTV_BLOCK_HINT = 'تنبيه: سيرفر IPTV يتطلب إذن المتصفح أو مشغل مباشر';
const MIXED_CONTENT_HINT = 'تنبيه: البث عبر HTTP على صفحة HTTPS — المتصفح قد يمنع المحتوى المختلط.';
const NATIVE_FALLBACK_HINT = 'تعذّر فكّ البث بالمحركات المتقدمة — شغّلنا المتصفح مباشرة. إن استمرت الشاشة السوداء فالسيرفر يمنع البث أو الرابط غير متوافق.';
const IFRAME_FALLBACK_HINT = 'تعذّر فكّ البث بالمحركات المتقدمة — شغّلنا عرض البث المضمّن داخل المشغّل.';

/**
 * توحيد بروتوكول رابط البث: يُخرج دائماً ببروتوكول http:// ولا يُرفع أبداً إلى https: —
 * سيرفر IPTV (http://ugeen.live:8080/…) لا يقدّم TLS أصلاً، فمعالجة الرابط إجبارية لتفادي
 * net::ERR_SSL_PROTOCOL_ERROR (روابط https على هذا المنفذ تفشل بالمتصفح). الروابط غير
 * الصالحة تُعاد كما هي.
 */
function normalizeStreamUrl(raw: string): string {
  const trimmed = raw.trim();
  try {
    const u = new URL(trimmed);
    if (u.protocol === 'https:' || u.protocol === 'http:') {
      u.protocol = 'http:';
    }
    return u.href;
  } catch {
    return trimmed;
  }
}

/** هل الرابط من سيرفر IPTV هذا (ugeen.live أو منفذ 8080)؟ فقط هذه تُمرَّر عبر الوكيل. */
function isIptvOrigin(url: string): boolean {
  try {
    const u = new URL(url, window.location.href);
    return /(^|\.)ugeen\.live$/i.test(u.hostname) || u.port === '8080';
  } catch {
    return false;
  }
}

/** مسار الوكيل المدمج الثابت — يعالجه سيرفر Node المحلي/الاستضافة (server/index.js، Express) الذي يعيد توجيه البث من عنوان IP غير محظور. */
const IPTV_PROXY_BASE = '/iptv-stream';

/**
 * تركيب رابط الطلب عبر الوكيل المدمج (المسار الثابت /iptv-stream): يحافظ على المسار
 * والمعاملات (Query) كاملةً ويُركّبها فوق أساس الوكيل نفسه — فيسقط حجب mixed-content و CORS
 * لدى كل الزوار دون أي إعداد أو حقل في لوحة الإدارة. يُصيَّر الرابط مطلقاً لأن محركات فكّ
 * البث (mpegts/hls) تعمل داخل Web Worker وترفض الروابط النسبية.
 */
function toProxiedUrl(url: string, proxyBase: string): string {
  const base = proxyBase?.trim();
  if (!base) return url;
  try {
    const u = new URL(url, window.location.href);
    const absoluteBase = base.startsWith('/') ? `${window.location.origin}${base}` : base;
    const cleanBase = absoluteBase.replace(/\/+$/, '');
    return `${cleanBase}/${u.pathname.replace(/^\/+/, '')}${u.search}`;
  } catch {
    return url;
  }
}

/** هل الرابط ملف فيديو تدريجي يعرفه المتصفح مباشرة (mp4/webm/…)؟ */
function isProgressiveVideo(url: string): boolean {
  return /\.(mp4|webm|ogg|ogv|mov)(\?|#|$)/i.test(url);
}

/** هل الرابط صريح كقائمة تشغيل HLS (m3u8)؟ */
function isHlsManifest(url: string): boolean {
  return /\.m3u8(\?|#|$)/i.test(url) || /application\/x-mpegURL/i.test(url) || /m3u8/i.test(url);
}

/**
 * ترتيب المحركات حسب شكل الرابط — تُجرب بالتسلسل حتى أول تشغيل ناجح:
 *  - روابط IPTV الخام (مثل http://ugeen.live:8080/… بلا امتداد، أو .ts) → mpegts.js أولاً
 *    (فكّ MPEG2-TS داخل المتصفح عبر MediaSource)، ثم هبوط إلى hls.js ثم تشغيل المتصفح المباشر.
 *  - قوائم HLS (m3u8) → hls.js أولاً ثم تشغيل المتصفح المباشر.
 *  - فيديو تدريجي → المتصفح مباشرة.
 */
function pickEngines(url: string): Engine[] {
  if (isProgressiveVideo(url)) return ['progressive'];
  if (isHlsManifest(url)) return ['hls', 'progressive'];
  return ['mpegts', 'hls', 'progressive'];
}

/**
 * مشغّل فيديو مبني على عنصر <video> HTML5 قياسي مملوك 100% من React،
 * مع فكّ البث داخل المتصفح عبر hls.js / mpegts.js للتشغيل المباشر لروابط IPTV.
 *
 * أهم ما في هذا الإصدار:
 * 1) لا توجد إطلاقاً أي عمليات DOM يدوية — لا replaceChildren() ولا removeChild() —
 *    —— عنصر <video> يملكه React بالكامل عبر key/ref، والمحركات (hls/mpegts) لا تلمس
 *    بنية العنصر: فهي تُلصق بثّه عبر attachMedia/attachMediaElement فقط، وبناؤها يُدمَّر
 *    بطريقتها الرسمية destroy() داخل try-catch. فلا مُحاكمة removeChild 'NotFoundError'.
 * 2) بروكسي IPTV مدمج (المسار الثابت /iptv-stream): روابط ugeen.live:8080 تُوجَّه تلقائياً
 *    عبر سيرفر Node المحلي/الاستضافة (HTTP → HTTPS) لتجاوز حجب mixed-content و CORS
 *    لدى كل الزوار — بلا أي إعداد من المستخدم.
 * 3) هبوط مضمّن: إن فشلت كل المحركات يُعرض البث داخل <iframe> مضمَّن في نفس النافذة —
 *    بلا أي window.open أو تبويبات خارجية.
 * 4) البروتوكول: كل الروابط تُخرج http:// دائماً ولا تُصعَّد إلى https أبداً
 *    (ERR_SSL_PROTOCOL_ERROR على منفذ IPTV الخام).
 */
export function VideoPlayerModal({ title, url, onClose }: ModalProps) {
  const { config, user } = useStore();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const mpegtsRef = useRef<ReturnType<typeof mpegts.createPlayer> | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [health, setHealth] = useState<StreamHealth>('yellow');
  const [reconnecting, setReconnecting] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [isNative, setIsNative] = useState(false);
  const [showIframe, setShowIframe] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const playedOnceRef = useRef(false);

  /** الرابط المعيَّر (http:// دائماً) ثم يُوجَّه عبر الوكيل المدمج /iptv-stream إذا كان من سيرفر IPTV — وإلا يُشغَّل كما هو. */
  const streamUrl = normalizeStreamUrl(url);
  const fetchUrl = isIptvOrigin(streamUrl) ? toProxiedUrl(streamUrl, IPTV_PROXY_BASE) : streamUrl;

  /** مسح كل حالات التحميل/الانتظار فور بدء بثٍ فعلي — يرفع التغطية ويعرض الصوت والصورة. */
  const markPlaying = () => {
    setHealth('green');
    setReconnecting(false);
    setHint(null);
    playedOnceRef.current = true;
  };

  const clearLoading = () => setHealth('green');
  const markWaiting = () => setHealth('yellow');

  /** إظهار البث داخل iframe مضمَّن في نفس النافذة بدل أي تبويب خارجي. */
  const embedInIframe = () => {
    setReconnecting(false);
    setHealth('green');
    setHint(null);
    playedOnceRef.current = true;
    setShowIframe(true);
  };

  /** تزامن حالة ملء الشاشة مع أي تغيير من المتصفح (Esc / زر الدخول / زر الخروج). */
  useEffect(() => {
    const sync = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  /**
   * الدخول/الخروج من ملء الشاشة على كاملِ حاوية المشغّل (header + شاشة الفيديو + العلامة
   * المائية) وليس على عنصر <video> وحده — هكذا تبقى علامة البث/الشعار ظاهرة دائماً
   * حتى في وضع ملء الشاشة وتغطي شعار القناة الخارجية.
   */
  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    if (el.requestFullscreen) {
      void el.requestFullscreen().catch(() => { /* تجاهل حالات الرفض (تركيز/تصريح) */ });
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    // الوضع القياسي: <video controls autoPlay> أو <iframe> — لا محركات وسيطة في الحالتين.
    if (!video || isNative || showIframe) return;

    let disposed = false;
    const events: Array<[string, () => void]> = [
      ['playing', markPlaying],
      ['canplay', clearLoading],
      ['loadeddata', clearLoading],
      ['waiting', markWaiting],
      ['stalled', markWaiting],
    ];
    events.forEach(([ev, fn]) => video.addEventListener(ev, fn));

    /** تدمير أي محركات سابقة بطريقتها الرسمية فقط داخل try-catch — لا لمس لبنية العنصر. */
    const detachEngines = () => {
      if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
      if (mpegtsRef.current) {
        try { mpegtsRef.current.destroy(); } catch { /* تجاهل */ }
        mpegtsRef.current = null;
      }
      if (hlsRef.current) {
        try { hlsRef.current.destroy(); } catch { /* تجاهل */ }
        hlsRef.current = null;
      }
    };

    // محتوى مختلط: المتصفح يرفض http على صفحة https قبل أي طلب — يُنبّه فوراً دون انتظار الخطأ
    // (عند تفعيل الوكيل يكون fetchUrl https فلا يظهر هذا التنبيه — فقط عند الاتصال المباشر).
    try {
      if (window.location.protocol === 'https:' && new URL(fetchUrl, window.location.href).protocol === 'http:') {
        setHint(MIXED_CONTENT_HINT);
      }
    } catch {
      /* تجاهل الروابط غير الصالحة */
    }

    const engines = pickEngines(fetchUrl);
    let attempt = 0;
    let fatalRetries = 0;

    /** عودة آمنة إلى عنصر <video> القياسي: نُطلق سراح المحركات ثم يرسل React src مباشرة. */
    const fallbackToNative = () => {
      if (disposed || isNative) return;
      detachEngines();
      setReconnecting(false);
      setHealth('yellow');
      setHint((prev) => prev ?? NATIVE_FALLBACK_HINT);
      setIsNative(true);
    };

    const scheduleRetry = () => {
      if (disposed || retryRef.current) return;
      setHealth('red');
      setReconnecting(true);
      retryRef.current = setTimeout(() => {
        retryRef.current = null;
        if (disposed) return;
        setReconnecting(false);
        setHealth('yellow');
        if (hlsRef.current) { try { hlsRef.current.destroy(); } catch { /* تجاهل */ } hlsRef.current = null; }
        if (mpegtsRef.current) { try { mpegtsRef.current.destroy(); } catch { /* تجاهل */ } mpegtsRef.current = null; }
        attempt = 0;
        fatalRetries = 0;
        startEngine();
      }, 3000);
    };

    // عند فشل فادح قبل أول تشغيل ناجح: يُرجَّح أنه حجب CORS / إذن المتصفح أو سيرفر IPTV غير جاهز.
    const onBlocked = () => {
      if (!playedOnceRef.current && !disposed) setHint(IPTV_BLOCK_HINT);
    };

    /**
     * فشل في جلب البث بسبب حجب المحتوى المختلط/الوكيل:
     * يتحول المشغّل إلى عرض <iframe> مضمَّن في نفس النافذة (بلا تبويبات خارجية).
     */
    const onLoadBlocked = () => {
      if (disposed || playedOnceRef.current) return;
      setHint(IFRAME_FALLBACK_HINT);
      embedInIframe();
    };

    /** تركيب محرك HLS عبر hls.js (أو التشغيل الأصلي عند غياب دعمه في المتصفح). */
    const startHls = () => {
      if (!video) return;
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true, // فكّ الترميز في Worker لكسر الأعطال الناتجة عن حجب الواجهة
          // تخفيف مطاردة التأخير لتفادي التقطّع المتكرر، مع مخزن خلفي/أمامي أكبر.
          lowLatencyMode: false,
          backBufferLength: 90,
          maxBufferLength: 45,
          maxBufferSize: 60 * 1000 * 1000, // 60MB كحدّ أقصى للمخزن
          maxBufferHole: 1.2,
          maxMaxBufferLength: 180,
          liveDurationInfinity: true,
          manifestLoadingMaxRetry: 3,
          levelLoadingMaxRetry: 4,
          fragLoadingMaxRetry: 6,
          manifestLoadingRetryDelay: 500,
          levelLoadingRetryDelay: 500,
          fragLoadingRetryDelay: 500,
        });
        hlsRef.current?.destroy();
        hlsRef.current = hls;
        hls.loadSource(fetchUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setHealth('yellow');
          void video.play().catch(() => setHealth('yellow'));
        });
        hls.on(Hls.Events.ERROR, (_evt, data) => {
          if (disposed) return;
          if (!data.fatal) { setHealth('yellow'); return; }
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            // انقطاع الشبكة بعد تشغيل ناجح → إعادة تشغيل السلسلة كاملة بعد 3 ثوانٍ.
            // أما فشل الجلب قبل أول تشغيل فهو غالباً حجب mixed content أو سيرفر غير جاهز.
            if (playedOnceRef.current) {
              scheduleRetry();
              return;
            }
            // فشل جلب القائمة/المقاطع — غالباً حجب mixed content أو سيرفر غير جاهز.
            onBlocked();
            if (data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR || data.details === Hls.ErrorDetails.LEVEL_LOAD_ERROR) {
              onLoadBlocked();
              return;
            }
            nextEngine();
            return;
          }
          // خطأ وسائط فادح: محاولة استعادة داخل نفس محرك hls قبل الهبوط للمحرك التالي.
          if (fatalRetries < 2) {
            fatalRetries += 1;
            hls.recoverMediaError();
            hls.startLoad();
            setHealth('yellow');
            return;
          }
          nextEngine();
        });
      } else {
        // هبوط أصلي (Safari يدعم HLS أحياناً) — يُحمل الرابط مباشرة على عنصر <video>.
        video.src = fetchUrl;
        void video.play().catch(() => setHealth('yellow'));
      }
    };

    /** تركيب محرك MPEG-TS الخام عبر mpegts.js داخل المتصفح (MediaSource). */
    const startMpegts = () => {
      if (!video) return;
      if (!mpegts.isSupported()) { nextEngine(); return; }
      let stream: ReturnType<typeof mpegts.createPlayer> | null = null;
      try {
        stream = mpegts.createPlayer(
          { type: 'mpegts', isLive: true, url: fetchUrl },
          {
            enableWorker: true,
            enableStashBuffer: true,
            // مخزن مبدئي أكبر (512KB) ليتفوق على تقطّع الشبكة قبل امتلاء المخزن.
            stashInitialSize: 512 * 1024,
            isLive: true,
            // إيقاف مطاردة التأخير العدوانية — هي مسبب رئيسي للتقطّع/الاهتزاز كل بضع ثوانٍ.
            liveBufferLatencyChasing: false,
            liveBufferLatencyMaxLatency: 5,
            liveBufferLatencyMinRemain: 1.5,
            lazyLoadMaxDuration: 60,
            autoCleanupSourceBuffer: true,
          },
        );
      } catch {
        // فشل في إنشائها (مثل رابط لا يفسّر في Workere fetch) — هبوط فوري للمشغل المضمَّن.
        onLoadBlocked();
        return;
      }
      mpegtsRef.current?.destroy();
      mpegtsRef.current = stream;
      stream.attachMediaElement(video);
      stream.on(mpegts.Events.ERROR, (_type, details, _info) => {
        if (disposed) return;
        setHealth('yellow');
        // فشل في جلب حزمة البث نفسها (network/loader error) — حجب mixed content غالباً،
        // أو انقطاع مباشر بعد تشغيل ناجح (يُعاد التشغيل تلقائياً بعد 3 ثوانٍ).
        if (details === mpegts.ErrorDetails.NETWORK_EXCEPTION || details === mpegts.ErrorDetails.NETWORK_STATUS_CODE_INVALID
          || details === mpegts.ErrorDetails.NETWORK_TIMEOUT || details === mpegts.ErrorDetails.NETWORK_UNRECOVERABLE_EARLY_EOF) {
          if (playedOnceRef.current) {
            scheduleRetry();
            return;
          }
          onBlocked();
          if (details === mpegts.ErrorDetails.NETWORK_EXCEPTION || details === mpegts.ErrorDetails.NETWORK_STATUS_CODE_INVALID) {
            onLoadBlocked();
            return;
          }
          nextEngine();
          return;
        }
        // صيغة/ترميز غير مدعوم هنا: الهبوط للمحرك التالي (hls ثم تدريجي أو المصدر المباشر).
        if (details === mpegts.ErrorDetails.MEDIA_FORMAT_UNSUPPORTED || details === mpegts.ErrorDetails.MEDIA_CODEC_UNSUPPORTED) {
          onBlocked();
          nextEngine();
          return;
        }
        if (mpegtsRef.current && fatalRetries < 2) {
          fatalRetries += 1;
          // إعادة تشغيل نفس البث داخل mpegts (unload+load) قبل الهبوط للمحرك التالي.
          mpegtsRef.current.unload();
          mpegtsRef.current.load();
          return;
        }
        onBlocked();
        nextEngine();
      });
      try {
        stream.load();
      } catch {
        onLoadBlocked();
        return;
      }
      setHealth('yellow');
      void Promise.resolve(stream.play()).catch(() => setHealth('yellow'));
    };

    /** تشغيل المتصفح المباشر على عنصر <video> (mp4/webm/… أو الرابط الخام). */
    const startProgressive = () => {
      if (!video) return;
      video.src = fetchUrl;
      void video.play().catch(() => setHealth('yellow'));
    };

    const startEngine = () => {
      if (disposed) return;
      const engine = engines[attempt];
      if (engine === 'mpegts') startMpegts();
      else if (engine === 'hls') startHls();
      else if (engine === 'progressive') startProgressive();
      else nextEngine();
    };

    /** الانتقال للمحرك التالي في الترتيب؛ وإن نضبت المحاولات نهائياً: عودة سلسة للمشغل القياسي. */
    const nextEngine = () => {
      if (disposed) return;
      attempt += 1;
      fatalRetries = 0;
      if (attempt >= engines.length) {
        fallbackToNative();
        return;
      }
      startEngine();
    };

    const boot = () => {
      if (disposed) return;
      if (!video.isConnected || !document.contains(video)) {
        requestAnimationFrame(boot);
        return;
      }
      startEngine();
    };

    requestAnimationFrame(boot);

    return () => {
      disposed = true;
      events.forEach(([ev, fn]) => video.removeEventListener(ev, fn));
      if (mpegtsRef.current) {
        try { mpegtsRef.current.pause(); } catch { /* تجاهل */ }
      }
      detachEngines();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchUrl, isNative, showIframe]);

  // البث المباشر مخصص للمدير فقط — أي دخول بحساب موظف يُغلَق بعرض رسالة وصول ممنوع.
  if (user?.role !== 'admin') {
    return (
      <div className="overlay" onClick={onClose}>
        <div className="modal video-modal" onClick={(e) => e.stopPropagation()}>
          <div className="vp-header">
            <div className="vp-title-wrap"><strong>{title}</strong></div>
            <button className="x" onClick={onClose} aria-label="إغلاق المشغّل"><X size={18} /></button>
          </div>
          <div className="vp-stage vp-lock">
            <span>🔒</span>
            <p>البث المباشر متاح للمدير فقط</p>
            <button className="btn ghost" onClick={onClose}>إغلاق</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal video-modal" ref={containerRef} onClick={(e) => e.stopPropagation()}>
        <div className="vp-header">
          <div className="vp-title-wrap">
            <span className="vp-health-stream"><i className={`vp-led vp-led-${health}`} />
              {health === 'green' ? HEALTH_LABEL.green : health === 'yellow' ? (reconnecting ? 'جاري إعادة الاتصال…' : HEALTH_LABEL.yellow) : HEALTH_LABEL.red}
            </span>
            <strong>{title}</strong>
          </div>
          <div className="vp-header-actions">
            <button
              type="button"
              className="vp-fs"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? 'إنهاء وضع ملء الشاشة' : 'ملء الشاشة'}
              title={isFullscreen ? 'إنهاء وضع ملء الشاشة' : 'ملء الشاشة'}
            >
              {isFullscreen ? <Minimize size={17} /> : <Maximize size={17} />}
            </button>
            <button className="x" onClick={onClose} aria-label="إغلاق المشغّل"><X size={18} /></button>
          </div>
        </div>

        <div className="vp-stage">
          <div className="vp-brand" title={config.siteName}>
            <svg className="vp-brand-ball" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6" />
              <path
                d="M12 7.2l3.2 1.2 1 3.4-2.4 2.4-3.6 0-2.4-2.4 1-3.4z"
                fill="rgba(255,255,255,0.14)"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
              <path
                d="M12 7.2V4.6M15.2 8.4l2.4-1.6M16.2 11.8l2.7 1.2M12 14.2v3.4M7.8 11.8l-2.7 1.2M8.8 8.4L6.4 6.8"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
            <span>{config.siteName}</span>
            <span className="live-dot-pulse" title="البث مباشر" aria-label="البث مباشر" />
          </div>
          {reconnecting && (
            <span className="vp-retry">
              <i className="vp-led vp-led-amber" />
              انقطع الاتصال — إعادة المحاولة خلال 3 ثوانٍ…
            </span>
          )}
          {hint && (
            <span className="vp-warn" role="alert">
              ⚠️ {hint}
            </span>
          )}

          {showIframe ? (
            <iframe
              key={fetchUrl}
              src={fetchUrl}
              className="vp-frame w-full h-full"
              allow="autoplay; fullscreen; encrypted-media"
              referrerPolicy="no-referrer"
              title="بث مباشر"
            />
          ) : (
            <video
              key={fetchUrl}
              ref={videoRef}
              className="vp-frame w-full h-full"
              controls
              controlsList="nofullscreen noremoteplayback nodownload"
              disablePictureInPicture
              autoPlay
              playsInline
              {...(isNative ? { src: fetchUrl } : {})}
              poster=""
              onPlaying={markPlaying}
              onCanPlay={clearLoading}
              onLoadedData={clearLoading}
              onWaiting={markWaiting}
              onStalled={markWaiting}
              onError={() => { setHealth('red'); setHint((prev) => prev ?? NATIVE_FALLBACK_HINT); }}
            />
          )}
        </div>
      </div>
    </div>
  );
}