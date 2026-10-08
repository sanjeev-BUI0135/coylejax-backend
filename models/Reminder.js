const mongoose = require('mongoose');

const reminderSchema = new mongoose.Schema({
  projectName: {
    type: String,
    required: true,
  },
  projectNo: {
    type: String,
    required: true,
  },
  materialName: {
    type: String,
    required: true,
  },
  reminderDate: {
    type: String,
    required: true,
  },
  reminderTime: {
    type: String,
    required: true,
  },
  reminderDateTime: {
    type: Date,
    required: true,
    index: true,
  },
  orderId: {
    type: String,
    required: false, 
  },
  estimateId: {
    type: String,
  },
  projectId: {
    type: String,
  },
  userId: {
    type: String,
    required: true,
    index: true,
  },
  userEmail: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'sent', 'failed'],
    default: 'pending',
  },
  emailSent: {
    type: Boolean,
    default: false,
  },
  sentAt: {
    type: Date,
  },
   created_by: {
      type: mongoose.Schema.Types.Mixed,
    },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  lastChecked: {
    type: Date,
  },
});

// Index for efficient querying
reminderSchema.index({ reminderDateTime: 1, status: 1, emailSent: 1 });

module.exports = mongoose.model('Reminder', reminderSchema);