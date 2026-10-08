const mongoose = require("mongoose");

const StripeSessionSchema = new mongoose.Schema({
  session_id: { type: String, required: true, unique: true },
  invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "Invoice", default: null },
  invoiceNumber: { type: String, default: "" },
  creatorId: { type: mongoose.Schema.Types.ObjectId, default: null },
  creatorModel: {
    type: String,
    enum: ["User", "Client"],
    default: "User",
  },
  customerInfo: {
    type: Object,
    default: {},
  },
  enteredAmount: { type: Number },
  processingFee: { type: Number },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("StripeSession", StripeSessionSchema);
