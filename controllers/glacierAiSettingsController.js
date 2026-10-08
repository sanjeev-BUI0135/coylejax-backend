const GlacierAiSettings = require("../models/GlacierAiSettings");
const mongoose = require("mongoose");

/** Resolve owner ID — non-admins use their creator's ID (same as SmsSettings pattern) */
const getOwnerId = (req) => {
    const roleType = req.user.role_type?.toLowerCase();
    if (roleType === "admin" || roleType === "superadmin") {
        return new mongoose.Types.ObjectId(req.user._id);
    }
    return new mongoose.Types.ObjectId(req.user.created_by || req.user._id);
};

const OWNER_MODEL = "Client";

// ── GET /api/settings/glaciers-ai ────────────────────────────────────────────
exports.getSettings = async (req, res) => {
    try {
        const ownerId = getOwnerId(req);

        const settings = await GlacierAiSettings.findOne({
            createdBy: ownerId,
            createdByModel: OWNER_MODEL,
        });

        if (!settings) {
            return res.json({ apiKey: "" });
        }

        res.json({ apiKey: settings.apiKey || "" });
    } catch (err) {
        console.error("GlacierAI getSettings error:", err);
        res.status(500).json({ error: "Failed to fetch Glacier AI settings" });
    }
};

// ── POST /api/settings/glaciers-ai ───────────────────────────────────────────
exports.saveSettings = async (req, res) => {
    try {
        const { apiKey } = req.body;
        const ownerId = getOwnerId(req);

        let settings = await GlacierAiSettings.findOne({
            createdBy: ownerId,
            createdByModel: OWNER_MODEL,
        });

        if (!settings) {
            settings = new GlacierAiSettings({
                createdBy: ownerId,
                createdByModel: OWNER_MODEL,
                apiKey: apiKey || "",
            });
        } else {
            settings.apiKey = apiKey || "";
        }

        settings.updatedBy = req.user._id;
        settings.updatedByModel =
            req.user.role_type?.toLowerCase() === "admin" || req.user.role_type?.toLowerCase() === "superadmin"
                ? "Client"
                : "User";
        settings.updatedAt = new Date();

        await settings.save();

        res.json({ success: true, apiKey: settings.apiKey });
    } catch (err) {
        console.error("GlacierAI saveSettings error:", err);
        res.status(500).json({ error: "Failed to save Glacier AI settings" });
    }
};

// ── DELETE /api/settings/glaciers-ai ─────────────────────────────────────────
exports.deleteSettings = async (req, res) => {
    try {
        const ownerId = getOwnerId(req);

        await GlacierAiSettings.deleteOne({
            createdBy: ownerId,
            createdByModel: OWNER_MODEL,
        });

        res.json({ success: true });
    } catch (err) {
        console.error("GlacierAI deleteSettings error:", err);
        res.status(500).json({ error: "Failed to delete Glacier AI settings" });
    }
};
