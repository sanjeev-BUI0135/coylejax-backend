
const serviceAuth = (req, res, next) => {
  const serviceKey = req.header('x-api-key');

  if (!serviceKey || serviceKey !== "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6ImNveWxlamF4IiwiYWRtaW4iOnRydWUsImlhdCI6MTUxNjIzOTAyMn0.yOCCptYEcEMfAeLXdKSUMyeZ3GbZ5CMV3C8d3qNM_RE") {
    return res.status(403).json({ error: 'Access denied. Invalid service key.' });
  }

  next();
};

module.exports = serviceAuth;
