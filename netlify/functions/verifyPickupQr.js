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

    // 🔓 Decode QR
    const parsed = JSON.parse(Buffer.from(qr, "base64").toString("utf8"));
    const { listingId } = parsed;

    if (!listingId) return json(400, { error: "Invalid QR" });

    // 📦 Fetch listing
    const record = await airtableGetRecord({
      baseId: process.env.AIRTABLE_BASE_ID,
      table: "Listings",
      recordId: listingId,
      apiKey: process.env.AIRTABLE_API_KEY,
    });

    const f = record.fields || {};

    if (f.status !== "Paid – Pending Pickup") {
      return json(400, { error: "Listing not ready for pickup" });
    }

    if (f.seller_payout_status === "Paid") {
      return json(400, { error: "Seller already paid" });
    }

    // 🕒 Start 24-hour fraud protection hold
    const now = new Date();
    const holdUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    await airtablePatchRecord({
      baseId: process.env.AIRTABLE_BASE_ID,
      table: "Listings",
      recordId: listingId,
      apiKey: process.env.AIRTABLE_API_KEY,
      fields: {
        pickup_confirmed: true,
        pickup_confirmed_at: now.toISOString(),
        payout_hold_until: holdUntil.toISOString(),
        seller_payout_status: "Pending",
        status: "Pickup Confirmed – Hold Period"
      }
    });

    return json(200, {
      success: true,
      message: "Pickup confirmed. 24-hour payout hold started."
    });

  } catch (err) {
    console.error("❌ Pickup confirmation error:", err);
    return json(500, { error: "Pickup verification failed" });
  }
};
