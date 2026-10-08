const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Client = require('../models/Client');
const Role = require('../models/Role');
const { buildDivisionVisibilityQuery } = require('../helpers/divisionHelper');

const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'No token, authorization denied' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret-key');

    let currentUser = null;

    if (decoded.type === 'user') {
      currentUser = await User.findById(decoded.id).select('-password');
    } else if (decoded.type === 'client') {
      currentUser = await Client.findById(decoded.id).select('-password');
    }

    if (!currentUser) {
      return res.status(401).json({ error: 'Token is not valid' });
    }

    // FETCH ROLE
    let role = null;

    if (currentUser.roleId) {
      role = await Role.findById(currentUser.roleId);
    } else {
      role = await Role.findOne({
        name: currentUser.role_type,
        created_by: currentUser.created_by
      });
    }

    // ATTACH PERMISSIONS
    const permissions = role?.permissions || [];
    const allDataVisible = role?.all_data_visible || false;
    const allLeadVisible = role?.all_lead_visible || false;
    req.user = {
      ...currentUser.toObject(),
      permissions,
      allDataVisible,
      allLeadVisible
    };  

    // Ensure companyPhone/phone and companyName are available (fall back to parent admin for sub-users)
    if ((!req.user.companyPhone && !req.user.phone) || !req.user.companyName) {
      if (req.user.created_by) {
        try {
          const parentAdmin = await Client.findById(req.user.created_by).select('companyPhone companyName').lean()
            || await User.findById(req.user.created_by).select('companyPhone phone companyName').lean();
          if (parentAdmin) {
            if (!req.user.companyPhone && !req.user.phone) {
              req.user.companyPhone = parentAdmin.companyPhone || parentAdmin.phone || "";
              req.user.phone = req.user.companyPhone;
            }
            if (!req.user.companyName) {
              req.user.companyName = parentAdmin.companyName || "";
            }
          }
        } catch (e) {
          console.error("Error populating parent admin info in auth middleware:", e);
        }
      }
    }

    const getAdminId = (user) =>
      user.role_type === 'admin' ? user._id : user.created_by;

    req.adminId = getAdminId(currentUser);

    req.userType = decoded.type;

    // PRE-COMPUTE DIVISION SCOPE
    if (currentUser.role_type !== 'admin' && currentUser.role_type !== 'superadmin') {
      req.user.divisionScope = await buildDivisionVisibilityQuery(req.user, req.adminId, 'created_by_user');
      req.user.nestedDivisionScope = await buildDivisionVisibilityQuery(req.user, req.adminId, 'created_by_user', true);
    }

    next();

  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(401).json({ error: 'Token is not valid' });
  }
};

module.exports = auth;