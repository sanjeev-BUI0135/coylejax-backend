const MasterData = require("../models/MasterData");
const mongoose = require("mongoose");

/**
 * Builds the division/user visibility query array for a non-admin user.
 * 
 * If a division has `show_all_division_data: true`, the user can see all data in that division.
 * If it has `show_all_division_data: false`, the user can only see data they created in that division.
 * 
 * @param {Object} user - The logged-in user object (req.user)
 * @param {mongoose.Types.ObjectId} ownerId - The admin's object ID
 * @param {String} userField - The field name in the target collection that stores the creator's user ID (e.g., 'created_by_user')
 * @param {Boolean} isNested - If true, outputs nested fields for aggregation pipelines
 * @returns {Array} An array suitable for a MongoDB $or clause, or an empty array if the user has no divisions.
 */
async function buildDivisionVisibilityQuery(user, ownerId, userField = "created_by_user", isNested = false) {
  if (!user.project_type || user.project_type.length === 0) {
    return []; // No divisions, they shouldn't see anything if we strictly filter.
  }

  // Fetch the divisions from MasterData that belong to the user's owner
  const divisions = await MasterData.find({
    type: "divisions",
    value: { $in: user.project_type },
    created_by: ownerId,
    status: "active"
  }).lean();

  const openDivisions = [];
  const restrictedDivisions = [];

  for (const div of divisions) {
    if (div.show_all_division_data === true) {
      openDivisions.push(div.value);
    } else {
      restrictedDivisions.push(div.value);
    }
  }

  // If there are divisions missing from MasterData (maybe deleted or inactive),
  // we default them to restricted (safe fallback)
  const masterDataValues = new Set(divisions.map(d => d.value));
  for (const div of user.project_type) {
    if (!masterDataValues.has(div)) {
      restrictedDivisions.push(div);
    }
  }

  const orConditions = [];

  if (openDivisions.length > 0) {
    const adminIds = [new mongoose.Types.ObjectId(ownerId), ownerId.toString()];
    if (isNested) {
      orConditions.push(
        { 
          "project.project_type": { $in: openDivisions },
          created_by: { $in: adminIds }
        },
        { 
          "quick_customer.division_type": { $in: openDivisions },
          created_by: { $in: adminIds }
        }
      );
    } else {
      orConditions.push(
        { 
          division: { $in: openDivisions },
          created_by: { $in: adminIds }
        },
        { 
          project_type: { $in: openDivisions },
          created_by: { $in: adminIds }
        }
      );
    }
  }

  if (restrictedDivisions.length > 0) {
    const userIds = [new mongoose.Types.ObjectId(user._id), user._id.toString()];
    if (isNested) {
      orConditions.push(
        {
          "project.project_type": { $in: restrictedDivisions },
          [userField]: { $in: userIds }
        },
        {
          "quick_customer.division_type": { $in: restrictedDivisions },
          [userField]: { $in: userIds }
        }
      );
    } else {
      orConditions.push(
        {
          division: { $in: restrictedDivisions },
          [userField]: { $in: userIds }
        },
        {
          project_type: { $in: restrictedDivisions },
          [userField]: { $in: userIds }
        }
      );
    }
  }

  return orConditions;
}

module.exports = {
  buildDivisionVisibilityQuery
};
