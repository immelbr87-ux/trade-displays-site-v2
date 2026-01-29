const Stripe = require("stripe");
const fetch = require("node-fetch");
const crypto = require("crypto");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  const auth = verifyAdminToken(event);
  if (!auth.ok) return { statusCode: 403, body: JSON.stringify({ error: auth.error }) };

  try {
    const { recordId } = JSON.parse(event.body || "{}");
    if (!recordId) return { statusCode: 400, body: JSON.stringify({ error: "Missing recordId" }) };

    // Fetch listing
    const recordRes = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE}/${recordId}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } }
    );
    const record = await recordRes.json();
    if (!record?.fields) return { statusCode: 404, body: JSON.stringify({ error: "Listing not found" }) };

    const f = record.fields;

    // Eligibility checks
    if (!f.pickup_confirmed) return { statusCode: 400, body: JSON.stringify({ error: "Pickup not confirmed yet" }) };
    if (f.seller_payout_status === "Paid") return { statusCode: 400, body: JSON.stringify({ error: "Payout already Paid" }) };
    if (!f.stripe_account_id) return { statusCode: 400, body: JSON.stringify({ error: "Missing stripe_account_id" }) };
    if (typeof f.seller_payout_amount !== "number" || f.seller_payout_amount <= 0) {
      return { statusCode: 400, body: JSON.stringify({ error: "Invalid seller_payout_amount" }) };
    }

    const amountCents = Math.round(f.seller_payout_amount * 100);

    // Create transfer
    const transfer = await stripe.transfers.create({
      amount: amountCents,
      currency: "usd",
      destination: f.stripe_account_id,
      metadata: { airtable_record_id: recordId },
    });

    // Log back to Airtable
    await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE}/${recordId}`, {
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
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({ success: true, transferId: transfer.id }),
    };
  } catch (err) {
    console.error("sendSellerPayout error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Server error" }) };
  }
};
