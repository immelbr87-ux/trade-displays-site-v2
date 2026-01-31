// netlify/functions/getCheckoutSummary.js
// Public: given a Stripe checkout session id, returns basic purchase summary + QR payload for pickup.
const Stripe = require("stripe");
const { json, airtableGetRecord, pick } = require("./_lib");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  };

  if (event.httpMethod !== "GET") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method Not Allowed" }) };

  try {
    const sessionId = (event.queryStringParameters || {}).session_id;
    if (!sessionId) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing session_id" }) };

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const listingId = session?.metadata?.listingId;
    if (!listingId) return { statusCode: 404, headers, body: JSON.stringify({ error: "Listing not found for session" }) };

    const rec = await airtableGetRecord({
      baseId: process.env.AIRTABLE_BASE_ID,
      table: "Listings",
      recordId: listingId,
      apiKey: process.env.AIRTABLE_API_KEY
    });

    const f = rec.fields || {};
    const title = pick(f, ["title", "product_name", "name"], "");
    const pickupLocation = pick(f, ["pickup_location", "location"], "");
    const pickupInstructions = pick(f, ["pickup_instructions"], "");

    const payloadObj = { listingId };
    const qr_payload = Buffer.from(JSON.stringify(payloadObj), "utf8").toString("base64");

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        listingId,
        title,
        amount_total: session?.amount_total ? session.amount_total / 100 : null,
        buyer_email: session?.customer_details?.email || session?.customer_email || null,
        pickup_location: pickupLocation,
        pickup_instructions: pickupInstructions,
        qr_payload
      })
    };
  } catch (err) {
    console.error("getCheckoutSummary error:", err?.message || err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Failed to load checkout summary" }) };
  }
};
