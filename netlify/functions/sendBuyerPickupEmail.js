export async function handler(event) {
  const { buyerEmail, buyerName, sellerName, pickupStart, pickupEnd, address, qrCodeUrl } = JSON.parse(event.body);

  const response = await fetch("https://api.mailersend.com/v1/email", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.MAILERSEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: {
        email: "payouts@showroommarket.com",
        name: "Showroom Market"
      },
      to: [{ email: buyerEmail, name: buyerName }],
      subject: "Your Pickup Details – Showroom Market",
      html: `
        <h2>Your Order is Ready for Pickup 🎉</h2>
        <p><strong>Seller:</strong> ${sellerName}</p>
        <p><strong>Pickup Window:</strong> ${pickupStart} – ${pickupEnd}</p>
        <p><strong>Pickup Address:</strong><br>${address}</p>
        <p>Please show this QR code when you arrive:</p>
        <img src="${qrCodeUrl}" width="200" />
        <p>Thank you for using Showroom Market!</p>
      `
    })
  });

  return { statusCode: 200, body: "Buyer email sent" };
}
