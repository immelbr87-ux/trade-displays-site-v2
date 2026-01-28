const Stripe = require("stripe");
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

    // 👉 TODO (next step): Update Airtable record here
    // Example:
    // await updateListingStatus(listingId);
  }

  return { statusCode: 200, body: "ok" };
};
