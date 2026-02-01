const Stripe = require("stripe");
const {
  json,
  airtableQuery,
  airtablePatchRecord,
  isPayoutAllowed,
  canTransitionStatus,
} = require("./_lib");

console.log("autoReleasePayouts loaded");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function requireEnv(name) {
  const v = process.env[name];
  if (!v || String(v).trim() === "") throw new Error(`Missing env var: ${name}`);
  return v;
}

async function findExistingTransfer(listingId) {
  const transfers = await stripe.transfers.list({
    limit: 100,
    transfer_group: `listing_${listingId}`,
  });

  return transfers.data.find(t => t.metadata?.listingId === listingId) || null;
}

exports.handler = async () => {
  const startedAt = new Date().toISOString();
  console.log("autoReleasePayouts job start", { startedAt });

  try {
    requireEnv("STRIPE_SECRET_KEY");
    requireEnv("AIRTABLE_BASE_ID");
    requireEnv("AIRTABLE_API_KEY");
  } catch (e) {
    return json(500, { error: e.message });
  }

  const records = await airtableQuery({
    baseId: process.env.AIRTABLE_BASE_ID,
    table: "Listings",
    apiKey: process.env.AIRTABLE_API_KEY,
    params: {
      filterByFormula: `AND({pickup_confirmed}=TRUE(), {seller_payout_status}='Pending')`,
    },
  });

  let processed = 0, skipped = 0, failed = 0, healed = 0;

  for (const rec of records.records || []) {
    const f = rec.fields || {};
    const listingId = rec.id;

    const payoutAmount = Number(f.seller_payout_amount);
    const destination = String(f.stripe_account_id || "").trim();
    const status = String(f.status || "").trim();

    if (!payoutAmount || payoutAmount <= 0 || !destination) {
      skipped++; continue;
    }

    const allowed = isPayoutAllowed(f);
    if (!allowed.ok) { skipped++; continue; }

    if (!canTransitionStatus(status, "Payout Sent")) {
      skipped++; continue;
    }

    const amountCents = Math.round(payoutAmount * 100);
    const idempotencyKey = `payout_${listingId}_${destination}_${amountCents}`;

    try {
      // 🔎 Step 1 — Check if transfer already exists (recovery path)
      const existing = await findExistingTransfer(listingId);

      if (existing) {
        console.log("Recovered existing transfer", { listingId, transferId: existing.id });

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

        healed++;
        continue;
      }

      // 💸 Step 2 — Create new transfer
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

      processed++;
    } catch (err) {
      failed++;
      console.error("Payout failure", listingId, err.message);
    }
  }

  return json(200, {
    ok: true,
    processed,
    healed,
    skipped,
    failed,
    startedAt,
    finishedAt: new Date().toISOString(),
  });
};
