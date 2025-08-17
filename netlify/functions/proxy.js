// netlify/functions/proxy.js
// Port City Luggage proxy → Google Apps Script (Web App /exec)
// - Forwards JSON POST bodies verbatim
// - CORS enabled
// - Debug helpers: fn:"debug" and fn:"debug_upstream"

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  // Only POST allowed
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: cors,
      body: JSON.stringify({ ok: false, error: 'POST_only' }),
    };
  }

  // Parse JSON body
  let body = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: 'invalid_json' }),
    };
  }

  // Env wiring
  const GAS_URL =
    process.env.GAS_URL ||
    process.env.APPS_SCRIPT_URL ||
    process.env.SCRIPT_URL ||
    '';

  /* ------------------------------------------------------------------ */
  /*                            DEBUG HELPERS                            */
  /* ------------------------------------------------------------------ */

  // Local proxy ping (no upstream)
  if (body && body.fn === 'ping') {
    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, note: 'proxy ping ok', ts: new Date().toISOString() }),
    };
  }

  // Show which upstream URL this proxy would call
  if (body && body.fn === 'debug') {
    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        upstream: GAS_URL || '(missing)',
        env_present: !!GAS_URL,
        ts: new Date().toISOString(),
      }),
    };
  }

  // Ping the upstream Apps Script (calls it with {fn:"ping"})
  if (body && body.fn === 'debug_upstream') {
    if (!GAS_URL) {
      return {
        statusCode: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'missing GAS_URL env' }),
      };
    }
    try {
      const r = await fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fn: 'ping' }),
        redirect: 'follow',
      });
      const text = await r.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch {}
      return {
        statusCode: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ok: true,
          upstream: GAS_URL,
          upstream_status: r.status,
          upstream_json: parsed,
          upstream_raw: parsed ? undefined : text.slice(0, 4000),
        }),
      };
    } catch (err) {
      return {
        statusCode: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ok: false,
          error: 'upstream_ping_failed',
          details: String(err),
          upstream: GAS_URL,
        }),
      };
    }
  }

  /* ------------------------------------------------------------------ */
  /*                            MAIN FORWARDER                           */
  /* ------------------------------------------------------------------ */

  if (!GAS_URL) {
    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: 'missing GAS_URL env' }),
    };
  }

  try {
    const upstream = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'follow',
    });

    const text = await upstream.text();

    // Return upstream response verbatim as JSON (Apps Script returns JSON)
    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: text,
    };
  } catch (err) {
    console.error('[proxy] fetch error', err);
    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: 'proxy_upstream_error', details: String(err) }),
    };
  }
};
