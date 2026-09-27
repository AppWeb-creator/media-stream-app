/**
 * VideoPlayerModal.tsx — Reusable, standalone live-stream player for
 * React + Vite. Handles raw IPTV (.ts / bare :8080), HLS (.m3u8) and
 * progressive video (mp4/webm/mov) with a single <video> element owned
 * 100% by React.
 *
 * ── What ships in this box ─────────────────────────────────────────────
 * 1) In-browser decoding via mpegts.js + hls.js (MediaSource), with a
 *    deterministic engine cascade:
 *        raw IPTV   → mpegts  → hls  → native <video> → embedded <iframe>
 *        HLS        → hls     → native <video>        → embedded <iframe>
 *        progressive→ native <video> (no engines touched at all)
 * 2) No manual DOM mutation ANYWHERE. No appendChild/removeChild/replace
 *    calls on the video element — engines only attach via
 *    attachMedia/attachMediaElement and are torn down with their official
 *    destroy() inside try/catch. That eliminated a class of
 *    "NotFoundError: Failed to execute 'removeChild'" crashes.
 * 3) Cloudflare Worker streaming proxy (prop `proxyUrl`, default "/iptv-stream"):
 *    raw IPTV links (ugeen.live:8080) are rewritten through the Worker so they
 *    load as HTTPS for ALL visitors — no mixed-content or CORS blocks. Set
 *    `proxyUrl=""` to connect directly with no proxy.
 * 4) Protocol: every output link is http:// — never upgraded to https
 *    (the IPTV upstream serves no TLS; https throws
 *    net::ERR_SSL_PROTOCOL_ERROR).
 * 5) Fullscreen on the whole modal container (header + stage + watermark),
 *    so the watermark stays on top of the channel's own logo while fullscreen.
 * 6) Watermark pill (brand text) with an animated football + pulsing green
 *    "live" dot, an error/warning overlay stack, and health LEDs in the header.
 *
 * ── Runtime dependencies ───────────────────────────────────────────────
 *   react, react-dom, hls.js, mpegts.js   (icons are inlined, lucide optional)
 *
 * ── Dev-mode note ──────────────────────────────────────────────────────
 * The dev Vite config (same folder) mirrors "/iptv-stream" to the local
 * Node proxy `server/index.js` (Express), which relays to the IPTV upstream
 * from a normal (non-Cloudflare) IP. If the browser blocks a stream, check
 * that server's route and CORS headers.
 */

import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import { normalizeStreamUrl, isIptvOrigin, toProxiedUrl, pickEngines } from './lib/iptv';

/** Stream health shown in the header: green healthy / yellow buffering / red dropped. */
type StreamHealth = 'green' | 'yellow' | 'red';

/** Props for the reusable player. */
export interface VideoPlayerModalProps {
  /** Match/event title shown in the header. */
  title: string;
  /** Raw stream URL (IPTV :8080, .m3u8, .mp4, webm, …). */
  url: string;
  /** Called when the user closes the modal. */
  onClose: () => void;
  /** Cloudflare Worker proxy base (default "/iptv-stream"). Empty = direct connection. */
  proxyUrl?: string;
  /** Watermark text inside the brand pill (default "LIVE"). */
  brandName?: string;
  /** When true, render an access-denied lock screen instead of the player. */
  locked?: boolean;
  /** Text for the access-denied lock screen. */
  lockMessage?: string;
}

const HEALTH_LABEL: Record<StreamHealth, string> = {
  green: 'Live OK',
  yellow: 'Buffering…',
  red: 'Stream dropped',
};

const LOCK_MESSAGE = 'Live stream is available for admin accounts only';

const IPTV_BLOCK_HINT = 'Blocked: the IPTV server needs browser permission or a native player';
const MIXED_CONTENT_HINT = 'Warning: HTTP stream on an HTTPS page — the browser may block mixed content.';
const NATIVE_FALLBACK_HINT =
  'Advanced engines failed — playing in the browser directly. If the screen stays black, the server rejects the stream or the link is incompatible.';
const IFRAME_FALLBACK_HINT = 'Advanced engines failed — embedded the stream inside the player.';

/* Inline icons (lucide-free) so the engine has exactly three runtime deps. */
const XIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);
const MaximizeIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
  </svg>
);
const MinimizeIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" />
  </svg>
);

export function VideoPlayerModal({
  title,
  url,
  onClose,
  proxyUrl = '/iptv-stream',
  brandName = 'LIVE',
  locked = false,
  lockMessage = LOCK_MESSAGE,
}: VideoPlayerModalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const mpegtsRef = useRef<ReturnType<typeof mpegts.createPlayer> | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playedOnceRef = useRef(false);
  const [health, setHealth] = useState<StreamHealth>('yellow');
  const [reconnecting, setReconnecting] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [isNative, setIsNative] = useState(false);
  const [showIframe, setShowIframe] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  /**
   * Request URL pipeline:
   *   1. normalize (ALWAYS output http://, never https),
   *   2. raw IPTV links are rewritten through the Cloudflare Worker proxy
   *      (path + query preserved) so the stream plays on an HTTPS page without
   *      mixed-content/CORS blocks. Other links stay untouched.
   */
  const streamUrl = normalizeStreamUrl(url);
  const fetchUrl = isIptvOrigin(streamUrl) ? toProxiedUrl(streamUrl, proxyUrl) : streamUrl;

  /** Clear every loading/waiting state the moment a real frame plays. */
  const markPlaying = () => {
    setHealth('green');
    setReconnecting(false);
    setHint(null);
    playedOnceRef.current = true;
  };

  const clearLoading = () => setHealth('green');
  const markWaiting = () => setHealth('yellow');

  /** Show the stream inside an <iframe> embedded in this same modal. */
  const embedInIframe = () => {
    setReconnecting(false);
    setHealth('green');
    setHint(null);
    playedOnceRef.current = true;
    setShowIframe(true);
  };

  /** Keep the fullscreen icon in sync with browser changes (Esc, toggle). */
  useEffect(() => {
    const sync = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  /** Enter/exit fullscreen on the whole modal container — not just <video> —
   * so the watermark/logo stays visible and covers the channel's own logo
   * even in fullscreen mode. */
  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    if (el.requestFullscreen) {
      void el.requestFullscreen().catch(() => {
        /* ignore denial (focus/permission) */
      });
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    // Native mode and iframe mode render their own element — no engines to wire.
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

    /** Tear down engines strictly via their official destroy() + try/catch. */
    const detachEngines = () => {
      if (retryRef.current) {
        clearTimeout(retryRef.current);
        retryRef.current = null;
      }
      if (mpegtsRef.current) {
        try {
          mpegtsRef.current.destroy();
        } catch {
          /* ignore */
        }
        mpegtsRef.current = null;
      }
      if (hlsRef.current) {
        try {
          hlsRef.current.destroy();
        } catch {
          /* ignore */
        }
        hlsRef.current = null;
      }
    };

    // Mixed content: browsers refuse http-on-https before ANY request fires.
    // Detect it up-front so we can warn immediately instead of waiting for an
    // obscure network error.
    try {
      if (window.location.protocol === 'https:' && new URL(streamUrl, window.location.href).protocol === 'http:') {
        setHint(MIXED_CONTENT_HINT);
      }
    } catch {
      /* malformed URL — ignore */
    }

    const engines = pickEngines(fetchUrl);
    let attempt = 0;
    let fatalRetries = 0;

    /** Safe return to the standard <video> element: release engines, then let
     * React drop the src in directly (see the `isNative` branch of the JSX). */
    const fallbackToNative = () => {
      if (disposed || isNative) return;
      detachEngines();
      setReconnecting(false);
      setHealth('yellow');
      setHint((prev) => prev ?? NATIVE_FALLBACK_HINT);
      setIsNative(true);
    };

    /** Retry the whole cascade after a 3s cooldown when a live stream drops. */
    const scheduleRetry = () => {
      if (disposed || retryRef.current) return;
      setHealth('red');
      setReconnecting(true);
      retryRef.current = setTimeout(() => {
        retryRef.current = null;
        if (disposed) return;
        setReconnecting(false);
        setHealth('yellow');
        if (hlsRef.current) {
          try {
            hlsRef.current.destroy();
          } catch {
            /* ignore */
          }
          hlsRef.current = null;
        }
        if (mpegtsRef.current) {
          try {
            mpegtsRef.current.destroy();
          } catch {
            /* ignore */
          }
          mpegtsRef.current = null;
        }
        attempt = 0;
        fatalRetries = 0;
        startEngine();
      }, 3000);
    };

    /** A fatal failure before the first successful frame usually means CORS/
     * mixed-content/permission or the IPTV server isn't ready — surface a hint. */
    const onBlocked = () => {
      if (!playedOnceRef.current && !disposed) setHint(IPTV_BLOCK_HINT);
    };

    /** Fetch-level block (mixed content / proxy): hand off to the embedded
     * <iframe> view rather than an external tab. */
    const onLoadBlocked = () => {
      if (disposed || playedOnceRef.current) return;
      setHint(IFRAME_FALLBACK_HINT);
      embedInIframe();
    };

    /** Boot hls.js (native playback when the browser doesn't support HLS via
     * MediaSource, e.g. older Safari, which can sometimes play it natively). */
    const startHls = () => {
      if (!video) return;
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true, // decode in a Worker so UI jank can't stutter playback
          // Aggressive latency chasing is the main culprit behind periodic
          // choppy buffering — disable it and keep a generous front/back buffer.
          lowLatencyMode: false,
          backBufferLength: 90,
          maxBufferLength: 45,
          maxBufferSize: 60 * 1000 * 1000, // 60 MB cap for the buffer
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
          if (!data.fatal) {
            setHealth('yellow');
            return;
          }
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            // Mid-stream network drop → full restart of the whole cascade.
            // Cold-start manifest failures are usually CORS/mixed-content and
            // hand off to the embedded iframe view instead.
            if (playedOnceRef.current) {
              scheduleRetry();
              return;
            }
            onBlocked();
            if (
              data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR ||
              data.details === Hls.ErrorDetails.LEVEL_LOAD_ERROR
            ) {
              onLoadBlocked();
              return;
            }
            nextEngine();
            return;
          }
          // Fatal MediaError — try recovering inside hls.js before falling
          // through to the next engine.
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
        // Native fallback: feed the raw URL straight to the <video> element.
        video.src = fetchUrl;
        void video.play().catch(() => setHealth('yellow'));
      }
    };

    /** Boot raw MPEG-TS streaming through mpegts.js (in-browser MediaSource). */
    const startMpegts = () => {
      if (!video) return;
      if (!mpegts.isSupported()) {
        nextEngine();
        return;
      }
      let stream: ReturnType<typeof mpegts.createPlayer> | null = null;
      try {
        stream = mpegts.createPlayer(
          { type: 'mpegts', isLive: true, url: fetchUrl },
          {
            enableWorker: true,
            enableStashBuffer: true,
            // A bigger initial stash (512 KB) absorbs network bursts before the
            // buffer drains and the player would otherwise stall.
            stashInitialSize: 512 * 1024,
            isLive: true,
            // Switching off aggressive latency chasing — a major source of the
            // every-few-seconds choppiness/stutter on live IPTV.
            liveBufferLatencyChasing: false,
            liveBufferLatencyMaxLatency: 5,
            liveBufferLatencyMinRemain: 1.5,
            lazyLoadMaxDuration: 60,
            autoCleanupSourceBuffer: true,
          },
        );
      } catch {
        // Player construction failed (e.g. a URL the Worker fetch can't parse) —
        // jump straight to the embedded view.
        onLoadBlocked();
        return;
      }
      mpegtsRef.current?.destroy();
      mpegtsRef.current = stream;
      stream.attachMediaElement(video);
      stream.on(mpegts.Events.ERROR, (_type, details, _info) => {
        if (disposed) return;
        setHealth('yellow');
        // Fetch-level errors = mixed-content / server refusing. If the stream
        // already played once, treat it as a live drop and restart after 3s;
        // otherwise this is a cold-start block → hint + iframe view.
        if (
          details === mpegts.ErrorDetails.NETWORK_EXCEPTION ||
          details === mpegts.ErrorDetails.NETWORK_STATUS_CODE_INVALID ||
          details === mpegts.ErrorDetails.NETWORK_TIMEOUT ||
          details === mpegts.ErrorDetails.NETWORK_UNRECOVERABLE_EARLY_EOF
        ) {
          if (playedOnceRef.current) {
            scheduleRetry();
            return;
          }
          onBlocked();
          if (
            details === mpegts.ErrorDetails.NETWORK_EXCEPTION ||
            details === mpegts.ErrorDetails.NETWORK_STATUS_CODE_INVALID
          ) {
            onLoadBlocked();
            return;
          }
          nextEngine();
          return;
        }
        // Unsupported format/codec → drop to the next engine (hls, then native).
        if (
          details === mpegts.ErrorDetails.MEDIA_FORMAT_UNSUPPORTED ||
          details === mpegts.ErrorDetails.MEDIA_CODEC_UNSUPPORTED
        ) {
          onBlocked();
          nextEngine();
          return;
        }
        if (mpegtsRef.current && fatalRetries < 2) {
          fatalRetries += 1;
          // Restart the same stream inside mpegts (unload + load) before
          // falling through to the next engine.
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

    /** Direct browser playback on the <video> element (mp4/webm/raw). */
    const startProgressive = () => {
      if (!video) return;
      video.src = fetchUrl;
      void video.play().catch(() => setHealth('yellow'));
    };

    /** Boot the current attempt's engine, or move past the tail. */
    const startEngine = () => {
      if (disposed) return;
      const engine = engines[attempt];
      if (engine === 'mpegts') startMpegts();
      else if (engine === 'hls') startHls();
      else if (engine === 'progressive') startProgressive();
      else nextEngine();
    };

    /** Advance to the next engine; when exhausted, fall back to native. */
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

    /** The video element may not be attached to the document yet on the first
     * paint (React 18 async). Wait for it with rAF before booting engines —
     * attachMediaElement on a detached node is silently ignored. */
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
        try {
          mpegtsRef.current.pause();
        } catch {
          /* ignore */
        }
      }
      detachEngines();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchUrl, isNative, showIframe]);

  // Access-denied lock screen (optional — pass locked).
  if (locked) {
    return (
      <div className="overlay" onClick={onClose}>
        <div className="modal video-modal" onClick={(e) => e.stopPropagation()}>
          <div className="vp-header">
            <div className="vp-title-wrap">
              <strong>{title}</strong>
            </div>
            <button className="x" onClick={onClose} aria-label="Close player">
              <XIcon />
            </button>
          </div>
          <div className="vp-stage vp-lock">
            <span>🔒</span>
            <p>{lockMessage}</p>
            <button className="btn ghost" onClick={onClose}>Close</button>
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
            <span className="vp-health-stream">
              <i className={`vp-led vp-led-${health}`} />
              {health === 'green'
                ? HEALTH_LABEL.green
                : health === 'yellow'
                  ? reconnecting
                    ? 'Reconnecting…'
                    : HEALTH_LABEL.yellow
                  : HEALTH_LABEL.red}
            </span>
            <strong>{title}</strong>
          </div>
          <div className="vp-header-actions">
            <button
              type="button"
              className="vp-fs"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? <MinimizeIcon /> : <MaximizeIcon />}
            </button>
            <button className="x" onClick={onClose} aria-label="Close player">
              <XIcon />
            </button>
          </div>
        </div>

        <div className="vp-stage">
          {/* Watermark pill: covers the channel's own top-right logo.
              Position it (top/right in stream-player.css) over YOUR target logo. */}
          <div className="vp-brand" title={brandName}>
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
            <span>{brandName}</span>
            <span className="live-dot-pulse" title="Live" aria-label="Live" />
          </div>

          {reconnecting && (
            <span className="vp-retry">
              <i className="vp-led vp-led-amber" />
              Connection lost — retrying in 3 seconds…
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
              title="Live stream"
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
              onError={() => {
                setHealth('red');
                setHint((prev) => prev ?? NATIVE_FALLBACK_HINT);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default VideoPlayerModal;