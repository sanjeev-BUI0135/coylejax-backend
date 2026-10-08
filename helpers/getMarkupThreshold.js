const MasterData = require("../models/MasterData.js");


async function getMarkupThreshold(ownerId) {
    try {

        const ownerString = ownerId?.toString();
        // Using .collection.find().limit(1) to bypass Mongoose schema casting 
        // because the DB has mixed types (strings vs ObjectIds)
        const results = await MasterData.collection.find({
            type: "markup",
            status: "active",
            created_by: { $in: [ownerId, ownerString, null, undefined, ""] }
        })
            .sort({ created_by: -1 })
            .limit(1)
            .toArray();

        const markupSetting = results[0];
        if (markupSetting?.markup_line_item) {
            return Number(markupSetting.markup_line_item);
        }

        return 20;

    } catch (err) {
        console.error("Markup threshold error:", err);
        return 20;
    }
}

module.exports = { getMarkupThreshold }
