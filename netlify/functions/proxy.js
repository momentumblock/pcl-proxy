// netlify/functions/proxy.js
// Minimal POST-only forwarder → Google Apps Script Web App (/exec)
// - Proper CORS preflight (reflect requested headers)
// - Forwards the incoming Content-Type to Apps Script

const GAS_URL = process.env.GAS_URL; // set in Netlify env

exports.handler = async (event) => {
  const origin = event.headers.origin || '*';
  const requested = event.headers['access-control-request-headers'] || '';

  const cors = {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin, Access-Control-Request-Headers',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    // reflect whatever headers the browser plans to send (includes custom ones like x-prev-am)
    'Access-Control-Allow-Headers': requested || 'Content-Type, Authorization, X-Requested-With, X-Prev-Am, X-Trace',
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
      body: JSON.stringify({ ok:false, error: 'method_not_allowed' }),
    };
  }

  if (!GAS_URL) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok:false, error: 'missing_env_GAS_URL' }),
    };
  }

  // Forward raw body to Apps Script with the original Content-Type
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000); // 30s cap

  try {
    const contentType = event.headers['content-type'] || 'application/json';
    const resp = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: event.body,                // forward verbatim
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeout);

    const text = await resp.text();    // pass through backend response
    // Always reply as JSON to the widget
    return {
      statusCode: resp.status,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: text && text.trim().length ? text : JSON.stringify({ ok:false, error:'empty_backend_response' }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok:false, error: 'proxy_fetch_failed', detail: String(err) }),
    };
  }
};
