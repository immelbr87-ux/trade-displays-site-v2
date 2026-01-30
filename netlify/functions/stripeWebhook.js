const Stripe = require("stripe");
const fetch = require("node-fetch");
const { addHours } = require("./_lib");

console.log("stripeWebhook function loaded");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  console.log("Webhook received");

  const sig = event.headers["stripe-signature"];
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return { statusCode: 400, body: "Webhook signature failed" };
  }

  console.log("Stripe event type:", stripeEvent.type);

  // -----------------------------
  // PAYMENT COMPLETED
  // -----------------------------
  if (stripeEvent.type === "checkout.session.completed") {
    const session = stripeEvent.data.object;
    const listingId = session.metadata?.listingId;

    console.log("Payment completed for listing:", listingId);

    if (!listingId) return { statusCode: 200 };

    const now = new Date();
    const holdUntil = addHours(now, 24);

    try {
      await fetch(
        `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Listings/${listingId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fields: {
              status: "Paid – Pending Pickup",
              paid_at: now.toISOString(),
              payout_eligible_at: holdUntil.toISOString(),
              seller_payout_status: "Pending",
              stripe_session_id: session.id,
              stripe_payment_intent: session.payment_intent
            },
          }),
        }
      );

      console.log("Listing updated after payment");
    } catch (err) {
      console.error("Failed to update Airtable after payment:", err);
    }
  }

  // -----------------------------
  // DISPUTE / CHARGEBACK
  // -----------------------------
  if (stripeEvent.type === "charge.dispute.created") {
    const dispute = stripeEvent.data.object;

    console.log("Dispute created for payment_intent:", dispute.payment_intent);

    try {
      const search = await fetch(
        `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Listings?filterByFormula={stripe_payment_intent}='${dispute.payment_intent}'`,
        { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } }
      );

      const records = (await search.json()).records;
      if (records.length === 0) {
        console.log("No matching listing found for dispute");
        return { statusCode: 200 };
      }

      await fetch(
        `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Listings/${records[0].id}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fields: {
              chargeback_flag: true,
              seller_payout_status: "Blocked"
            }
          }),
        }
      );

      console.log("Listing marked as chargeback risk");
    } catch (err) {
      console.error("Failed to handle dispute:", err);
    }
  }

  return { statusCode: 200, body: "OK" };
};
