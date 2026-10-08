const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Client = require('../models/Client')
const auth = require('../middleware/auth');
const { createIdQuery } = require('../utils/idHelper');
const Role = require('../models/Role');
const { forgotPassword, resetPassword } = require('../controllers/AuthController');
const mongoose = require('mongoose');


const getOwnerId = (req) => {
  if (req.user.role_type === "admin") {
    return req.user._id.toString();
  }
  return req.user.created_by.toString();
};

router.post('/register', async (req, res) => {
  try {
    const {
      full_name,
      email,
      password,
      role_type,
      hourly_rate,
      project_type,
      project_type_name,
      created_by,
      project_number_config,
      phone
    } = req.body;

    const existingUser = await User.findOne({ email });
    const existingClient = await Client.findOne({ email });
    if (existingUser || existingClient) {
      return res.status(400).json({ error: 'Email already exists in the system' });
    }

    if (role_type !== "Bid User") {

      // 1. Required validation
      if (
        !project_number_config?.new_project ||
        !project_number_config?.service_project
      ) {
        return res.status(400).json({
          error: "Both New Project & Service Project config required"
        });
      }

      const newPrefix = project_number_config.new_project.prefix;
      const servicePrefix = project_number_config.service_project.prefix;

      // 3. Prefix uniqueness check
      const conditions = [
        { "project_number_config.new_project.prefix": newPrefix },
        { "project_number_config.service_project.prefix": servicePrefix }
      ];

      const prefixExistsUser = await User.findOne({ $or: conditions });
      const prefixExistsClient = await Client.findOne({ $or: conditions });

      if (prefixExistsUser || prefixExistsClient) {
        const foundUser = prefixExistsUser || prefixExistsClient;
        let conflict = newPrefix;
        if (
          foundUser.project_number_config?.new_project?.prefix === newPrefix ||
          foundUser.project_number_config?.service_project?.prefix === newPrefix
        ) {
           conflict = newPrefix;
        } else if (
          foundUser.project_number_config?.new_project?.prefix === servicePrefix ||
          foundUser.project_number_config?.service_project?.prefix === servicePrefix
        ) {
           conflict = servicePrefix;
        }
        return res.status(400).json({
          error: `Project prefix '${conflict}' already exists`
        });
      }
    }

    const userData = {
      full_name,
      email,
      password,
      role_type: role_type || 'field_employee',
      hourly_rate: hourly_rate || 0,
      project_type,
      project_type_name,
      created_by,
      phone
    };

    if (role_type !== "Bid User") {
      userData.project_number_config = {
        new_project: {
          prefix: project_number_config.new_project.prefix,
          year: project_number_config.new_project.year,
          start_number: Number(project_number_config.new_project.start_number),
          current_number: Number(project_number_config.new_project.start_number),
          project_count: 0
        },
        service_project: {
          prefix: project_number_config.service_project.prefix,
          year: project_number_config.service_project.year,
          start_number: Number(project_number_config.service_project.start_number),
          current_number: Number(project_number_config.service_project.start_number),
          project_count: 0
        }
      };
    }

    const user = new User(userData);
    await user.save();

    res.status(201).json({ message: 'User created successfully' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    let user = await User.findOne({ email });
    if (user) {
      const isMatch = await user.comparePassword(password);
      if (!isMatch)
        return res.status(401).json({ error: "Invalid credentials" });

      let rolePermissions = [];
      let role = null;
      if (user.roleId) {
        role = await Role.findById(user.roleId);
      } else {
        role = await Role.findOne({ name: user.role_type, created_by: user.created_by });
      }

      if (role) rolePermissions = role.permissions;

      const token = jwt.sign(
        { id: user._id, type: "user" },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );

      return res.json({
        token,
        type: "user",
        user: {
          id: user._id,
          full_name: user.full_name,
          email: user.email,
          role_type: user.role_type,
          permissions: rolePermissions,
          created_by: user.created_by,
          project_number_config: user.project_number_config,
          project_type:user.project_type,
          all_data_visible: role?.all_data_visible,
          all_lead_visible: role?.all_lead_visible
        },
      });
    }

    let client = await Client.findOne({ email, isDeleted: false });

    if (client) {
      if (client.status === 'inactive') {
        return res.status(403).json({
          error: "Your account is inactive. Please contact administrator."
        });
      }

      const isMatch = await client.comparePassword(password);
      if (!isMatch)
        return res.status(401).json({ error: "Invalid credentials" });

      const token = jwt.sign(
        { id: client._id, type: "client" },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );

      let rolePermissions = [];
      let role = null;
      if (client.roleId) {
        role = await Role.findById(client.roleId);
      } else if (client.role_type) {
        role = await Role.findOne({ name: client.role_type });
      }

      if (role) rolePermissions = role.permissions || [];

      return res.json({
        token,
        type: "client",
        user: {
          id: client._id,
          full_name: `${client.firstName} ${client.lastName}`,
          email: client.email,
          role_type: client.role_type,
          permissions: rolePermissions,
          project_number_config: client.project_number_config
        },
      });
    }

    return res.status(404).json({ error: "Account not found" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/me', auth, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(404).json({ error: 'Account not found' });
    }

    // Convert Mongoose document to plain object
    const responseData = req.user.toObject
      ? req.user.toObject()
      : { ...req.user }; // fallback if already plain object

    // Normalize id fields
    responseData.id = req.user._id.toString();
    responseData._id = req.user._id;

    res.json(responseData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all users (admin only)
router.get('/', auth, async (req, res) => {
  try {
    const ownerId = getOwnerId(req);
    let ownerIdObj;
    try {
      ownerIdObj = new mongoose.Types.ObjectId(ownerId);
    } catch (e) {
      ownerIdObj = ownerId; // Fallback if invalid ObjectId format
    }
    
    const users = await User.find({ 
      $or: [
        { created_by: ownerId },
        { created_by: ownerIdObj }
      ]
    }).select('-password').sort({ createdAt: -1 });
    
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/:id", auth, async (req, res) => {
  try {
    const paramId = req.params.id;

    let result = await User.findById(paramId).select("-password");

    if (!result) {
      result = await Client.findById(paramId).select("-password");
    }

    if (!result) {
      return res.json({ _id: paramId, id: paramId, full_name: "—", isDeleted: true });
    }

    res.json(result);
  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({ error: error.message });
  }
});


// Update user
router.put('/:id', auth, async (req, res) => {
  try {
    const {
      full_name,
      email,
      hourly_rate,
      role_type,
      leads_assigned,
      project_type,
      project_type_name,
      project_number_config,
      password,
      phone,
      text_notifications
    } = req.body;

    const existingUser = await User.findById(req.params.id);
    if (!existingUser) return res.status(404).json({ error: "User not found" });
    // Email duplicate check (exclude current user)
    if (email) {
      const emailExistsUser = await User.findOne({
        email,
        _id: { $ne: req.params.id }
      });

      const emailExistsClient = await Client.findOne({ email });

      if (emailExistsUser || emailExistsClient) {
        return res.status(400).json({
          error: "Email already exists in the system"
        });
      }
    }

    const updateData = {
      full_name,
      email,
      hourly_rate,
      role_type,
      leads_assigned,
      project_type,
      project_type_name,
      phone,
      text_notifications
    };

    if (password?.trim()) {
      const salt = await bcrypt.genSalt(10);
      updateData.password = await bcrypt.hash(password, salt);
    }

    if (project_number_config) {
      const prevConfig = existingUser.project_number_config || {};
      const prevNew = prevConfig.new_project || {};
      const prevService = prevConfig.service_project || {};

      const newProj = project_number_config.new_project || {};
      const serviceProj = project_number_config.service_project || {};
      // Prefix validation
      const newPrefix = newProj.prefix;
      const servicePrefix = serviceProj.prefix;

      // Build conditions
      const conditions = [];

      if (newPrefix && newPrefix !== prevNew.prefix) {
        conditions.push({
          "project_number_config.new_project.prefix": newPrefix
        });
      }

      if (servicePrefix && servicePrefix !== prevService.prefix) {
        conditions.push({
          "project_number_config.service_project.prefix": servicePrefix
        });
      }

      if (conditions.length > 0) {
        const prefixExistsUser = await User.findOne({
          _id: { $ne: req.params.id },
          $or: conditions
        });

        const prefixExistsClient = await Client.findOne({
          $or: conditions
        });

        if (prefixExistsUser || prefixExistsClient) {
          const foundUser = prefixExistsUser || prefixExistsClient;
          let conflict = newPrefix || servicePrefix || 'Unknown';
          if (newPrefix && (
            foundUser.project_number_config?.new_project?.prefix === newPrefix ||
            foundUser.project_number_config?.service_project?.prefix === newPrefix
          )) {
             conflict = newPrefix;
          } else if (servicePrefix && (
            foundUser.project_number_config?.new_project?.prefix === servicePrefix ||
            foundUser.project_number_config?.service_project?.prefix === servicePrefix
          )) {
             conflict = servicePrefix;
          }
          return res.status(400).json({
            error: `Project prefix '${conflict}' already exists`
          });
        }
      }

      const updateOps = {};

      // Determine if the current user is an admin
      const isAdmin = req.user.role_type === 'admin' || req.user.role_type === 'superadmin';

      // NEW PROJECT
      // Allow prefix changes for all users
      if (newProj.prefix !== undefined && newProj.prefix !== prevNew.prefix)
        updateOps["project_number_config.new_project.prefix"] = newProj.prefix;

      // Only allow admins to change year and start_number
      if (isAdmin) {
        if (newProj.year !== undefined && newProj.year !== prevNew.year)
          updateOps["project_number_config.new_project.year"] = newProj.year;

        if (
          newProj.start_number !== undefined &&
          Number(newProj.start_number) !== Number(prevNew.start_number)
        ) {
          updateOps["project_number_config.new_project.start_number"] =
            Number(newProj.start_number);
          updateOps["project_number_config.new_project.current_number"] =
            Number(newProj.start_number);
        }
      }

      // Ensure project_count exists
      if (prevNew.project_count === undefined) {
        updateOps["project_number_config.new_project.project_count"] = 0;
      }

      // SERVICE PROJECT
      // Allow prefix changes for all users
      if (serviceProj.prefix !== undefined && serviceProj.prefix !== prevService.prefix)
        updateOps["project_number_config.service_project.prefix"] = serviceProj.prefix;

      // Only allow admins to change year and start_number
      if (isAdmin) {
        if (serviceProj.year !== undefined && serviceProj.year !== prevService.year)
          updateOps["project_number_config.service_project.year"] = serviceProj.year;

        if (
          serviceProj.start_number !== undefined &&
          Number(serviceProj.start_number) !== Number(prevService.start_number)
        ) {
          updateOps["project_number_config.service_project.start_number"] =
            Number(serviceProj.start_number);
          updateOps["project_number_config.service_project.current_number"] =
            Number(serviceProj.start_number);
        }
      }

      if (prevService.project_count === undefined) {
        updateOps["project_number_config.service_project.project_count"] = 0;
      }

      Object.assign(updateData, updateOps);
    }
    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select('-password');

    res.json(updatedUser);
  } catch (error) {
    console.error("User update error:", error);
    if (error.code === 11000) {
      const duplicateKey = Object.keys(error.keyValue || {})[0] || '';
      const duplicateVal = Object.values(error.keyValue || {})[0] || 'Unknown';
      if (duplicateKey.includes('email')) {
         return res.status(400).json({ error: "Email already exists in the system" });
      }
      return res.status(400).json({
        error: `Project prefix '${duplicateVal}' already exists`
      });
    }
    res.status(400).json({ error: error.message });
  }
});

// Delete user
router.delete('/:id', auth, async (req, res) => {
  try {
    const deletedUser = await User.findByIdAndDelete(req.params.id);

    if (!deletedUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User deleted successfully', id: deletedUser._id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/me/permissions', auth, async (req, res) => {
  try {
    // prefer req.user.roleId (if token has it), else fallback to role_type mapping
    const roleId = req.user.roleId;
    let role = null;
    if (roleId) role = await Role.findById(roleId);
    else {
      // optional fallback: find role by name using req.user.role_type
      role = await Role.findOne({ name: req.user.role_type });
    }
    if (!role) return res.json({ modules: [] });

    // send array or normalized map
    const modules = role.permissions.map(p => ({
      module: p.module,
      canView: p.canView,
      canAdd: p.canAdd,
      canUpdate: p.canUpdate,
      canDelete: p.canDelete
    }));
    res.json({ modules, roleId: role._id, roleName: role.name });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post("/forgotPassword", forgotPassword);

router.post("/resetPassword", resetPassword);

module.exports = router;
