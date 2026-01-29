const Stripe = require("stripe");
const {
  json,
  requireAdmin,
  airtableGetRecord,
  airtablePatchRecord,
  canTransitionStatus,
  isPayoutAllowed
} = require("./_lib");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  const auth = requireAdmin(event);
  if (!auth.ok) return json(auth.status, { error: auth.error });

  const { action, recordId } = JSON.parse(event.body || "{}");
  if (!recordId) return json(400, { error: "Missing recordId" });

  const rec = await airtableGetRecord({
    baseId: process.env.AIRTABLE_BASE_ID,
    table: "Listings",
    recordId,
    apiKey: process.env.AIRTABLE_API_KEY
  });

  const f = rec.fields;

  /* ===============================
     📦 CONFIRM PICKUP
  =============================== */
  if (action === "confirm_pickup") {
    if (!canTransitionStatus(f.status, "Picked Up")) {
      return json(400, { error: `Invalid transition from ${f.status}` });
    }

    await airtablePatchRecord({
      baseId: process.env.AIRTABLE_BASE_ID,
      table: "Listings",
      recordId,
      apiKey: process.env.AIRTABLE_API_KEY,
      fields: {
        status: "Picked Up",
        pickup_confirmed: true,
        pickup_confirmed_at: new Date().toISOString(),
      }
    });

    return json(200, { ok: true, message: "Pickup confirmed" });
  }

  /* ===============================
     💸 RELEASE PAYOUT
  =============================== */
  if (action === "release_payout") {
    const allowed = isPayoutAllowed(f);
    if (!allowed.ok) return json(400, { error: allowed.reason });

    if (!canTransitionStatus(f.status, "Payout Sent")) {
      return json(400, { error: `Invalid transition from ${f.status}` });
    }

    const transfer = await stripe.transfers.create({
      amount: Math.round(f.seller_payout_amount * 100),
      currency: "usd",
      destination: f.stripe_account_id,
    });

    await airtablePatchRecord({
      baseId: process.env.AIRTABLE_BASE_ID,
      table: "Listings",
      recordId,
      apiKey: process.env.AIRTABLE_API_KEY,
      fields: {
        status: "Payout Sent",
        stripe_transfer_id: transfer.id,
        seller_payout_status: "Paid",
        payout_sent_at: new Date().toISOString()
      }
    });

    return json(200, { ok: true, transferId: transfer.id });
  }

  return json(400, { error: "Unknown action" });
};
