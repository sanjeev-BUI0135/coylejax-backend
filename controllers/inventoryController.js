const InventoryItem = require('../models/InventoryItem');
const { createIdQuery, createForeignKeyQuery } = require('../utils/idHelper');
const getRootCreator = require('../helpers/getRootCreator');
const mongoose = require('mongoose');

const getOwnerId = (req) => {
  if (req.user.role_type === "admin") {
    return new mongoose.Types.ObjectId(req.user._id);
  }
  return new mongoose.Types.ObjectId(req.user.created_by);
};

const getAllInventoryItems = async (req, res) => {
  try {
    const { page, limit, search, sort } = req.query;

    const ownerObjectId = getOwnerId(req);
    const ownerIdString = ownerObjectId.toString();

    const baseQuery = {
      created_by: { $in: [ownerObjectId, ownerIdString] }
    };

    let query = { ...baseQuery };

    if (search) {
      const searchRegex = new RegExp(search, 'i');
      query = {
        ...baseQuery,
        $or: [
          { item_name: searchRegex },
          { description: searchRegex },
          { supplier: searchRegex },
          { category: searchRegex },
          { location: searchRegex }
        ]
      };
    }

    let sortQuery = { createdAt: -1 };
    if (sort) {
      const isDesc = sort.startsWith('-');
      const field = isDesc ? sort.substring(1) : sort;
      sortQuery = { [field]: isDesc ? -1 : 1 };
    }

    let inventoryQuery = InventoryItem.find(query).sort(sortQuery);

    if (page || limit) {
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 10;
      const skip = (pageNum - 1) * limitNum;

      inventoryQuery = inventoryQuery.skip(skip).limit(limitNum);
    }

    const inventoryItems = await inventoryQuery;
    const total = await InventoryItem.countDocuments(query);

    const data = inventoryItems.map(item => ({
      ...item.toObject(),
      id: item.id || item._id.toString(),
      _id: item._id
    }));

    res.json({
      data,
      total,
      page: page ? Number(page) : null,
      limit: limit ? Number(limit) : null
    });

  } catch (err) {
    console.error('Error fetching inventory items:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

const getInventoryItemById = async (req, res) => {
  try {
    const searchId = req.params.id;
    const query = createIdQuery(searchId);
    const inventoryItem = await InventoryItem.findOne(query);

    if (!inventoryItem) {
      return res.status(404).json({ error: 'Inventory item not found' });
    }

    const responseData = {
      ...inventoryItem.toObject(),
      id: inventoryItem.id || inventoryItem._id.toString(),
      _id: inventoryItem._id
    };

    res.json(responseData);
  } catch (err) {
    console.error('Error fetching inventory item:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

const createInventoryItem = async (req, res) => {
  try {
    let createdBy = req.user._id;
    if (req.user.role_type !== "admin") {
      createdBy = await getRootCreator(req.user);
    }
    const inventoryItemData = {
      ...req.body,
      created_by: createdBy
    };

    // Don't set previous_unit_cost for new items
    if (!inventoryItemData.previous_unit_cost) {
      inventoryItemData.previous_unit_cost = null;
    }

    const inventoryItem = new InventoryItem(inventoryItemData);
    await inventoryItem.save();

    const responseData = {
      ...inventoryItem.toObject(),
      id: inventoryItem.id || inventoryItem._id.toString(),
      _id: inventoryItem._id
    };

    res.status(201).json(responseData);
  } catch (err) {
    console.error('Error creating inventory item:', err);
    res.status(500).json({ error: err });
  }
};

const createBulkInventoryItems = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    let createdBy = req.user._id;
    if (req.user.role_type !== "admin") {
      createdBy = await getRootCreator(req.user);
    }

    const items = req.body.items;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Items array required" });
    }

    const cleanedItems = items
      .map((item, index) => {
        if (!item.item_name) return null;

        return {
          item_name: String(item.item_name).trim(),
          description: item.description || "",
          category: ["materials", "equipment", "tools", "supplies", "other"]
            .includes(item.category) ? item.category : "materials",
          quantity: Number(item.quantity) || 0,
          unit: item.unit || "each",
          unit_cost: Number(item.unit_cost) || 0,
          reorder_level: Number(item.reorder_level) || 0,
          location: item.location || "main_warehouse",
          supplier: item.supplier || "",
          notes: item.notes || "",
          received_date: item.received_date ? new Date(item.received_date) : null,
          previous_unit_cost: null,
          project_id: null,
          created_by: createdBy,
        };
      })
      .filter(Boolean);

    if (cleanedItems.length === 0) {
      return res.status(400).json({ error: "No valid rows found" });
    }

    const result = await InventoryItem.insertMany(cleanedItems, {
      ordered: false,
    });

    res.status(201).json({
      success: true,
      inserted: result.length,
      skipped: items.length - result.length,
    });

  } catch (err) {
    console.error("Bulk insert error:", err);

    // IMPORTANT: handle partial success
    if (err.writeErrors) {
      return res.status(207).json({
        success: true,
        inserted: err.result?.nInserted || 0,
        errors: err.writeErrors.map(e => ({
          index: e.index,
          message: e.errmsg
        }))
      });
    }

    res.status(500).json({ error: err.message });
  }
};

const updateInventoryItem = async (req, res) => {
  try {
    const searchId = req.params.id;
    const query = createIdQuery(searchId);
    const ownerObjectId = await getOwnerId(req);
    const ownerIdString = ownerObjectId.toString();

    // Get the existing item first to track price changes
    const existingItem = await InventoryItem.findOne({
      ...query,
      created_by: { $in: [ownerObjectId, ownerIdString] }
    });

    if (!existingItem) {
      return res.status(404).json({ error: 'Inventory item not found' });
    }

    // Prepare update data
    const updateData = { ...req.body };

    // Handle price tracking
    if (updateData.unit_cost !== undefined && updateData.unit_cost !== null) {
      const newUnitCost = parseFloat(updateData.unit_cost);
      const existingUnitCost = parseFloat(existingItem.unit_cost);

      // If price changed, store the old price as previous_unit_cost
      if (newUnitCost !== existingUnitCost) {
        updateData.previous_unit_cost = existingUnitCost;
      } else if (updateData.previous_unit_cost === undefined) {
        // If price didn't change and previous_unit_cost not provided, keep existing
        updateData.previous_unit_cost = existingItem.previous_unit_cost;
      }
    }

    const inventoryItem = await InventoryItem.findOneAndUpdate(
      {
        ...query,
        created_by: { $in: [ownerObjectId, ownerIdString] }
      },
      updateData,
      { new: true }
    );

    const responseData = {
      ...inventoryItem.toObject(),
      id: inventoryItem.id || inventoryItem._id.toString(),
      _id: inventoryItem._id
    };

    res.json(responseData);
  } catch (err) {
    console.error('Error updating inventory item:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

const deleteBulkInventoryItems = async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "No inventory items selected" });
    }

    const ownerObjectId = await getOwnerId(req);
    const ownerIdString = ownerObjectId.toString();

    const result = await InventoryItem.deleteMany({
      _id: { $in: ids },
      created_by: { $in: [ownerObjectId, ownerIdString] },
    });

    res.json({
      success: true,
      deleted: result.deletedCount,
    });
  } catch (err) {
    console.error("Bulk delete error:", err);
    res.status(500).json({ error: "Bulk delete failed" });
  }
};

const deleteInventoryItem = async (req, res) => {
  try {
    const searchId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(searchId)) {
      return res.status(400).json({ error: "Invalid inventory ID" });
    }

    const query = createIdQuery(searchId);
    const ownerObjectId = await getOwnerId(req);
    const ownerIdString = ownerObjectId.toString();

    const inventoryItem = await InventoryItem.findOneAndDelete({
      ...query,
      created_by: { $in: [ownerObjectId, ownerIdString] },
    });

    if (!inventoryItem) {
      return res.status(404).json({ error: "Inventory item not found" });
    }

    res.json({
      success: true,
      deletedId: inventoryItem._id,
    });
  } catch (err) {
    console.error("Error deleting inventory item:", err);
    res.status(500).json({ error: "Server error" });
  }
};

module.exports = {
  getAllInventoryItems,
  getInventoryItemById,
  createInventoryItem,
  createBulkInventoryItems,
  updateInventoryItem,
  deleteBulkInventoryItems,
  deleteInventoryItem
};
