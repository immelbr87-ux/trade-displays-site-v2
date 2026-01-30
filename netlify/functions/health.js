exports.handler = async () => {
  console.log("Health check ping received");

  return {
    statusCode: 200,
    body: "OK",
  };
};
