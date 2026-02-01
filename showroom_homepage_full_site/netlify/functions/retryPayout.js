// netlify/functions/retryPayout.js
const Stripe = require("stripe");
const { json, requireAdmin, airtableGetRecord, airtablePatchRecord, isPayoutAllowed, canTransitionStatus } = require("./_lib");
const { computeCommissionFromCents } = require("./calculateCommission");

console.log("retryPayout loaded");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  const auth = requireAdmin(event);
  if (!auth.ok) return json(auth.status || 401, { error: auth.error || "Unauthorized" });

  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });

  const baseId = process.env.AIRTABLE_BASE_ID;
  const apiKey = process.env.AIRTABLE_API_KEY;
  const table = process.env.AIRTABLE_TABLE || "Listings";

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch {}

  const recordId = body.recordId || body.listingId;
  if (!recordId) return json(400, { error: "Missing recordId/listingId" });

  try {
    const rec = await airtableGetRecord({ baseId, table, recordId, apiKey });
    const f = rec.fields || {};

    if (!f.stripe_account_id) return json(400, { error: "Missing stripe_account_id on listing" });

    // Ensure seller_payout_amount exists; if missing but we have gross amount, compute
    let payoutAmount = Number(f.seller_payout_amount);
    if (!Number.isFinite(payoutAmount) || payoutAmount <= 0) {
      // Try to infer from sale amount if stored
      const gross = Number(f.sale_amount || f.gross_amount || f.amount_paid);
      if (Number.isFinite(gross) && gross > 0) {
        const computed = computeCommissionFromCents(Math.round(gross * 100));
        payoutAmount = computed.payoutDollars;
      }
    }

    if (!Number.isFinite(payoutAmount) || payoutAmount <= 0) {
      return json(400, { error: "Missing/invalid seller_payout_amount (cannot retry payout)" });
    }

    const allowed = isPayoutAllowed(f);
    if (!allowed.ok) {
      return json(409, { error: "Payout not allowed", reason: allowed.reason });
    }

    if (!canTransitionStatus(f.status, "Payout Sent")) {
      // Still allow if already in payout-ish status?
      if (String(f.status || "").toLowerCase() !== "payout sent") {
        return json(409, { error: "Invalid status transition", from: f.status, to: "Payout Sent" });
      }
    }

    const transfer = await stripe.transfers.create({
      amount: Math.round(payoutAmount * 100),
      currency: "usd",
      destination: f.stripe_account_id,
      description: `Showroom Market payout retry for ${recordId}`,
      metadata: { listingId: recordId, retry: "true" },
    });

    await airtablePatchRecord({
      baseId,
      table,
      recordId,
      apiKey,
      fields: {
        status: "Payout Sent",
        seller_payout_status: "Paid",
        stripe_transfer_id: transfer.id,
        payout_sent_at: new Date().toISOString(),
      },
    });

    return json(200, { ok: true, transfer_id: transfer.id });
  } catch (err) {
    console.error("retryPayout error:", err);
    return json(500, { error: "Retry payout failed", detail: err.message });
  }
};
