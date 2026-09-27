import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// المنفذ الذي توفره المنصة (PORT) أو 8787 للتطوير المحلي
const PORT = Number(process.env.PORT) || 8787;
const UPSTREAM_BASE = (process.env.UPSTREAM_BASE || 'http://ugeen.live:8080').replace(/\/+$/, '');
const DEFAULT_UA = process.env.DEFAULT_UA || 'VLC/3.0.18 LibVLC/3.0.18';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Cache-Control': 'no-store',
};

app.disable('x-powered-by');

// ── وكيل /iptv-stream ─────────────────────────────────────────────
// يمرّر طلبات البث إلى الخادم الأصلي من عنوان IP عادي (ليس Cloudflare).
// نفس فلسفة ترويسات Cloudflare Worker السابقة: UA افتراضية VLC، ولا Referer/Origin
// تلقائي، وحذف ترويسات الكشف عن IP الحقيقي، وتحكم يدوي عبر Query / X-Iptv-*.
app.use('/iptv-stream', (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, corsHeaders);
    res.end('Method Not Allowed');
    return;
  }

  const clientUrl = new URL(req.originalUrl, 'http://internal/');
  let upstreamPath = clientUrl.pathname.replace(/^\/iptv-stream/, '');
  if (!upstreamPath) upstreamPath = '/';

  // باراميترات التحكم بالترويسات (تُشذَّب قبل رسالها للخادم الأصلي)
  const control = clientUrl.searchParams;
  const opt = (pname, hname, fallback) => {
    if (control.has(pname)) {
      const v = (control.get(pname) || '').trim();
      if (v && v !== '-') return v;
      return null; // "-" أو فارغ = حذف الترويسة
    }
    const h = req.headers[hname.toLowerCase()];
    if (h) return h;
    return fallback ?? null;
  };

  for (const k of ['ua', 'referer', 'origin', 'accept', 'xff']) control.delete(k);
  const upstream = `${UPSTREAM_BASE}${upstreamPath}${control.toString() ? '?' + control.toString() : ''}`;

  // ترويسات الطلب الصادرة — بالتخفي كامل: نتقمّص Player عادي، ولا نكشف IP الزائر
  const outHeaders = {};
  const ua = opt('ua', 'x-iptv-ua', DEFAULT_UA);
  if (ua) outHeaders['User-Agent'] = ua;
  outHeaders['Accept'] = opt('accept', 'accept', '*/*');
  const referer = opt('referer', 'x-iptv-referer', null);
  if (referer) outHeaders['Referer'] = referer;
  const origin = opt('origin', 'x-iptv-origin', null);
  if (origin) outHeaders['Origin'] = origin;
  const xff = opt('xff', 'x-iptv-xff', null);
  if (xff) {
    outHeaders['X-Forwarded-For'] = xff;
    outHeaders['X-Real-IP'] = xff;
  }
  if (req.headers.range) outHeaders['Range'] = req.headers.range;
  if (req.headers.cookie) outHeaders['Cookie'] = req.headers.cookie;

  const upstreamReq = http.request(upstream, { method: req.method, headers: outHeaders }, (upRes) => {
    // تمرير ترويسات الاستجابة الأصلية مع إسقاط ترويسات النقل المزوّفة وترويسات الأمان الكاسرة للبث
    const headers = { ...corsHeaders };
    for (const [k, v] of Object.entries(upRes.headers)) {
      const lower = k.toLowerCase();
      if (['connection', 'keep-alive', 'transfer-encoding', 'x-frame-options', 'content-security-policy'].includes(lower)) continue;
      headers[k] = v;
    }
    res.writeHead(upRes.statusCode || 502, headers);
    if (req.method === 'HEAD') {
      upRes.resume();
      res.end();
    } else {
      upRes.pipe(res);
    }
  });

  upstreamReq.setTimeout(30000, () => upstreamReq.destroy(new Error('Upstream timeout')));
  upstreamReq.on('error', (err) => {
    if (!res.headersSent) res.writeHead(502, corsHeaders);
    res.end(`Upstream error: ${err.message}`);
  });
  req.on('close', () => upstreamReq.destroy());
  upstreamReq.end();
});

// ── تقديم البناء الساكن (dist) على نفس الأصل ──────────────────────
const distDir = path.resolve(__dirname, '..', 'dist');
if (fs.existsSync(path.join(distDir, 'index.html'))) {
  app.use(express.static(distDir, { index: 'index.html' }));
  app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
} else {
  console.warn(`Building folder not found at ${distDir}; run "npm run build". Only /iptv-stream is active.`);
}

app.listen(PORT, () => {
  console.log(`Proxy server listening on http://localhost:${PORT}`);
  console.log(`Upstream: ${UPSTREAM_BASE} | default UA: ${DEFAULT_UA}`);
});