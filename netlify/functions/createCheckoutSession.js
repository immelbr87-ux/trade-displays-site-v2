// netlify/functions/createCheckoutSession.js
// Creates a Stripe Checkout Session for a listing.
// Also marks listing as Reserved (Active -> Reserved) before redirecting.
//
// Expects POST JSON:
//  { listingId, customer_email?, customer_name?, customer_phone?, buyer_company?, origin? }
//
// Required env vars:
//   STRIPE_SECRET_KEY
//   AIRTABLE_API_KEY
//   AIRTABLE_BASE_ID
//   SITE_URL (fallback for success/cancel URLs)

const Stripe = require("stripe");
const { json, airtableGetRecord, airtablePatchRecord, canTransitionStatus, pick } = require("./_lib");
const config = require("./_config");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };
}

exports.handler = async (event) => {
  const headers = corsHeaders();

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method Not Allowed" }) };

  try {
    const body = JSON.parse(event.body || "{}");
    const listingId = body.listingId;
    if (!listingId) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing listingId" }) };

    const baseId = process.env.AIRTABLE_BASE_ID;
    const apiKey = process.env.AIRTABLE_API_KEY;

    const rec = await airtableGetRecord({ baseId, table: "Listings", recordId: listingId, apiKey });
    const f = rec.fields || {};

    const title = pick(f, ["title", "product_name", "name"], "Showroom Listing");
    const priceUsd = Number(pick(f, ["price", "sale_price"], 0)) || 0;
    const priceCents = Math.round(priceUsd * 100);

    if (!priceCents || priceCents < 50) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid listing price" }) };
    }

    // Mark as Reserved if possible
    const currentStatus = f.status || "Active";
    if (currentStatus === "Active") {
      await airtablePatchRecord({
        baseId,
        table: "Listings",
        recordId: listingId,
        apiKey,
        fields: { status: "Reserved", reserved_at: new Date().toISOString() }
      });
    }

    // Success/cancel URLs: use request origin if provided, else SITE_URL
    const origin = (body.origin || "").trim() || (event.headers?.origin || event.headers?.Origin || "").trim() || config.siteUrl;
    const successUrl = `${origin.replace(/\/$/, "")}/success.html?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${origin.replace(/\/$/, "")}/cancel.html?listingId=${encodeURIComponent(listingId)}`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: body.customer_email || undefined,
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: { name: title },
          unit_amount: priceCents
        },
        quantity: 1
      }],
      metadata: {
        listingId,
        customer_name: body.customer_name || "",
        customer_phone: body.customer_phone || "",
        buyer_company: body.buyer_company || ""
      },
      success_url: successUrl,
      cancel_url: cancelUrl
    });

    return { statusCode: 200, headers, body: JSON.stringify({ url: session.url }) };
  } catch (err) {
    console.error("createCheckoutSession error:", err?.message || err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Checkout failed" }) };
  }
};
