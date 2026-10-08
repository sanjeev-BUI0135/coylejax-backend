const multer = require("multer");
const path = require("path");

// Storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/client");
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `client_${Date.now()}${ext}`);
  }
});

// File filter
const fileFilter = (req, file, cb) => {
  const allowed = ["image/png", "image/jpg", "image/jpeg"];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error("Only images allowed"), false);
};

const uploadClientLogo = multer({ storage, fileFilter });

module.exports = uploadClientLogo;
