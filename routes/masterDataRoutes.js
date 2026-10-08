const express = require("express");
const router = express.Router();
const controller = require("../controllers/masterDataController");
const auth = require('../middleware/auth');

router.use(auth);

router.get("/:type", controller.getAll);
router.post("/", controller.create);
router.put("/:id", controller.update);
router.delete("/:id", controller.remove);
router.patch("/toggle/:id", controller.toggleStatus);

module.exports = router;
