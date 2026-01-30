// netlify/functions/releaseHeldPayouts.js
const Stripe = require("stripe");
const fetch = require("node-fetch");
const { json, airtableQuery, airtablePatchRecord, isPayoutAllowed, canTransitionStatus } = require("./_lib");

console.log("releaseHeldPayouts loaded");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

exports.handler = async () => {
  console.log("releaseHeldPayouts job start");

  try {
    const records = await airtableQuery({
      baseId: process.env.AIRTABLE_BASE_ID,
      table: "Listings",
      apiKey: process.env.AIRTABLE_API_KEY,
      params: {
        // eligible = pickup confirmed AND hold window complete AND not already paid
        filterByFormula: `AND({pickup_confirmed}=TRUE(), {seller_payout_status}!='Paid')`
      }
    });

    console.log("Candidates:", records.records?.length || 0);

    for (const rec of records.records || []) {
      const f = rec.fields || {};

      if (!f.seller_payout_amount || !f.stripe_account_id) continue;

      // Ensure hold complete + no chargeback + pickup confirmed + payout_eligible_at in past
      const allowed = isPayoutAllowed(f);
      if (!allowed.ok) {
        console.log("Skipping (not allowed):", rec.id, allowed.reason);
        continue;
      }

      // Ensure status transition is valid
      if (!canTransitionStatus(f.status, "Payout Sent")) {
        console.log("Skipping (bad status transition):", rec.id, f.status);
        continue;
      }

      console.log("Creating transfer:", rec.id);

      const transfer = await stripe.transfers.create({
        amount: Math.round(Number(f.seller_payout_amount) * 100),
        currency: "usd",
        destination: f.stripe_account_id,
        description: `Showroom Market payout for ${rec.id}`,
        metadata: { listingId: rec.id },
      });

      // Optional: seller email notification
      if (process.env.MAILERSEND_API_KEY && (f.seller_email || f.showroom_email)) {
        const toEmail = f.seller_email || f.showroom_email;
        const fromEmail = process.env.MAILERSEND_FROM_EMAIL || "payouts@showroommarket.com";
        const fromName = process.env.MAILERSEND_FROM_NAME || "Showroom Market";

        console.log("Emailing seller payout notice:", toEmail);

        await fetch("https://api.mailersend.com/v1/email", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.MAILERSEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: { email: fromEmail, name: fromName },
            to: [{ email: toEmail }],
            subject: "You’ve been paid 🎉",
            text: `Your item has been picked up and payout of $${f.seller_payout_amount} has been sent.`,
          }),
        });
      }

      await airtablePatchRecord({
        baseId: process.env.AIRTABLE_BASE_ID,
        table: "Listings",
        recordId: rec.id,
        apiKey: process.env.AIRTABLE_API_KEY,
        fields: {
          status: "Payout Sent",
          seller_payout_status: "Paid",
          stripe_transfer_id: transfer.id,
          payout_sent_at: new Date().toISOString(),
        },
      });

      console.log("Payout complete:", rec.id);
    }

    return json(200, { message: "Held payouts processed" });
  } catch (err) {
    console.error("releaseHeldPayouts error:", err);
    return json(500, { error: "Payout release failed" });
  }
};
