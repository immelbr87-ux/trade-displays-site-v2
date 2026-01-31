const fetch = require("node-fetch");

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.MAILERSEND_API_KEY;
  const fromEmail = "marketplace@showroommarket.com";
  const fromName = "Showroom Market";

  if (!apiKey) {
    console.log("MAILERSEND_API_KEY missing — email skipped");
    return;
  }

  try {
    const res = await fetch("https://api.mailersend.com/v1/email", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: { email: fromEmail, name: fromName },
        to: [{ email: to }],
        subject,
        html,
      }),
    });

    const text = await res.text();
    if (!res.ok) throw new Error(text);

    console.log("Email sent to", to);
  } catch (err) {
    console.error("Email failed:", err.message);
  }
}

module.exports = { sendEmail };
