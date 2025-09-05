// netlify/functions/proxy.js

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Vary': 'Origin',
};

const C_FUNS = new Set([
  'manage_lookup', 'manage_update_address', 'manage_catalog',
  'extras_checkout', 'extras_confirm',
]);

const A_FUNS = new Set([
  'ping', 'config', 'availability', 'book', 'checkout', 'confirm',
]);

const B_FUNS = new Set([]);

const pickTarget = (fn) =>
  C_FUNS.has(fn) ? process.env.GOOGLE_SCRIPT_URL_C :
  A_FUNS.has(fn) ? process.env.GOOGLE_SCRIPT_URL_A :
  B_FUNS.has(fn) ? process.env.GOOGLE_SCRIPT_URL_B :
  process.env.GOOGLE_SCRIPT_URL || null;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS')
    return { statusCode: 204, headers: CORS, body: '' };

  if (event.httpMethod !== 'POST')
    return {
      statusCode: 405,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' }),
    };

  try {
    const body = JSON.parse(event.body || '{}');
    const fn = String(body.fn || '').trim();
    const targetOverride = String(body.target || '').trim();
    const url = targetOverride.startsWith('http')
      ? targetOverride
      : targetOverride === 'A' ? process.env.GOOGLE_SCRIPT_URL_A
      : targetOverride === 'B' ? process.env.GOOGLE_SCRIPT_URL_B
      : targetOverride === 'C' ? process.env.GOOGLE_SCRIPT_URL_C
      : pickTarget(fn);

    if (!url)
      return {
        statusCode: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'No target URL' }),
      };

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: event.body,
    });

    const text = await resp.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }

    return {
      statusCode: resp.status || 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify(json),
    };
  } catch (err) {
    console.error('Proxy error:', err);
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Proxy error' }),
    };
  }
};
