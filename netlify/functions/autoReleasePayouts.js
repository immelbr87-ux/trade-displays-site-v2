// netlify/functions/autoReleasePayouts.js
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

exports.handler = async () => {
  const startedAt = new Date().toISOString();
  console.log("autoReleasePayouts job start", { startedAt });

  let baseId, apiKey;
  try {
    baseId = requireEnv("AIRTABLE_BASE_ID");
    apiKey = requireEnv("AIRTABLE_API_KEY");
    requireEnv("STRIPE_SECRET_KEY");
  } catch (e) {
    console.error("autoReleasePayouts env error", e.message);
    return json(500, { error: e.message });
  }

  try {
    // Only process clearly pending payouts
    const records = await airtableQuery({
      baseId,
      table: "Listings",
      apiKey,
      params: {
        filterByFormula: `AND({pickup_confirmed}=TRUE(), {seller_payout_status}='Pending')`,
      },
    });

    const total = records.records?.length || 0;
    console.log("autoReleasePayouts candidates", { total });

    let processed = 0;
    let skipped = 0;
    let failed = 0;

    for (const rec of records.records || []) {
      const f = rec.fields || {};

      const listingId = rec.id;
      const payoutAmount = Number(f.seller_payout_amount);
      const destination = String(f.stripe_account_id || "").trim();
      const status = String(f.status || "").trim();

      if (!payoutAmount || isNaN(payoutAmount) || payoutAmount <= 0 || !destination) {
        skipped++;
        console.log("Skipping (missing payout data)", {
          listingId,
          payoutAmount,
          hasDestination: !!destination,
        });
        continue;
      }

      // Marketplace safety rules
      const allowed = isPayoutAllowed(f);
      if (!allowed.ok) {
        skipped++;
        console.log("Skipping (not allowed)", { listingId, reason: allowed.reason });
        continue;
      }

      // Ensure status transition is valid
      if (!canTransitionStatus(status, "Payout Sent")) {
        skipped++;
        console.log("Skipping (bad status transition)", { listingId, status });
        continue;
      }

      const amountCents = Math.round(payoutAmount * 100);

      // Idempotency key prevents duplicate transfers if job retries or Airtable patch fails
      // Include destination + amount to avoid “wrong destination” risk if acct changes.
      const idempotencyKey = `payout_${listingId}_${destination}_${amountCents}`;

      try {
        console.log("Creating transfer", {
          listingId,
          amountCents,
          destination,
          idempotencyKey,
        });

        const transfer = await stripe.transfers.create(
          {
            amount: amountCents,
            currency: "usd",
            destination,
            description: `Showroom Market payout for ${listingId}`,
            transfer_group: `listing_${listingId}`,
            metadata: {
              listingId,
              airtableRecordId: listingId,
              payoutAmount: String(payoutAmount),
            },
          },
          { idempotencyKey }
        );

        await airtablePatchRecord({
          baseId,
          table: "Listings",
          recordId: listingId,
          apiKey,
          fields: {
            status: "Payout Sent",
            seller_payout_status: "Paid",
            stripe_transfer_id: transfer.id,
            payout_sent_at: new Date().toISOString(),
          },
        });

        processed++;
        console.log("Payout complete", { listingId, transferId: transfer.id });
      } catch (err) {
        failed++;
        console.error("Payout failed", {
          listingId,
          message: err?.message,
          type: err?.type,
          code: err?.code,
        });
      }
    }

    const finishedAt = new Date().toISOString();
    console.log("autoReleasePayouts job end", { finishedAt, processed, skipped, failed });

    return json(200, {
      ok: true,
      processed,
      skipped,
      failed,
      totalCandidates: total,
      startedAt,
      finishedAt,
    });
  } catch (err) {
    console.error("autoReleasePayouts fatal error", err?.message || err);
    return json(500, { error: "Payout job failed", detail: err?.message || String(err) });
  }
};
