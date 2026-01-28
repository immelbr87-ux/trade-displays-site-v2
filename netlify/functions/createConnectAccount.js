const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { sellerEmail, sellerName } = JSON.parse(event.body || "{}");

    if (!sellerEmail) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing sellerEmail" }) };
    }

    const account = await stripe.accounts.create({
      type: "express",
      country: "US",
      email: sellerEmail,
      business_profile: {
        name: sellerName || "Showroom Seller",
      },
      capabilities: {
        transfers: { requested: true },
      },
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ stripe_account_id: account.id }),
    };
  } catch (err) {
    console.error("createConnectAccount error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Server error" }) };
  }
};
