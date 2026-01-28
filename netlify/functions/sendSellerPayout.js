const Stripe = require("stripe");
const fetch = require("node-fetch");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE = "Listings"; // change later if you move to a Showrooms table

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });

  try {
    const { recordId } = JSON.parse(event.body || "{}");
    if (!recordId) return json(400, { error: "Missing recordId" });

    // 1) Fetch listing from Airtable
    const recordRes = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE}/${recordId}`,
      {
        headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
      }
    );

    const record = await recordRes.json();
    if (!record?.fields) return json(404, { error: "Listing not found" });

    const f = record.fields;

    // 2) Safety checks
    if (!f.pickup_confirmed) {
      return json(400, { error: "Pickup not confirmed yet" });
    }

    if (f.seller_payout_status === "Paid") {
      return json(400, { error: "Payout already marked Paid" });
    }

    if (!f.stripe_account_id) {
      return json(400, { error: "Missing stripe_account_id for seller" });
    }

    if (typeof f.seller_payout_amount !== "number") {
      return json(400, { error: "Missing or invalid seller_payout_amount" });
    }

    // Stripe transfer amounts must be integer cents
    const amountCents = Math.round(f.seller_payout_amount * 100);

    if (amountCents < 1) {
      return json(400, { error: "Payout amount too small" });
    }

    // 3) Create Stripe Transfer to the seller’s connected account
    const transfer = await stripe.transfers.create({
      amount: amountCents,
      currency: "usd",
      destination: f.stripe_account_id,
      metadata: {
        airtable_record_id: recordId,
      },
    });

    // 4) Update Airtable
    await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE}/${recordId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fields: {
          seller_payout_status: "Paid",
          payout_sent_at: new Date().toISOString(),
          stripe_transfer_id: transfer.id,
          status: "Completed",
        },
      }),
    });

    return json(200, { success: true, transfer_id: transfer.id });
  } catch (err) {
    console.error("sendSellerPayout error:", err);
    return json(500, { error: "Server error" });
  }
};
