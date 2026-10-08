const mongoose = require('mongoose');

const bidSchema = new mongoose.Schema({
  project_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: true
  },
  
  submitted_by_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  bidder_name: {
    type: String,
    required: false
  },
  bidder_email: {
    type: String,
    required: false  
  },
  
  customer_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: false  
  },
  submitted_by: {
    type: String,
    required: false 
  },
  customer_name: {
    type: String,
    required: false 
  },
  customer_email: {
    type: String,
    required: false  
  },
  
  customer_request: {
    type: String,
    default: ''
  },
  bid_value: {
    type: Number,
    required: true
  },
  notes: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected'],
    default: 'pending'
  },
  reviewed_by: String,
  reviewed_at: Date,
  rejection_reason: String
}, {
  timestamps: true
});

bidSchema.index({ project_id: 1, createdAt: -1 });
bidSchema.index({ status: 1 });
bidSchema.index({ submitted_by_id: 1 });

module.exports = mongoose.model('Bid', bidSchema);