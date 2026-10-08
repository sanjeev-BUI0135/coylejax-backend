const express = require("express");
const multer = require("multer");
const auth = require("../middleware/auth");
const path = require("path");
const fs = require("fs");
const checklistController = require("../controllers/checklistController");

const router = express.Router();

// ------------------- MULTER FILE STORAGE ------------------- //
const checklistUploadDir = path.join(__dirname, "..", "uploads", "checklist");
if (!fs.existsSync(checklistUploadDir)) fs.mkdirSync(checklistUploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, checklistUploadDir);
  },
  filename: function (req, file, cb) {
    // Make filename URL-safe
    const safeName = file.originalname.replace(/\s+/g, "_"); 
    cb(null, Date.now() + "-" + safeName);
  },
});

const upload = multer({ storage });

// ------------------- ROUTES ------------------- //

// GET all checklists
router.get("/", checklistController.getAllChecklists);

// GET single checklist
router.get("/:id", checklistController.getChecklistById);

// GET checklists for a project
router.get("/project/:projectId", checklistController.getChecklistsByProject);

// CREATE checklist
router.post("/", auth, checklistController.createChecklist);

// UPDATE checklist
router.put("/:id", auth, checklistController.updateChecklist);

// DELETE checklist (and attached files)
router.delete("/:id", auth, checklistController.deleteChecklist);

// ------------------- FILE UPLOAD ------------------- //
router.post("/:id/upload", auth, upload.array("files"), checklistController.uploadFiles);

// DELETE single file
router.delete("/:id/files/:fileIndex", auth, checklistController.deleteFile);

module.exports = router;