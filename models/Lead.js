const mongoose = require("mongoose");

const leadSchema = new mongoose.Schema(
  {
    company_name: { type: String },

    customer_name: {
      type: String,
      required: true
    },

    phone: {
      type: String,
      required: true
    },

    email: {
      type: String
    },
    due_date: {
      type: Date
    },
    lead_source: {
      type: String,
      default: ""
    },
    lead_status: {
      type: String,
      default: ""
    },
    site_address: {
      type: String
    },
    billing_address: {
      type: String
    },

    division: {
      type: String,
      required: true
    },

    notes: {
      type: String
    },

    assigned_to: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },

    status: {
      type: String,
      enum: ["OPEN", "ARCHIVED", "CONVERTED"],
      default: "OPEN"
    },

    created_by: {
      type: mongoose.Schema.Types.Mixed
    },
    created_by_user: {
      type: mongoose.Schema.Types.Mixed
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Lead", leadSchema);
