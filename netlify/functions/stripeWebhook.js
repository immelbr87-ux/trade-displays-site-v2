const Stripe = require("stripe");
const fetch = require("node-fetch");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  // 🚨 Stripe requires the RAW body for signature verification
  const sig = event.headers["stripe-signature"];

  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Webhook signature verification failed.", err.message);
    return {
      statusCode: 400,
      body: `Webhook Error: ${err.message}`,
    };
  }

  // 🎯 We only care about successful checkout payments
  if (stripeEvent.type === "checkout.session.completed") {
    const session = stripeEvent.data.object;

    const listingId = session.metadata.listingId;

    if (!listingId) {
      console.error("⚠️ No listingId in Stripe metadata");
      return { statusCode: 200 };
    }

    console.log("💰 Payment successful for listing:", listingId);

    try {
      // 🗂 Update Airtable record
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
              stripe_session_id: session.id,
              paid_at: new Date().toISOString(),
            },
          }),
        }
      );

      console.log("📦 Airtable record updated to Paid – Pending Pickup");
    } catch (err) {
      console.error("❌ Airtable update failed:", err);
    }
  }

  return {
    statusCode: 200,
    body: "Webhook received",
  };
};
