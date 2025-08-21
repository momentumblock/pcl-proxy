// netlify/functions/proxy.js
// -----------------------------------------------------------------------------
// Port City Luggage — Proxy to Google Apps Script backends
// Purpose: Forward JSON POSTs to the right Apps Script (Booking vs Manage/Lookup)
// Edited: 2025-08-21
//
// Behavior
// - POST only (CORS + OPTIONS preflight supported)
// - Forwards raw request body verbatim (no parse/re-stringify before send)
// - Follows Apps Script 302 redirects
// - 12s upstream timeout
// - Routes all Manage/Lookup calls to GAS_LOOKUP_URL
//   (manage_lookup, manage_update_address, manage_catalog, extras_checkout, extras_confirm)
//   Also supports legacy alias: lookup_booking
//
// Env vars
// - GAS_URL / APPS_SCRIPT_URL / SCRIPT_URL .......... Booking backend (write-capable)
// - GAS_LOOKUP_URL / LOOKUP_URL ..................... Lookup/Manage backend (read + limited writes)
// Fallback: a hard-coded BOOKING URL can be left below as a safety net.
// -----------------------------------------------------------------------------

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };

  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  // Only POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: 'POST_only' }),
    };
  }

  // Booking backend (write-capable)
  const GAS_BOOKING_URL =
    process.env.GAS_URL ||
    process.env.APPS_SCRIPT_URL ||
    process.env.SCRIPT_URL ||
    // Hard-coded fallback (optional, but handy for emergencies)
    'https://script.google.com/macros/s/AKfycbzw412CHbweoMCHIL70TQiHUcPKaBCtkddxHBcs-rFI14yWiI_c-D2ZhW4rhsSkiAxU/exec';

  // Lookup/Manage backend (read + limited writes)
  const GAS_LOOKUP_URL =
    process.env.GAS_LOOKUP_URL ||
    process.env.LOOKUP_URL ||
    '';

  if (!GAS_BOOKING_URL) {
    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: 'missing GAS_URL env' }),
    };
  }

  // Decide target by fn
  const raw = event.body || '{}';
  let fn = '';
  try {
    const j = JSON.parse(raw);
    fn = String(j.fn || '');
  } catch {
    // ignore parse error; default to booking URL
  }

  // All manage/lookup functions routed to the Lookup backend
  const MANAGE_FNS = new Set([
    'manage_lookup',
    'manage_update_address',
    'manage_catalog',
    'extras_checkout',
    'extras_confirm',
  ]);
  // Back-compat alias used earlier
  const LEGACY_LOOKUP_ALIAS = 'lookup_booking';

  let target = GAS_BOOKING_URL;
  let targetName = 'booking';

  if (MANAGE_FNS.has(fn) || fn === LEGACY_LOOKUP_ALIAS) {
    if (!GAS_LOOKUP_URL) {
      return {
        statusCode: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'missing GAS_LOOKUP_URL env' }),
      };
    }
    target = GAS_LOOKUP_URL;
    targetName = 'lookup';
  }

  // Upstream fetch with a short timeout
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000); // 12s cap

  try {
    const upstream = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: raw,                 // pass-through; no re-stringify
      redirect: 'follow',        // follow Apps Script 302
      signal: controller.signal,
    });
    clearTimeout(timer);

    const text = await upstream.text(); // Apps Script returns JSON text
    return {
      statusCode: 200,
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Proxy-Target': targetName,
        'X-Proxy-Version': 'pcl-proxy/2025-08-21',
      },
      body: text,
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      statusCode: 200,
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Proxy-Target': targetName,
        'X-Proxy-Version': 'pcl-proxy/2025-08-21',
      },
      body: JSON.stringify({
        ok: false,
        error: 'proxy_upstream_error',
        details: String(err),
      }),
    };
  }
};
