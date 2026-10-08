const SmsSettings = require("../models/SmsSettings");
const mongoose = require("mongoose");

const getOwnerId = (req) => {
    const roleType = req.user.role_type?.toLowerCase();
    if (roleType === "admin") {
        return new mongoose.Types.ObjectId(req.user._id);
    }
    return new mongoose.Types.ObjectId(req.user.created_by);
}

exports.saveSettings = async (req, res) => {
    try {
        const { accountSid, authToken, twilioPhoneNumber, accountName, enabled } = req.body;
        const ownerId = getOwnerId(req);
        const CreatorModel = "Client";

        let settings = await SmsSettings.findOne({
            createdBy: ownerId,
            createdByModel: CreatorModel,
        });

        if (!settings) {
            if (!authToken) {
                return res.status(400).json({ error: "Auth Token is required for first time setup" });
            }
            settings = new SmsSettings({
                createdBy: ownerId,
                createdByModel: CreatorModel,
                authToken: authToken
            });
        }

        if (accountSid) settings.accountSid = accountSid;
        if (authToken) settings.authToken = authToken;
        if (twilioPhoneNumber) settings.twilioPhoneNumber = twilioPhoneNumber;
        if (accountName) settings.accountName = accountName;
        if (enabled !== undefined) settings.enabled = enabled;

        settings.updatedBy = req.user._id;
        settings.updatedByModel = req.user.role_type?.toLowerCase() === "admin" ? "Client" : "User";
        settings.updatedAt = new Date();

        await settings.save();
        res.json({ success: true, data: settings });
    } catch (err) {
        console.error("Error saving SMS settings:", err);
        res.status(500).json({ error: "Failed to save SMS settings" });
    }
};

exports.getSettings = async (req, res) => {
    try {
        const ownerId = getOwnerId(req);
        const CreatorModel = "Client";

        const settings = await SmsSettings.findOne({
            createdBy: ownerId,
            createdByModel: CreatorModel,
        });

        if (!settings) {
            return res.json(null);
        }

        res.json({
            accountSid: settings.accountSid,
            twilioPhoneNumber: settings.twilioPhoneNumber,
            accountName: settings.accountName,
            enabled: settings.enabled,
            hasAuthToken: !!settings.authToken,
            maskedAuthToken: settings.authToken ? "********" : ""
        });
    } catch (err) {
        console.error("Error fetching SMS settings:", err);
        res.status(500).json({ error: "Failed to fetch SMS settings" });
    }
};

exports.deleteSettings = async (req, res) => {
    try {
        const ownerId = getOwnerId(req);
        const CreatorModel = "Client";

        await SmsSettings.deleteOne({
            createdBy: ownerId,
            createdByModel: CreatorModel,
        });

        res.json({ success: true });
    } catch (err) {
        console.error("Error deleting SMS settings:", err);
        res.status(500).json({ error: "Failed to delete SMS settings" });
    }
};
