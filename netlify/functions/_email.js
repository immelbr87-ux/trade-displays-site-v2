// netlify/functions/_email.js
const fetch = require("node-fetch");

async function sendEmail(to, subject, text) {
  if (!to) return;
  await fetch("https://api.mailersend.com/v1/email", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.MAILERSEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: { email: process.env.FROM_EMAIL, name: "Showroom Market" },
      to: [{ email: to }],
      subject,
      text,
    }),
  });
}

module.exports = { sendEmail };
