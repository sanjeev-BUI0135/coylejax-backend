// middleware/permissions.js
const User = require('../models/User');

// Middleware to check if user has permission for specific module and action
const checkPermission = (module, action) => {
  return async (req, res, next) => {
    try {
      const user = await User.findById(req.user.id);
      
      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }

      // Admin has all permissions
      if (user.role_type === 'admin') {
        return next();
      }

      // Check if user has the required permission
      const hasPermission = user.hasPermissionFor(module, action);
      
      if (!hasPermission) {
        return res.status(403).json({ 
          error: 'Access denied', 
          message: `You don't have ${action} permission for ${module}` 
        });
      }

      next();
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };
};

// Middleware to check if user can access any of the specified modules
const checkAnyPermission = (modules, action) => {
  return async (req, res, next) => {
    try {
      const user = await User.findById(req.user.id);
      
      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }

      // Admin has all permissions
      if (user.role_type === 'admin') {
        return next();
      }

      // Check if user has permission for any of the modules
      const hasAnyPermission = modules.some(module => 
        user.hasPermissionFor(module, action)
      );
      
      if (!hasAnyPermission) {
        return res.status(403).json({ 
          error: 'Access denied', 
          message: `You don't have ${action} permission for any of the required modules` 
        });
      }

      next();
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };
};

// Middleware to check role-based access
const checkRole = (allowedRoles) => {
  return async (req, res, next) => {
    try {
      const user = await User.findById(req.user.id);
      
      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }

      if (!allowedRoles.includes(user.role_type)) {
        return res.status(403).json({ 
          error: 'Access denied', 
          message: `This action requires one of the following roles: ${allowedRoles.join(', ')}` 
        });
      }

      next();
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };
};

// Helper function to get user permissions for frontend
const getUserPermissions = async (userId) => {
  try {
    const user = await User.findById(userId);
    if (!user) return null;

    // If admin, return all permissions
    if (user.role_type === 'admin') {
      const modules = [
        'dashboard',
        'projects', 
        'estimates',
        'material_orders',
        'inventory_management',
        'customers',
        'invoices',
        'time_entry',
        'user_management'
      ];

      return modules.map(module => ({
        module,
        permissions: {
          delete: true,
          update: true,
          add: true,
          view: true
        }
      }));
    }

    return user.permissions;
  } catch (error) {
    console.error('Error getting user permissions:', error);
    return null;
  }
};

// Helper function to check if user has specific permission
const hasPermission = async (userId, module, action) => {
  try {
    const user = await User.findById(userId);
    if (!user) return false;
    
    return user.hasPermissionFor(module, action);
  } catch (error) {
    console.error('Error checking permission:', error);
    return false;
  }
};

// Middleware to add user permissions to request object
const attachUserPermissions = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    req.userPermissions = user.permissions;
    req.userRole = user.role_type;
    next();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  checkPermission,
  checkAnyPermission,
  checkRole,
  getUserPermissions,
  hasPermission,
  attachUserPermissions
};
