// netlify/functions/proxy.js
// Minimal POST-only forwarder → Google Apps Script Web App (/exec)

const GAS_URL = process.env.GAS_URL; // set in Netlify env

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };

  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  // Enforce POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  if (!GAS_URL) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing GAS_URL env var' }),
    };
  }

  // Forward raw JSON body to Apps Script
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000); // 30s cap

  try {
    const resp = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: event.body,                // forward verbatim
      signal: controller.signal,
      redirect: 'follow',              // normal JSON responses
    });
    clearTimeout(timeout);

    const text = await resp.text();    // pass through whatever Apps Script sent
    return {
      statusCode: resp.status,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: text,
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Upstream failure', detail: String(err) }),
    };
  }
};
