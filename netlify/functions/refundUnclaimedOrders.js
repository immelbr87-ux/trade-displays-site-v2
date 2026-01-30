// netlify/functions/sendBuyerPickupEmail.js
const fetch = require("node-fetch");
const { json, requireAdmin } = require("./_lib");

console.log("sendBuyerPickupEmail loaded");

exports.handler = async (event) => {
  console.log("sendBuyerPickupEmail invoked", { method: event.httpMethod });

  // Protect this endpoint so it can't be abused to spam emails
  const auth = requireAdmin(event);
  if (!auth.ok) return json(auth.status, { error: auth.error });

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const {
      buyerEmail,
      buyerName,
      sellerName,
      pickupStart,
      pickupEnd,
      address,
      qrCodeUrl,
    } = JSON.parse(event.body || "{}");

    console.log("Payload received", { buyerEmail, hasQr: !!qrCodeUrl });

    if (!buyerEmail || !address || !qrCodeUrl) {
      return json(400, { error: "Missing required fields (buyerEmail, address, qrCodeUrl)" });
    }

    const fromEmail = process.env.MAILERSEND_FROM_EMAIL || "payouts@showroommarket.com";
    const fromName = process.env.MAILERSEND_FROM_NAME || "Showroom Market";

    const response = await fetch("https://api.mailersend.com/v1/email", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.MAILERSEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: { email: fromEmail, name: fromName },
        to: [{ email: buyerEmail, name: buyerName || "" }],
        subject: "Your Pickup Details – Showroom Market",
        html: `
          <h2>Your Order is Ready for Pickup 🎉</h2>
          ${sellerName ? `<p><strong>Seller:</strong> ${sellerName}</p>` : ""}
          ${pickupStart || pickupEnd ? `<p><strong>Pickup Window:</strong> ${pickupStart || ""} – ${pickupEnd || ""}</p>` : ""}
          <p><strong>Pickup Address:</strong><br>${address}</p>
          <p>Please show this QR code when you arrive:</p>
          <img src="${qrCodeUrl}" width="200" />
          <p>Thank you for using Showroom Market!</p>
        `,
      }),
    });

    const text = await response.text();
    console.log("MailerSend response", { status: response.status, body: text.slice(0, 200) });

    if (!response.ok) {
      return json(500, { error: "Failed to send email", detail: text });
    }

    return json(200, { ok: true, message: "Buyer email sent" });
  } catch (err) {
    console.error("sendBuyerPickupEmail error", err);
    return json(500, { error: "Buyer email failed" });
  }
};
