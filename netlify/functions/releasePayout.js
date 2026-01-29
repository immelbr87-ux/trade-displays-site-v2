const fetch = require("node-fetch");
const Stripe = require("stripe");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE = process.env.AIRTABLE_TABLE;
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const ADMIN_TOKEN = process.env.ADMIN_SECRET_TOKEN;

exports.handler = async (event) => {
  try {
    // 🔒 1️⃣ Admin protection
    const authHeader = event.headers.authorization || "";
    if (!authHeader || authHeader !== `Bearer ${ADMIN_TOKEN}`) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: "Unauthorized" }),
      };
    }

    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: "Method not allowed" }),
      };
    }

    const { recordId } = JSON.parse(event.body);

    if (!recordId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing recordId" }),
      };
    }

    // 📥 2️⃣ Fetch listing from Airtable
    const airtableRes = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE}/${recordId}`,
      {
        headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
      }
    );

    const record = await airtableRes.json();

    if (!record.fields) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "Listing not found" }),
      };
    }

    const {
      seller_payout_status,
      stripe_transfer_id,
      seller_payout_amount,
      stripe_account_id,
      pickup_confirmed,
    } = record.fields;

    // 🚫 3️⃣ Duplicate payout protection
    if (seller_payout_status === "Paid" || stripe_transfer_id) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Payout already completed for this listing" }),
      };
    }

    // ⚠️ 4️⃣ Optional safety — ensure pickup confirmed
    if (!pickup_confirmed) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Pickup not confirmed yet" }),
      };
    }
