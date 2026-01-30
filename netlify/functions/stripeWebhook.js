const Stripe = require("stripe");
const fetch = require("node-fetch");
const { addHours } = require("./_lib");

console.log("stripeWebhook loaded");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function sendEmail(to, subject, text) {
  console.log("Sending email to:", to, subject);

  return fetch("https://api.mailersend.com/v1/email", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.MAILERSEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: {
        email: process.env.MAILERSEND_FROM_EMAIL,
        name: process.env.MAILERSEND_FROM_NAME,
      },
      to: [{ email: to }],
      subject,
      text,
    }),
  });
}

exports.handler = async (event) => {
  console.log("Webhook received");

  const sig = event.headers["stripe-signature"];
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature failed:", err.message);
    return { statusCode: 400, body: "Webhook signature failed" };
  }

  console.log("Stripe event:", stripeEvent.type);

  // ================= PAYMENT COMPLETED =================
  if (stripeEvent.type === "checkout.session.completed") {
    const session = stripeEvent.data.object;
    const listingId = session.metadata?.listingId;
    if (!listingId) return { statusCode: 200 };

    const now = new Date();
    const holdUntil = addHours(now, 24);
    const pickupCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    console.log("Processing payment for listing:", listingId);

    // Update Airtable listing
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
            pickup_code: pickupCode
          },
        }),
      }
    );

    const listingData = await recordRes.json();
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
  }

  // ================= DISPUTE HANDLING =================
  if (stripeEvent.type === "charge.dispute.created") {
    const dispute = stripeEvent.data.object;
    console.log("Dispute detected:", dispute.payment_intent);

    const search = await fetch(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Listings?filterByFormula={stripe_payment_intent}='${dispute.payment_intent}'`,
      { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } }
    );

    const records = (await search.json()).records;
    if (records.length === 0) return { statusCode: 200 };

    await fetch(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Listings/${records[0].id}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fields: {
            chargeback_flag: true,
            seller_payout_status: "Blocked",
          },
        }),
      }
    );
  }

  return { statusCode: 200, body: "OK" };
};
