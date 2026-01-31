// netlify/functions/retryPayout.js
// Admin-only: manually attempts a Stripe transfer for a listing, if allowed.
const Stripe = require("stripe");
const { json, requireAdmin, airtableGetRecord, airtablePatchRecord, isPayoutAllowed, canTransitionStatus, pick } = require("./_lib");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  const auth = requireAdmin(event);
  if (!auth.ok) return json(auth.status || 401, { error: auth.error || "Unauthorized" });

  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });

  const baseId = process.env.AIRTABLE_BASE_ID;
  const apiKey = process.env.AIRTABLE_API_KEY;

  try {
    const body = JSON.parse(event.body || "{}");
    const listingId = body.listingId;
    if (!listingId) return json(400, { error: "Missing listingId" });

    const rec = await airtableGetRecord({ baseId, table: "Listings", recordId: listingId, apiKey });
    const f = rec.fields || {};

    const payoutAmt = Number(pick(f, ["seller_payout_amount"], 0)) || 0;
    const dest = pick(f, ["stripe_account_id"], "");

    if (!payoutAmt || !dest) return json(400, { error: "Missing seller_payout_amount or stripe_account_id" });

    const allowed = isPayoutAllowed(f);
    if (!allowed.ok) return json(400, { error: "Payout not allowed", reason: allowed.reason });

    if (!canTransitionStatus(f.status, "Payout Sent")) return json(400, { error: "Bad status transition", from: f.status });

    const transfer = await stripe.transfers.create({
      amount: Math.round(payoutAmt * 100),
      currency: "usd",
      destination: dest,
      description: `Showroom Market payout retry for ${listingId}`,
      metadata: { listingId }
    });

    await airtablePatchRecord({
      baseId,
      table: "Listings",
      recordId: listingId,
      apiKey,
      fields: {
        status: "Payout Sent",
        seller_payout_status: "Paid",
        stripe_transfer_id: transfer.id,
        payout_sent_at: new Date().toISOString()
      }
    });

    return json(200, { ok: true, transfer_id: transfer.id });
  } catch (err) {
    console.error("retryPayout error:", err?.message || err);
    return json(500, { error: "Retry payout failed" });
  }
};
