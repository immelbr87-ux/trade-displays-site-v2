const Stripe = require("stripe");
const fetch = require("node-fetch");
const {
  json,
  airtableQuery,
  airtablePatchRecord
} = require("./_lib");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

exports.handler = async () => {
  try {
    const now = new Date().toISOString();

    const records = await airtableQuery({
      baseId: process.env.AIRTABLE_BASE_ID,
      table: "Listings",
      apiKey: process.env.AIRTABLE_API_KEY,
      params: {
        filterByFormula: `AND({pickup_confirmed}=TRUE(), {seller_payout_status}!='Paid', {payout_hold_until} <= '${now}')`
      }
    });

    for (const rec of records.records) {
      const f = rec.fields;

      if (!f.seller_payout_amount || !f.stripe_account_id) continue;

      const transfer = await stripe.transfers.create({
        amount: Math.round(f.seller_payout_amount * 100),
        currency: "usd",
        destination: f.stripe_account_id,
        description: `Showroom Market payout for ${rec.id}`,
        metadata: { listingId: rec.id }
      });

      // 📧 Email seller
      await fetch("https://api.mailersend.com/v1/email", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.MAILERSEND_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: { email: "payouts@showroommarket.com" },
          to: [{ email: f.seller_email }],
          subject: "You’ve been paid 🎉",
          text: `Your item has been picked up and payout of $${f.seller_payout_amount} has been sent.`,
        })
      });

      await airtablePatchRecord({
        baseId: process.env.AIRTABLE_BASE_ID,
        table: "Listings",
        recordId: rec.id,
        apiKey: process.env.AIRTABLE_API_KEY,
        fields: {
          seller_payout_status: "Paid",
          stripe_transfer_id: transfer.id,
          payout_sent_at: new Date().toISOString(),
          status: "Completed"
        }
      });
    }

    return json(200, { message: "Held payouts processed" });

  } catch (err) {
    console.error(err);
    return json(500, { error: "Payout release failed" });
  }
};
