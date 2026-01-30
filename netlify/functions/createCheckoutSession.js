const Stripe = require("stripe");
const fetch = require("node-fetch");

const config = require("./_config");
const { ok, error } = require("./_response");

console.log("createCheckoutSession function loaded");

const stripe = new Stripe(config.stripeSecretKey);

exports.handler = async (event) => {
  console.log("createCheckoutSession start", { method: event.httpMethod });

  if (event.httpMethod !== "POST") {
    return error("Method Not Allowed", 405);
  }

  try {
    const { listingId } = JSON.parse(event.body || "{}");
    console.log("Incoming listingId:", listingId);

    if (!listingId) {
      return error("Missing listingId");
    }

    const airtableUrl = `https://api.airtable.com/v0/${config.airtableBaseId}/Listings/${listingId}`;
    console.log("Fetching Airtable record:", airtableUrl);

    const airtableRes = await fetch(airtableUrl, {
      headers: { Authorization: `Bearer ${config.airtableApiKey}` }
    });

    const airtableData = await airtableRes.json();
    console.log("Airtable response received");

    if (!airtableData.fields) {
      return error("Listing not found", 404);
    }

    const listing = airtableData.fields;

    if (listing.locked) {
      return error("Listing under review.", 403);
    }

    if (listing.status !== "Active") {
      return error("Item not available.", 409);
    }

    const priceCents = Math.round(Number(listing.price) * 100);
    console.log("Calculated price (cents):", priceCents);

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
      success_url: `${config.siteUrl}/success.html`,
      cancel_url: `${config.siteUrl}/cancel.html`,
    });

    console.log("Stripe session created:", session.id);

    return ok({ url: session.url });

  } catch (err) {
    console.error("Checkout error:", err);
    return error("Checkout failed", 500);
  }
};
