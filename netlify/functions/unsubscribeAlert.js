// netlify/functions/unsubscribeAlert.js
// One-click unsubscribe for buyer listing alerts.

const { json, airtablePatchRecord } = require('./_lib');
const { ALERTS_TABLE } = require('./_alerts');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method Not Allowed' });
  const token = (event.queryStringParameters?.token || '').trim();
  if (!token || !token.includes('.')) return json(400, { error: 'Missing token' });

  const [recordId] = token.split('.', 1);
  if (!recordId) return json(400, { error: 'Invalid token' });

  try {
    await airtablePatchRecord({
      baseId: process.env.AIRTABLE_BASE_ID,
      table: ALERTS_TABLE,
      recordId,
      apiKey: process.env.AIRTABLE_API_KEY,
      fields: { active: false, unsubscribed_at: new Date().toISOString() },
    });
  } catch (e) {
    console.error('unsubscribeAlert error', e.message);
    // Don't leak details
  }

  // Return a simple HTML response so it feels polished
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>Unsubscribed</title>
      <style>body{font-family:Inter,system-ui,-apple-system,Arial,sans-serif;background:#fafafa;color:#111;margin:0} .wrap{max-width:720px;margin:80px auto;padding:0 20px} .card{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:28px} a{color:#111}
      </style></head><body><div class="wrap"><div class="card"><h2 style="margin:0 0 10px">You're unsubscribed</h2>
      <p style="margin:0;color:#374151">You won't receive any more listing alerts from Showroom Market.</p>
      <p style="margin:16px 0 0;color:#6b7280;font-size:13px">If this was a mistake, just create a new alert from the marketplace.</p>
      </div></div></body></html>`,
  };
};
