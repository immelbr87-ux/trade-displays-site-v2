const Stripe = require("stripe");
const {
  airtableQuery,
  airtablePatchRecord,
  isPayoutAllowed,
  canTransitionStatus
} = require("./_lib");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

exports.handler = async () => {
  const baseId = process.env.AIRTABLE_BASE_ID;
  const apiKey = process.env.AIRTABLE_API_KEY;

  const records = await airtableQuery({
    baseId,
    table: "Listings",
    apiKey,
    params: {
      filterByFormula: `AND({pickup_confirmed}=TRUE(), {seller_payout_status}='Pending')`
    }
  });

  let processed = 0;

  for (const rec of records.records) {
    const f = rec.fields;

    if (!f.seller_payout_amount || !f.stripe_account_id) continue;

    const allowed = isPayoutAllowed(f);
    if (!allowed.ok) continue;

    if (!canTransitionStatus(f.status, "Payout Sent")) continue;

    try {
      const transfer = await stripe.transfers.create({
        amount: Math.round(f.seller_payout_amount * 100),
        currency: "usd",
        destination: f.stripe_account_id,
      });

      await airtablePatchRecord({
        baseId,
        table: "Listings",
        recordId: rec.id,
        apiKey,
        fields: {
          status: "Payout Sent",
          seller_payout_status: "Paid",
          stripe_transfer_id: transfer.id,
          payout_sent_at: new Date().toISOString()
        }
      });

      processed++;
    } catch (err) {
      console.error("Payout failed:", rec.id, err.message);
    }
  }

  return { statusCode: 200, body: `Processed ${processed} payouts` };
};
