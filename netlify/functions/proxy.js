// netlify/functions/proxy.js

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const GAS_URL = process.env.API_BASE || process.env.GOOGLE_SCRIPT_URL;

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: CORS };
    }

    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers: CORS,
        body: JSON.stringify({ ok: false, error: 'Method not allowed' }),
      };
    }

    if (!GAS_URL) {
      throw new Error('Missing Apps Script URL in env (API_BASE or GOOGLE_SCRIPT_URL)');
    }

    const body = JSON.parse(event.body || '{}');
    const fn = body.fn;

    if (fn === 'availability') {
      const u = new URL(GAS_URL);
      u.searchParams.set('fn', 'availability');
      if (body.date) u.searchParams.set('date', body.date);

      const r = await fetch(u.toString(), { method: 'GET' });
      const text = await r.text();
      return { statusCode: r.ok ? 200 : r.status, headers: CORS, body: text };
    }

    const r = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const text = await r.text();
    return { statusCode: r.ok ? 200 : r.status, headers: CORS, body: text };
  } catch (err) {
    console.error('Proxy error:', err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ ok: false, error: err.message || 'Proxy error' }),
    };
  }
};
