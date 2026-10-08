const mongoose = require("mongoose");

const smsSettingsSchema = new mongoose.Schema({
    accountSid: { type: String, required: true },
    authToken: { type: String, required: true },
    twilioPhoneNumber: { type: String, required: true },
    accountName: String,
    enabled: { type: Boolean, default: true },

    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        refPath: "createdByModel",
        required: true
    },
    createdByModel: {
        type: String,
        enum: ["User", "Client"],
        required: true
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

smsSettingsSchema.index(
    { createdBy: 1, createdByModel: 1 },
    { unique: true }
);

module.exports = mongoose.model("SmsSettings", smsSettingsSchema);
