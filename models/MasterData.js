const mongoose = require("mongoose");

const MasterDataSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      trim: true
    },

    display_name: {
      type: String,
      trim: true
    },

    // markup text
    value: {
      type: String,
      trim: true
    },

    // markup %
    markup_line_item: {
      type: Number,
      default: 0
    },

    // alert role
    low_markup_role: {
      type: String,
      default: ""
    },

    // alert users
    low_markup_users: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      }
    ],

    // approval amount
    estimate_amount: {
      type: Number,
      default: 0
    },

    material_approval_role: {
      type: String,
      default: ""
    },

    material_approval_users: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      }
    ],

    // customer payment alert role
    payment_alert_role: {
      type: String,
      default: ""
    },

    // customer payment alert users
    payment_alert_users: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      }
    ],
    hourly_rate: {
      type: Number,
      default: null
    },
    tax_added: {
      type: Boolean,
      default: false
    },
    sort_order: {
      type: Number,
      default: 0
    },

    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active"
    },

    is_default: {
      type: Boolean,
      default: false
    },

    terms_and_conditions: {
      type: String,
      trim: true,
      default: ""
    },

    show_all_division_data: {
      type: Boolean,
      default: false
    },

    created_by: {
      type: mongoose.Schema.Types.ObjectId
    },

    updated_by: {
      type: mongoose.Schema.Types.ObjectId
    }

  },
  { timestamps: true }
);

module.exports = mongoose.model("MasterData", MasterDataSchema);