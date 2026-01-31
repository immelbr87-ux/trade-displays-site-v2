// netlify/functions/getPayoutHistory.js
// Admin-only: returns payout-related listing records for dashboard.
const { json, requireAdmin, airtableQuery, pick } = require("./_lib");

exports.handler = async (event) => {
  const auth = requireAdmin(event);
  if (!auth.ok) return json(auth.status || 401, { error: auth.error || "Unauthorized" });

  const baseId = process.env.AIRTABLE_BASE_ID;
  const apiKey = process.env.AIRTABLE_API_KEY;

  try {
    const status = (event.queryStringParameters || {}).status || "all"; // all|pending|paid|blocked
    let filter = "TRUE()";
    if (status === "pending") filter = `{seller_payout_status}='Pending'`;
    if (status === "paid") filter = `{seller_payout_status}='Paid'`;
    if (status === "blocked") filter = `{seller_payout_status}='Blocked'`;

    const res = await airtableQuery({
      baseId,
      table: "Listings",
      apiKey,
      params: {
        pageSize: 100,
        filterByFormula: filter,
        sort: JSON.stringify([{ field: "paid_at", direction: "desc" }])
      }
    });

    const rows = (res.records || []).map((r) => {
      const f = r.fields || {};
      return {
        id: r.id,
        title: pick(f, ["title", "product_name", "name"], ""),
        status: f.status || "",
        seller: pick(f, ["seller_name", "showroom_name"], ""),
        pickup_confirmed: !!f.pickup_confirmed,
        paid_at: f.paid_at || null,
        payout_eligible_at: f.payout_eligible_at || null,
        payout_sent_at: f.payout_sent_at || null,
        seller_payout_status: f.seller_payout_status || "",
        sale_price: Number(pick(f, ["sale_price", "price"], 0)) || 0,
        platform_fee: Number(pick(f, ["platform_fee"], 0)) || 0,
        seller_payout_amount: Number(pick(f, ["seller_payout_amount"], 0)) || 0,
        stripe_transfer_id: f.stripe_transfer_id || null,
        chargeback_flag: !!f.chargeback_flag,
        dispute_id: f.dispute_id || null
      };
    });

    return json(200, { rows });
  } catch (err) {
    console.error("getPayoutHistory error:", err?.message || err);
    return json(500, { error: "Failed to load payout history" });
  }
};
