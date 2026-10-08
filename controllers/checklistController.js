const Checklist = require("../models/Checklist");
const { logActivity } = require("../utils/activityLogger");
const path = require("path");
const fs = require("fs");

const checklistUploadDir = path.join(__dirname, "..", "uploads", "checklist");

const getAllChecklists = async (req, res) => {
  try {
    const checklists = await Checklist.find();
    res.json(checklists);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getChecklistById = async (req, res) => {
  try {
    const checklist = await Checklist.findById(req.params.id);
    if (!checklist) return res.status(404).json({ message: "Checklist not found" });
    res.json(checklist);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getChecklistsByProject = async (req, res) => {
  try {
    const checklists = await Checklist.find({ project: req.params.projectId });
    res.json(checklists);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const createChecklist = async (req, res) => {
  try {
    const { name, status, project } = req.body;

    if (!project) return res.status(400).json({ message: "Project ID is required" });

    const checklist = new Checklist({
      name,
      status: status || "Open",
      files: [],
      project,
    });

    await checklist.save();
    res.status(201).json(checklist);

    // Activity Logging
    await logActivity(
      project,
      req.user,
      'Checklist',
      'Create',
      `Checklist "${name}" created.`,
      { name }
    );
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const updateChecklist = async (req, res) => {
  try {
    const checklist = await Checklist.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(checklist);

    // Activity Logging
    if (checklist) {
      await logActivity(
        checklist.project,
        req.user,
        'Checklist',
        'Update',
        `Checklist "${checklist.name}" updated.`,
        { name: checklist.name, status: checklist.status }
      );
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const deleteChecklist = async (req, res) => {
  try {
    const checklist = await Checklist.findById(req.params.id);
    if (!checklist) return res.status(404).json({ message: "Checklist not found" });

    // Delete attached files from filesystem
    checklist.files.forEach((file) => {
      const filePath = path.join(checklistUploadDir, path.basename(file.filePath));
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });

    await Checklist.findByIdAndDelete(req.params.id);
    res.json({ message: "Checklist deleted" });

    // Activity Logging
    await logActivity(
      checklist.project,
      req.user,
      'Checklist',
      'Delete',
      `Checklist "${checklist.name}" deleted.`,
      { name: checklist.name }
    );
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const uploadFiles = async (req, res) => {
  try {
    const checklist = await Checklist.findById(req.params.id);
    if (!checklist) return res.status(404).json({ message: "Checklist not found" });

    const baseURL = `${req.protocol}://${req.get("host")}`;

    const uploadedFiles = req.files.map((file) => ({
      fileName: file.originalname,
      filePath: `${baseURL}/uploads/checklist/${file.filename}`,
      fileType: file.mimetype,
    }));

    checklist.files.push(...uploadedFiles);
    await checklist.save();

    res.json({ message: "Files uploaded", checklist });

    // Activity Logging
    await logActivity(
      checklist.project,
      req.user,
      'Checklist',
      'Upload',
      `Uploaded ${uploadedFiles.length} file(s) to checklist "${checklist.name}".`,
      { name: checklist.name, file_count: uploadedFiles.length }
    );
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ message: err.message });
  }
};

const deleteFile = async (req, res) => {
  try {
    const { id, fileIndex } = req.params;

    const checklist = await Checklist.findById(id);
    if (!checklist) return res.status(404).json({ message: "Checklist not found" });

    const fileToDelete = checklist.files[fileIndex];
    if (!fileToDelete) return res.status(404).json({ message: "File not found" });

    // Delete from filesystem
    const localPath = path.join(checklistUploadDir, path.basename(fileToDelete.filePath));
    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);

    // Remove from DB
    checklist.files.splice(fileIndex, 1);
    await checklist.save();

    res.json({ message: "File deleted", checklist });

    // Activity Logging
    await logActivity(
      checklist.project,
      req.user,
      'Checklist',
      'Delete',
      `Deleted file from checklist "${checklist.name}".`,
      { name: checklist.name, file_name: fileToDelete.fileName }
    );
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getAllChecklists,
  getChecklistById,
  getChecklistsByProject,
  createChecklist,
  updateChecklist,
  deleteChecklist,
  uploadFiles,
  deleteFile
};
