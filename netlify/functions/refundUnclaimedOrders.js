const Stripe = require("stripe");
const {
  json,
  airtableQuery,
  airtablePatchRecord
} = require("./_lib");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

exports.handler = async () => {
  try {
    const now = new Date();
    const cutoff = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString(); // 5 days

    const records = await airtableQuery({
      baseId: process.env.AIRTABLE_BASE_ID,
      table: "Listings",
      apiKey: process.env.AIRTABLE_API_KEY,
      params: {
        filterByFormula: `AND({status}='Paid – Pending Pickup', {paid_at} <= '${cutoff}')`
      }
    });

    for (const rec of records.records) {
      const f = rec.fields;
      if (!f.stripe_session_id) continue;

      await stripe.refunds.create({ payment_intent: f.stripe_session_id });

      await airtablePatchRecord({
        baseId: process.env.AIRTABLE_BASE_ID,
        table: "Listings",
        recordId: rec.id,
        apiKey: process.env.AIRTABLE_API_KEY,
        fields: { status: "Refunded", seller_payout_status: "Refunded" }
      });
    }

    return json(200, { message: "Refunds processed" });

  } catch (err) {
    console.error(err);
    return json(500, { error: "Refund job failed" });
  }
};
