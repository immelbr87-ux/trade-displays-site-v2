// netlify/functions/_alerts.js
// Buyer listing alerts: create alerts + match new listings + send premium emails.

const { airtableQuery, airtablePatchRecord, pick } = require('./_lib');
const { getLatLngFromZip, haversineMiles } = require('./_geo');
const { sendMail } = require('./_email');

const ALERTS_TABLE = process.env.ALERTS_TABLE || 'Alerts';
const LISTINGS_TABLE = 'Listings';

function normalize(s) {
  return String(s || '').trim().toLowerCase();
}

function categoryMatch(alertCategory, listingCategory) {
  const a = normalize(alertCategory);
  const l = normalize(listingCategory);
  if (!a) return true;
  if (!l) return false;
  // loose contains match ("vanity" matches "vanities")
  return l.includes(a) || a.includes(l);
}

function skuMatch(alertSku, listingSku) {
  const a = normalize(alertSku);
  const l = normalize(listingSku);
  if (!a) return true;
  if (!l) return false;
  return a === l;
}

async function sendAlertEmail({ to, subject, html }) {
  const from = process.env.FROM_EMAIL || process.env.SUPPORT_EMAIL;
  const replyTo = process.env.SUPPORT_EMAIL || from;
  await sendMail({
    to,
    subject,
    html,
    from,
    replyTo,
  });
}

async function matchAlertsForListing({ listingId, listingFields }) {
  const siteUrl = (process.env.SITE_URL || '').replace(/\/$/, '');

  const listingZip = pick(listingFields, ['pickup_zip', 'Pickup Zip', 'pickupZip', 'zip', 'Zip'], '').toString();
  const listingLatLng = listingZip ? await getLatLngFromZip(listingZip) : null;

  // Only attempt geo filtering if we have a listing ZIP.
  if (!listingLatLng) {
    console.log('Alerts: listing missing pickup_zip; skipping geo alert matching', listingId);
    return { matched: 0, sent: 0, skipped: 1 };
  }

  const listingCategory = pick(listingFields, ['category', 'Category', 'product_category'], '');
  const listingSku = pick(listingFields, ['sku', 'SKU', 'model', 'Model'], '');

  // Active, not paused alerts.
  const alerts = await airtableQuery({
    baseId: process.env.AIRTABLE_BASE_ID,
    table: ALERTS_TABLE,
    apiKey: process.env.AIRTABLE_API_KEY,
    params: {
      pageSize: 100,
      filterByFormula: `AND({active}=TRUE())`,
    },
  });

  let matched = 0;
  let sent = 0;

  for (const a of alerts.records || []) {
    const f = a.fields || {};
    const email = pick(f, ['email', 'Email'], '').toString();
    if (!email) continue;

    const radius = Number(pick(f, ['radius_miles', 'radius', 'Radius Miles'], 90)) || 90;
    const alertZip = pick(f, ['zip', 'Zip'], '').toString();
    const alertLatLng = alertZip ? await getLatLngFromZip(alertZip) : null;
    if (!alertLatLng) continue;

    const dist = haversineMiles(alertLatLng, listingLatLng);
    if (dist === null || dist > radius) continue;

    const mode = normalize(pick(f, ['mode', 'Mode'], 'similar')) || 'similar';
    const wantCategory = pick(f, ['category', 'Category'], '');
    const wantSku = pick(f, ['sku', 'SKU'], '');

    // Mode rules:
    // - exact: requires SKU match
    // - similar: category match; optional SKU if provided
    if (mode === 'exact') {
      if (!skuMatch(wantSku, listingSku)) continue;
    } else {
      if (!categoryMatch(wantCategory, listingCategory)) continue;
      if (wantSku && !skuMatch(wantSku, listingSku)) continue;
    }

    matched++;

    // basic rate limit: don't send the same listing twice to the same alert
    const notified = Array.isArray(f.notified_listing_ids) ? f.notified_listing_ids : [];
    if (notified.includes(listingId)) continue;

    const listingUrl = siteUrl ? `${siteUrl}/listing-details.html?id=${encodeURIComponent(listingId)}` : '';
    const unsubscribeToken = `${a.id}.${Buffer.from(email).toString('base64url')}`;
    const unsubscribeUrl = siteUrl ? `${siteUrl}/.netlify/functions/unsubscribeAlert?token=${encodeURIComponent(unsubscribeToken)}` : '';

    const subject = `New ${listingCategory || 'listing'} available near you`;
    const html = `
      <div style="font-family:Inter,Arial,sans-serif;max-width:640px;margin:0 auto;line-height:1.5;color:#111">
        <h2 style="margin:0 0 12px">A new listing matches your alert</h2>
        <p style="margin:0 0 16px;color:#374151">Within <strong>${radius} miles</strong> of ${alertZip}.</p>
        <div style="border:1px solid #e5e7eb;border-radius:12px;padding:16px;background:#fff">
          <div style="font-weight:700;margin-bottom:6px">${pick(listingFields,['title','Title','name','Name'],'New Listing')}</div>
          <div style="color:#6b7280;font-size:14px;margin-bottom:10px">${listingCategory || ''}${listingSku ? ` • SKU ${listingSku}` : ''}</div>
          <div style="font-size:18px;font-weight:800;margin-bottom:12px">$${Number(pick(listingFields,['price','Price','sale_price'],0)||0).toFixed(2)}</div>
          ${listingUrl ? `<a href="${listingUrl}" style="display:inline-block;background:#00b85c;color:#fff;text-decoration:none;padding:12px 16px;border-radius:10px;font-weight:700">View listing</a>` : ''}
        </div>
        <p style="margin:16px 0 0;color:#6b7280;font-size:12px">If you no longer want alerts, you can <a href="${unsubscribeUrl}" style="color:#111">unsubscribe</a>.</p>
      </div>
    `;

    try {
      await sendAlertEmail({ to: email, subject, html });
      sent++;
      await airtablePatchRecord({
        baseId: process.env.AIRTABLE_BASE_ID,
        table: ALERTS_TABLE,
        recordId: a.id,
        apiKey: process.env.AIRTABLE_API_KEY,
        fields: {
          notified_listing_ids: [...notified, listingId],
          last_notified_at: new Date().toISOString(),
        },
      });
    } catch (e) {
      console.error('Alerts: failed to send email', a.id, e.message);
    }
  }

  return { matched, sent, skipped: 0 };
}

module.exports = {
  matchAlertsForListing,
  matchAndNotifyAlerts,
  ALERTS_TABLE,
};
