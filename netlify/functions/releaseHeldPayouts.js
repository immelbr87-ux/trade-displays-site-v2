const Stripe = require("stripe");
const fetch = require("node-fetch");
const {
  json,
  airtableQuery,
  airtablePatchRecord,
  isPayoutAllowed,
  canTransitionStatus,
} = require("./_lib");

console.log("releaseHeldPayouts loaded");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function findExistingTransfer(listingId) {
  const transfers = await stripe.transfers.list({
    limit: 100,
    transfer_group: `listing_${listingId}`,
  });

  return transfers.data.find(t => t.metadata?.listingId === listingId) || null;
}

exports.handler = async () => {
  console.log("releaseHeldPayouts job start");

  const records = await airtableQuery({
    baseId: process.env.AIRTABLE_BASE_ID,
    table: "Listings",
    apiKey: process.env.AIRTABLE_API_KEY,
    params: {
      filterByFormula: `AND({pickup_confirmed}=TRUE(), {seller_payout_status}='Pending')`,
    },
  });

  for (const rec of records.records || []) {
    const f = rec.fields || {};
    const listingId = rec.id;

    const payoutAmount = Number(f.seller_payout_amount);
    const destination = String(f.stripe_account_id || "").trim();

    if (!payoutAmount || !destination) continue;
    if (!isPayoutAllowed(f).ok) continue;
    if (!canTransitionStatus(f.status, "Payout Sent")) continue;

    const amountCents = Math.round(payoutAmount * 100);
    const idempotencyKey = `payout_${listingId}_${destination}_${amountCents}`;

    try {
      const existing = await findExistingTransfer(listingId);
      if (existing) {
        console.log("Recovered transfer", listingId);
        await airtablePatchRecord({
          baseId: process.env.AIRTABLE_BASE_ID,
          table: "Listings",
          recordId: listingId,
          apiKey: process.env.AIRTABLE_API_KEY,
          fields: {
            status: "Payout Sent",
            seller_payout_status: "Paid",
            stripe_transfer_id: existing.id,
            payout_sent_at: new Date().toISOString(),
          },
        });
        continue;
      }

      const transfer = await stripe.transfers.create(
        {
          amount: amountCents,
          currency: "usd",
          destination,
          description: `Showroom Market payout for ${listingId}`,
          transfer_group: `listing_${listingId}`,
          metadata: { listingId },
        },
        { idempotencyKey }
      );

      await airtablePatchRecord({
        baseId: process.env.AIRTABLE_BASE_ID,
        table: "Listings",
        recordId: listingId,
        apiKey: process.env.AIRTABLE_API_KEY,
        fields: {
          status: "Payout Sent",
          seller_payout_status: "Paid",
          stripe_transfer_id: transfer.id,
          payout_sent_at: new Date().toISOString(),
        },
      });

    } catch (err) {
      console.error("Held payout error", listingId, err.message);
    }
  }

  return json(200, { ok: true });
};
