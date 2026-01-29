const fetch = require("node-fetch");
const Stripe = require("stripe");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE = process.env.AIRTABLE_TABLE;
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;

exports.handler = async () => {
  try {
    console.log("🔄 Auto payout check started...");

    // 🔍 1️⃣ Find eligible listings
    const formula = encodeURIComponent(
      "AND({pickup_confirmed}=TRUE(), {seller_payout_status}='Pending')"
    );

    const res = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE}?filterByFormula=${formula}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } }
    );

    const data = await res.json();

    if (!data.records.length) {
      console.log("No payouts ready.");
      return { statusCode: 200, body: "No payouts ready" };
    }

    console.log(`Found ${data.records.length} payout(s) to process`);

    for (const record of data.records) {
      const fields = record.fields;

      if (!fields.stripe_account_id || !fields.seller_payout_amount) continue;

      const payoutAmountCents = Math.round(Number(fields.seller_payout_amount) * 100);

      console.log(`Sending payout for record ${record.id}`);

      // 💸 2️⃣ Send Stripe transfer
      const transfer = await stripe.transfers.create({
        amount: payoutAmountCents,
        currency: "usd",
        destination: fields.stripe_account_id,
        description: `Auto payout for listing ${record.id}`,
      });

      // 📝 3️⃣ Mark as Paid
      await fetch(
        `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE}/${record.id}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${AIRTABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fields: {
              seller_payout_status: "Paid",
              stripe_transfer_id: transfer.id,
            },
          }),
        }
      );

      console.log(`✅ Payout sent: ${transfer.id}`);
    }

    return { statusCode: 200, body: "Auto payouts complete" };
  } catch (err) {
    console.error("Auto payout error:", err);
    return { statusCode: 500, body: "Auto payout failed" };
  }
};
