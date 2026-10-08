const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const smsSettingsController = require("../controllers/smsSettingsController");

router.post("/", auth, smsSettingsController.saveSettings);
router.get("/", auth, smsSettingsController.getSettings);
router.delete("/", auth, smsSettingsController.deleteSettings);

module.exports = router;
