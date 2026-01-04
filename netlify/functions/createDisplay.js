exports.handler = async (event) => {
  let payload = null;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return {
      statusCode: 400,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "Invalid JSON body" })
    };
  }

  // TEMP: echoes back what you sent
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ created: true, data: payload })
  };
};
