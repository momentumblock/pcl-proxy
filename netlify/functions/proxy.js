// netlify/functions/proxy.js
// Minimal JSON forwarder → Google Apps Script (Web App /exec)
// - POST only, CORS enabled
// - Forwards the raw request body verbatim
// - Follows Apps Script's redirect and times out quickly
// - Routes lookup_booking to a separate read-only Apps Script

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

  // Existing booking backend (write-capable)
  const GAS_BOOKING_URL =
    process.env.GAS_URL ||
    process.env.APPS_SCRIPT_URL ||
    process.env.SCRIPT_URL ||
    // fallback to your hard-coded booking Apps Script URL:
    'https://script.google.com/macros/s/AKfycbzw412CHbweoMCHIL70TQiHUcPKaBCtkddxHBcs-rFI14yWiI_c-D2ZhW4rhsSkiAxU/exec';

  // New read-only lookup backend
  const GAS_LOOKUP_URL = "https://script.google.com/macros/s/AKfycbzw412CHbweoMCHIL70TQiHUcPKaBCtkddxHBcs-rFI14yWiI_c-D2ZhW4rhsSkiAxU/exec"
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

  // Decide target by fn (only route lookup_booking to the read-only URL)
  const raw = event.body || '{}';
  let target = GAS_BOOKING_URL;

  try {
    const j = JSON.parse(raw);
    if (j && j.fn === 'lookup_booking') {
      if (!GAS_LOOKUP_URL) {
        return {
          statusCode: 200,
          headers: { ...cors, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ok: false, error: 'missing GAS_LOOKUP_URL env' }),
        };
      }
      target = GAS_LOOKUP_URL;
    }
  } catch {
    // ignore parse error; stay on booking URL
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
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: text,
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: false,
        error: 'proxy_upstream_error',
        details: String(err),
      }),
    };
  }
};
