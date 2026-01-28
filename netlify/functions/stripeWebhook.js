const Stripe = require("stripe");
const fetch = require("node-fetch");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  const sig =
    event.headers["stripe-signature"] ||
    event.headers["Stripe-Signature"];

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;

  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Webhook signature verification failed:", err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  // 🎯 PAYMENT SUCCESS HANDLER
  if (stripeEvent.type === "checkout.session.completed") {
    const session = stripeEvent.data.object;
    const listingId = session.metadata?.listingId;

    console.log("✅ Payment successful:", {
      sessionId: session.id,
      listingId,
      amount: session.amount_total,
    });

    if (listingId) {
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
                stripe_session_id: session.id,
                paid_at: new Date().toISOString(),
              },
            }),
          }
        );

        console.log("📦 Airtable record updated for listing:", listingId);
      } catch (airtableErr) {
        console.error("❌ Airtable update failed:", airtableErr);
      }
    }
  }

  return { statusCode: 200, body: "ok" };
};
