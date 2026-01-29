// netlify/functions/verifyPickupQr.js
// ✅ Admin-protected
// ✅ Verifies QR payload (SMK|listingId|token)
// ✅ Confirms pickup (pickup_confirmed = true)
// ✅ Pays seller immediately via Stripe Connect transfer
// ✅ Logs transfer id + payout status back to Airtable
// ✅ Duplicate protection (won’t pay twice)

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
    event.headers["x-admin-secret"] ||
    event.headers["X-Admin-Secret"] ||
    ""
  ).trim();
}

function parsePayload(payload) {
  // Expected: SMK|recXXXXXXXXXXXXXX|token
  if (!payload || typeof payload !== "string") return null;

  const trimmed = payload.trim();
  const decoded = (() => {
    try { return decodeURIComponent(trimmed); } catch { return trimmed; }
  })();

  const parts = decoded.split("|");
  if (parts.length !== 3) return null;

  const [prefix, recordId, token] = parts;

  if (prefix !== "SMK") return null;
  if (!recordId || !recordId.startsWith("rec")) return null;
  if (!token || token.length < 8) return null;

  return { recordId, token, decoded };
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

  if (!res.ok) {
    const msg = data?.error?.message || data?.error || text || res.statusText;
    throw new Error(`Airtable GET failed (${res.status}): ${msg}`);
  }
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

  if (!res.ok) {
    const msg = data?.error?.message || data?.error || text || res.statusText;
    throw new Error(`Airtable PATCH failed (${res.status}): ${msg}`);
  }
  return data;
}

exports.handler = async (event) => {
  // ✅ Method validation
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed. Use POST." });

  // 🔒 Admin auth
  const expected = process.env.ADMIN_SECRET_TOKEN;
  const provided = getAuthToken(event);

  if (!expected) return json(500, { error: "Missing ADMIN_SECRET_TOKEN in Netlify env vars." });
  if (!provided || provided !== expected) return json(401, { error: "Unauthorized (bad or missing admin token)." });

  // ✅ Env vars
  const baseId = process.env.AIRTABLE_BASE_ID;
  const table = process.env.AIRTABLE_TABLE || "Listings";
  const apiKey = process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_TOKEN;
  if (!baseId || !apiKey) {
    return json(500, { error: "Missing Airtable env vars", detail: "Need AIRTABLE_BASE_ID + AIRTABLE_API_KEY" });
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return json(500, { error: "Missing STRIPE_SECRET_KEY in Netlify env vars." });
  }

  // ✅ Parse request
  let body = {};
  try { body = event.body ? JSON.parse(event.body) : {}; }
  catch { return json(400, { error: "Invalid JSON body." }); }

  const parsed = parsePayload(body.payload);
  if (!parsed) {
    return json(400, {
      error: "Invalid QR payload format.",
      expected: "SMK|<airtableRecordId>|<token>",
      got: body.payload,
    });
  }

  const { recordId, token: scannedToken, decoded } = parsed;

  // 1) Load listing
  let record;
  try {
    record = await airtableGetRecord({ baseId, table, recordId, apiKey });
  } catch (e) {
    console.error("Airtable GET error:", e.message);
    return json(500, { error: "Failed to load listing from Airtable.", detail: e.message });
  }

  const f = record.fields || {};

  // 2) Token validation (must match token OR payload)
  const expectedToken = f.pickup_qr_token ? String(f.pickup_qr_token).trim() : "";
  const expectedPayload = f.pickup_qr_payload ? String(f.pickup_qr_payload).trim() : "";

  const tokenOk =
    (expectedToken && expectedToken === scannedToken) ||
    (expectedPayload && expectedPayload === decoded);

  if (!tokenOk) {
    return json(401, { error: "QR token mismatch (invalid/expired code).", recordId });
  }

  // 3) Must be in a paid state to confirm pickup
  const status = String(f.status || "");
  const isPaid =
    status.toLowerCase().includes("paid") ||
    status.toLowerCase().includes("pending pickup");

  if (!isPaid) {
    return json(409, {
      error: "Pickup cannot be confirmed because listing is not in a paid state.",
      recordId,
      status,
    });
  }

  // 4) Duplicate protection: if already picked up, don't do anything else
  if (f.pickup_confirmed === true) {
    // But still return payout status info
    return json(200, {
      ok: true,
      message: "Already picked up (no changes).",
      recordId,
      pickup_confirmed_at: f.pickup_confirmed_at || null,
      seller_payout_status: f.seller_payout_status || null,
      stripe_transfer_id: f.stripe_transfer_id || null,
    });
  }

  // 5) Confirm pickup in Airtable first (so we have an audit trail even if payout fails)
  const nowIso = new Date().toISOString();
  try {
    await airtablePatchRecord({
      baseId,
      table,
      recordId,
      apiKey,
      fields: {
        pickup_confirmed: true,
        pickup_confirmed_at: nowIso,
        status: "Picked Up",
      },
    });
  } catch (e) {
    console.error("Airtable pickup PATCH error:", e.message);
    return json(500, { error: "Failed to mark pickup_confirmed in Airtable.", detail: e.message });
  }

  // 6) Reload listing (fresh values for payout)
  let record2;
  try {
    record2 = await airtableGetRecord({ baseId, table, recordId, apiKey });
  } catch (e) {
    return json(200, {
      ok: true,
      message: "Pickup confirmed, but failed to reload record for payout. You can payout manually.",
      recordId,
      payout_attempted: false,
      detail: e.message,
    });
  }

  const g = record2.fields || {};

  // 7) Immediate payout duplicate protection
  const payoutAlreadyDone =
    String(g.seller_payout_status || "").toLowerCase() === "paid" ||
    !!g.stripe_transfer_id;

  if (payoutAlreadyDone) {
    return json(200, {
      ok: true,
      message: "Pickup confirmed. Payout already sent (duplicate protection).",
      recordId,
      payout_attempted: false,
      seller_payout_status: g.seller_payout_status || null,
      stripe_transfer_id: g.stripe_transfer_id || null,
    });
  }

  // Required payout fields
  const destination = g.stripe_account_id;
  const payoutAmount = Number(g.seller_payout_amount);

  if (!destination) {
    // Mark payout needs attention
    try {
      await airtablePatchRecord({
        baseId,
        table,
        recordId,
        apiKey,
        fields: {
          seller_payout_status: "Failed",
          payout_error: "Missing stripe_account_id (seller not onboarded).",
        },
      });
    } catch {}
    return json(200, {
      ok: true,
      message: "Pickup confirmed, but seller is not onboarded (missing stripe_account_id).",
      recordId,
      payout_attempted: false,
    });
  }

  if (!Number.isFinite(payoutAmount) || payoutAmount <= 0) {
    try {
      await airtablePatchRecord({
        baseId,
        table,
        recordId,
        apiKey,
        fields: {
          seller_payout_status: "Failed",
          payout_error: "Invalid seller_payout_amount.",
        },
      });
    } catch {}
    return json(200, {
      ok: true,
      message: "Pickup confirmed, but seller_payout_amount is missing/invalid.",
      recordId,
      payout_attempted: false,
      seller_payout_amount: g.seller_payout_amount || null,
    });
  }

  // 8) Send Stripe transfer
  const amountCents = Math.round(payoutAmount * 100);

  try {
    const transfer = await stripe.transfers.create({
      amount: amountCents,
      currency: "usd",
      destination,
      description: `Showroom Market seller payout for ${recordId}`,
      metadata: {
        listingId: recordId,
        type: "seller_payout",
      },
    });

    // 9) Log payout in Airtable
    await airtablePatchRecord({
      baseId,
      table,
      recordId,
      apiKey,
      fields: {
        seller_payout_status: "Paid",
        payout_sent_at: new Date().toISOString(),
        stripe_transfer_id: transfer.id,
        payout_error: "", // clear any prior error
      },
    });

    return json(200, {
      ok: true,
      message: "Pickup confirmed + payout sent ✅",
      recordId,
      pickup_confirmed_at: nowIso,
      payout_attempted: true,
      payout_amount: payoutAmount,
      stripe_transfer_id: transfer.id,
      destination_account: destination,
    });
  } catch (e) {
    console.error("Stripe transfer failed:", e.message);

    // Leave pickup confirmed, but log payout failure
    try {
      await airtablePatchRecord({
        baseId,
        table,
        recordId,
        apiKey,
        fields: {
          seller_payout_status: "Failed",
          payout_error: String(e.message || "Stripe transfer failed"),
        },
      });
    } catch {}

    return json(500, {
      error: "Pickup confirmed BUT payout failed",
      recordId,
      detail: e.message,
    });
  }
};
