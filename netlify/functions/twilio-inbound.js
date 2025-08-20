// netlify/functions/twilio-inbound.js
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // 1) Parse Twilio's x-www-form-urlencoded payload
  const params = new URLSearchParams(event.body || '');
  const form = Object.fromEntries(params.entries());

  // (Optional) Light sanity check
  if (!form.From || !form.Body) {
    // We still return 200 so Twilio doesn't retry endlessly
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/xml' },
      body: `<Response><Message>OK</Message></Response>`
    };
  }

  // 2) Forward to your Apps Script web app as JSON
  const APPS_SCRIPT_WEBAPP_URL = process.env.APPS_SCRIPT_WEBAPP_URL; // set in Netlify env
  const res = await fetch(APPS_SCRIPT_WEBAPP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fn: 'twilio_inbound', form })
  });

  // 3) Whatever XML Apps Script returns, pass it back to Twilio
  const xml = await res.text();
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/xml' },
    body: xml || `<Response><Message>Thanks, we got your message.</Message></Response>`
  };
};
