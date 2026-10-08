const Role = require('../models/Role');

const getAdminId = (user) =>
  user.role_type === 'admin' ? user._id : user.created_by;

/* =========================
   SERVICE: GET ALL ROLES
========================= */
exports.getAllRolesService = async (req, res) => {
  try {
    const roles = await Role.find().sort({ createdAt: -1 });
    res.json(roles);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* =========================
   GET ROLES (ADMIN / SUBUSER)
========================= */
exports.getRoles = async (req, res) => {
  try {
    const adminId = getAdminId(req.user);

    const roles = await Role.find({
      created_by: adminId
    }).sort({ createdAt: -1 });

    res.json(roles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* =========================
   CREATE ROLE
========================= */
exports.createRole = async (req, res) => {
  try {
    const adminId = getAdminId(req.user);
    const { name, permissions = [], status = 'active', all_data_visible = false, all_lead_visible = false } = req.body;

    const existingRole = await Role.findOne({
      name: { $regex: new RegExp(`^${name}$`, 'i') },
      created_by: adminId
    });

    if (existingRole) {
      return res.status(400).json({
        error: `Role "${existingRole.name}" already exists`
      });
    }

    const role = new Role({
      name,
      permissions,
      status,
      all_data_visible,
      all_lead_visible,
      created_by: adminId
    });

    await role.save();
    res.status(201).json(role);

  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/* =========================
   GET SINGLE ROLE
========================= */
exports.getRoleById = async (req, res) => {
  try {
    const adminId = getAdminId(req.user);

    const role = await Role.findOne({
      _id: req.params.id,
      created_by: adminId
    });

    if (!role) {
      return res.status(404).json({
        error: 'Role not found or access denied'
      });
    }

    res.json(role);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* =========================
   UPDATE ROLE
========================= */
exports.updateRole = async (req, res) => {
  try {
    const adminId = getAdminId(req.user);
    const { name, permissions, status, all_data_visible, all_lead_visible } = req.body;

    const existingRole = await Role.findOne({
      name: { $regex: new RegExp(`^${name}$`, 'i') },
      created_by: adminId,
      _id: { $ne: req.params.id }
    });

    if (existingRole) {
      return res.status(400).json({
        error: `Role "${existingRole.name}" already exists`
      });
    }

    const role = await Role.findOneAndUpdate(
      { _id: req.params.id, created_by: adminId },
      {
        name,
        permissions,
        status,
        all_data_visible,
        all_lead_visible
      },
      { new: true, runValidators: true }
    );

    if (!role) {
      return res.status(404).json({
        error: 'Role not found or access denied'
      });
    }

    res.json(role);

  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/* =========================
   DELETE ROLE
========================= */
exports.deleteRole = async (req, res) => {
  try {
    const adminId = getAdminId(req.user);

    const role = await Role.findOneAndDelete({
      _id: req.params.id,
      created_by: adminId
    });

    if (!role) {
      return res.status(404).json({
        error: 'Role not found or access denied'
      });
    }

    res.json({
      message: 'Role deleted successfully',
      id: role._id
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};