const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  // 🚨 SECURITY: Only allow POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: "Method Not Allowed",
    };
  }

  try {
    const { price, listingId } = JSON.parse(event.body);

    if (!price || !listingId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing price or listingId" }),
      };
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",

      // ✅ Auto enables cards, Apple Pay, Google Pay, etc.
      automatic_payment_methods: { enabled: true },

      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Showroom Market Purchase",
            },
            unit_amount: price, // cents
          },
          quantity: 1,
        },
      ],

      metadata: {
        listingId: listingId,
      },

      success_url: "https://showroommarket.com/success.html",
      cancel_url: "https://showroommarket.com/cancel.html",
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    console.error("Stripe Checkout Error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Checkout session failed" }),
    };
  }
};
