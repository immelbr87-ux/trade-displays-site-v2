const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  try {
    const { price, listingId } = JSON.parse(event.body);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Showroom Market Item",
            },
            unit_amount: price, // in cents
          },
          quantity: 1,
        },
      ],
      success_url: `https://showroommarket.com/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://showroommarket.com/cancel`,
      metadata: {
        listingId: listingId,
      },
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }
};
