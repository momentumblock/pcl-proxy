// netlify/functions/proxy.js
// -----------------------------------------------------------------------------
// Port City Luggage — Proxy to Google Apps Script backends
// (CORS hardened to support arbitrary request headers from booking UI)
// Edited: 2025-08-21
// -----------------------------------------------------------------------------

exports.handler = async (event) => {
  // Dynamically reflect origin & requested headers to satisfy preflight
  const origin = event.headers?.origin || '*';
  const requestedHeaders =
    event.headers?.['access-control-request-headers'] ||
    'Content-Type';

  const baseCors = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': requestedHeaders,
    'Vary': 'Origin',
  };

  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: baseCors, body: '' };
  }

  // Only POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { ...baseCors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: 'POST_only' }),
    };
  }

  // Booking backend (write-capable)
  const GAS_BOOKING_URL =
    process.env.GAS_URL ||
    process.env.APPS_SCRIPT_URL ||
    process.env.SCRIPT_URL ||
    // Hard-coded fallback (kept for safety)
    'https://script.google.com/macros/s/AKfycbzw412CHbweoMCHIL70TQiHUcPKaBCtkddxHBcs-rFI14yWiI_c-D2ZhW4rhsSkiAxU/exec';

  // Lookup/Manage backend (read + limited writes)
  const GAS_LOOKUP_URL =
    process.env.GAS_LOOKUP_URL ||
    process.env.LOOKUP_URL ||
    '';

  if (!GAS_BOOKING_URL) {
    return {
      statusCode: 200,
      headers: { ...baseCors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: 'missing GAS_URL env' }),
    };
  }

  // Decide target by fn
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

  let target = GAS_BOOKING_URL;
  let targetName = 'booking';

  if (MANAGE_FNS.has(fn) || fn === LEGACY_LOOKUP_ALIAS) {
    if (!GAS_LOOKUP_URL) {
      return {
        statusCode: 200,
        headers: { ...baseCors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'missing GAS_LOOKUP_URL env' }),
      };
    }
    target = GAS_LOOKUP_URL;
    targetName = 'lookup';
  }

  // Upstream fetch with a short timeout
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000); // 12s

  try {
    const upstream = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: raw,                 // pass-through; no re-stringify
      redirect: 'follow',        // follow Apps Script 302
      signal: controller.signal,
    });
    clearTimeout(timer);

    const text = await upstream.text();
    return {
      statusCode: 200,
      headers: {
        ...baseCors,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Proxy-Target': targetName,
        'X-Proxy-Version': 'pcl-proxy/2025-08-21+cors',
      },
      body: text,
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      statusCode: 200,
      headers: {
        ...baseCors,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Proxy-Target': targetName,
        'X-Proxy-Version': 'pcl-proxy/2025-08-21+cors',
      },
      body: JSON.stringify({
        ok: false,
        error: 'proxy_upstream_error',
        details: String(err),
      }),
    };
  }
};
