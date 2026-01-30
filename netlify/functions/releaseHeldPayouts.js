// netlify/functions/releaseHeldPayouts.js
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

function requireEnv(name) {
  const v = process.env[name];
  if (!v || String(v).trim() === "") throw new Error(`Missing env var: ${name}`);
  return v;
}

exports.handler = async () => {
  const startedAt = new Date().toISOString();
  console.log("releaseHeldPayouts job start", { startedAt });

  try {
    requireEnv("STRIPE_SECRET_KEY");
    requireEnv("AIRTABLE_BASE_ID");
    requireEnv("AIRTABLE_API_KEY");
  } catch (e) {
    console.error("releaseHeldPayouts env error", e.message);
    return json(500, { error: e.message });
  }

  try {
    const records = await airtableQuery({
      baseId: process.env.AIRTABLE_BASE_ID,
      table: "Listings",
      apiKey: process.env.AIRTABLE_API_KEY,
      params: {
        // Only Pending to avoid accidentally paying blocked/other states
        filterByFormula: `AND({pickup_confirmed}=TRUE(), {seller_payout_status}='Pending')`,
      },
    });

    const total = records.records?.length || 0;
    console.log("releaseHeldPayouts candidates", { total });

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
        console.log("Skipping (missing payout data)", { listingId });
        continue;
      }

      const allowed = isPayoutAllowed(f);
      if (!allowed.ok) {
        skipped++;
        console.log("Skipping (not allowed)", { listingId, reason: allowed.reason });
        continue;
      }

      if (!canTransitionStatus(status, "Payout Sent")) {
        skipped++;
        console.log("Skipping (bad status transition)", { listingId, status });
        continue;
      }

      const amountCents = Math.round(payoutAmount * 100);
      const idempotencyKey = `payout_${listingId}_${destination}_${amountCents}`;

      try {
        console.log("Creating transfer", { listingId, amountCents, destination, idempotencyKey });

        const transfer = await stripe.transfers.create(
          {
            amount: amountCents,
            currency: "usd",
            destination,
            description: `Showroom Market payout for ${listingId}`,
            transfer_group: `listing_${listingId}`,
            metadata: { listingId, airtableRecordId: listingId },
          },
          { idempotencyKey }
        );

        // Optional email notification
        if (process.env.MAILERSEND_API_KEY && (f.seller_email || f.showroom_email)) {
          const toEmail = f.seller_email || f.showroom_email;
          const fromEmail = process.env.MAILERSEND_FROM_EMAIL || "payouts@showroommarket.com";
          const fromName = process.env.MAILERSEND_FROM_NAME || "Showroom Market";

          console.log("Emailing seller payout notice", { listingId, toEmail });

          await fetch("https://api.mailersend.com/v1/email", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.MAILERSEND_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: { email: fromEmail, name: fromName },
              to: [{ email: toEmail }],
              subject: "You’ve been paid 🎉",
              text: `Your item has been picked up and payout of $${payoutAmount} has been sent.`,
            }),
          });
        }

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
        console.log("Payout complete", { listingId, transferId: transfer.id });
      } catch (err) {
        failed++;
        console.error("releaseHeldPayouts payout failed", {
          listingId,
          message: err?.message,
          type: err?.type,
          code: err?.code,
        });
      }
    }

    const finishedAt = new Date().toISOString();
    console.log("releaseHeldPayouts job end", { finishedAt, processed, skipped, failed });

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
    console.error("releaseHeldPayouts fatal error", err?.message || err);
    return json(500, { error: "Payout release failed", detail: err?.message || String(err) });
  }
};
