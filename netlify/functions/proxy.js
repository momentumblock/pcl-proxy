// netlify/functions/proxy.js

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ---- Map fn -> target script (Apps Script /exec URL in env) ----
// WebApp C (Lookup + Manage): manages all LOOKUP/MANAGE and EXTRAS flows
const C_FUNS = new Set([
  'manage_lookup',
  'manage_update_address',
  'manage_catalog',
  'extras_checkout',
  'extras_confirm',
]);

// WebApp A (Booking widget) — core booking endpoints
const A_FUNS = new Set([
  'ping',        // used by widget .config()
  'config',
  'availability',
  'book',
  'checkout',
  'confirm'
]);

// (Optional) If/when you want to directly post Ops events (WebApp B) via proxy:
const B_FUNS = new Set([
  // examples (if you ever call Ops directly from the site)
  // 'manage_address_updated', 'extras_paid'
]);

function pickTargetByFn(fn) {
  if (C_FUNS.has(fn)) return process.env.GOOGLE_SCRIPT_URL_C; // WebApp C (/exec)
  if (A_FUNS.has(fn)) return process.env.GOOGLE_SCRIPT_URL_A; // WebApp A (/exec)
  if (B_FUNS.has(fn)) return process.env.GOOGLE_SCRIPT_URL_B; // WebApp B (/exec)
  return process.env.GOOGLE_SCRIPT_URL ?? null; // fallback for legacy setups
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    // parse JSON
    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

    // Allow explicit override: { target: "A" | "B" | "C" | "<full URL>" }
    let targetUrl = null;
    const target = (body && body.target && String(body.target).trim()) || '';
    if (/^https?:\/\//i.test(target)) {
      targetUrl = target;
    } else if (target.toUpperCase() === 'A') {
      targetUrl = process.env.GOOGLE_SCRIPT_URL_A;
    } else if (target.toUpperCase() === 'B') {
      targetUrl = process.env.GOOGLE_SCRIPT_URL_B;
    } else if (target.toUpperCase() === 'C') {
      targetUrl = process.env.GOOGLE_SCRIPT_URL_C;
    } else {
      // auto-route by fn
      const fn = String(body.fn || '').trim();
      targetUrl = pickTargetByFn(fn);
    }

    if (!targetUrl) {
      return {
        statusCode: 400,
        headers: CORS,
        body: JSON.stringify({ error: 'No target Apps Script URL configured/matched (booking uses GOOGLE_SCRIPT_URL_A).' }),
      };
    }

    // forward
    const resp = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: event.body, // send raw JSON through
    });

    const rawText = await resp.text();
    let data;
    try { data = JSON.parse(rawText); } catch { data = { raw: rawText }; }

    // mirror non-2xx responses to the client but keep CORS OK
    return {
      statusCode: resp.status || 200,
      headers: CORS,
      body: JSON.stringify(data),
    };
  } catch (err) {
    console.error('Proxy error:', err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'Proxy error' }),
    };
  }
};
