const fetch = require("node-fetch");

exports.handler = async (event) => {
  try {
    const { sellerEmail, sellerName, payoutAmount, listingId } = JSON.parse(event.body);

    if (!sellerEmail || !payoutAmount) {
      return { statusCode: 400, body: "Missing required email or amount" };
    }

    const response = await fetch("https://api.mailersend.com/v1/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.MAILERSEND_API_KEY}`
      },
      body: JSON.stringify({
        from: {
          email: process.env.FROM_EMAIL,
          name: "Showroom Market"
        },
        to: [
          {
            email: sellerEmail,
            name: sellerName || "Seller"
          }
        ],
        subject: "💸 Your Showroom Market payout has been sent!",
        html: `
          <div style="font-family: Arial, sans-serif; line-height: 1.6;">
            <h2>Great news, ${sellerName || "Seller"}!</h2>
            <p>Your payout for listing <strong>${listingId}</strong> has been successfully sent.</p>
            <p><strong>Amount Paid:</strong> $${payoutAmount}</p>
            <p>The funds are on their way to your connected Stripe account.</p>
            <br/>
            <p>Thanks for being part of Showroom Market!</p>
          </div>
        `
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("MailerSend error:", errorText);
      return { statusCode: 500, body: "Email send failed" };
    }

    return { statusCode: 200, body: "Seller payout email sent" };

  } catch (err) {
    console.error("sendSellerPayout crash:", err);
    return { statusCode: 500, body: "Server error sending payout email" };
  }
};
