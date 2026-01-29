const crypto = require("crypto");

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function sign(payloadB64, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(payloadB64)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { passcode } = JSON.parse(event.body || "{}");

    if (!passcode) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing passcode" }) };
    }

    if (!process.env.ADMIN_LOGIN_PASSCODE || !process.env.ADMIN_TOKEN_SIGNING_SECRET) {
      return { statusCode: 500, body: JSON.stringify({ error: "Missing admin env vars" }) };
    }

    if (passcode !== process.env.ADMIN_LOGIN_PASSCODE) {
      return { statusCode: 401, body: JSON.stringify({ error: "Invalid passcode" }) };
    }

    const now = Math.floor(Date.now() / 1000);
    const exp = now + 60 * 30; // 30 minutes

    const payload = { iat: now, exp };
    const payloadB64 = base64url(JSON.stringify(payload));
    const signature = sign(payloadB64, process.env.ADMIN_TOKEN_SIGNING_SECRET);

    const token = `${payloadB64}.${signature}`;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({ token, exp }),
    };
  } catch (err) {
    console.error("issueAdminToken error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Server error" }) };
  }
};
