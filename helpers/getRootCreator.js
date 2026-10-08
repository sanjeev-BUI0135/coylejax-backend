const User = require("../models/User");

const getRootCreatorId = async (user) => {
  // If the user itself is an admin, they are their own root
  if (user?.role_type === 'admin') {
    return user._id;
  }

  let rootCreatorId = user?.created_by;
  let lastValidAdminId = null;

  while (rootCreatorId) {
    const parent = await User.findById(rootCreatorId).lean();
    if (!parent) break;

    // If we find an admin, stop here
    if (parent.role_type === 'admin') {
      return parent._id;
    }

    lastValidAdminId = parent._id;
    rootCreatorId = parent.created_by;
  }

  return rootCreatorId || lastValidAdminId;
};

module.exports = getRootCreatorId;
