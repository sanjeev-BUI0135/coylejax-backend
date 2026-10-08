const Client = require("../models/Client");
const User = require("../models/User")
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const Project = require("../models/Project");
const Estimate = require("../models/Estimate");
const Invoice = require("../models/Invoice");
const MaterialOrder = require("../models/MaterialOrder");
const Supplier = require("../models/Supplier");
const Customer = require("../models/Customer");
const InventoryItem = require("../models/InventoryItem");
const LaborEntry = require("../models/LaborEntry");
const Bid = require("../models/Bid");
const Lead = require("../models/Lead");
const Checklist = require("../models/Checklist");
const Reminder = require("../models/Reminder");
const Payment = require("../models/Payment");
const PaymentSettings = require("../models/PaymentSettings");
const StripeSession = require("../models/StripeSession");
const Role = require("../models/Role");
const MasterData = require("../models/MasterData");


const deleteByAllRefs = async (Model, match) => {
  await Model.deleteMany({
    $or: [
      { created_by: match },
      { created_by_user: match },
      { createdBy: match },
      { creatorId: match }
    ]
  });
};

exports.createClient = async (req, res) => {
  try {
    const data = { ...req.body };
    const normalizedEmail = data.email?.trim().toLowerCase();
    data.email = normalizedEmail;

    const existingUser = await User.findOne({ email: normalizedEmail });
    const existingClient = await Client.findOne({ email: normalizedEmail });

    if (existingUser || existingClient) {
      return res.status(400).json({
        error: "Email already exists in the system"
      });
    }

    if (data.project_number_config) {
      if (typeof data.project_number_config === "string") {
        data.project_number_config = JSON.parse(data.project_number_config);
      }
    }

    const newPrefix = data.project_number_config?.new_project?.prefix;
    const servicePrefix = data.project_number_config?.service_project?.prefix;

    const conditions = [];

    if (newPrefix) {
      conditions.push({
        "project_number_config.new_project.prefix": newPrefix
      });
    }

    if (servicePrefix) {
      conditions.push({
        "project_number_config.service_project.prefix": servicePrefix
      });
    }

    if (conditions.length > 0) {
      const prefixExistsUser = await User.findOne({ $or: conditions });
      const prefixExistsClient = await Client.findOne({ $or: conditions });

      if (prefixExistsUser || prefixExistsClient) {
        return res.status(400).json({
          error: "Project prefix already exists"
        });
      }
    }

    if (data.project_number_config) {
      if (typeof data.project_number_config === "string") {
        data.project_number_config = JSON.parse(data.project_number_config);
      }

      data.project_number_config = {
        new_project: {
          prefix: data.project_number_config.new_project.prefix,
          year: data.project_number_config.new_project.year,
          start_number: Number(
            data.project_number_config.new_project.start_number
          ),
          current_number: Number(
            data.project_number_config.new_project.start_number
          ),
          project_count: 0,
        },
        service_project: {
          prefix: data.project_number_config.service_project.prefix,
          year: data.project_number_config.service_project.year,
          start_number: Number(
            data.project_number_config.service_project.start_number
          ),
          current_number: Number(
            data.project_number_config.service_project.start_number
          ),
          project_count: 0,
        },
      };
    }

    if (req.file) {
      data.logo = `/uploads/client/${req.file.filename}`;
    }

    const client = new Client(data);
    await client.save();

    const obj = client.toObject();
    delete obj.password;

    res.status(201).json(obj);
  } catch (err) {
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern)[0];

      let message = "Duplicate value detected";

      if (field === "email") {
        message = "Email already exists";
      } else if (field.includes("prefix")) {
        message = "Project prefix already exists";
      }

      return res.status(400).json({ error: message });
    }

    res.status(500).json({ error: err.message });
  }

};


exports.getClients = async (req, res) => {
  try {
    const clients = await Client.find({ isDeleted: false });
    res.json(clients);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


exports.getClient = async (req, res) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client)
      return res.status(404).json({ error: "Client not found" });

    res.json(client);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateClient = async (req, res) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }
    const normalizedEmail = req.body.email?.trim().toLowerCase();

    if (normalizedEmail) {
      const existingUser = await User.findOne({ email: normalizedEmail });

      const existingClient = await Client.findOne({
        email: normalizedEmail,
        _id: { $ne: req.params.id }
      });

      if (existingUser || existingClient) {
        return res.status(400).json({
          error: "Email already exists in the system"
        });
      }

      req.body.email = normalizedEmail;
    }

    if (req.body.project_number_config) {
      if (typeof req.body.project_number_config === "string") {
        req.body.project_number_config = JSON.parse(
          req.body.project_number_config
        );
      }

      const prevNew = client.project_number_config.new_project;
      const prevService = client.project_number_config.service_project;

      const newProj = req.body.project_number_config.new_project;
      const serviceProj = req.body.project_number_config.service_project;

      newProj.start_number = Number(newProj.start_number);
      serviceProj.start_number = Number(serviceProj.start_number);

      const newPrefix = newProj.prefix;
      const servicePrefix = serviceProj.prefix;

      const conditions = [];

      // check only if changed
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
          $or: conditions
        });

        const prefixExistsClient = await Client.findOne({
          _id: { $ne: req.params.id },
          $or: conditions
        });

        if (prefixExistsUser || prefixExistsClient) {
          return res.status(400).json({
            error: "Project prefix already exists"
          });
        }
      }
      // Determine if the current user is an admin
      const isAdmin = req.user.role_type === 'admin' || req.user.role_type === 'superadmin';

      // For admins, allow all changes
      // For non-admins, only allow prefix changes
      const resetNew = isAdmin && (
        newProj.prefix !== prevNew.prefix ||
        newProj.year !== prevNew.year ||
        newProj.start_number !== prevNew.start_number
      );

      const resetService = isAdmin && (
        serviceProj.prefix !== prevService.prefix ||
        serviceProj.year !== prevService.year ||
        serviceProj.start_number !== prevService.start_number
      );

      client.project_number_config = {
        new_project: {
          ...prevNew,
          prefix: newProj.prefix, // Allow prefix change for all
          year: isAdmin ? newProj.year : prevNew.year, // Admin only
          start_number: isAdmin ? newProj.start_number : prevNew.start_number, // Admin only
          current_number: resetNew
            ? newProj.start_number
            : prevNew.current_number,
        },
        service_project: {
          ...prevService,
          prefix: serviceProj.prefix, // Allow prefix change for all
          year: isAdmin ? serviceProj.year : prevService.year, // Admin only
          start_number: isAdmin ? serviceProj.start_number : prevService.start_number, // Admin only
          current_number: resetService
            ? serviceProj.start_number
            : prevService.current_number,
        },
      };

      delete req.body.project_number_config;
    }

    Object.keys(req.body).forEach((key) => {
      if (key !== "password") {
        client[key] = req.body[key];
      }
    });

    if (typeof req.body.password === "string" && req.body.password.trim()) {
      client.password = req.body.password.trim();
    }

    if (req.file) {
      client.logo = `/uploads/client/${req.file.filename}`;
    }

    await client.save();

    const obj = client.toObject();
    delete obj.password;

    res.json(obj);
  } catch (err) {
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern)[0];

      let message = "Duplicate value detected";

      if (field === "email") {
        message = "Email already exists";
      } else if (field.includes("prefix")) {
        message = "Project prefix already exists";
      }

      return res.status(400).json({ error: message });
    }

    res.status(500).json({ error: err.message });
  }

};

exports.deleteClient = async (req, res) => {
  try {
    const clientId = req.params.id;
    const objectId = new mongoose.Types.ObjectId(clientId);
    const match = { $in: [clientId, objectId] };

    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    // Delete logo
    if (client.logo) {
      const filePath = path.join(__dirname, "..", client.logo);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    // 🔥 Delete all modules safely
    await deleteByAllRefs(Customer, match);
    await deleteByAllRefs(Project, match);
    await deleteByAllRefs(Estimate, match);
    await deleteByAllRefs(Invoice, match);
    await deleteByAllRefs(MaterialOrder, match);
    await deleteByAllRefs(Supplier, match);
    await deleteByAllRefs(InventoryItem, match);
    await deleteByAllRefs(LaborEntry, match);
    await deleteByAllRefs(Bid, match);
    await deleteByAllRefs(Lead, match);
    await deleteByAllRefs(Checklist, match);
    await deleteByAllRefs(Reminder, match);
    await deleteByAllRefs(Payment, match);
    await deleteByAllRefs(PaymentSettings, match);
    await deleteByAllRefs(StripeSession, match);
    await deleteByAllRefs(Role, match);
    await deleteByAllRefs(MasterData, match);

    // Users
    await deleteByAllRefs(User, match);

    // Finally delete client
    await Client.findByIdAndDelete(clientId);

    res.json({
      message: "Client and ALL related data permanently deleted successfully"
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


exports.checkPrefix = async (req, res) => {
  try {
    const { prefix, type, excludeId } = req.query;
    if (!prefix || !type) {
      return res.status(400).json({ error: "prefix and type are required" });
    }

    const field = type === "new"
      ? "project_number_config.new_project.prefix"
      : "project_number_config.service_project.prefix";

    const query = { [field]: prefix };

    const userMatch = await User.findOne(query);

    const clientQuery = excludeId
      ? { ...query, _id: { $ne: excludeId } }
      : query;
    const clientMatch = await Client.findOne(clientQuery);

    if (userMatch || clientMatch) {
      const label = type === "new" ? "New Project Prefix" : "Service Project Prefix";
      return res.status(200).json({ exists: true, message: `${label} already exists` });
    }

    return res.status(200).json({ exists: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
