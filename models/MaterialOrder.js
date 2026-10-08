const mongoose = require('mongoose');

const lineItemSchema = new mongoose.Schema({
  description: String,
  quantity_ordered: Number,
  quantity_received: {
    type: Number,
    default: 0
  },
  unit: String,
  unit_price: {
    type: Number,
    default: 0
  },
  project_only: {
    type: Boolean,
    default: true
  },
  category: {
    type: String,
    default: 'Material'
  },
  status: {
    type: String,
    enum: ['Not Ordered', 'Ordered', 'Received', 'Available', 'In Stock', 'Out of Stock', 'Unavailable'],
    default: 'Available'
  },
  inventory_item_id: {
    type: mongoose.Schema.Types.Mixed,
    required: false
  },
  packing_slip: {
    file_name: {
      type: String,
      default: null
    },
    file_url: {
      type: String,
      default: null
    }
  },
  item_image: {
    file_name: {
      type: String,
    },
    file_url: {
      type: String,
    }
  },
  is_Upload_Toggle: {
    type: Boolean,
    default: false
  },
  supplier: String,
  location: String,
  reorder_level: {
    type: Number,
    default: 0
  },
  notes: String,
  order_date: Date,
  expected_delivery_date: Date,
  received_date: Date
});

const materialOrderSchema = new mongoose.Schema({
  project_id: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  estimate_id: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  order_status: {
    type: String,
    enum: ['Pending', 'Ordered', 'Partially Received', 'Fulfilled', 'Cancelled', 'Approved', 'Rejected'],
    default: 'Pending'
  },
  line_items: [lineItemSchema],
  notes: String,
  created_by: {
    type: mongoose.Schema.Types.Mixed,
  },
  created_by_user: {
    type: mongoose.Schema.Types.Mixed
  },
  customer_id: {
    type: mongoose.Schema.Types.Mixed,
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
  contact_name: {
    type: String,
    required: false
  },
  project_name: {
    type: String,
    required: false
  },
  rejection_reason: {
    type: String,
    default: null
  },
  total_amount: {
    type: Number,
    default: 0
  },
  requirement_status: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected'],
    default: 'Pending'
  },
  approved_at: {
    type: Date,
    default: null
  },
  approver_emails: {
    type: [String],
    default: []
  },
  approvaldata15K: {
    type: String,
    enum: ["Pending", "Approved", "Rejected"],
    default: "Pending"
  },
  approval_token: {
    type: String,
    default: null
  },
  rejected_at: {
    type: Date,
    default: null
  },
  approval_method: {
    type: String,
    default: null
  },
  approval_user_id: {
    type: mongoose.Schema.Types.Mixed,
    required: false
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('MaterialOrder', materialOrderSchema);