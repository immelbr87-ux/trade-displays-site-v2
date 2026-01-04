exports.handler = async () => {
  // TEMP: returns empty list so your frontend can prove it’s hitting JSON
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items: [] })
  };
};
