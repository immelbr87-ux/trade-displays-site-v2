// netlify/functions/getPayoutHistory.js
const { json, requireAdmin, airtableQuery } = require("./_lib");

console.log("getPayoutHistory loaded");

exports.handler = async (event) => {
  const auth = requireAdmin(event);
  if (!auth.ok) return json(auth.status || 401, { error: auth.error || "Unauthorized" });

  if (event.httpMethod !== "GET") return json(405, { error: "Method Not Allowed" });

  const baseId = process.env.AIRTABLE_BASE_ID;
  const apiKey = process.env.AIRTABLE_API_KEY;
  const table = process.env.AIRTABLE_TABLE || "Listings";

  try {
    // Pull recent payout-related records. Airtable sorts require a field name.
    // We filter for anything with a payout status set, or paid_at set.
    const data = await airtableQuery({
      baseId,
      table,
      apiKey,
      params: {
        pageSize: "100",
        filterByFormula: "OR({seller_payout_status}!='', {paid_at}!='')",
        // Sort newest first if field exists; harmless if field doesn't exist? (Airtable ignores unknown sort? It errors.)
        // To be safe, omit sort. Client can sort.
      },
    });

    return json(200, data);
  } catch (err) {
    console.error("getPayoutHistory error:", err);
    return json(500, { error: "Failed to load payout history", detail: err.message });
  }
};
