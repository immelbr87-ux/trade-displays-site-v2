// netlify/functions/verifyPickupQr.js
const { json, requireAdmin, airtableGetRecord, airtablePatchRecord } = require("./_lib");

console.log("verifyPickupQr loaded");

exports.handler = async (event) => {
  console.log("verifyPickupQr invoked", { method: event.httpMethod });

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const auth = requireAdmin(event);
  if (!auth.ok) return json(auth.status, { error: auth.error });

  try {
    const { qr } = JSON.parse(event.body || "{}");
    if (!qr) return json(400, { error: "Missing QR payload" });

    // Decode QR (base64 JSON with listingId)
    const parsed = JSON.parse(Buffer.from(qr, "base64").toString("utf8"));
    const { listingId } = parsed;

    if (!listingId) return json(400, { error: "Invalid QR" });

    console.log("Decoded listingId:", listingId);

    // Fetch listing
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

    // Start/extend 24-hour fraud protection hold AFTER pickup
    const now = new Date();
    const holdUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // If payout_eligible_at already exists (from payment hold), keep the later one
    const existingEligible = f.payout_eligible_at ? new Date(f.payout_eligible_at) : null;
    const newEligible = existingEligible && existingEligible > holdUntil ? existingEligible : holdUntil;

    console.log("Setting payout_eligible_at:", newEligible.toISOString());

    await airtablePatchRecord({
      baseId: process.env.AIRTABLE_BASE_ID,
      table: "Listings",
      recordId: listingId,
      apiKey: process.env.AIRTABLE_API_KEY,
      fields: {
        pickup_confirmed: true,
        pickup_confirmed_at: now.toISOString(),
        payout_eligible_at: newEligible.toISOString(),
        seller_payout_status: "Pending",
        status: "Picked Up"
      },
    });

    return json(200, {
      success: true,
      message: "Pickup confirmed. Hold enforced via payout_eligible_at."
    });
  } catch (err) {
    console.error("verifyPickupQr error:", err);
    return json(500, { error: "Pickup verification failed" });
  }
};
