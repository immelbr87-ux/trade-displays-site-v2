// netlify/functions/_lib.js
const fetch = require("node-fetch");

/* ===============================
   📦 Standard JSON Response
   =============================== */
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

/* ===============================
   🔐 Admin Authentication
   =============================== */
function getAuthToken(event) {
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice("Bearer ".length).trim();
  return (h["x-admin-token"] || h["X-Admin-Token"] || "").trim();
}

function requireAdmin(event) {
  const expected = process.env.ADMIN_SECRET_TOKEN;
  const provided = getAuthToken(event);
  if (!expected) return { ok: false, status: 500, error: "Missing ADMIN_SECRET_TOKEN env var" };
  if (!provided || provided !== expected) return { ok: false, status: 401, error: "Unauthorized" };
  return { ok: true };
}

/* ===============================
   📋 Airtable Helpers
   =============================== */
async function airtableGetRecord({ baseId, table, recordId, apiKey }) {
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}/${recordId}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.error?.message || data?.error || text || res.statusText;
    throw new Error(`Airtable GET failed (${res.status}): ${msg}`);
  }
  return data;
}

async function airtablePatchRecord({ baseId, table, recordId, apiKey, fields }) {
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}/${recordId}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.error?.message || data?.error || text || res.statusText;
    throw new Error(`Airtable PATCH failed (${res.status}): ${msg}`);
  }
  return data;
}

async function airtableQuery({ baseId, table, apiKey, params }) {
  const qs = new URLSearchParams(params);
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}?${qs.toString()}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.error?.message || data?.error || text || res.statusText;
    throw new Error(`Airtable QUERY failed (${res.status}): ${msg}`);
  }
  return data;
}

/* ===============================
   🧠 Field Helper
   =============================== */
function pick(fields, names, fallback = "") {
  for (const n of names) {
    const v = fields?.[n];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return fallback;
}

/* ===============================
   🔐 Marketplace Safety Rules
   =============================== */

const ALLOWED_STATUS_TRANSITIONS = {
  "Active": ["Reserved"],
  "Reserved": ["Paid – Pending Pickup"],
  "Paid – Pending Pickup": ["Picked Up"],
  "Picked Up": ["Payout Sent"],
};

function canTransitionStatus(from, to) {
  if (!from || !to) return false;
  if (!ALLOWED_STATUS_TRANSITIONS[from]) return false;
  return ALLOWED_STATUS_TRANSITIONS[from].includes(to);
}

function addHours(date, hours) {
  return new Date(new Date(date).getTime() + hours * 60 * 60 * 1000);
}

function isPayoutAllowed(recordFields) {
  if (!recordFields) return { ok: false, reason: "Missing record" };

  if (recordFields.chargeback_flag)
    return { ok: false, reason: "Chargeback exists" };

  if (!recordFields.pickup_confirmed)
    return { ok: false, reason: "Pickup not confirmed" };

  if (!recordFields.payout_eligible_at)
    return { ok: false, reason: "Missing payout hold date" };

  if (new Date() < new Date(recordFields.payout_eligible_at))
    return { ok: false, reason: "Hold window not complete" };

  return { ok: true };
}

/* ===============================
   📦 Exports
   =============================== */
module.exports = {
  json,
  requireAdmin,
  airtableGetRecord,
  airtablePatchRecord,
  airtableQuery,
  pick,
  canTransitionStatus,
  addHours,
  isPayoutAllowed,
};
