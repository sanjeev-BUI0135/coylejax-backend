const Role = require('../models/Role');

function checkPermission(moduleName, action) {
  return async (req, res, next) => {
    try {
      const roleId = req.user.roleId;
      let role = null;
      if (roleId) role = await Role.findById(roleId);
      else role = await Role.findOne({ name: req.user.role_type });

      if (!role) return res.status(403).json({ error: 'Role not assigned' });

      const perm = role.permissions.find(p => p.module === moduleName);
      if (!perm) return res.status(403).json({ error: 'No permission for module' });

      const ok =
        (action === 'view' && perm.canView) ||
        (action === 'add' && perm.canAdd) ||
        (action === 'update' && perm.canUpdate) ||
        (action === 'delete' && perm.canDelete);

      if (!ok) return res.status(403).json({ error: 'Forbidden' });

      next();
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
}

module.exports = checkPermission;
