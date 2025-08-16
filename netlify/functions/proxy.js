exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ ok:false, error:'POST only' }) };
  }

  let body = {};
  try { body = event.body ? JSON.parse(event.body) : {}; }
  catch (e) {
    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok:false, error:'invalid_json_body' }) };
  }

  // Quick local ping (no GAS)
  if (body.fn === 'ping') {
    return {
      statusCode: 200, headers: { ...cors, 'Content-Type':'application/json' },
      body: JSON.stringify({ ok:true, note:'proxy ping ok', got: body })
    };
  }

  const GAS_URL = process.env.GAS_URL; // <-- set this in Netlify env
  if (!GAS_URL) {
    return {
      statusCode: 200, headers: cors,
      body: JSON.stringify({ ok:false, error:'missing GAS_URL env' })
    };
  }

  try {
    // Forward AS-IS (no extra wrapping, same Content-Type)
    const upstream = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(body),
    });

    const text = await upstream.text();

    // Log for Netlify function logs (helps a ton)
    console.log('[proxy] status', upstream.status, 'body:', text.slice(0, 500));

    // Return whatever GAS returned (verbatim)
    return {
      statusCode: upstream.status,
      headers: { ...cors, 'Content-Type':'application/json' },
      body: text,
    };
  } catch (err) {
    console.error('[proxy] fetch error', err);
    return {
      statusCode: 200, headers: cors,
      body: JSON.stringify({ ok:false, error:'proxy_upstream_error', details:String(err) })
    };
  }
};
