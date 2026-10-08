const MasterData = require("../models/MasterData");
const Project = require("../models/Project");

/**
 * Fetch terms and conditions based on project ID
 * @param {String} projectId - MongoDB ObjectId of the project
 * @returns {String|null} HTML string of terms and conditions or null
 */
async function getTermsAndConditionsByProjectId(projectId, createdBy) {
  try {
    if (!projectId) return null;

    const project = await Project.findById(projectId).select('project_type');
    if (!project || !project.project_type) return null;

    const projectType = project.project_type
    const division = await MasterData.find({
      type: 'divisions',
      value: projectType
    });

    const createdByStr = createdBy?.toString();
    const matched = division.find(d =>
      d.created_by?.toString() === createdByStr &&
      d.status === "active"
    );

    if (matched) {
      return matched.terms_and_conditions;
    }
    return null
  } catch (error) {
    console.error('Error fetching terms and conditions:', error);
    return null;
  }
}

/**
 * Fetch terms and conditions based on project type directly
 * @param {String} projectType - Project type (e.g., "division_32", "division_8")
 * @returns {String|null} HTML string of terms and conditions or null
 */
async function getTermsAndConditionsByProjectType(projectType) {
  try {
    if (!projectType) return null;

    const projectTypeLower = projectType.toLowerCase();

    const division = await MasterData.findOne({
      type: 'divisions',
      status: 'active',
      $or: [
        { value: { $regex: new RegExp(`^${projectTypeLower}$`, 'i') } },
        {
          $expr: {
            $eq: [
              { $toLower: { $replaceAll: { input: "$display_name", find: " ", replacement: "_" } } },
              projectTypeLower
            ]
          }
        }
      ]
    }).select('terms_and_conditions display_name');

    if (division && division.terms_and_conditions && division.terms_and_conditions.trim() !== '') {
      return division.terms_and_conditions;
    }

    return null;
  } catch (error) {
    console.error('Error fetching terms and conditions by type:', error);
    return null;
  }
}

/**
 * Convert HTML terms to email-safe format
 * @param {String} termsHtml - HTML string of terms and conditions
 * @returns {String} Email-safe HTML string
 */
function formatTermsForEmail(termsHtml) {
  if (!termsHtml) return '';

  if (termsHtml.includes('<ul') || termsHtml.includes('<ol')) {
    return termsHtml;
  }

  return `<div style="margin:0; padding:0; color:#333;">${termsHtml}</div>`;
}

/**
 * Get terms with fallback to default
 * @param {String} projectId - MongoDB ObjectId of the project
 * @returns {String} HTML string of terms (custom or default)
 */
async function getTermsWithFallback(projectId, createdBy) {
  
  try {
    const customTerms = await getTermsAndConditionsByProjectId(projectId, createdBy);
    if (customTerms) {
      return formatTermsForEmail(customTerms);
    }

    return null;

  } catch (error) {
    console.error('Error in getTermsWithFallback:', error);
    return null;
  }
}

module.exports = {
  getTermsAndConditionsByProjectId,
  getTermsAndConditionsByProjectType,
  formatTermsForEmail,
  getTermsWithFallback
};