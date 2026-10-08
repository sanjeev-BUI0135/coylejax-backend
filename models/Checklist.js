const mongoose = require("mongoose");

const checklistSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    status: {
      type: String,
      enum: ["Open", "Processing", "Completed", "N/A"],
      default: "Open",
    },
    files: [{ fileName: String, filePath: String, fileType: String }],
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Checklist", checklistSchema);
