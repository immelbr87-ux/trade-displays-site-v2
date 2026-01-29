// netlify/functions/createConnectAccount.js

const Stripe = require("stripe");
const fetch = require("node-fetch");
const crypto = require("crypto");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE = process.env.AIRTABLE_TABLE || "Listings";

function verifyAdminToken(event) {
  const auth = event.headers.authorization || event.headers.Authorization || "";
  const parts = auth.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return { ok: false, error: "Missing Bearer token" };

  const token = parts[1];
  const [payloadB64, signature] = token.split(".");
  if (!payloadB64 || !signature) return { ok: false, error: "Malformed token" };

  const secret = process.env.ADMIN_TOKEN_SIGNING_SECRET;
  if (!secret) return { ok: false, error: "Server missing signing secret" };

  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(payloadB64)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  if (signature !== expectedSig) return { ok: false, error: "Invalid signature" };

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return { ok: false, error: "Invalid payload" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || now >= payload.exp) return { ok: false, error: "Token expired" };

  return { ok: true };
}

function json(statusCode, bodyObj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(bodyObj),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });

  // 🔐 Token protection
  const auth = verifyAdminToken(event);
  if (!auth.ok) return json(403, { error: auth.error });

  try {
    const { sellerEmail, sellerName, recordId } = JSON.parse(event.body || "{}");

    if (!sellerEmail || !recordId) {
      return json(400, { error: "Missing sellerEmail or recordId" });
    }

    if (!process.env.STRIPE_SECRET_KEY) return json(500, { error: "Missing STRIPE_SECRET_KEY" });
    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) return json(500, { error: "Missing Airtable env vars" });

    // 1) Create Stripe Connect Express account
    const account = await stripe.accounts.create({
      type: "express",
      country: "US",
      email: sellerEmail,
      business_profile: { name: sellerName || "Showroom Seller" },
      capabilities: { transfers: { requested: true } },
    });

    const stripeAccountId = account.id;

    // 2) Save to Airtable
    const patchRes = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}/${recordId}`,
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
            seller_email: sellerEmail,
            ...(sellerName ? { seller_name: sellerName } : {}),
          },
        }),
      }
    );

    const patchData = await patchRes.json().catch(() => ({}));
    if (!patchRes.ok) {
      console.error("Airtable PATCH error:", patchData);
      return json(500, { error: "Failed to update Airtable with stripe_account_id" });
    }

    return json(200, { stripe_account_id: stripeAccountId });
  } catch (err) {
    console.error("createConnectAccount error:", err);
    return json(500, { error: "Server error" });
  }
};
