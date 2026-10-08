const router = require("express").Router();
const auth = require("../middleware/auth");
const controller = require("../controllers/lead.controller");

router.post("/", auth, controller.createLead);
router.get("/", auth, controller.getLeads);
router.put("/:id/assign", auth, controller.assignLead);
router.put("/:id/convert", auth, controller.convertLeadToCustomer);
router.put("/:id", auth, controller.updateLead);
router.delete("/bulk", auth, controller.bulkDeleteLeads);
router.delete("/:id", auth, controller.deleteLead);
router.get("/stats", auth, controller.getLeadStats);
router.get("/source-stats", auth, controller.getLeadSourceStats);

module.exports = router;
