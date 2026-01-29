// netlify/functions/verifyPickupQr.js
const {
  json,
  requireAdmin,
  airtableGetRecord,
  airtablePatchRecord
} = require("./_lib");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const auth = requireAdmin(event);
  if (!auth.ok) return json(auth.status, { error: auth.error });

  try {
    const { qr } = JSON.parse(event.body);
    if (!qr) return json(400, { error: "Missing QR payload" });

    const parsed = JSON.parse(Buffer.from(qr, "base64").toString("utf8"));
    const { listingId } = parsed;

    if (!listingId) return json(400, { error: "Invalid QR" });

    const record = await airtableGetRecord({
      baseId: process.env.AIRTABLE_BASE_ID,
      table: "Listings",
      recordId: listingId,
      apiKey: process.env.AIRTABLE_API_KEY,
    });

    const fields = record.fields || {};

    if (fields.status !== "Paid – Pending Pickup") {
      return json(400, { error: "Not ready for pickup" });
    }

    await airtablePatchRecord({
      baseId: process.env.AIRTABLE_BASE_ID,
      table: "Listings",
      recordId: listingId,
      apiKey: process.env.AIRTABLE_API_KEY,
      fields: {
        pickup_confirmed: true,
        status: "Picked Up",
        pickup_confirmed_at: new Date().toISOString(),
      },
    });

    return json(200, { success: true, message: "Pickup confirmed" });

  } catch (err) {
    console.error("❌ QR verify error:", err);
    return json(500, { error: "Verification failed" });
  }
};
