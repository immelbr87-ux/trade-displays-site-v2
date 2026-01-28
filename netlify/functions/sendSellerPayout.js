// netlify/functions/sendSellerPayout.js

const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  // 🔐 HARD BLOCK non-POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: "Method Not Allowed",
    };
  }

  // 🔐 SERVER-SIDE ADMIN AUTH
  const adminSecret = event.headers["x-admin-secret"];
  if (!adminSecret || adminSecret !== process.env.ADMIN_PAYOUT_SECRET) {
    return {
      statusCode: 403,
      body: "Forbidden: Invalid admin credentials",
    };
  }

  try {
    const { stripeAccountId, amount, currency = "usd" } = JSON.parse(event.body);

    if (!stripeAccountId || !amount) {
      return {
        statusCode: 400,
        body: "Missing stripeAccountId or amount",
      };
    }

    // 💸 Create payout (manual release)
    const payout = await stripe.transfers.create({
      amount: Math.round(amount * 100), // dollars → cents
      currency,
      destination: stripeAccountId,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        payoutId: payout.id,
      }),
    };

  } catch (err) {
    console.error("Payout error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
