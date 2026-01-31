
const {
  json,
  requireAdmin,
  airtablePatchRecord,
  airtableGetRecord,
} = require("./_lib");
const fetch = require("node-fetch");

exports.handler = async (event) => {
  const auth = requireAdmin(event);
  if (!auth.ok) return json(auth.status, { error: auth.error });

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method Not Allowed" });
  }

  try {
    const { recordId } = JSON.parse(event.body || "{}");
    if (!recordId) return json(400, { error: "Missing recordId" });

    const baseId = process.env.AIRTABLE_BASE_ID;
    const table = process.env.AIRTABLE_TABLE || "Listings";
    const apiKey = process.env.AIRTABLE_API_KEY;

    const record = await airtableGetRecord({ baseId, table, recordId, apiKey });
    const f = record.fields || {};

    if (!f.chargeback_flag) {
      return json(400, { error: "No active dispute" });
    }

    await airtablePatchRecord({
      baseId,
      table,
      recordId,
      apiKey,
      fields: {
        chargeback_flag: false,
        dispute_status: "resolved",
        seller_payout_status: "Pending",
        dispute_resolved_at: new Date().toISOString(),
      },
    });

    console.log("Dispute resolved:", recordId);

    if (process.env.MAILERSEND_API_KEY && (f.seller_email || f.showroom_email)) {
      const toEmail = f.seller_email || f.showroom_email;

      await fetch("https://api.mailersend.com/v1/email", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.MAILERSEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: {
            email: process.env.MAILERSEND_FROM_EMAIL || "support@showroommarket.com",
            name: "Showroom Market"
          },
          to: [{ email: toEmail }],
          subject: "Dispute Resolved — Payout Reinstated",
          text: `Good news — the payment dispute for your item "${f.title}" has been resolved. Your payout is now re-enabled and will be processed automatically.`,
        }),
      });

      console.log("Seller notified:", toEmail);
    }

    return json(200, { success: true });
  } catch (err) {
    console.error("admin-resolve-dispute error:", err);
    return json(500, { error: "Failed to resolve dispute" });
  }
};
