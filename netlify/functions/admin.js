const Stripe = require("stripe");
const crypto = require("crypto");
const fetch = require("node-fetch");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const baseId = process.env.AIRTABLE_BASE_ID;
const apiKey = process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_TOKEN;
const table = process.env.AIRTABLE_TABLE || "Listings";
const logsTable = "Pickup_Logs";

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function requireAdmin(event) {
  const auth = event.headers.authorization || event.headers.Authorization || "";
  if (!auth.startsWith("Bearer ")) return false;
  return auth.slice(7) === process.env.ADMIN_SECRET_TOKEN;
}

async function airtableGet(recordId) {
  const r = await fetch(`https://api.airtable.com/v0/${baseId}/${table}/${recordId}`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  const data = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(data));
  return data;
}

async function airtablePatch(recordId, fields) {
  await fetch(`https://api.airtable.com/v0/${baseId}/${table}/${recordId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ fields })
  });
}

async function logScan(listingId, payload, result, reason, event) {
  try {
    await fetch(`https://api.airtable.com/v0/${baseId}/${logsTable}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        fields: {
          listing_id: listingId || "",
          qr_payload: payload || "",
          scan_result: result,
          reason,
          scanned_at: new Date().toISOString(),
          admin_hash: crypto.createHash("sha256").update(process.env.ADMIN_SECRET_TOKEN).digest("hex"),
          user_agent: event.headers["user-agent"] || ""
        }
      })
    });
  } catch (e) {
    console.error("Log failed", e);
  }
}

function parsePayload(payload) {
  const parts = payload.split("|");
  if (parts.length !== 3) return null;
  return { recordId: parts[1], token: parts[2], decoded: payload };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });
  if (!requireAdmin(event)) return json(401, { error: "Unauthorized" });

  const body = JSON.parse(event.body || "{}");
  const action = body.action;

  try {

    // 🔎 PICKUP SCAN + FRAUD PROTECTION
    if (action === "verify_pickup_and_payout") {
      const parsed = parsePayload(body.payload || "");
      if (!parsed) {
        await logScan("", body.payload, "fail", "Invalid QR format", event);
        return json(400, { error: "Invalid QR payload" });
      }

      const rec = await airtableGet(parsed.recordId);
      const f = rec.fields || {};

      if (f.pickup_qr_used) {
        await logScan(parsed.recordId, body.payload, "duplicate", "QR already used", event);
        return json(409, { error: "QR already used" });
      }

      if (f.pickup_qr_token !== parsed.token && f.pickup_qr_payload !== parsed.decoded) {
        await logScan(parsed.recordId, body.payload, "fail", "Token mismatch", event);
        return json(401, { error: "Token mismatch" });
      }

      if (!String(f.status || "").toLowerCase().includes("paid")) {
        await logScan(parsed.recordId, body.payload, "blocked", "Not paid", event);
        return json(409, { error: "Not paid" });
      }

      // 🔒 Burn QR + confirm pickup
      await airtablePatch(parsed.recordId, {
        pickup_qr_used: true,
        pickup_confirmed: true,
        pickup_confirmed_at: new Date().toISOString(),
        status: "Picked Up"
      });

      await logScan(parsed.recordId, body.payload, "success", "Pickup confirmed", event);

      // 💸 Trigger payout
      const updated = await airtableGet(parsed.recordId);
      const amount = Math.round((updated.fields.seller_payout_amount || 0) * 100);
      const acct = updated.fields.stripe_account_id;

      if (acct && amount > 0 && !updated.fields.stripe_transfer_id) {
        const transfer = await stripe.transfers.create({
          amount,
          currency: "usd",
          destination: acct,
          metadata: { listingId: parsed.recordId }
        });

        await airtablePatch(parsed.recordId, {
          stripe_transfer_id: transfer.id,
          payout_sent_at: new Date().toISOString(),
          seller_payout_status: "Paid"
        });
      }

      return json(200, { ok: true, listingId: parsed.recordId });
    }

    // 📊 PICKUP OPS DASHBOARD DATA
    if (action === "get_ops") {
      const r = await fetch(`https://api.airtable.com/v0/${baseId}/${table}?filterByFormula=OR(FIND("Paid",{status}),FIND("Pickup",{status}))`, {
        headers: { Authorization: `Bearer ${apiKey}` }
      });
      const data = await r.json();
      return json(200, { ok: true, records: data.records || [] });
    }

    return json(400, { error: "Unknown action" });

  } catch (e) {
    console.error(e);
    return json(500, { error: "Server error", detail: e.message });
  }
};
