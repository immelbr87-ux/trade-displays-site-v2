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

exports.handler = async (event) => {
  // 🔒 HTTP method validation
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method Not Allowed" });
  }

  // 🔒 Admin token validation (server-side)
  const provided =
    event.headers["x-admin-token"] ||
    event.headers["X-Admin-Token"] ||
    event.headers["x-admin-token".toLowerCase()];

  const expected = process.env.ADMIN_SECRET_TOKEN;

  if (!expected) {
    return json(500, { error: "Missing ADMIN_SECRET_TOKEN env var in Netlify" });
  }

  if (!provided || provided !== expected) {
    return json(401, { error: "Unauthorized" });
  }

  // ✅ Parse body
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const listingId = (body.listingId || "").trim();
  const qrToken = (body.qrToken || "").trim();

  if (!listingId || !qrToken) {
    return json(400, { error: "Missing listingId or qrToken" });
  }

  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const table = process.env.AIRTABLE_TABLE || "Listings";

  if (!apiKey || !baseId) {
    return json(500, { error: "Missing Airtable env vars (AIRTABLE_API_KEY, AIRTABLE_BASE_ID)" });
  }

  // 1) Load listing
  let record;
  try {
    record = await airtableGetRecord({ baseId, table, recordId: listingId, apiKey });
  } catch (e) {
    return json(500, { error: "Failed to load listing from Airtable", detail: e.message });
  }

  const f = record.fields || {};

  // 🔒 Validate QR token matches what we issued
  // Field name we expect in Airtable: pickup_qr_token
  if (!f.pickup_qr_token) {
    return json(409, { error: "Listing has no pickup_qr_token on record (QR not set up yet)." });
  }
  if (String(f.pickup_qr_token).trim() !== qrToken) {
    return json(409, { error: "QR token mismatch. Wrong/expired code." });
  }

  // ✅ Basic state validation
  // We only confirm pickup if the listing is already paid
  const status = String(f.status || "");
  const alreadyConfirmed = !!f.pickup_confirmed;

  if (alreadyConfirmed) {
    return json(200, {
      ok: true,
      message: "Pickup already confirmed ранее — no changes made.",
      listingId,
      status,
      pickup_confirmed: true,
      seller_payout_status: f.seller_payout_status || null,
      stripe_transfer_id: f.stripe_transfer_id || null,
    });
  }

  // If you want stricter checking, enforce:
  // - status must be "Paid – Pending Pickup"
  // We'll allow any "Paid" state, but block obviously wrong states.
  if (!status.toLowerCase().includes("paid")) {
    return json(409, {
      error: "Listing is not in a paid state. Refusing to confirm pickup.",
      current_status: status,
    });
  }

  // 2) Mark pickup confirmed in Airtable
  try {
    await airtablePatchRecord({
      baseId,
      table,
      recordId: listingId,
      apiKey,
      fields: {
        pickup_confirmed: true,
        pickup_confirmed_at: new Date().toISOString(),
        status: "Picked Up",
      },
    });
  } catch (e) {
    return json(500, { error: "Failed to mark pickup_confirmed in Airtable", detail: e.message });
  }

  // 3) Auto-trigger payout (manual for now was your choice, BUT you said: “Auto-release payouts when pickup_confirmed = true lets do now”)
  // We'll attempt payout immediately, with duplicate protection.

  // Required Airtable fields for payout:
  // - stripe_account_id (destination connected account)
  // - seller_payout_amount (formula field you already set)
  // - seller_payout_status (single select: Pending / Paid / etc)
  // - stripe_transfer_id (text field)

  // Reload updated record (to ensure latest)
  let record2;
  try {
    record2 = await airtableGetRecord({ baseId, table, recordId: listingId, apiKey });
  } catch (e) {
    return json(200, {
      ok: true,
      message: "Pickup confirmed, but payout reload failed. You can still payout manually.",
      listingId,
      payout_attempted: false,
      detail: e.message,
    });
  }

  const g = record2.fields || {};

  // Duplicate protection
  if (String(g.seller_payout_status || "").toLowerCase() === "paid" || g.stripe_transfer_id) {
    return json(200, {
      ok: true,
      message: "Pickup confirmed. Payout already sent (duplicate protection triggered).",
      listingId,
      payout_attempted: false,
      seller_payout_status: g.seller_payout_status || null,
      stripe_transfer_id: g.stripe_transfer_id || null,
    });
  }

  const destination = g.stripe_account_id;
  const payoutAmount = Number(g.seller_payout_amount);

  if (!destination) {
    return json(200, {
      ok: true,
      message: "Pickup confirmed. No stripe_account_id on listing — cannot auto-payout.",
      listingId,
      payout_attempted: false,
    });
  }

  if (!Number.isFinite(payoutAmount) || payoutAmount <= 0) {
    return json(200, {
      ok: true,
      message: "Pickup confirmed. seller_payout_amount missing/invalid — cannot auto-payout.",
      listingId,
      payout_attempted: false,
      seller_payout_amount: g.seller_payout_amount || null,
    });
  }

  const amountCents = Math.round(payoutAmount * 100);

  // Transfer (Connect)
  try {
    const transfer = await stripe.transfers.create({
      amount: amountCents,
      currency: "usd",
      destination,
      metadata: {
        listingId,
        sellerName: g.sellerName || "",
        type: "seller_payout",
      },
    });

    // Log payout in Airtable
    await airtablePatchRecord({
      baseId,
      table,
      recordId: listingId,
      apiKey,
      fields: {
        seller_payout_status: "Paid",
        payout_sent_at: new Date().toISOString(),
        stripe_transfer_id: transfer.id,
      },
    });

    return json(200, {
      ok: true,
      message: "Pickup confirmed + payout sent ✅",
      listingId,
      payout_attempted: true,
      payout_amount: payoutAmount,
      stripe_transfer_id: transfer.id,
      destination_account: destination,
    });

  } catch (e) {
    // If payout failed, keep pickup confirmed but mark payout issue
    try {
      await airtablePatchRecord({
        baseId,
        table,
        recordId: listingId,
        apiKey,
        fields: {
          seller_payout_status: "Failed",
          payout_error: String(e.message || "Payout failed"),
        },
      });
    } catch {}

    return json(500, {
      error: "Pickup confirmed BUT payout failed",
      listingId,
      detail: e.message,
    });
  }
};
