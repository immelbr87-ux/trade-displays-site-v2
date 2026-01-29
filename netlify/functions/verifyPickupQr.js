// netlify/functions/verifyPickupQr.js
// Verifies a pickup QR scan and marks the Airtable listing as pickup_confirmed.
// SECURITY: Requires an admin token (server-side) via Authorization Bearer or x-admin-token.

const fetch = require("node-fetch");

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function getAuthToken(event) {
  const auth = event.headers.authorization || event.headers.Authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice("Bearer ".length).trim();
  return (
    event.headers["x-admin-token"] ||
    event.headers["X-Admin-Token"] ||
    event.headers["x-admin-secret"] ||
    event.headers["X-Admin-Secret"] ||
    ""
  ).trim();
}

async function airtableGetRecord({ baseId, table, recordId, apiKey }) {
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
    table
  )}/${recordId}`;

  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || data?.error || res.statusText;
    throw new Error(`Airtable GET failed (${res.status}): ${msg}`);
  }
  return data;
}

async function airtablePatchRecord({ baseId, table, recordId, apiKey, fields }) {
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
    table
  )}/${recordId}`;

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || data?.error || res.statusText;
    throw new Error(`Airtable PATCH failed (${res.status}): ${msg}`);
  }
  return data;
}

function parsePayload(payload) {
  // Expected format: "SMK|<airtableRecordId>|<token>"
  if (!payload || typeof payload !== "string") return null;
  const trimmed = payload.trim();

  // Allow URL-encoded payloads just in case
  const decoded = (() => {
    try {
      return decodeURIComponent(trimmed);
    } catch {
      return trimmed;
    }
  })();

  const parts = decoded.split("|");
  if (parts.length !== 3) return null;

  const [prefix, recordId, token] = parts;
  if (prefix !== "SMK") return null;

  // Airtable record IDs usually look like "recxxxxxxxxxxxxxx"
  if (!recordId || !recordId.startsWith("rec")) return null;
  if (!token || token.length < 8) return null;

  return { recordId, token, decoded };
}

exports.handler = async (event) => {
  // ✅ HTTP method validation
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, X-Admin-Token, X-Admin-Secret",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method Not Allowed. Use POST." });
  }

  // ✅ Server-side admin protection
  const adminSecret = process.env.ADMIN_SECRET_TOKEN;
  const token = getAuthToken(event);

  if (!adminSecret) {
    return json(500, {
      error: "Missing ADMIN_SECRET_TOKEN in Netlify env vars.",
    });
  }

  if (!token || token !== adminSecret) {
    return json(401, { error: "Unauthorized (bad or missing admin token)." });
  }

  // ✅ Airtable env vars
  const baseId = process.env.AIRTABLE_BASE_ID;
  const table = process.env.AIRTABLE_TABLE || "Listings";
  const apiKey = process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_TOKEN;

  if (!baseId || !apiKey) {
    return json(500, {
      error: "Missing Airtable env vars.",
      detail: "Set AIRTABLE_BASE_ID and AIRTABLE_API_KEY (or AIRTABLE_TOKEN).",
    });
  }

  // ✅ Parse body
  let body = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  const payload = body.payload;
  const parsed = parsePayload(payload);

  if (!parsed) {
    return json(400, {
      error: "Invalid QR payload format.",
      expected: "SMK|<airtableRecordId>|<token>",
      got: payload,
    });
  }

  const { recordId, token: scannedToken, decoded } = parsed;

  // ✅ Load listing
  let record;
  try {
    record = await airtableGetRecord({ baseId, table, recordId, apiKey });
  } catch (err) {
    console.error("❌ Airtable GET error:", err);
    return json(500, { error: "Failed to load listing from Airtable." });
  }

  const fields = record.fields || {};

  // ✅ Duplicate protection
  if (fields.pickup_confirmed === true) {
    return json(409, {
      error: "Already picked up.",
      recordId,
      pickup_confirmed_at: fields.pickup_confirmed_at || null,
    });
  }

  // ✅ Require a paid state before pickup can be confirmed
  const status = String(fields.status || "");
  const isPaid =
    status.toLowerCase().includes("paid") ||
    status.toLowerCase().includes("pending pickup");

  if (!isPaid) {
    return json(409, {
      error:
        "Pickup cannot be confirmed because listing is not in a paid state.",
      recordId,
      status,
    });
  }

  // ✅ Validate token against Airtable
  // Preferred: compare to pickup_qr_token; fallback: compare to pickup_qr_payload.
  const expectedToken = fields.pickup_qr_token;
  const expectedPayload = fields.pickup_qr_payload;

  const tokenOk =
    (expectedToken && String(expectedToken).trim() === scannedToken) ||
    (expectedPayload && String(expectedPayload).trim() === decoded);

  if (!tokenOk) {
    return json(401, {
      error: "QR token mismatch (invalid QR for this listing).",
      recordId,
    });
  }

  // ✅ Mark picked up
  const nowIso = new Date().toISOString();

  // Choose the status wording you want to standardize on:
  const newStatus = "Pickup Confirmed"; // or: "Picked Up – Pending Payout"

  const patchFields = {
    pickup_confirmed: true,
    pickup_confirmed_at: nowIso,
    status: newStatus,
  };

  // Optional: if you’re using payout workflow fields already
  // Only set these if they exist in your base, otherwise Airtable will ignore unknown fields.
  if (fields.seller_payout_status) {
    patchFields.seller_payout_status = "Ready"; // or "Pending"
  }

  let patched;
  try {
    patched = await airtablePatchRecord({
      baseId,
      table,
      recordId,
      apiKey,
      fields: patchFields,
    });
  } catch (err) {
    console.error("❌ Airtable PATCH error:", err);
    return json(500, { error: "Failed to update listing in Airtable." });
  }

  return json(200, {
    ok: true,
    message: "Pickup confirmed.",
    recordId,
    status_before: status || null,
    status_after: patchFields.status,
    pickup_confirmed_at: nowIso,
  });
};
