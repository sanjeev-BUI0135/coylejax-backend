const MasterData = require("../models/MasterData");
const getRootCreator = require("../helpers/getRootCreator");
const mongoose = require("mongoose");

async function ensureNewProject(user) {
  let createdBy;
  createdBy =
    user.role_type !== "admin"
      ? await getRootCreator(user)
      : user._id;
  createdBy = new mongoose.Types.ObjectId(createdBy);
  const exists = await MasterData.findOne({
    type: "project_creation_type",
    value: "new_project",
    created_by: createdBy
  });

  if (!exists) {
    await MasterData.create({
      type: "project_creation_type",
      display_name: "New Project",
      value: "new_project",
      sort_order: 1,
      status: "active",
      created_by: createdBy
    });
  }
}

exports.getAll = async (req, res) => {
  try {
    const { type } = req.params;

    if (type === "project_creation_type") {
      await ensureNewProject(req.user);
    }

    const {
      page = 1,
      limit = 20,
      search = "",
      sortKey = "sort_order",
      sortDir = "asc",
      status
    } = req.query;

    let adminId =
      req.user.role_type !== "admin"
        ? await getRootCreator(req.user)
        : req.user._id;

    const filter = {
      type,
      created_by: new mongoose.Types.ObjectId(adminId)
    };

    if (search) {
      filter.$or = [
        { display_name: { $regex: search, $options: "i" } },
        { value: { $regex: search, $options: "i" } }
      ];
    }

    if (status) filter.status = status;

    const skip = (page - 1) * limit;

    const items = await MasterData
      .find(filter)
      .skip(skip)
      .limit(Number(limit))
      .sort({ [sortKey]: sortDir === "asc" ? 1 : -1 });

    const total = await MasterData.countDocuments(filter);

    res.json({
      data: items,
      page: Number(page),
      limit: Number(limit),
      total,
      totalPages: Math.ceil(total / limit)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.create = async (req, res) => {
  try {
    let createdBy = req.user._id;
    if (req.user.role_type !== "admin") {
      createdBy = await getRootCreator(req.user);
    }
    if ( req.body.type === "lead_status" && req.body.is_default === true ) {
      await MasterData.updateMany(
        {
          type: "lead_status",
          created_by: createdBy
        },
        {
          is_default: false
        }
      );
    }

    const item = await MasterData.create({
      ...req.body,
      created_by: createdBy
    });

    res.status(201).json(item);

  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const existing = await MasterData.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: "Not found" });
    }

    if (
      existing.type === "project_creation_type" &&
      existing.value === "new_project"
    ) {
      return res.status(403).json({
        error: "New Project is a default value and cannot be modified"
      });
    }

    const updateData = { ...req.body };
    delete updateData.created_by;

    if ( existing.type === "lead_status" && req.body.is_default === true) {
      await MasterData.updateMany(
        {
          type: "lead_status",
          created_by: existing.created_by
        },
        {
          is_default: false
        }
      );
    }

    let adminId =
      req.user.role_type !== "admin"
        ? await getRootCreator(req.user)
        : req.user._id;

    updateData.updated_by = adminId;

    const item = await MasterData.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );

    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};


exports.remove = async (req, res) => {
  try {
    const item = await MasterData.findById(req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });

    if (
      item.type === "project_creation_type" &&
      item.value === "new_project"
    ) {
      return res.status(403).json({
        error: "New Project cannot be deleted"
      });
    }

    await item.deleteOne();
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};


exports.toggleStatus = async (req, res) => {
  try {
    const item = await MasterData.findById(req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });

    if (
      item.type === "project_creation_type" &&
      item.value === "new_project"
    ) {
      return res.status(403).json({
        error: "New Project status cannot be changed"
      });
    }

    item.status = item.status === "active" ? "inactive" : "active";
    await item.save();

    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
