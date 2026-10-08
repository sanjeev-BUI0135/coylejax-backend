const mongoose = require("mongoose");

const paymentSettingsSchema = new mongoose.Schema({
  provider: { type: String, default: "stripe" },
  enabled: { type: Boolean, default: false },
  publishableKey: String,
  secretKey: String,
  vitalMerchantId: String,

  // Payment methods
  cashEnabled: { type: Boolean, default: false },
  checkEnabled: { type: Boolean, default: false },
  cardsEnabled: { type: Boolean, default: false },
  achEnabled: { type: Boolean, default: false },
  mobileEnabled: { type: Boolean, default: false },

  // Tax settings
  taxRate: { type: Number, default: 0.075 },
  taxExemptCustomers: [{ type: mongoose.Schema.Types.ObjectId, ref: "Customer" }],
  taxExemptLeads: [{ type: mongoose.Schema.Types.ObjectId, ref: "Lead" }],

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: "createdByModel",
  },
  createdByModel: {
    type: String,
    enum: ["User", "Client"],
  },

  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: "updatedByModel",
  },
  updatedByModel: {
    type: String,
    enum: ["User", "Client"],
  },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});
paymentSettingsSchema.index(
  { provider: 1, createdBy: 1, createdByModel: 1 },
  { unique: true }
);
module.exports = mongoose.model("PaymentSettings", paymentSettingsSchema);