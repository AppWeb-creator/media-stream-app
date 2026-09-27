/**
 * vite.config.ts — React/Vite config with a local /iptv-stream dev relay.
 *
 * In production the stream is relayed by a Cloudflare Worker at the same path
 * (see project cloudflare-worker/worker.js) so it loads over HTTPS for all
 * visitors. For local development this Vite proxy mirrors that path to the
 * raw HTTP upstream so the player works identically in dev.
 *
 *     http://ugeen.live:8080/Ugeen_01unbG/N8ffGj/46
 *                 ↓          (toProxiedUrl in the player — path/query kept)
 *     http://localhost:5173/iptv-stream/Ugeen_01unbG/N8ffGj/46
 *                 ↓          (this proxy, mount prefix stripped, UA added)
 *     http://ugeen.live:8080/Ugeen_01unbG/N8ffGj/46
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** ← Point this at YOUR IPTV upstream (no trailing slash). */
const IPTV_UPSTREAM = 'http://ugeen.live:8080';

/** Default upstream User-Agent — a modern desktop Chrome */
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Raw IPTV relay: /iptv-stream/<rest> → <IPTV_UPSTREAM>/<rest>
      '/iptv-stream': {
        target: IPTV_UPSTREAM,
        changeOrigin: true,
        // Strip the proxy mount prefix before forwarding upstream.
        rewrite: (path) => path.replace(/^\/iptv-stream/, ''),
        // Fallback User-Agent so protected IPTV servers don't 403 our fetch.
        headers: {
          'User-Agent': DEFAULT_USER_AGENT,
        },
      },
    },
  },
});

/**
 * IMPORTANT — production:
 * A static Vite build exposes NO proxy. Route "/iptv-stream/*" to the Node
 * proxy server `server/index.js` (Express) on the same origin, which forwards
 * to the IPTV upstream from a non-blocked home/server IP.
 */