// netlify/functions/createAlert.js
// Public endpoint to create a buyer listing alert.

const fetch = require('node-fetch');
const { json, airtableQuery } = require('./_lib');
const { getLatLngFromZip } = require('./_geo');
const { ALERTS_TABLE } = require('./_alerts');
const { sendMail } = require('./_email');

function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s||'').trim());
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}

  const email = String(body.email || '').trim();
  const zip = String(body.zip || '').trim();
  const radius_miles = Number(body.radius_miles || 90) || 90;
  const category = String(body.category || '').trim();
  const sku = String(body.sku || '').trim();
  const mode = (String(body.mode || 'similar').trim().toLowerCase() === 'exact') ? 'exact' : 'similar';

  if (!isEmail(email)) return json(400, { error: 'Invalid email' });
  if (!zip) return json(400, { error: 'ZIP required' });

  // Validate zip resolves
  const latlng = await getLatLngFromZip(zip);
  if (!latlng) return json(400, { error: 'Could not resolve ZIP' });

  // Upsert by email+zip+category+sku+mode
  const baseId = process.env.AIRTABLE_BASE_ID;
  const apiKey = process.env.AIRTABLE_API_KEY;
  if (!baseId || !apiKey) return json(500, { error: 'Missing Airtable env vars' });

  const filter = `AND({email}='${email.replace(/'/g, "\\'")}', {zip}='${zip.replace(/'/g, "\\'")}', {mode}='${mode.replace(/'/g, "\\'")}', {category}='${category.replace(/'/g, "\\'")}', {sku}='${sku.replace(/'/g, "\\'")}')`;
  const existing = await airtableQuery({
    baseId,
    table: ALERTS_TABLE,
    apiKey,
    params: { maxRecords: 1, filterByFormula: filter },
  });

  const fields = {
    email,
    zip,
    radius_miles,
    category,
    sku,
    mode,
    active: true,
    created_at: new Date().toISOString(),
  };

  let record;
  if (existing.records && existing.records.length) {
    const id = existing.records[0].id;
    // patch
    const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(ALERTS_TABLE)}/${id}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    record = await res.json();
  } else {
    const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(ALERTS_TABLE)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    record = await res.json();
  }

  // Confirmation email (premium feel)
  const siteUrl = (process.env.SITE_URL || '').replace(/\/$/, '');
  const from = process.env.FROM_EMAIL || process.env.SUPPORT_EMAIL;
  const replyTo = process.env.SUPPORT_EMAIL || from;
  const token = `${record.id}.${Buffer.from(email).toString('base64url')}`;
  const unsubscribeUrl = siteUrl ? `${siteUrl}/.netlify/functions/unsubscribeAlert?token=${encodeURIComponent(token)}` : '';

  try {
    await sendMail({
      to: email,
      from,
      replyTo,
      subject: 'Your Showroom Market listing alert is active',
      html: `
        <div style="font-family:Inter,Arial,sans-serif;max-width:640px;margin:0 auto;color:#111;line-height:1.5">
          <h2 style="margin:0 0 12px">Alert created</h2>
          <p style="margin:0 0 16px;color:#374151">We'll email you when a matching listing is posted within <strong>${radius_miles} miles</strong> of <strong>${zip}</strong>.</p>
          <div style="border:1px solid #e5e7eb;border-radius:12px;padding:16px;background:#fff">
            <div style="font-weight:700">Criteria</div>
            <div style="color:#6b7280;font-size:14px;margin-top:6px">
              Category: ${category || 'Any'}<br/>
              SKU: ${sku || 'Any'}<br/>
              Match: ${mode === 'exact' ? 'Exact SKU' : 'Similar listings'}
            </div>
          </div>
          ${unsubscribeUrl ? `<p style="margin:16px 0 0;color:#6b7280;font-size:12px">Unsubscribe anytime: <a href="${unsubscribeUrl}" style="color:#111">unsubscribe</a></p>` : ''}
        </div>
      `,
    });
  } catch (e) {
    console.error('createAlert: confirmation email failed', e.message);
  }

  return json(200, { ok: true, alert_id: record.id });
};
