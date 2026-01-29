// netlify/functions/getPayoutHistory.js
// ✅ Admin-protected payout history fetch (Airtable -> Admin UI)
// GET /.netlify/functions/getPayoutHistory?status=Paid&limit=50

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
    ""
  ).trim();
}

function pick(fields, names, fallback = "") {
  for (const n of names) {
    const v = fields?.[n];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return fallback;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return json(405, { error: "Method Not Allowed" });

  // 🔒 Admin auth
  const expected = process.env.ADMIN_SECRET_TOKEN;
  const provided = getAuthToken(event);
  if (!expected) return json(500, { error: "Missing ADMIN_SECRET_TOKEN in Netlify env vars" });
  if (!provided || provided !== expected) return json(401, { error: "Unauthorized" });

  const baseId = process.env.AIRTABLE_BASE_ID;
  const apiKey = process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_TOKEN;
  const table = process.env.AIRTABLE_TABLE || "Listings";

  if (!baseId || !apiKey) {
    return json(500, {
      error: "Missing Airtable env vars",
      detail: "Need AIRTABLE_BASE_ID and AIRTABLE_API_KEY (or AIRTABLE_TOKEN)",
    });
  }

  const qs = event.queryStringParameters || {};
  const status = (qs.status || "All").trim(); // Paid | Failed | Pending | All
  const limit = Math.min(Math.max(parseInt(qs.limit || "50", 10) || 50, 1), 200);

  // Build Airtable filter
  // Paid: seller_payout_status = "Paid"
  // Failed: seller_payout_status = "Failed"
  // Pending: seller_payout_status != "Paid" AND pickup_confirmed = true (useful)
  let filterByFormula = "";
  if (status === "Paid") filterByFormula = `{seller_payout_status}="Paid"`;
  if (status === "Failed") filterByFormula = `{seller_payout_status}="Failed"`;
  if (status === "Pending") filterByFormula = `AND({pickup_confirmed}=TRUE(), OR({seller_payout_status}="", {seller_payout_status}="Pending", {seller_payout_status}="Ready"))`;

  const params = new URLSearchParams();
  params.set("pageSize", String(Math.min(limit, 100)));
  params.set("maxRecords", String(limit));

  // Sort newest first
  params.append("sort[0][field]", "payout_sent_at");
  params.append("sort[0][direction]", "desc");

  if (filterByFormula) params.set("filterByFormula", filterByFormula);

  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}?${params.toString()}`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!res.ok) {
      return json(500, { error: "Airtable query failed", detail: data?.error?.message || text });
    }

    const records = (data.records || []).map((r) => {
      const f = r.fields || {};
      return {
        id: r.id,

        sellerName: pick(f, ["sellerName", "seller_name"], ""),
        sellerEmail: pick(f, ["sellerEmail", "seller_email"], ""),
        itemTitle: pick(f, ["title", "product_title", "displayName", "item_name"], ""),

        status: String(f.status || ""),
        pickup_confirmed: !!f.pickup_confirmed,
        pickup_confirmed_at: f.pickup_confirmed_at || null,
        paid_at: f.paid_at || null,

        seller_payout_status: f.seller_payout_status || "",
        seller_payout_amount: f.seller_payout_amount ?? null,
        payout_sent_at: f.payout_sent_at || null,
        payout_error: f.payout_error || "",
        stripe_transfer_id: f.stripe_transfer_id || "",
        stripe_account_id: f.stripe_account_id || "",
      };
    });

    return json(200, { ok: true, status, count: records.length, records });
  } catch (e) {
    return json(500, { error: "Server error", detail: e.message });
  }
};
