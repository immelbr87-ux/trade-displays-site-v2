// netlify/functions/createOnboardingLink.js

const Stripe = require("stripe");
const crypto = require("crypto");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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
    const { stripe_account_id } = JSON.parse(event.body || "{}");
    if (!stripe_account_id) return json(400, { error: "Missing stripe_account_id" });

    // Must exist on your site (in /site)
    const refresh_url = "https://showroommarket.com/onboarding-refresh.html";
    const return_url  = "https://showroommarket.com/onboarding-return.html";

    const link = await stripe.accountLinks.create({
      account: stripe_account_id,
      refresh_url,
      return_url,
      type: "account_onboarding",
    });

    return json(200, { url: link.url });
  } catch (err) {
    console.error("createOnboardingLink error:", err);
    return json(500, { error: "Server error" });
  }
};
