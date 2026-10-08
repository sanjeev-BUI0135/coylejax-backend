const mongoose = require('mongoose');

const permissionSchema = new mongoose.Schema({
  module: { type: String, required: true },
  submenu_module: { type: String, default: null },
  canView: { type: Boolean, default: false },
  canAdd: { type: Boolean, default: false },
  canUpdate: { type: Boolean, default: false },
  canDelete: { type: Boolean, default: false }
}, { _id: false });

const roleSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  },
  permissions: {
    type: [permissionSchema],
    default: []
  },
  all_data_visible: {
    type: Boolean,
    default: false
  },
  all_lead_visible: {
    type: Boolean,
    default: false
  },
  created_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, { timestamps: true });

roleSchema.index(
  { name: 1, created_by: 1 },
  { unique: true }
);

module.exports = mongoose.model('Role', roleSchema);
