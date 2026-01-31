// netlify/functions/stripeWebhook.js
// Stripe webhook → updates Airtable after successful checkout + dispute flags.
// Adds commission calculation + richer logging.
//
// Required env vars:
//   STRIPE_SECRET_KEY
//   STRIPE_WEBHOOK_SECRET
//   AIRTABLE_BASE_ID
//   AIRTABLE_API_KEY
//
// Optional env vars (commission):
//   PLATFORM_FEE_PCT (default 0.15)
//   PLATFORM_FEE_FLAT (default 0)
//   PLATFORM_FEE_MIN / PLATFORM_FEE_MAX (optional caps)

const Stripe = require("stripe");
const {
  json,
  airtableGetRecord,
  airtablePatchRecord,
  addHours,
  pick
} = require("./_lib");
const { calculateCommission } = require("./calculateCommission");

console.log("stripeWebhook loaded");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function getRawBody(event) {
  if (!event) return "";
  if (event.isBase64Encoded) {
    try {
      return Buffer.from(event.body || "", "base64").toString("utf8");
    } catch (e) {
      console.error("stripeWebhook: failed to decode base64 body", e?.message || e);
      return event.body || "";
    }
  }
  return event.body || "";
}

exports.handler = async (event) => {
  const requestId = event?.headers?.["x-request-id"] || event?.headers?.["X-Request-Id"] || "";
  const sig = event?.headers?.["stripe-signature"] || event?.headers?.["Stripe-Signature"];

  if (!sig) {
    console.error("stripeWebhook: missing stripe-signature header", { requestId });
    return json(400, { error: "Missing stripe-signature header" });
  }

  let stripeEvent;
  try {
    const rawBody = getRawBody(event);
    stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("stripeWebhook signature failed:", err?.message || err, { requestId });
    return json(400, { error: "Webhook signature failed" });
  }

  const baseId = process.env.AIRTABLE_BASE_ID;
  const apiKey = process.env.AIRTABLE_API_KEY;

  console.log("stripeWebhook event received", {
    requestId,
    type: stripeEvent?.type,
    id: stripeEvent?.id
  });

  try {
    // 1) Checkout completed → mark listing as paid, set hold window, compute commission, store buyer email.
    if (stripeEvent.type === "checkout.session.completed") {
      const session = stripeEvent.data.object || {};
      const listingId = session?.metadata?.listingId;

      if (!listingId) {
        console.log("stripeWebhook: checkout.session.completed missing listingId metadata");
        return json(200, { ok: true });
      }

      // Fetch Airtable listing to get price + seller payout destination fields
      const record = await airtableGetRecord({
        baseId,
        table: "Listings",
        recordId: listingId,
        apiKey
      });

      const f = record?.fields || {};
      const priceUsd = Number(pick(f, ["price", "Price", "sale_price"], 0)) || 0;

      // Commission calc
      const comm = calculateCommission(priceUsd);
      if (!comm.ok) {
        console.warn("stripeWebhook: commission calc not ok, using full price payout", comm);
      }

      const now = new Date();
      const holdUntil = addHours(now, 24);

      const buyerEmail =
        session?.customer_details?.email ||
        session?.customer_email ||
        null;

      const buyerName =
        session?.customer_details?.name ||
        null;

      const paymentIntent = session?.payment_intent || null;

      const fieldsToPatch = {
        status: "Paid – Pending Pickup",
        paid_at: now.toISOString(),
        payout_eligible_at: holdUntil.toISOString(),
        seller_payout_status: "Pending",
        stripe_session_id: session?.id || null,
        stripe_payment_intent: paymentIntent,
        // Buyer details for receipts + pickup pass
        buyer_email: buyerEmail,
        buyer_name: buyerName,
        // Commission fields
        sale_price: priceUsd || null,
        platform_fee: comm.ok ? comm.platform_fee : null,
        seller_payout_amount: comm.ok ? comm.seller_payout : priceUsd || null,
        platform_fee_pct_effective: comm.ok ? comm.effective_pct : null
      };

      console.log("stripeWebhook: patching listing for paid status", {
        listingId,
        priceUsd,
        platform_fee: fieldsToPatch.platform_fee,
        seller_payout_amount: fieldsToPatch.seller_payout_amount,
        buyerEmail,
        paymentIntent
      });

      await airtablePatchRecord({
        baseId,
        table: "Listings",
        recordId: listingId,
        apiKey,
        fields: fieldsToPatch
      });

      return json(200, { ok: true });
    }

    // 2) Dispute created → mark chargeback flag + block payout
    if (stripeEvent.type === "charge.dispute.created") {
      const dispute = stripeEvent.data.object || {};
      const paymentIntent = dispute?.payment_intent || null;

      console.log("stripeWebhook: dispute created", { paymentIntent, disputeId: dispute?.id });

      if (!paymentIntent) return json(200, { ok: true });

      // Find listing by stripe_payment_intent (preferred) or stripe_session_id (fallback)
      const query = await require("node-fetch")(
        `https://api.airtable.com/v0/${baseId}/Listings?` +
          new URLSearchParams({
            filterByFormula: `OR({stripe_payment_intent}='${paymentIntent}', {stripe_session_id}='${paymentIntent}')`
          }).toString(),
        { headers: { Authorization: `Bearer ${apiKey}` } }
      );

      const data = await query.json();
      const rec = (data.records || [])[0];
      if (!rec) return json(200, { ok: true });

      await airtablePatchRecord({
        baseId,
        table: "Listings",
        recordId: rec.id,
        apiKey,
        fields: { chargeback_flag: true, seller_payout_status: "Blocked", dispute_id: dispute?.id || null }
      });

      return json(200, { ok: true });
    }

    // Other event types: acknowledge
    return json(200, { ok: true });
  } catch (err) {
    console.error("stripeWebhook error:", err?.message || err, err?.stack);
    return json(500, { error: "Webhook handler failed" });
  }
};
