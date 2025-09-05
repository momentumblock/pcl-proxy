// netlify/functions/proxy.js

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// WebApp routing sets
const C_FUNS = new Set([
  'manage_lookup',
  'manage_update_address',
  'manage_catalog',
  'extras_checkout',
  'extras_confirm',
]);

const A_FUNS = new Set([
  'ping',
  'config',
  'availability',
  'book',
  'checkout',
  'confirm',
]);

const B_FUNS = new Set([
  // placeholder if needed
]);

function pickTargetByFn(fn) {
  if (C_FUNS.has(fn)) return process.env.GOOGLE_SCRIPT_URL_C;
  if (A_FUNS.has(fn)) return process.env.GOOGLE_SCRIPT_URL_A;
  if (B_FUNS.has(fn)) return process.env.GOOGLE_SCRIPT_URL_B;
  return process.env.GOOGLE_SCRIPT_URL ?? null;
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
    const body = JSON.parse(event.body || '{}');
    const fn = String(body.fn || '').trim();

    // Allow override via { target: "A" | "B" | "C" | "<full URL>" }
    let targetUrl = null;
    const target = String(body.target || '').trim();
    if (target.startsWith('http')) {
      targetUrl = target;
    } else if (target === 'A') {
      targetUrl = process.env.GOOGLE_SCRIPT_URL_A;
    } else if (target === 'B') {
      targetUrl = process.env.GOOGLE_SCRIPT_URL_B;
    } else if (target === 'C') {
      targetUrl = process.env.GOOGLE_SCRIPT_URL_C;
    } else {
      targetUrl = pickTargetByFn(fn);
    }

    if (!targetUrl) {
      return {
        statusCode: 400,
        headers: CORS,
        body: JSON.stringify({ error: 'No target Apps Script URL configured or matched.' }),
      };
    }

    const resp = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: event.body,
    });

    const json = await resp.json().catch(() => ({
      error: 'Invalid JSON returned from Apps Script',
      raw: await resp.text(),
    }));

    return {
      statusCode: resp.status || 200,
      headers: {
        ...CORS,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(json),
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
