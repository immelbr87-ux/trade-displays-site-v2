const Stripe = require("stripe");
const fetch = require("node-fetch");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE = "Listings";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // 🔐 Server-side admin protection
  const adminSecret = event.headers["x-admin-secret"];
  if (!adminSecret || adminSecret !== process.env.ADMIN_PAYOUT_SECRET) {
    return { statusCode: 403, body: "Forbidden" };
  }

  try {
    const { recordId } = JSON.parse(event.body);

    if (!recordId) {
      return { statusCode: 400, body: "Missing recordId" };
    }

    // 1️⃣ Fetch record from Airtable
    const recordRes = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE}/${recordId}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } }
    );

    const recordData = await recordRes.json();

    if (!recordData.fields) {
      return { statusCode: 404, body: "Listing not found" };
    }

    const fields = recordData.fields;

    // 2️⃣ Duplicate payout protection
    if (fields.seller_payout_status === "Paid") {
      return {
        statusCode: 400,
        body: "Payout already completed for this listing",
      };
    }

    if (!fields.stripe_account_id || !fields.seller_payout_amount) {
      return {
        statusCode: 400,
        body: "Missing seller Stripe account or payout amount",
      };
    }

    const amountInCents = Math.round(fields.seller_payout_amount * 100);

    // 3️⃣ Send Stripe transfer
    const transfer = await stripe.transfers.create({
      amount: amountInCents,
      currency: "usd",
      destination: fields.stripe_account_id,
      metadata: { airtable_record_id: recordId },
    });

    // 4️⃣ Log payout back to Airtable
    await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE}/${recordId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fields: {
            seller_payout_status: "Paid",
            stripe_transfer_id: transfer.id,
            payout_sent_at: new Date().toISOString(),
            status: "Completed",
          },
        }),
      }
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, transferId: transfer.id }),
    };
  } catch (err) {
    console.error("Payout error:", err);
    return { statusCode: 500, body: err.message };
  }
};
