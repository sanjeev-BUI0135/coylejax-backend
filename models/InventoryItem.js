const mongoose = require('mongoose');

const inventoryItemSchema = new mongoose.Schema({
  project_id: {
    type: mongoose.Schema.Types.Mixed, // Accepts both String and ObjectId
    // required: true
  },
  material_order_id: {
    type: mongoose.Schema.Types.Mixed, // Accepts both String and ObjectId
  },
  item_name: {
    type: String,
    required: true
  },
  description: String,
  item_image_url: String,
  receipt: {
    file_name: String,
    file_url: String
  },
  quantity: {
    type: Number,
    required: true
  },
  unit: String,
  unit_cost: Number,
  previous_unit_cost: {
    type: Number,
    default: null
  },
  location: {
    type: String,
    default: 'Main Warehouse'
  },
  category: {
    type: String,
    // enum: ['materials', 'equipment', 'tools', 'supplies', 'other'],
    default: 'materials'
  },
  supplier: String,
  reorder_level: {
    type: Number,
    default: 0
  },
  received_date: Date,
  notes: String,
  created_by: {
    type: mongoose.Schema.Types.Mixed, 
  },
}, {
  timestamps: true
});

module.exports = mongoose.model('InventoryItem', inventoryItemSchema);