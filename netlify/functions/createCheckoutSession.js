const Stripe = require("stripe");
const fetch = require("node-fetch");

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

    // 🔒 INVENTORY LOCK — Check Airtable before allowing checkout
    const airtableRes = await fetch(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Listings/${listingId}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
        },
      }
    );

    const airtableData = await airtableRes.json();

    if (!airtableData || !airtableData.fields) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "Listing not found" }),
      };
    }

    const listingStatus = airtableData.fields.status;

    // ✅ Only listings with status "Active" can be purchased
    if (listingStatus !== "Active") {
      return {
        statusCode: 409,
        body: JSON.stringify({
          error: "This item is no longer available.",
        }),
      };
    }

    // 💳 Create Stripe Checkout session
    const session = await stripe.checkout.sessions.create({
      mode: "payment",

      // Auto enables cards, Apple Pay, Google Pay, etc.
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
      cancel_url: "https://showroommarke_
