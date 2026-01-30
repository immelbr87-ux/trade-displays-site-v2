// Standard API responses

exports.ok = (data = {}) => ({
  statusCode: 200,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

exports.error = (message = "Server error", code = 400) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ error: message }),
});
