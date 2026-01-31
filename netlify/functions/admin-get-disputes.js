const {
  json,
  requireAdmin,
  airtableQuery,
  pick,
} = require("./_lib");

/**
 * Normalize Airtable boolean variations
 */
function normalizeBool(val) {
  return val === true || val === "true" || val === 1 || val === "1";
}

exports.handler = async (event) => {
  // 🔐 Admin protection
  const auth = requireAdmin(event);
  if (!auth.ok) return json(auth.status, { error: auth.error });

  try {
    const baseId = process.env.AIRTABLE_BASE_ID;
    const table = process.env.AIRTABLE_TABLE || "Listings";
    const apiKey = process.env.AIRTABLE_API_KEY;

    if (!baseId || !apiKey) {
      return json(500, { error: "Missing Airtable configuration" });
    }

    console.log("Loading dispute dashboard data…");

    // Only listings with chargebacks
    const data = await airtableQuery({
      baseId,
      table,
      apiKey,
      params: {
        filterByFormula: "{chargeback_flag}=TRUE()",
        pageSize: 100,
      },
    });

    const disputes = (data.records || []).map((r) => {
      const f = r.fields || {};

      return {
        id: r.id,
        listing_id: pick(f, ["listing_id", "Listing ID", "SKU", "Model"], r.id),
        product_name: pick(f, ["product_name", "Product Name", "Title"], "Unknown Product"),
        buyer_email: pick(f, ["buyer_email", "Buyer Email"], "Unknown"),
        seller_email: pick(f, ["seller_email", "Seller Email"], "Unknown"),
        amount: Number(pick(f, ["sale_price", "Sale Price", "Amount"], 0)),
        stripe_session_id: pick(f, ["stripe_session_id"], ""),
        dispute_status: pick(f, ["dispute_status"], "open"),
        payout_status: pick(f, ["seller_payout_status"], "Pending"),
        pickup_confirmed: normalizeBool(f.pickup_confirmed),
        chargeback_flag: normalizeBool(f.chargeback_flag),
        created_at: pick(f, ["paid_at", "Created"], ""),
      };
    });

    console.log(`Loaded ${disputes.length} dispute records`);

    return json(200, { disputes });
  } catch (err) {
    console.error("admin-get-disputes error:", err);
    return json(500, { error: "Failed to load disputes" });
  }
};
