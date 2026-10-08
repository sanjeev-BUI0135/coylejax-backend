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
  markup_amount: {
    type: Number,
    default: 0
  },
  base_total: {
    type: Number,
    default: 0
  },
  previous_unit_price: {
    type: Number,
    default: null
  },
  is_new: {
    type: Boolean,
    default: false
  },
  total: Number,
  inventory_item_id: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  markup_status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  is_section: {
    type: Boolean,
    default: false
  },
  imported_via_planscan: {
    type: Boolean,
    default: false
  }
});

const estimateSchema = new mongoose.Schema({
  // NEW: Quick estimate flag
  is_quick_estimate: {
    type: Boolean,
    default: false
  },
  imported_via_planscan: {
    type: Boolean,
    default: false
  },

  // NEW: Quick customer info (used when is_quick_estimate = true)
  quick_customer: {
    company_name: String,
    customer_name: String,
    phone_number: String,
    email_address: String,
    billing_address: String,
    site_address: String,
    division_type: String,
    project_name: String,
    _lead_id: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", default: null },
  },

  // Existing fields - now optional for quick estimates
  project_id: {
    type: mongoose.Schema.Types.Mixed,
    required: function () {
      return !this.is_quick_estimate;
    }
  },

  estimate_number: {
    type: String,
    required: true,
    unique: true
  },
  // Lead reference for quick estimates created from leads (used for tax exemption lookup)
  lead_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Lead",
    default: null
  },
  customer_po_number: String,
  project_manager: String,
  project_location: String,

  status: {
    type: String,
    enum: ['draft', 'sent', 'approved', 'rejected', 'expired'],
    default: 'draft'
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
  additional_markup_status_updated_at: Date,

  revision_date: Date,
  line_items: [lineItemSchema],
  subtotal: Number,

  tax_rate: {
    type: Number,
    default: 0.075
  },
  // When true: user has manually overridden the tax for this estimate.
  // Payment settings bulk updates will skip this estimate entirely.
  tax_exempt_override: {
    type: Boolean,
    default: false
  },
  tax_amount: Number,
  total_amount: Number,

  material_markup: {
    type: Number,
    default: 0
  },
  material_markup_amount: {
    type: Number,
    default: 0
  },
  invoiced_amount: {
    type: Number,
    default: 0
  },

  Scope_of_work: {
    type: String,
    default: ""
  },
  notes: {
    type: String,
    default: ""
  },
  valid_until: Date,
  reject_reason: String,
  approved_date: Date,
  sent_date: Date,
  auto_resend_count: {
    type: Number,
    default: 0
  },

  last_auto_resend_at: {
    type: Date,
    default: null
  },

  file_attachments: [{
    file_name: String,
    file_url: String,

    uploaded_by: String,

    uploaded_by_id: {
      type: mongoose.Schema.Types.ObjectId
    },

    uploaded_by_model: {
      type: String,
      enum: ["User", "Client"]
    },

    createdAt: {
      type: Date,
      default: Date.now
    }
  }],

  created_by: {
    type: mongoose.Schema.Types.Mixed,
  },
  created_by_user: {
    type: mongoose.Schema.Types.Mixed,
  },
  public_share_token: String,

  // NEW: Track if converted to project
  converted_to_project: {
    type: Boolean,
    default: false
  },
  converted_project_id: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  converted_at: Date
}, {
  timestamps: true
});

estimateSchema.pre('save', function (next) {
  if (this.line_items && this.line_items.length > 0) {
    this.line_items.forEach(item => {
      if (item.unit_price > 0 && item.total > 0) {
        const baseAmount = item.unit_price * item.quantity;
        if (baseAmount > 0) {
          item.markup_percentage = ((item.total - baseAmount) / baseAmount) * 100;
        }
      }
    });
  }
  next();
});

module.exports = mongoose.model('Estimate', estimateSchema);