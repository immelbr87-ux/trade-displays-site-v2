const Stripe = require("stripe");

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

    return { statusCode: 400, body: `Webhook Error: ${err.message}` };

  }



  if (stripeEvent.type === "checkout.session.completed") {

    const session = stripeEvent.data.object;



    const listingId = session.metadata.listingId;



    console.log("Payment successful for listing:", listingId);



    // 👉 HERE you mark listing as SOLD / PAID in Airtable or DB

  }



  return { statusCode: 200 };

};

