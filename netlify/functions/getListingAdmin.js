const fetch = require("node-fetch");
const crypto = require("crypto");

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE = "Listings";

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

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return { statusCode: 405, body: "Method Not Allowed" };

  const auth = verifyAdminToken(event);
  if (!auth.ok) return { statusCode: 403, body: JSON.stringify({ error: auth.error }) };

  try {
    const recordId = (event.queryStringParameters?.recordId || "").trim();
    if (!recordId) return { statusCode: 400, body: JSON.stringify({ error: "Missing recordId" }) };

    const res = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE}/${recordId}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } }
    );
    const data = await res.json();

    if (!data?.fields) return { statusCode: 404, body: JSON.stringify({ error: "Not found" }) };

    const f = data.fields;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
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
    return { statusCode: 500, body: JSON.stringify({ error: "Server error" }) };
  }
};
