const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
  project_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: false,
    index: true
  },
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  user_name: {
    type: String,
    required: false
  },

  user_email: {
    type: String,
    required: false
  },
  entity_id: {
    type: mongoose.Schema.Types.ObjectId,
    required: false,
    index: true
  },
  entity_type: {
    type: String,
    required: false,
    index: true
  },
  module: {
    type: String,
    required: true,
    enum: ['Project', 'Estimate', 'Invoice', 'Payment', 'Material Order', 'Upload', 'Checklist']
  },
  action: {
    type: String,
    required: true,
    enum: ['Create', 'Update', 'Delete', 'Upload', 'Status Change', 'Priority Change', 'Download', 'Sent', 'Approved', 'Rejected']
  },
  description: {
    type: String,
    required: true
  },
  changes: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('ActivityLog', activityLogSchema);
