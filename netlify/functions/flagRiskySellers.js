const { json, airtableQuery, airtablePatchRecord } = require("./_lib");

exports.handler = async () => {
  try {
    const baseId = process.env.AIRTABLE_BASE_ID;
    const table = process.env.AIRTABLE_TABLE || "Listings";
    const apiKey = process.env.AIRTABLE_API_KEY;

    const records = await airtableQuery({
      baseId,
      table,
      apiKey,
      params: {
        filterByFormula: "{chargeback_flag}=TRUE()",
      },
    });

    const sellerCounts = {};

    for (const r of records.records || []) {
      const seller = r.fields.seller_email || r.fields.showroom_email || "unknown";
      sellerCounts[seller] = (sellerCounts[seller] || 0) + 1;
    }

    for (const r of records.records || []) {
      const seller = r.fields.seller_email || r.fields.showroom_email || "unknown";
      if (sellerCounts[seller] >= 2) {
        await airtablePatchRecord({
          baseId,
          table,
          recordId: r.id,
          apiKey,
          fields: { seller_risk_flag: true }
        });
        console.log("Flagged risky seller:", seller);
      }
    }

    return json(200, { message: "Seller risk scan complete" });
  } catch (err) {
    console.error("flagRiskySellers error:", err);
    return json(500, { error: "Risk scan failed" });
  }
};
