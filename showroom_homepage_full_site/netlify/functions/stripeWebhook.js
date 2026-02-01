// netlify/functions/stripeWebhook.js
const Stripe = require("stripe");
const calculateCommission = require("./calculateCommission");
const { json, airtablePatchRecord } = require("./_lib");
const { sendEmail } = require("./_email");

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
    console.error("Webhook signature verification failed.", err.message);
    return json(400, { error: "Invalid signature" });
  }

  if (stripeEvent.type === "checkout.session.completed") {
    const session = stripeEvent.data.object;
    const listingId = session.metadata?.listing_id;
    const salePrice = session.amount_total / 100;

    if (!listingId) return json(400, { error: "Missing listing_id" });

    const {
      commission_rate,
      commission_amount,
      seller_payout_amount,
    } = calculateCommission(salePrice);

    await airtablePatchRecord({
      baseId: process.env.AIRTABLE_BASE_ID,
      table: "Listings",
      recordId: listingId,
      apiKey: process.env.AIRTABLE_API_KEY,
      fields: {
        status: "Paid – Pending Pickup",
        sale_price: salePrice,
        commission_rate,
        commission_amount,
        seller_payout_amount,
        seller_payout_status: "Pending",
        stripe_payment_intent: session.payment_intent,
        payout_eligible_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        buyer_email: session.customer_details?.email || "",
        paid_at: new Date().toISOString()
      },
    });

    const siteUrl = process.env.SITE_URL;

    await sendEmail(session.customer_details?.email, "Your pickup is ready 🎉",
      `Your order is confirmed. Schedule pickup: ${siteUrl}/pickup/${listingId}`);

    await sendEmail(process.env.SUPPORT_EMAIL, "New sale on Showroom Market",
      `Listing ${listingId} sold for $${salePrice}`);
  }

  return json(200, { received: true });
};
