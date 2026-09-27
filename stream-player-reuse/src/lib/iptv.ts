/**
 * iptv.ts — Pure, dependency-free helpers for the reusable IPTV stream engine.
 *
 * Everything here is a plain function / type shared by <VideoPlayerModal />.
 * No React, no store, no browser globals other than window/URL which are
 * expected at runtime. You can paste these helpers verbatim into any app.
 *
 * PROXY-BASED PLAYBACK:
 * Raw IPTV hosts (ugeen.live:8080) serve HTTP-only MPEG-TS, which a browser
 * blocks as mixed content on an HTTPS page. The player therefore routes those
 * links through a Cloudflare Worker (HTTP → HTTPS relay) — pass its mount
 * path / full URL as `proxyUrl` (default "/iptv-stream"). When left empty the
 * player falls back to direct connection.
 *
 * The three jobs of this module:
 *   1) Normalize raw IPTV URLs — ALWAYS emit http:// and never upgrade to https
 *      (the upstream serves NO TLS; https links throw net::ERR_SSL_PROTOCOL_ERROR).
 *   2) Rewrite raw IPTV URLs through the Worker proxy, preserving path + query
 *      (the Worker strips its mount prefix and forwards to ugeen.live:8080).
 *   3) Detect the stream shape (.m3u8 / mp4 / raw TS) so the player can order
 *      its engines correctly before trying to boot anything.
 */

/**
 * Normalize a stream URL:
 * - trims whitespace,
 * - ALWAYS forces the http: protocol (never https) for any http/https link,
 *   because the IPTV upstream provides no TLS and browsers hard-fail with
 *   net::ERR_SSL_PROTOCOL_ERROR otherwise.
 *
 * Invalid input is returned untouched so downstream code can still show it.
 */
export function normalizeStreamUrl(raw: string): string {
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

/** True when the link points at the IPTV origin (ugeen.live or :8080) — only these go through the Worker. */
export function isIptvOrigin(url: string): boolean {
  try {
    const u = new URL(url, window.location.href);
    return /(^|\.)ugeen\.live$/i.test(u.hostname) || u.port === '8080';
  } catch {
    return false;
  }
}

/**
 * Rewrite a raw IPTV URL through the Cloudflare Worker proxy, preserving the
 * full path and query string. Example:
 *
 *   toProxiedUrl("http://ugeen.live:8080/Ugeen_01unbG/N8ffGj/46?token=1", "/iptv-stream")
 *   → "http://localhost:5173/iptv-stream/Ugeen_01unbG/N8ffGj/46?token=1"
 *
 * A relative base ("/iptv-stream") is absolutized against window.location.origin
 * because the decode engines run inside a Web Worker whose fetch() rejects
 * relative URLs. When `proxyUrl` is empty the URL is returned untouched (direct).
 */
export function toProxiedUrl(url: string, proxyUrl: string): string {
  const base = proxyUrl?.trim();
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

/** True when the link is a progressive file the browser can play natively. */
export function isProgressiveVideo(url: string): boolean {
  return /\.(mp4|webm|ogg|ogv|mov)(\?|#|$)/i.test(url);
}

/** True when the link is explicitly an HLS playlist (.m3u8). */
export function isHlsManifest(url: string): boolean {
  return /\.m3u8(\?|#|$)/i.test(url) || /application\/x-mpegURL/i.test(url) || /m3u8/i.test(url);
}

/** Decode engines available in the browser, in the order to try them. */
export type Engine = 'mpegts' | 'hls' | 'progressive';

/**
 * Order the engine cascade by the shape of the URL:
 *  - raw IPTV (.ts / bare :8080) → mpegts.js first (in-browser MPEG2-TS
 *    demuxing + MediaSource), then hls.js, then the native <video> element.
 *  - HLS playlists → hls.js first, then native.
 *  - progressive files (mp4/webm/mov) → native <video> directly.
 */
export function pickEngines(url: string): Engine[] {
  if (isProgressiveVideo(url)) return ['progressive'];
  if (isHlsManifest(url)) return ['hls', 'progressive'];
  return ['mpegts', 'hls', 'progressive'];
}