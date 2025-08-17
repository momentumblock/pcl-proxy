// netlify/functions/proxy.js
// Minimal JSON forwarder → Google Apps Script (Web App /exec)
// - POST only, CORS enabled
// - Forwards the raw request body verbatim (no re-stringify)
// - Follows Apps Script's redirect and times out quickly

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

  const GAS_URL =
    process.env.GAS_URL ||
    process.env.APPS_SCRIPT_URL ||
    process.env.SCRIPT_URL ||
    '';

  if (!GAS_URL) {
    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: 'missing GAS_URL env' }),
    };
  }

  // Upstream fetch with a short timeout (improves perceived latency)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000); // 12s cap

  try {
    const upstream = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: event.body || '{}',          // pass-through; no parse/re-stringify
      redirect: 'follow',                // follow Apps Script 302
      signal: controller.signal,
    });
    clearTimeout(timer);

    const text = await upstream.text();  // Apps Script returns JSON text
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
