const User = require("../models/User");
const MasterData = require("../models/MasterData");

async function getLowMarkupRecipients(ownerId) {
    const ownerString = ownerId?.toString();
    const markupSettings = await MasterData.collection.find({
        type: "markup",
        created_by: { $in: [ownerId, ownerString, null, undefined, ""] }
    }).sort({ created_by: -1 })
        .limit(1)
        .toArray();
    if (!markupSettings) return [];

    const role = markupSettings[0].low_markup_role;
    const userIds = markupSettings[0].low_markup_users || [];
    let users = [];

    if (role) {
        const roleUsers = await User.find({
            role,
            created_by: ownerId
        }).select("email full_name");

        users = [...users, ...roleUsers];
    }

    if (userIds.length) {
        const specificUsers = await User.find({
            _id: { $in: userIds }
        }).select("email full_name");

        users = [...users, ...specificUsers];
    }
    return [...new Map(users.map(u => [u.email, u])).values()];
}

module.exports = { getLowMarkupRecipients };