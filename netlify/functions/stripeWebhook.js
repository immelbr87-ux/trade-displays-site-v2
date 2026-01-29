const Stripe = require("stripe");
const fetch = require("node-fetch");
const { addHours } = require("./_lib");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  const sig = event.headers["stripe-signature"];
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return { statusCode: 400, body: "Webhook signature failed" };
  }

  /* ===============================
     💰 PAYMENT COMPLETED
  =============================== */
  if (stripeEvent.type === "checkout.session.completed") {
    const session = stripeEvent.data.object;
    const listingId = session.metadata?.listingId;
    if (!listingId) return { statusCode: 200 };

    const now = new Date();
    const holdUntil = addHours(now, 24);

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
          },
        }),
      }
    );
  }

  /* ===============================
     🚨 DISPUTE CREATED
  =============================== */
  if (stripeEvent.type === "charge.dispute.created") {
    const dispute = stripeEvent.data.object;

    await fetch(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Listings`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fields: {
            chargeback_flag: true,
            seller_payout_status: "Blocked",
          },
        }),
      }
    );
  }

  return { statusCode: 200, body: "OK" };
};
