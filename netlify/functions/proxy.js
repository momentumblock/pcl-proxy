// netlify/functions/proxy.js
// -----------------------------------------------------------------------------
// Port City Luggage — Proxy to Google Apps Script backends
// Back-compat for BOOKING (wildcard CORS like the old proxy) +
// hardened CORS for LOOKUP/MANAGE (mirrored origin + credentials).
// Edited: 2025-08-21
// -----------------------------------------------------------------------------

exports.handler = async (event) => {
  const origin = event.headers?.origin || '';
  const requestedHeaders =
    event.headers?.['access-control-request-headers'] ||
    event.headers?.['Access-Control-Request-Headers'] ||
    'content-type';

  // Old behavior (what booking relied on)
  const corsBooking = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin, Access-Control-Request-Headers, Access-Control-Request-Method',
  };

  // Hardened CORS for manage/lookup (supports credentials + arbitrary headers)
  const corsLookup = {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': requestedHeaders,
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin, Access-Control-Request-Headers, Access-Control-Request-Method',
    ...(origin ? { 'Access-Control-Allow-Credentials': 'true' } : {}),
  };

  // Preflight — permissive so both paths work (body absent on preflight)
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsBooking, body: '' };
  }

  // Only POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { ...corsBooking, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: 'POST_only' }),
    };
  }

  // Env: booking (write-capable)
  const GAS_BOOKING_URL =
    process.env.GAS_URL ||
    process.env.APPS_SCRIPT_URL ||
    process.env.SCRIPT_URL ||
    // Emergency fallback (keep)
    'https://script.google.com/macros/s/AKfycbzw412CHbweoMCHIL70TQiHUcPKaBCtkddxHBcs-rFI14yWiI_c-D2ZhW4rhsSkiAxU/exec';

  // Env: lookup/manage (read + limited writes)
  const GAS_LOOKUP_URL =
    process.env.GAS_LOOKUP_URL ||
    process.env.LOOKUP_URL ||
    '';

  if (!GAS_BOOKING_URL) {
    return {
      statusCode: 200,
      headers: { ...corsBooking, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: 'missing GAS_URL env' }),
    };
  }

  // Decide route by fn (default → booking)
  const raw = event.body || '{}';
  let fn = '';
  try { fn = String(JSON.parse(raw).fn || ''); } catch { /* keep default */ }

  const MANAGE_FNS = new Set([
    'manage_lookup',
    'manage_update_address',
    'manage_catalog',
    'extras_checkout',
    'extras_confirm',
  ]);
  const LEGACY_LOOKUP_ALIAS = 'lookup_booking';

  const isLookup = MANAGE_FNS.has(fn) || fn === LEGACY_LOOKUP_ALIAS;

  const target = isLookup
    ? (GAS_LOOKUP_URL || GAS_BOOKING_URL) // if lookup env missing, avoid hard fail
    : GAS_BOOKING_URL;

  const targetName = isLookup ? 'lookup' : 'booking';
  const corsOut = isLookup ? corsLookup : corsBooking;

  // Upstream fetch with a slightly longer timeout + keep-alive hint
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const upstream = await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Connection': 'keep-alive'
      },
      body: raw,               // pass-through; no parse/re-stringify
      redirect: 'follow',      // follow Apps Script 302
      signal: controller.signal,
    });
    clearTimeout(timer);

    const text = await upstream.text(); // GAS returns JSON text
    return {
      statusCode: 200,
      headers: {
        ...corsOut,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Proxy-Target': targetName,
        'X-Proxy-Version': 'pcl-proxy/2025-08-21+hybrid',
      },
      body: text,
    };
  } catch (err) {
    clearTimeout(timer);
    // Normalize to consistent JSON (Stripe/clients expect JSON)
    return {
      statusCode: 200,
      headers: {
        ...corsOut,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Proxy-Target': targetName,
        'X-Proxy-Version': 'pcl-proxy/2025-08-21+hybrid',
      },
      body: JSON.stringify({
        ok: false,
        error: 'proxy_upstream_error',
        details: String(err),
      }),
    };
  }
};
