const User = require("../models/User");
const MasterData = require("../models/MasterData");
const Role = require("../models/Role");
const mongoose = require("mongoose");

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function getPaymentRecipients(ownerId) {
  const ownerObjectId = (ownerId && mongoose.Types.ObjectId.isValid(ownerId))
    ? new mongoose.Types.ObjectId(ownerId)
    : null;

  try {
    let setting = null;

    if (ownerObjectId) {
      setting = await MasterData.findOne({
        type: "markup",
        created_by: ownerObjectId,
        $or: [
          { payment_alert_role: { $exists: true, $ne: "" } },
          { payment_alert_users: { $exists: true, $not: { $size: 0 } } },
        ],
      }).lean();
    }

    // 2. Try updated_by scope
    if (!setting && ownerObjectId) {
      setting = await MasterData.findOne({
        type: "markup",
        updated_by: ownerObjectId,
        $or: [
          { payment_alert_role: { $exists: true, $ne: "" } },
          { payment_alert_users: { $exists: true, $not: { $size: 0 } } },
        ],
      }).lean();
    }

    // 3. Fallback: any markup setting with alert config (most recent)
    if (!setting) {
      setting = await MasterData.findOne({
        type: "markup",
        $or: [
          { payment_alert_role: { $exists: true, $ne: "" } },
          { payment_alert_users: { $exists: true, $not: { $size: 0 } } },
        ],
      }).sort({ updatedAt: -1, _id: -1 }).lean();
    }

    // 4. Last resort: any markup setting
    if (!setting) {
      setting = await MasterData.findOne({ type: "markup" })
        .sort({ updatedAt: -1, _id: -1 }).lean();
    }

    if (!setting) {
      console.log("[getPaymentRecipients] No markup settings found in DB.");
      return [];
    }

    const role = (setting.payment_alert_role || "").trim();
    const userIds = Array.isArray(setting.payment_alert_users) ? setting.payment_alert_users : [];

    if (!role && userIds.length === 0) {
      console.log("[getPaymentRecipients] No alert role or users configured.");
      return [];
    }

    let users = [];

    if (userIds.length > 0) {
      const objectIds = userIds
        .map((id) => {
          try { return new mongoose.Types.ObjectId(id.toString()); }
          catch { return null; }
        })
        .filter(Boolean);

      const specificUsers = await User.find({ _id: { $in: objectIds } })
        .select("email full_name role_type role")
        .lean();
      users.push(...specificUsers);

    } else if (role) {
      // ── CASE B: No specific users → send to ALL users matching the role ───
      const matchingRoles = await Role.find({
        name: { $regex: new RegExp(`^${escapeRegex(role)}$`, "i") },
      }).select("_id name").lean();

      const matchingRoleIds = matchingRoles.map((r) => r._id);

      const roleConditions = [
        { role_type: { $regex: new RegExp(`^${escapeRegex(role)}$`, "i") } },
        { role: { $regex: new RegExp(`^${escapeRegex(role)}$`, "i") } },
      ];
      if (matchingRoleIds.length > 0) {
        roleConditions.push({ roleId: { $in: matchingRoleIds } });
      }

      // Scoped to owner first
      let roleUsers = [];
      if (ownerObjectId) {
        roleUsers = await User.find({
          $and: [
            { $or: roleConditions },
            { created_by: ownerObjectId },
          ],
        }).select("email full_name role_type role").lean();
      }

      // If none found under owner, search globally
      if (roleUsers.length === 0) {
        roleUsers = await User.find({ $or: roleConditions })
          .select("email full_name role_type role")
          .lean();
      }
      users.push(...roleUsers);
    }

    const uniqueMap = new Map();
    for (const u of users) {
      if (u && u.email && u.email.trim()) {
        uniqueMap.set(u.email.trim().toLowerCase(), u);
      }
    }

    const result = [...uniqueMap.values()];
    console.log("[getPaymentRecipients] Final alert recipients:",
      result.map((u) => `${u.full_name} <${u.email}>`));
    return result;

  } catch (err) {
    console.error("[getPaymentRecipients Error]:", err);
    return [];
  }
}

module.exports = { getPaymentRecipients };
