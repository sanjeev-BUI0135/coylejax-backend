const User = require('../models/User');
const Client = require('../models/Client');

async function getProjectCreator(project) {
  if (!project?.created_by) return null;

  let creator = await User.findById(project.created_by).lean();
  if (!creator) {
    creator = await Client.findById(project.created_by).lean();
  }
  return creator;
}

module.exports = { getProjectCreator };
