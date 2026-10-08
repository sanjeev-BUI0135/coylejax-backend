const mongoose = require("mongoose");

const applyScope = (req, query = {}, opts = {}) => {
  const user = req.user;
  const adminId = req.adminId;
  const roleType = user.role_type?.toLowerCase();

  const adminObjectId = mongoose.Types.ObjectId.isValid(adminId)
    ? new mongoose.Types.ObjectId(adminId)
    : adminId;

  let scopeQuery = {};

  if (roleType === "admin" || user.allDataVisible) {
    scopeQuery = {
      $or: [
        { created_by: adminObjectId },
        { created_by: adminId.toString() }
      ]
    };
  } else if (roleType === "superadmin") {
    return query;
  } else {
    if (opts.excludeDivision) {
      scopeQuery = {};
    } else if (user.divisionScope && user.divisionScope.length > 0) {
      scopeQuery = { $or: user.divisionScope };
    } else {
      scopeQuery = {
        $or: [
          { created_by_user: user._id },
          { created_by_user: user._id.toString() }
        ]
      };
    }
  }

  // existing search query irundha merge pannu
  if (query.$or) {
    return {
      $and: [
        {
          $or: query.$or
        },
        scopeQuery
      ]
    };
  }

  return {
    ...query,
    ...scopeQuery
  };
};

module.exports = applyScope;