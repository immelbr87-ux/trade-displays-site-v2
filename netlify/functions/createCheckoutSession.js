const Stripe = require("stripe");
const fetch = require("node-fetch");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { listingId } = JSON.parse(event.body);

    if (!listingId) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing listingId" }) };
    }

    const airtableRes = await fetch(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Listings/${listingId}`,
      { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } }
    );

    const airtableData = await airtableRes.json();
    if (!airtableData.fields) {
      return { statusCode: 404, body: JSON.stringify({ error: "Listing not found" }) };
    }

    const listing = airtableData.fields;

    if (listing.locked) {
      return { statusCode: 403, body: JSON.stringify({ error: "Listing under review." }) };
    }

    if (listing.status !== "Active") {
      return { statusCode: 409, body: JSON.stringify({ error: "Item not available." }) };
    }

    const priceCents = Math.round(Number(listing.price) * 100);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      automatic_payment_methods: { enabled: true },
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: { name: listing.title || "Showroom Listing" },
          unit_amount: priceCents
        },
        quantity: 1
      }],
      metadata: { listingId },
      success_url: "https://showroommarket.com/success.html",
      cancel_url: "https://showroommarket.com/cancel.html",
    });

    return { statusCode: 200, body: JSON.stringify({ url: session.url }) };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: "Checkout failed" }) };
  }
};
