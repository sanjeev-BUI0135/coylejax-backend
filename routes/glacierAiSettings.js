const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const ctrl = require("../controllers/glacierAiSettingsController");

router.get("/",    auth, ctrl.getSettings);
router.post("/",   auth, ctrl.saveSettings);
router.delete("/", auth, ctrl.deleteSettings);

module.exports = router;
