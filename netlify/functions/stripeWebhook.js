// netlify/functions/stripeWebhook.js
// ✅ Verifies Stripe signature (RAW body)
// ✅ Marks Airtable listing as Paid – Pending Pickup
// ✅ Generates + stores pickup QR token + payload (SMK|listingId|token)
// ✅ Emails buyer pickup instructions via MailerSend (with QR image + fallback text)

const Stripe = require("stripe");
const fetch = require("node-fetch");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function getHeader(event, name) {
  const headers = event.headers || {};
  const lower = name.toLowerCase();
  return headers[name] || headers[lower] || headers[Object.keys(headers).find(k => k.toLowerCase() === lower)];
}

function randomToken(len = 24) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

async function airtableGetRecord({ baseId, table, recordId, apiKey }) {
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}/${recordId}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`Airtable GET failed: ${res.status} ${res.statusText} ${text}`);
  return data;
}

async function airtablePatchRecord({ baseId, table, recordId, apiKey, fields }) {
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}/${recordId}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`Airtable PATCH failed: ${res.status} ${res.statusText} ${text}`);
  return data;
}

async function sendBuyerEmailMailerSend({ toEmail, subject, html, text }) {
  const apiKey = process.env.MAILERSEND_API_KEY;
  const fromEmail = process.env.MAILERSEND_FROM_EMAIL; // MUST be a verified sender in MailerSend
  const fromName = process.env.MAILERSEND_FROM_NAME || "Showroom Market";

  if (!apiKey) throw new Error("Missing MAILERSEND_API_KEY env var");
  if (!fromEmail) throw new Error("Missing MAILERSEND_FROM_EMAIL env var");

  const payload = {
    from: { email: fromEmail, name: fromName },
    to: [{ email: toEmail }],
    subject,
    text,
    html,
  };

  const res = await fetch("https://api.mailersend.com/v1/email", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const out = await res.text();
  if (!res.ok) throw new Error(`MailerSend error: ${res.status} ${res.statusText} ${out}`);
  return { ok: true };
}

exports.handler = async (event) => {
  // 🔒 HTTP method validation
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });

  // ✅ Stripe requires the RAW body for signature verification
  const sig = getHeader(event, "stripe-signature");
  if (!sig) return json(400, { error: "Missing stripe-signature header" });

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body, // raw string
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Webhook signature verification failed:", err.message);
    return json(400, { error: `Webhook Error: ${err.message}` });
  }

  // We only care about successful checkout payments
  if (stripeEvent.type !== "checkout.session.completed") {
    return json(200, { ok: true, ignored: stripeEvent.type });
  }

  const session = stripeEvent.data.object;

  const listingId = session?.metadata?.listingId;
  if (!listingId) {
    console.error("⚠️ No listingId in Stripe session metadata");
    return json(200, { ok: true, warning: "No listingId metadata" });
  }

  // Buyer email
  const buyerEmail =
    session?.customer_details?.email ||
    session?.customer_email ||
    null;

  console.log("💰 Payment successful for listing:", listingId, "buyer:", buyerEmail || "(none)");

  // Airtable env vars
  const baseId = process.env.AIRTABLE_BASE_ID;
  const apiKey = process.env.AIRTABLE_API_KEY;
  const table = process.env.AIRTABLE_TABLE || "Listings";
  if (!baseId || !apiKey) {
    return json(500, { error: "Missing Airtable env vars (AIRTABLE_BASE_ID, AIRTABLE_API_KEY)" });
  }

  // 1) Load listing so we can (a) preserve existing QR token and (b) email pickup details
  let record;
  try {
    record = await airtableGetRecord({ baseId, table, recordId: listingId, apiKey });
  } catch (e) {
    console.error("❌ Airtable load failed:", e.message);
    return json(500, { error: "Failed to load listing", detail: e.message });
  }

  const f = record.fields || {};

  // 2) Create/keep pickup QR token
  const pickupQrToken = (f.pickup_qr_token && String(f.pickup_qr_token).trim()) || randomToken(28);
  const qrPayload = `SMK|${listingId}|${pickupQrToken}`;

  // 3) Update Airtable record to Paid – Pending Pickup (idempotent-ish)
  // NOTE: your Airtable uses formula fields marketplace_fee + seller_payout_amount.
  // We'll set seller_payout_status to Pending so the admin/payout flow is consistent.
  try {
    await airtablePatchRecord({
      baseId,
      table,
      recordId: listingId,
      apiKey,
      fields: {
        status: "Paid – Pending Pickup",
        stripe_session_id: session.id,
        paid_at: new Date().toISOString(),
        buyer_email: buyerEmail || f.buyer_email || "",
        pickup_qr_token: pickupQrToken,
        pickup_qr_payload: qrPayload, // optional field (create if you want). If it doesn't exist, Airtable will ignore? (Airtable will error if field doesn't exist)
        seller_payout_status: f.seller_payout_status || "Pending",
      },
    });

    console.log("✅ Airtable updated: Paid – Pending Pickup + QR token");
  } catch (e) {
    // If you do NOT have pickup_qr_payload field, Airtable will throw.
    // If that happens, remove pickup_qr_payload from the fields list OR create that field in Airtable.
    console.error("❌ Airtable update failed:", e.message);
    return json(500, {
      error: "Airtable update failed",
      detail: e.message,
      hint: "If this mentions an unknown field, either create it in Airtable or remove it from the PATCH fields.",
    });
  }

  // 4) Email buyer pickup instructions (MailerSend)
  // If buyer email not available, we still succeed the webhook.
  if (!buyerEmail) {
    return json(200, { ok: true, message: "Paid marked. No buyer email available to send pickup instructions." });
  }

  // Pull pickup info from Airtable (use your real field names)
  const pickupAddress = f.pickup_address || f.pickupLocation || "";
  const pickupStart = f.pickup_window_start || "";
  const pickupEnd = f.pickup_window_end || "";
  const sellerName = f.sellerName || f.seller_name || "";
  const listingTitle =
    f.title ||
    f.product_title ||
    f.displayName ||
    `${f.category || "Item"}${f.dimensions ? ` — ${f.dimensions}` : ""}`;

  const siteUrl = (process.env.SITE_URL || "https://showroommarket.com").replace(/\/+$/, "");
  const supportEmail = process.env.SUPPORT_EMAIL || "support@showroommarket.com";

  // QR image (free) — email clients render this as an image
  const qrImgUrl =
    `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(qrPayload)}`;

  const subject = `Pickup Instructions — ${listingTitle || "Your purchase"} (Showroom Market)`;

  const text = [
    `Your purchase is confirmed.`,
    ``,
    `Listing: ${listingTitle || ""}`,
    `Seller: ${sellerName || ""}`,
    ``,
    `Pickup Address: ${pickupAddress || "(see seller)"}`
      + (pickupStart || pickupEnd ? `\nPickup Window: ${pickupStart || ""} - ${pickupEnd || ""}` : ""),
    ``,
    `Bring this QR code to pickup (show on your phone):`,
    `${qrPayload}`,
    ``,
    `Questions? ${supportEmail}`,
  ].join("\n");

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif; color:#0b1220; line-height:1.45;">
    <h2 style="margin:0 0 8px;">Pickup Instructions</h2>
    <p style="margin:0 0 12px;">Your purchase is confirmed. Please present this QR code at pickup.</p>

    <div style="border:1px solid #e6e8ee; border-radius:12px; padding:14px; margin:14px 0;">
      <div style="font-size:14px; margin:0 0 6px;"><b>Listing:</b> ${escapeHtml(listingTitle || "")}</div>
      ${sellerName ? `<div style="font-size:14px; margin:0 0 6px;"><b>Seller:</b> ${escapeHtml(sellerName)}</div>` : ""}
      ${pickupAddress ? `<div style="font-size:14px; margin:0 0 6px;"><b>Pickup Address:</b> ${escapeHtml(pickupAddress)}</div>` : ""}
      ${(pickupStart || pickupEnd) ? `<div style="font-size:14px; margin:0 0 6px;"><b>Pickup Window:</b> ${escapeHtml(String(pickupStart || ""))} ${pickupEnd ? "– " + escapeHtml(String(pickupEnd)) : ""}</div>` : ""}
      <div style="font-size:12px; color:#556; margin-top:10px;">
        If any detail above is missing, reply to this email and we’ll coordinate pickup.
      </div>
    </div>

    <div style="border:1px solid #e6e8ee; border-radius:12px; padding:14px; margin:14px 0; text-align:center;">
      <div style="font-weight:bold; margin-bottom:10px;">Your Pickup QR Code</div>
      <img src="${qrImgUrl}" alt="Pickup QR Code" style="width:320px; max-width:100%; height:auto; border-radius:10px; border:1px solid #e6e8ee;" />
      <div style="margin-top:10px; font-size:12px; color:#556;">
        If the image doesn’t load, show this code to the seller:
      </div>
      <div style="margin-top:6px; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono','Courier New', monospace; font-size:12px; background:#f6f7fb; border-radius:8px; padding:10px; display:inline-block;">
        ${escapeHtml(qrPayload)}
      </div>
    </div>

    <p style="margin:14px 0 0; font-size:13px; color:#556;">
      Need help? <a href="mailto:${supportEmail}">${supportEmail}</a><br/>
      Showroom Market • ${siteUrl}
    </p>
  </div>
  `;

  try {
    await sendBuyerEmailMailerSend({
      toEmail: buyerEmail,
      subject,
      html,
      text,
    });
    console.log("✅ Buyer pickup email sent:", buyerEmail);
  } catch (e) {
    console.error("❌ Buyer email failed:", e.message);
    // Do NOT fail the webhook; payment is real.
    return json(200, {
      ok: true,
      message: "Paid marked, but buyer email failed",
      detail: e.message,
      buyerEmail,
    });
  }

  return json(200, { ok: true, message: "Paid marked + buyer email sent", listingId, buyerEmail });
};

// tiny helper
function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
