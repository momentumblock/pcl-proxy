// netlify/functions/proxy.js
// -----------------------------------------------------------------------------
// Port City Luggage — Proxy to Google Apps Script backends
// Back-compat for BOOKING (wildcard CORS like the old proxy) +
// hardened CORS for LOOKUP/MANAGE (mirrored origin + credentials).
// Edited: 2025-08-21 (lean rewrite; behavior preserved)
// -----------------------------------------------------------------------------

/** Small helpers **/
const getHeader = (event, name) =>
  event.headers?.[name] ?? event.headers?.[name.toLowerCase()] ?? '';

const json = (statusCode, headers, bodyObjOrString) => ({
  statusCode,
  headers,
  body: typeof bodyObjOrString === 'string'
    ? bodyObjOrString
    : JSON.stringify(bodyObjOrString),
});

// Build CORS presets
const buildCors = (origin, requestedHeaders) => {
  const base = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin, Access-Control-Request-Headers, Access-Control-Request-Method',
  };
  // Booking = legacy wildcard
  const booking = {
    ...base,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
  };
  // Lookup/manage = mirror origin + allow creds + mirror requested headers
  const lookup = {
    ...base,
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': requestedHeaders || 'content-type',
    ...(origin ? { 'Access-Control-Allow-Credentials': 'true' } : {}),
  };
  return { booking, lookup };
};

// Manage/lookup fn list (+ legacy alias)
const MANAGE_FNS = new Set([
  'manage_lookup',
  'manage_update_address',
  'manage_catalog',
  'extras_checkout',
  'extras_confirm',
]);
const LEGACY_LOOKUP_ALIAS = 'lookup_booking';

// Emergency fallback (keep as-is)
const EMERGENCY_BOOKING_URL =
  'https://script.google.com/macros/s/AKfycbzw412CHbweoMCHIL70TQiHUcPKaBCtkddxHBcs-rFI14yWiI_c-D2ZhW4rhsSkiAxU/exec';

exports.handler = async (event) => {
  const origin = getHeader(event, 'origin') || '';
  const requestedHeaders =
    getHeader(event, 'access-control-request-headers') || 'content-type';
  const { booking: corsBooking, lookup: corsLookup } = buildCors(origin, requestedHeaders);

  // Preflight — permissive so both paths work (unchanged)
  if (event.httpMethod === 'OPTIONS') {
    return json(204, corsBooking, '');
  }

  // Only POST
  if (event.httpMethod !== 'POST') {
    return json(405, { ...corsBooking, 'Content-Type': 'application/json' }, { ok:false, error:'POST_only' });
  }

  // Env: booking (write-capable)
  const GAS_BOOKING_URL =
    process.env.GAS_URL ||
    process.env.APPS_SCRIPT_URL ||
    process.env.SCRIPT_URL ||
    EMERGENCY_BOOKING_URL;

  // Env: lookup/manage (read + limited writes)
  const GAS_LOOKUP_URL =
    process.env.GAS_LOOKUP_URL ||
    process.env.LOOKUP_URL ||
    '';

  // Decide route by fn (default → booking)
  const raw = event.body || '{}';
  let fn = '';
  try { fn = String(JSON.parse(raw).fn || ''); } catch { /* keep default */ }

  const isLookup = MANAGE_FNS.has(fn) || fn === LEGACY_LOOKUP_ALIAS;
  const target = isLookup ? (GAS_LOOKUP_URL || GAS_BOOKING_URL) : GAS_BOOKING_URL;
  const targetName = isLookup ? 'lookup' : 'booking';
  const corsOut = isLookup ? corsLookup : corsBooking;

  // Upstream fetch with timeout
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const upstream = await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Connection': 'keep-alive',
      },
      body: raw,               // pass-through; no parse/re-stringify
      redirect: 'follow',      // follow Apps Script 302
      signal: controller.signal,
    });
    clearTimeout(timer);

    const text = await upstream.text(); // GAS returns JSON text
    return json(200, {
      ...corsOut,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Proxy-Target': targetName,
      'X-Proxy-Version': 'pcl-proxy/2025-08-21+lean',
    }, text);
  } catch (err) {
    clearTimeout(timer);
    // Normalize to consistent JSON (Stripe/clients expect JSON)
    return json(200, {
      ...corsOut,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Proxy-Target': targetName,
      'X-Proxy-Version': 'pcl-proxy/2025-08-21+lean',
    }, { ok:false, error:'proxy_upstream_error', details:String(err) });
  }
};
