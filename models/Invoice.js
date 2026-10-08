const mongoose = require('mongoose');

const lineItemSchema = new mongoose.Schema({
  category: String,
  category_display_name: String,
  description: String,
  quantity: Number,
  unit: String,
  unit_price: Number,
  markup_percentage: {
    type: Number,
    default: 0
  },
  total: Number,
  markup_status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  is_section: {
    type: Boolean,
    default: false
  }
});

const invoiceSchema = new mongoose.Schema({
  project_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: true
  },
  estimate_id: {
    type: String   
  },
  invoice_number: {
    type: String,
    required: true,
    unique: true
  },
  customer_po_number: String,
  project_manager: String,
  project_location: String,
  status: {
    type: String,
    enum: ['draft', 'sent', 'paid', 'partial', 'void'],
    default: 'draft'
  },
  invoice_sent_date: Date,
  auto_resend_count: {
    type: Number,
    default: 0
  },
  last_auto_resend_at: Date,
  issue_date: Date,
  due_date: Date,
  line_items: [lineItemSchema],
  subtotal: Number,
  tax_rate: {
    type: Number,
    default: 0.075
  },
  // When true: user has manually overridden the tax for this invoice.
  // Payment settings bulk updates will skip this invoice entirely.
  tax_exempt_override: {
    type: Boolean,
    default: false
  },
  tax_amount: Number,
  material_markup: {
    type: Number,
    default: 0
  },
  material_markup_amount: {
    type: Number,
    default: 0
  },
  total_amount: {
    type: Number,
    required: true
  },
  amount_paid: {
    type: Number,
    default: 0
  },
  processing_fee: {
    type: Number,
    default: 0
  },
  notes: String,
  Scope_of_work: {
    type: String,
    default: ""
  },
  public_share_token: String,
  created_by: {
    type: String
  },
  created_by_user: {
    type: String
  },
  markup_status: {
    type: String,
    enum: ['N/A', 'pending', 'approved', 'rejected'],
    default: 'N/A'
  },
  markup_status_updated_at: Date,
  additional_markup_status: {
    type: String,
    enum: ['N/A', 'pending', 'approved', 'rejected'],
    default: 'N/A'
  },
  additional_markup_status_updated_at: Date
}, {
  timestamps: true
});

module.exports = mongoose.model('Invoice', invoiceSchema)