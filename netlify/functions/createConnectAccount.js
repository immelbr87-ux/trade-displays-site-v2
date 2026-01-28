const Stripe = require("stripe");
const fetch = require("node-fetch");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE = "Listings"; // change later if you move sellers to a separate table

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { sellerEmail, sellerName, recordId } = JSON.parse(event.body || "{}");

    if (!sellerEmail || !recordId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing sellerEmail or recordId" }),
      };
    }

    // STEP 1 — Create Stripe Connect Express account
    const account = await stripe.accounts.create({
      type: "express",
      country: "US",
      email: sellerEmail,
      business_profile: {
        name: sellerName || "Showroom Seller",
      },
      capabilities: {
        transfers: { requested: true },
      },
    });

    const stripeAccountId = account.id;

    // STEP 2 — Save Stripe Account ID to Airtable
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
            stripe_account_id: stripeAccountId,
            stripe_onboarding_status: "In progress",
          },
        }),
      }
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ stripe_account_id: stripeAccountId }),
    };
  } catch (err) {
    console.error("createConnectAccount error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Server error" }) };
  }
};
