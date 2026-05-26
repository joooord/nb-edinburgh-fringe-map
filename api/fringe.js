/**
 * Vercel serverless function: signed proxy for the Edinburgh Festivals Listings API.
 *
 * The Edinburgh Festivals Listings API requires HMAC-SHA1 request signing with
 * a per-project access key + secret token. Those credentials must not appear
 * in client-side code, so this function signs requests server-side.
 *
 * To enable live data on this map:
 *   1. Register at https://api.edinburghfestivalcity.com and request a key.
 *   2. Apply for Fringe approval (see /documentation/fringe_approval).
 *   3. Set FRINGE_API_KEY and FRINGE_API_SECRET as Vercel env vars.
 *   4. Until approval is granted, the demofringe dataset is available with any
 *      valid key (set ?festival=demofringe).
 *
 * Endpoints proxied:
 *   GET /api/fringe?endpoint=events&...filters
 *   GET /api/fringe?endpoint=venues&...filters
 *
 * Per API licence: only edfringe.com links may be presented to users.
 */

const crypto = require('crypto');

const API_BASE = 'https://api.edinburghfestivalcity.com';
const ALLOWED_ENDPOINTS = new Set(['events', 'venues']);

module.exports = async (req, res) => {
  const apiKey = process.env.FRINGE_API_KEY;
  const apiSecret = process.env.FRINGE_API_SECRET;

  if (!apiKey || !apiSecret) {
    res.status(503).json({
      error: 'fringe_api_not_configured',
      message: 'Live Fringe data is not enabled. Set FRINGE_API_KEY and FRINGE_API_SECRET in Vercel.',
      docs: 'https://api.edinburghfestivalcity.com/documentation/fringe_approval',
    });
    return;
  }

  // Parse query params
  const url = new URL(req.url, 'http://localhost');
  const endpoint = url.searchParams.get('endpoint');
  if (!endpoint || !ALLOWED_ENDPOINTS.has(endpoint)) {
    res.status(400).json({ error: 'bad_endpoint', allowed: [...ALLOWED_ENDPOINTS] });
    return;
  }

  // Build the signed query string
  const params = new URLSearchParams();
  for (const [k, v] of url.searchParams.entries()) {
    if (k === 'endpoint') continue;
    params.append(k, v);
  }
  params.set('key', apiKey);

  const path = `/${endpoint}?${params.toString()}`;
  const signature = crypto.createHmac('sha1', apiSecret).update(path).digest('hex');
  const finalUrl = `${API_BASE}${path}&signature=${signature}`;

  try {
    const upstream = await fetch(finalUrl, {
      headers: { 'User-Agent': 'NorthernBelle-FringeMap/1.0' },
    });
    const body = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    // Cache aggressively at the edge: API recommends >= 24h freshness, we use 1h
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    res.send(body);
  } catch (err) {
    res.status(502).json({ error: 'upstream_error', message: err.message });
  }
};
