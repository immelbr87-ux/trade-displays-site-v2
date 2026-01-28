// netlify/functions/releasePayout.js

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE = process.env.AIRTABLE_TABLE;

exports.handler = async (event) => {
  try {
    // 🔒 SECURITY — Only allow POST
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: "Method Not Allowed" }),
      };
    }

    const { recordId } = JSON.parse(event.body);

    if (!recordId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing recordId" }),
      };
    }

    // 📦 Fetch listing from Airtable
    const recordRes = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE}/${recordId}`,
      {
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        },
      }
    );

    const recordData = await recordRes.json();

    if (!recordData.fields) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "Listing not found" }),
      };
    }

    const fields = recordData.fields;

    // 🛑 VALIDATIONS
    if (!fields.pickup_confirmed) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Pickup not confirmed yet" }),
      };
    }

    if (fields.seller_payout_status === "Paid") {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Payout already completed" }),
      };
    }

    // 📝 Update Airtable: Mark payout approved + listing completed
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
            seller_payout_status: "Approved",
            status: "Completed",
            payout_sent_at: new Date().toISOString(),
          },
        }),
      }
    );

    console.log("💸 Seller payout approved for record:", recordId);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    console.error("❌ releasePayout error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server error" }),
    };
  }
};
