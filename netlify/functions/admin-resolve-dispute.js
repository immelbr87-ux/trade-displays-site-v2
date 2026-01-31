const {
  json,
  requireAdmin,
  airtablePatchRecord,
  airtableGetRecord,
  canTransitionStatus,
} = require("./_lib");

exports.handler = async (event) => {
  const auth = requireAdmin(event);
  if (!auth.ok) return json(auth.status, { error: auth.error });

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method Not Allowed" });
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { recordId } = body;

    if (!recordId) {
      return json(400, { error: "Missing recordId" });
    }

    const baseId = process.env.AIRTABLE_BASE_ID;
    const table = process.env.AIRTABLE_TABLE || "Listings";
    const apiKey = process.env.AIRTABLE_API_KEY;

    console.log("Resolving dispute for listing:", recordId);

    // Get current record
    const record = await airtableGetRecord({
      baseId,
      table,
      recordId,
      apiKey,
    });

    const fields = record.fields || {};

    if (!fields.chargeback_flag) {
      return json(400, { error: "No active dispute on this listing" });
    }

    // Optional safety: Only allow status change if valid
    const nextStatus = "Picked Up";
    if (!canTransitionStatus(fields.status, nextStatus)) {
      console.log("Status transition not allowed, keeping current status");
    }

    await airtablePatchRecord({
      baseId,
      table,
      recordId,
      apiKey,
      fields: {
        chargeback_flag: false,
        dispute_status: "resolved",
        seller_payout_status: "Pending", // Re-enable payout
        dispute_resolved_at: new Date().toISOString(),
      },
    });

    console.log("Dispute resolved:", recordId);

    return json(200, { success: true });
  } catch (err) {
    console.error("admin-resolve-dispute error:", err);
    return json(500, { error: "Failed to resolve dispute" });
  }
};
