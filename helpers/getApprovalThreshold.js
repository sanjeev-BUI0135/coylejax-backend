const MasterData = require("../models/MasterData");

const getApprovalThreshold = async (createdBy) => {
    try {
        const markup = await MasterData.findOne({
            type: "markup",
            status: "active",
            created_by: createdBy
        }).lean();
        return markup?.estimate_amount || 15000;
    } catch (error) {
        console.error("Error fetching markup settings:", error);
        return 15000;
    }
};

module.exports = { getApprovalThreshold }
