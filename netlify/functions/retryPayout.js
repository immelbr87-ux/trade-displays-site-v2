// netlify/functions/retryPayout.js
// ✅ Admin-protected
// ✅ Retries Stripe Connect payout for a listing (Airtable record)
// ✅ Duplicate protection (won't pay if already paid / has transfer id)
// ✅ Requires pickup_confirmed = true and a paid-like status

const fetch = require("node-fetch");
const Stripe = require("stripe");

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

function getAuthToken(event) {
  const auth = event.headers.authorization || event.headers.Authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice("Bearer ".length).trim();
  return (
    event.headers["x-admin-token"] ||
    event.headers["X-Admin-Token"] ||
    ""
  ).trim();
}

async function airtableGet({ baseId, table, recordId, apiKey }) {
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}/${recordId}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.error?.message || data?.error || text || res.statusText;
    throw new Error(`Airtable GET failed (${res.status}): ${msg}`);
  }
  return data;
}

async function airtablePatch({ baseId, table, recordId, apiKey, fields }) {
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
  if (!res.ok) {
    const msg = data?.error?.message || data?.error || text || res.statusText;
    throw new Error(`Airtable PATCH failed (${res.status}): ${msg}`);
  }
  return data;
}

exports.handler = async (event) => {
  // ✅ Method
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });

  // 🔒 Admin auth
  const expected = process.env.ADMIN_SECRET_TOKEN;
  const provided = getAuthToken(event);
  if (!expected) return json(500, { error: "Missing ADMIN_SECRET_TOKEN env var" });
  if (!provided || provided !== expected) return json(401, { error: "Unauthorized" });

  // ✅ Env
  const baseId = process.env.AIRTABLE_BASE_ID;
  const apiKey = process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_TOKEN;
  const table = process.env.AIRTABLE_TABLE || "Listings";
  if (!baseId || !apiKey) return json(500, { error: "Missing Airtable env vars" });
  if (!process.env.STRIPE_SECRET_KEY) return json(500, { error: "Missing STRIPE_SECRET_KEY env var" });

  // ✅ Body
  let body = {};
  try { body = event.body ? JSON.parse(event.body) : {}; }
  catch { return json(400, { error: "Invalid JSON body" }); }

  const recordId = String(body.recordId || "").trim();
  if (!recordId || !recordId.startsWith("rec")) {
    return json(400, { error: "Missing/invalid recordId" });
  }

  // 1) Load record
  let rec;
  try {
    rec = await airtableGet({ baseId, table, recordId, apiKey });
  } catch (e) {
    return json(500, { error: "Failed to load listing", detail: e.message });
  }

  const f = rec.fields || {};

  // 2) Hard guards
  const payoutStatus = String(f.seller_payout_status || "").trim();
  const transferId = String(f.stripe_transfer_id || "").trim();
  const pickupConfirmed = !!f.pickup_confirmed;
  const status = String(f.status || "");

  const isPaidLike =
    status.toLowerCase().includes("paid") ||
    status.toLowerCase().includes("pending pickup") ||
    status.toLowerCase().includes("picked up") ||
    status.toLowerCase().includes("pickup");

  if (!pickupConfirmed) {
    return json(409, { error: "Cannot payout: pickup_confirmed is not true.", recordId });
  }

  if (!isPaidLike) {
    return json(409, { error: "Cannot payout: listing status is not a paid/pickup state.", recordId, status });
  }

  // Duplicate protection
  if (transferId || payoutStatus.toLowerCase() === "paid") {
    return json(200, {
      ok: true,
      message: "Payout already completed (duplicate protection).",
      recordId,
      seller_payout_status: payoutStatus,
      stripe_transfer_id: transferId || null,
    });
  }

  // Only allow retry if status is Failed (or blank) — you can loosen this if you want
  const allowed = ["failed", "" , "pending", "ready"];
  if (!allowed.includes(payoutStatus.toLowerCase())) {
    return json(409, {
      error: "Retry blocked: seller_payout_status is not Failed/Pending/Ready.",
      recordId,
      seller_payout_status: payoutStatus,
    });
  }

  const destination = String(f.stripe_account_id || "").trim();
  const payoutAmount = Number(f.seller_payout_amount);

  if (!destination) {
    return json(409, { error: "Missing stripe_account_id (seller not onboarded).", recordId });
  }
  if (!Number.isFinite(payoutAmount) || payoutAmount <= 0) {
    return json(409, { error: "Invalid seller_payout_amount.", recordId, seller_payout_amount: f.seller_payout_amount });
  }

  // 3) Mark as processing (optional but useful)
  try {
    await airtablePatch({
      baseId, table, recordId, apiKey,
      fields: {
        seller_payout_status: "Processing",
        payout_error: "",
        payout_retry_at: new Date().toISOString(),
      },
    });
  } catch {
    // non-fatal
  }

  // 4) Stripe transfer
  const cents = Math.round(payoutAmount * 100);

  try {
    const transfer = await stripe.transfers.create({
      amount: cents,
      currency: "usd",
      destination,
      description: `Showroom Market seller payout retry for ${recordId}`,
      metadata: { listingId: recordId, type: "seller_payout_retry" },
    });

    // 5) Log success
    await airtablePatch({
      baseId, table, recordId, apiKey,
      fields: {
        seller_payout_status: "Paid",
        payout_sent_at: new Date().toISOString(),
        stripe_transfer_id: transfer.id,
        payout_error: "",
      },
    });

    return json(200, {
      ok: true,
      message: "Payout retried successfully ✅",
      recordId,
      payout_amount: payoutAmount,
      stripe_transfer_id: transfer.id,
      destination_account: destination,
    });
  } catch (e) {
    // log failure
    try {
      await airtablePatch({
        baseId, table, recordId, apiKey,
        fields: {
          seller_payout_status: "Failed",
          payout_error: String(e.message || "Stripe transfer failed"),
        },
      });
    } catch {}

    return json(500, {
      error: "Retry payout failed",
      recordId,
      detail: e.message,
    });
  }
};
