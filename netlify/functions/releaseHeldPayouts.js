const Stripe = require("stripe");
const {
  json,
  airtableQuery,
  airtablePatchRecord,
  isPayoutAllowed,
  canTransitionStatus,
} = require("./_lib");
const { sendEmail } = require("./_email");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

exports.handler = async () => {
  const records = await airtableQuery({
    baseId: process.env.AIRTABLE_BASE_ID,
    table: "Listings",
    apiKey: process.env.AIRTABLE_API_KEY,
    params: {
      filterByFormula: `AND({pickup_confirmed}=TRUE(), {seller_payout_status}='Pending')`,
    },
  });

  for (const rec of records.records || []) {
    const f = rec.fields || {};
    const listingId = rec.id;

    if (!isPayoutAllowed(f).ok) continue;
    if (!canTransitionStatus(f.status, "Payout Sent")) continue;

    const transfer = await stripe.transfers.create({
      amount: Math.round(Number(f.seller_payout_amount) * 100),
      currency: "usd",
      destination: f.stripe_account_id,
      transfer_group: `listing_${listingId}`,
      metadata: { listingId },
    });

    await airtablePatchRecord({
      baseId: process.env.AIRTABLE_BASE_ID,
      table: "Listings",
      recordId: listingId,
      apiKey: process.env.AIRTABLE_API_KEY,
      fields: {
        status: "Payout Sent",
        seller_payout_status: "Paid",
        stripe_transfer_id: transfer.id,
        payout_sent_at: new Date().toISOString(),
      },
    });

    await sendEmail(f.seller_email, "You’ve been paid 💰",
      `Your payout of $${f.seller_payout_amount} has been sent.`);
  }

  return json(200, { ok: true });
};
