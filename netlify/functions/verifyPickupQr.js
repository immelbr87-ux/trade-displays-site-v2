const {
  json,
  requireAdmin,
  airtableGetRecord,
  airtablePatchRecord,
  pick
} = require("./_lib");

const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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

    // 💰 Calculate payout
    const payoutAmount = Math.round(f.seller_payout_amount || 0);
    const stripeAccountId = f.stripe_account_id;

    if (!stripeAccountId) {
      return json(400, { error: "Seller not onboarded" });
    }

    // 💳 Transfer funds to seller
    const transfer = await stripe.transfers.create({
      amount: payoutAmount * 100, // dollars → cents
      currency: "usd",
      destination: stripeAccountId,
      description: `Showroom Market payout for listing ${listingId}`,
      metadata: { listingId }
    });

    console.log("💸 Seller paid:", transfer.id);

    // 🗂 Update Airtable
    await airtablePatchRecord({
      baseId: process.env.AIRTABLE_BASE_ID,
      table: "Listings",
      recordId: listingId,
      apiKey: process.env.AIRTABLE_API_KEY,
      fields: {
        pickup_confirmed: true,
        pickup_confirmed_at: new Date().toISOString(),
        status: "Picked Up",
        seller_payout_status: "Paid",
        stripe_transfer_id: transfer.id,
        payout_sent_at: new Date().toISOString()
      }
    });

    return json(200, {
      success: true,
      message: "Pickup confirmed and seller paid"
    });

  } catch (err) {
    console.error("❌ Pickup + payout error:", err);
    return json(500, { error: "Pickup verification failed" });
  }
};
