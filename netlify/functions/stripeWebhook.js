// netlify/functions/stripeWebhook.js
const Stripe = require("stripe");
const fetch = require("node-fetch");
const { addHours } = require("./_lib");

console.log("stripeWebhook loaded");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function env(name, optional = false) {
  const v = process.env[name];
  if (!optional && (!v || String(v).trim() === "")) {
    throw new Error(`Missing env var: ${name}`);
  }
  return v;
}

async function sendEmail(to, subject, text) {
  // Email is best-effort: log if missing config
  if (!process.env.MAILERSEND_API_KEY || !process.env.MAILERSEND_FROM_EMAIL) {
    console.log("Email skipped (missing MailerSend env).", { to, subject });
    return { ok: false, skipped: true };
  }

  console.log("Sending email", { to, subject });

  const res = await fetch("https://api.mailersend.com/v1/email", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.MAILERSEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: {
        email: process.env.MAILERSEND_FROM_EMAIL,
        name: process.env.MAILERSEND_FROM_NAME || "Showroom Market",
      },
      to: [{ email: to }],
      subject,
      text,
    }),
  });

  const body = await res.text();
  if (!res.ok) {
    console.error("Email send failed", { status: res.status, body });
    return { ok: false, status: res.status, body };
  }
  return { ok: true };
}

async function airtableFindListingByPaymentIntent(paymentIntentId) {
  const baseId = env("AIRTABLE_BASE_ID");
  const apiKey = env("AIRTABLE_API_KEY");

  const url =
    `https://api.airtable.com/v0/${baseId}/Listings?` +
    `filterByFormula=${encodeURIComponent(`{stripe_payment_intent}='${paymentIntentId}'`)}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  const data = await res.json();
  const record = data?.records?.[0];
  return record || null;
}

async function airtablePatchListing(recordId, fields) {
  const baseId = env("AIRTABLE_BASE_ID");
  const apiKey = env("AIRTABLE_API_KEY");

  const res = await fetch(`https://api.airtable.com/v0/${baseId}/Listings/${recordId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    console.error("Airtable patch failed", { status: res.status, data });
    throw new Error(`Airtable patch failed (${res.status})`);
  }
  return data;
}

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

exports.handler = async (event) => {
  console.log("Webhook received");

  // Validate required env for webhook verification + Stripe operations
  try {
    env("STRIPE_SECRET_KEY");
    env("STRIPE_WEBHOOK_SECRET");
    env("AIRTABLE_BASE_ID");
    env("AIRTABLE_API_KEY");
  } catch (e) {
    console.error("stripeWebhook env error", e.message);
    return { statusCode: 500, body: "Missing server configuration" };
  }

  const sig =
    event.headers["stripe-signature"] ||
    event.headers["Stripe-Signature"] ||
    event.headers["STRIPE-SIGNATURE"];

  let stripeEvent;
  try {
    // IMPORTANT: Stripe requires the raw body string for signature verification.
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature failed:", err.message);
    return { statusCode: 400, body: "Webhook signature failed" };
  }

  console.log("Stripe event type:", stripeEvent.type);

  // =========================
  // PAYMENT COMPLETED
  // =========================
  if (stripeEvent.type === "checkout.session.completed") {
    const session = stripeEvent.data.object;
    const listingId = session.metadata?.listingId;

    if (!listingId) {
      console.log("checkout.session.completed missing listingId metadata");
      return { statusCode: 200, body: "OK" };
    }

    const now = new Date();
    const holdUntil = addHours(now, 24);
    const pickupCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    console.log("Processing payment", {
      listingId,
      sessionId: session.id,
      paymentIntent: session.payment_intent,
      holdUntil: holdUntil.toISOString(),
    });

    // Update Airtable listing record
    const recordRes = await fetch(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Listings/${listingId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fields: {
            status: "Paid – Pending Pickup",
            paid_at: now.toISOString(),
            payout_eligible_at: holdUntil.toISOString(),
            seller_payout_status: "Pending",
            stripe_session_id: session.id,
            stripe_payment_intent: session.payment_intent,
            pickup_code: pickupCode,
          },
        }),
      }
    );

    const listingData = safeJsonParse(await recordRes.text()) || {};
    const listing = listingData.fields || {};

    // Buyer email
    if (listing.buyer_email) {
      await sendEmail(
        listing.buyer_email,
        "Your Showroom Market Purchase",
        `Thanks for your purchase of "${listing.title}". Your pickup code is ${pickupCode}.`
      );
    }

    // Seller email
    if (listing.showroom_email) {
      await sendEmail(
        listing.showroom_email,
        "Your showroom item has sold 🎉",
        `Your listing "${listing.title}" has sold. Buyer will schedule pickup soon.`
      );
    }

    return { statusCode: 200, body: "OK" };
  }

  // =========================
  // DISPUTE / CHARGEBACK MONITORING
  // =========================
  const disputeTypes = new Set([
    "charge.dispute.created",
    "charge.dispute.updated",
    "charge.dispute.closed",
  ]);

  if (disputeTypes.has(stripeEvent.type)) {
    const dispute = stripeEvent.data.object;

    // Stripe dispute object often has dispute.payment_intent
    const paymentIntentId = dispute.payment_intent;
    const disputeId = dispute.id;
    const disputeStatus = dispute.status; // needs_response, under_review, won, lost
    const amount = dispute.amount;
    const reason = dispute.reason;

    console.log("Dispute event", {
      type: stripeEvent.type,
      disputeId,
      disputeStatus,
      paymentIntentId,
      amount,
      reason,
    });

    if (!paymentIntentId) {
      console.log("Dispute missing payment_intent; nothing to do");
      return { statusCode: 200, body: "OK" };
    }

    const record = await airtableFindListingByPaymentIntent(paymentIntentId);

    if (!record) {
      console.log("No listing found for dispute payment_intent", { paymentIntentId });
      // Still alert admin because this is suspicious
      if (process.env.ALERT_EMAIL) {
        await sendEmail(
          process.env.ALERT_EMAIL,
          "⚠️ Stripe dispute with no matching listing",
          `Dispute ${disputeId} (${disputeStatus}) for payment_intent ${paymentIntentId} had no matching Airtable listing.`
        );
      }
      return { statusCode: 200, body: "OK" };
    }

    const listingId = record.id;
    const listing = record.fields || {};
    const alreadyPaid = String(listing.seller_payout_status || "").toLowerCase() === "paid";

    // Decision:
    // - If dispute is WON -> clear chargeback_flag and (optionally) re-enable payout if it was pending/blocked.
    // - Otherwise -> set chargeback_flag true and block payout immediately.
    const isWon = disputeStatus === "won";
    const block = !isWon;

    const patchFields = {
      dispute_flag: true,
      dispute_id: disputeId,
      dispute_status: disputeStatus,
      dispute_reason: reason || "",
      dispute_amount: amount ? amount / 100 : null, // store dollars if you want
      dispute_last_event: stripeEvent.type,
      dispute_updated_at: new Date().toISOString(),

      // Core freeze logic
      chargeback_flag: block,
      seller_payout_status: block ? "Blocked" : (alreadyPaid ? "Paid" : "Pending"),
    };

    // If payout was already sent, we cannot undo it here—so alert admin loudly.
    if (alreadyPaid && block) {
      patchFields.payout_risk_flag = true;
      patchFields.payout_risk_note = "Dispute occurred after payout was marked Paid.";
    }

    await airtablePatchListing(listingId, patchFields);

    // Alert email (instant visibility)
    if (process.env.ALERT_EMAIL) {
      const statusLine = block
        ? "PAYOUT FROZEN (seller_payout_status=Blocked)"
        : "DISPUTE WON (payout may resume if eligible)";

      await sendEmail(
        process.env.ALERT_EMAIL,
        `⚠️ Stripe dispute: ${disputeStatus} (${stripeEvent.type})`,
        `Listing: ${listing.title || listingId}\n` +
          `Airtable ID: ${listingId}\n` +
          `Dispute: ${disputeId}\n` +
          `Payment Intent: ${paymentIntentId}\n` +
          `Status: ${disputeStatus}\n` +
          `Reason: ${reason || "n/a"}\n` +
          `${statusLine}\n`
      );
    }

    return { statusCode: 200, body: "OK" };
  }

  // =========================
  // REFUND SAFETY (optional but strongly recommended)
  // =========================
  // If a charge is refunded, freeze payout immediately.
  // You can remove this block if you never refund.
  if (stripeEvent.type === "charge.refunded") {
    const charge = stripeEvent.data.object;
    const paymentIntentId = charge.payment_intent;

    console.log("charge.refunded", {
      chargeId: charge.id,
      paymentIntentId,
      refunded: charge.refunded,
      amountRefunded: charge.amount_refunded,
    });

    if (paymentIntentId) {
      const record = await airtableFindListingByPaymentIntent(paymentIntentId);
      if (record) {
        const listingId = record.id;
        await airtablePatchListing(listingId, {
          refund_flag: true,
          refunded_at: new Date().toISOString(),
          chargeback_flag: true, // treat refunds as payout-blocking
          seller_payout_status: "Blocked",
        });

        if (process.env.ALERT_EMAIL) {
          await sendEmail(
            process.env.ALERT_EMAIL,
            "⚠️ Stripe refund detected — payout frozen",
            `Refund detected for listing ${record.fields?.title || listingId}\n` +
              `Airtable ID: ${listingId}\n` +
              `Payment Intent: ${paymentIntentId}\n` +
              `Charge: ${charge.id}\n`
          );
        }
      }
    }

    return { statusCode: 200, body: "OK" };
  }

  // Ignore other event types
  return { statusCode: 200, body: "OK" };
};
