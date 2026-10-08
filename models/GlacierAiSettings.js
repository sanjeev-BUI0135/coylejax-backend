const mongoose = require("mongoose");

const glacierAiSettingsSchema = new mongoose.Schema({
    // The Glacier AI API key — stored encrypted-at-rest via MongoDB
    apiKey: { type: String, default: "" },

    // Owner: same pattern as SmsSettings (one record per admin/client)
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        refPath: "createdByModel",
        required: true,
    },
    createdByModel: {
        type: String,
        enum: ["User", "Client"],
        required: true,
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

// One settings document per owner
glacierAiSettingsSchema.index(
    { createdBy: 1, createdByModel: 1 },
    { unique: true }
);

module.exports = mongoose.model("GlacierAiSettings", glacierAiSettingsSchema);
