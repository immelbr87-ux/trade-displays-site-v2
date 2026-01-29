const fetch = require("node-fetch");

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE = "Listings";

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // 🔐 Same server-side admin protection
  const adminSecret = event.headers["x-admin-secret"];
  if (!adminSecret || adminSecret !== process.env.ADMIN_PAYOUT_SECRET) {
    return { statusCode: 403, body: "Forbidden" };
  }

  try {
    const recordId = (event.queryStringParameters?.recordId || "").trim();
    if (!recordId) return { statusCode: 400, body: "Missing recordId" };

    const res = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE}/${recordId}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } }
    );

    const data = await res.json();

    if (!data?.fields) return { statusCode: 404, body: "Not found" };

    const f = data.fields;

    // Return ONLY what admin page needs
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recordId,
        status: f.status || null,
        pickup_confirmed: !!f.pickup_confirmed,
        seller_payout_status: f.seller_payout_status || null,
        seller_payout_amount: typeof f.seller_payout_amount === "number" ? f.seller_payout_amount : null,
        stripe_account_id: f.stripe_account_id || null,
        stripe_transfer_id: f.stripe_transfer_id || null,
        payout_sent_at: f.payout_sent_at || null,
        seller_email: f.seller_email || null,
        seller_name: f.seller_name || null,
      }),
    };
  } catch (err) {
    console.error("getListingAdmin error:", err);
    return { statusCode: 500, body: "Server error" };
  }
};
