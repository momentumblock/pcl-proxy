// netlify/functions/checkout.js
// Create (or reuse) a Stripe Checkout Session at the edge.
// - Accepts JSON: { booking_id, customer_email, bags, days, addons:[{id,label,amount}] }
// - Uses idempotency key "pcl:checkout:<booking_id>" so prewarm + click return the same session quickly.
// - Returns { ok:true, url } on success.
//
// Required env vars:
//   STRIPE_SECRET_KEY  = sk_live_... (or sk_test_...)
//   SUCCESS_URL_BASE   = https://www.portcityluggage.com/book-1-1/
//   CANCEL_URL_BASE    = https://www.portcityluggage.com/book-1-1/

const SUCCESS = process.env.SUCCESS_URL_BASE;
const CANCEL  = process.env.CANCEL_URL_BASE;
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;

function corsHeaders(origin, requested) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Vary': 'Origin, Access-Control-Request-Headers',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': requested || 'Content-Type',
    'Content-Type': 'application/json'
  };
}

// ---- pricing (mirror of Apps Script) ----
const PASS_TIERS = [
  { id:'solo',    name:'Solo Traveler',        maxBags:2, day1:49 },
  { id:'couples', name:'Couples Traveler',     maxBags:4, day1:99 },
  { id:'family',  name:'Family Traveler',      maxBags:6, day1:129 },
  { id:'large',   name:'Large Group Traveler', maxBags:8, day1:159 },
];
const EXTRA_BAG_DAY1 = 15;
const EXTRA_BAG_EXTRA_DAY = Math.ceil(EXTRA_BAG_DAY1 * 0.5);

function passTierForBags(bags){
  const t = PASS_TIERS.find(x => bags <= x.maxBags) || PASS_TIERS[PASS_TIERS.length-1];
  const extraBags = Math.max(0, bags - 8);
  return { tier:t, extraBags };
}
function passNameForBags(bags){
  const r = passTierForBags(bags);
  return r.extraBags ? `${r.tier.name} + ${r.extraBags} extra` : r.tier.name;
}
function priceForBagsAndDays(bags, days){
  const b = Math.max(1, Number(bags)||1);
  const d = Math.max(1, Number(days)||1);
  const r = passTierForBags(b);
  const day1Base   = Number(r.tier.day1) || 0;
  const day1Extras = r.extraBags * EXTRA_BAG_DAY1;
  const firstDay   = day1Base + day1Extras;
  const extraDayBase   = Math.ceil(day1Base * 0.5);
  const extraDayExtras = r.extraBags * EXTRA_BAG_EXTRA_DAY;
  const perExtraDay    = extraDayBase + extraDayExtras;
  return { tier:r.tier, total:firstDay + (d-1)*perExtraDay };
}
function extrasSum(addons){
  if (!Array.isArray(addons)) return 0;
  return addons.reduce((s,a)=> s + (Number(a && a.amount)||0), 0);
}

exports.handler = async (event) => {
  const origin    = event.headers.origin || '*';
  const requested = event.headers['access-control-request-headers'] || '';
  const CORS = corsHeaders(origin, requested);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ ok:false, error:'method_not_allowed' }) };
  }
  if (!STRIPE_KEY || !SUCCESS || !CANCEL) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ ok:false, error:'missing_env' }) };
  }

  let body;
  try {
    // support text/plain (simple request) or application/json
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok:false, error:'bad_json' }) };
  }

  const bid   = String(body.booking_id || '').trim();
  const email = String(body.customer_email || '').trim();
  const bags  = Math.max(1, Number(body.bags || 1));
  const days  = Math.max(1, Number(body.days || 1));
  const addons= Array.isArray(body.addons) ? body.addons : [];

  if (!bid) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok:false, error:'missing_booking_id' }) };
  }

  // Compose line items
  const basePrice = priceForBagsAndDays(bags, days).total;
  const items = [
    {
      name: `${passNameForBags(bags)} — ${bags} ${bags===1?'bag':'bags'} — ${days} ${days===1?'day':'days'}`,
      amount_cents: Math.round(basePrice * 100),
      qty: 1
    }
  ];
  addons.forEach(a=>{
    const amt = Number(a && a.amount) || 0;
    if (amt > 0) items.push({ name: String(a.label||a.id||'Add-on'), amount_cents: Math.round(amt*100), qty: 1 });
  });

  // Build Stripe form
  const form = [];
  form.push('mode=payment');
  if (email) form.push('customer_email='+encodeURIComponent(email));
  form.push('success_url='+encodeURIComponent(`${SUCCESS}?paid=1&bid=${encodeURIComponent(bid)}&session_id={CHECKOUT_SESSION_ID}`));
  form.push('cancel_url='+encodeURIComponent(`${CANCEL}?cancel=1&bid=${encodeURIComponent(bid)}`));
  form.push('metadata['+encodeURIComponent('booking_id')+']='+encodeURIComponent(bid));
  items.forEach((it,i)=>{
    form.push(`line_items[${i}][price_data][currency]=usd`);
    form.push(`line_items[${i}][price_data][product_data][name]=`+encodeURIComponent(it.name.slice(0,120)));
    form.push(`line_items[${i}][price_data][unit_amount]=`+encodeURIComponent(String(it.amount_cents|0)));
    form.push(`line_items[${i}][quantity]=`+encodeURIComponent(String(it.qty||1)));
  });
  const bodyForm = form.join('&');

  // Create (or reuse) session with idempotency key
  try{
    const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + STRIPE_KEY,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': `pcl:checkout:${bid}`
      },
      body: bodyForm
    });

    const text = await resp.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { error:{ message:'stripe_parse_error' }, raw:text }; }

    if (resp.status !== 200 || !json || json.error) {
      return { statusCode: 502, headers: CORS, body: JSON.stringify({ ok:false, error:'stripe_error', details: json.error || text }) };
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok:true, url: json.url }) };
  } catch (e) {
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ ok:false, error:'stripe_fetch_failed', details:String(e) }) };
  }
};
