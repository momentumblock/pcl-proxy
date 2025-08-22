// netlify/functions/notify-created.js
// Accepts a POST { booking_id } and relays {type:'booking_created', booking_id, secret}
// to your Slack Automations Apps Script. Returns 202 immediately.

const SLACK_AUTOMATIONS_URL = process.env.SLACK_AUTOMATIONS_URL; // same URL your Apps Script uses
const INBOUND_SECRET = process.env.INBOUND_SECRET;               // same secret both scripts share

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  if (!(SLACK_AUTOMATIONS_URL && INBOUND_SECRET)) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Missing env vars' }) };
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { payload = {}; }
  const booking_id = String(payload.booking_id || '').trim();
  if (!booking_id) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'missing booking_id' }) };
  }

  // Relay but don't await (fire-and-forget semantics).
  // We still kick it off, but return 202 immediately to the browser.
  fetch(SLACK_AUTOMATIONS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'booking_created', booking_id, secret: INBOUND_SECRET }),
  }).catch(() => { /* swallow */ });

  return { statusCode: 202, headers: cors, body: JSON.stringify({ ok: true }) };
};
