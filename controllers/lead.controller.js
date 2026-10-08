const Lead = require("../models/Lead");
const Customer = require("../models/Customer");
const mongoose = require("mongoose");
const sendMail = require("../utils/sendMail");
const leadAssignedEmailTemplate = require("../utils/leadAssignedTemplate");
const User = require("../models/User");
const Client = require("../models/Client");
const { BillingPeriodInstance } = require("twilio/lib/rest/supersim/v1/sim/billingPeriod");
const MasterData = require("../models/MasterData");
const PaymentSettings = require("../models/PaymentSettings");

const escapeRegex = (text) => {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

/* same pattern you already use */
const getOwnerId = (req) => {
  if (req.user.role_type === "admin") {
    return new mongoose.Types.ObjectId(req.user._id);
  }
  return new mongoose.Types.ObjectId(req.user.created_by);
};

async function getDivisionName(value, createdBy) {
  if (!value) return "";

  const createdByStr = createdBy?.toString();

  const division = await MasterData.findOne({
    type: "divisions",
    value: value,
    status: "active",
    created_by: {
      $in: [
        createdByStr,
        new mongoose.Types.ObjectId(createdByStr)
      ]
    }
  }).lean();

  return division?.display_name || value;
}

const getCreatorUser = async (lead) => {
  if (!lead.created_by) return null;

  // First check User collection
  let creator = await User.findById(lead.created_by).lean();
  if (creator) return creator;

  // If not found, check Client collection
  creator = await Client.findById(lead.created_by).lean();
  return creator;
};



/* ---------------- CREATE LEAD ---------------- */
exports.createLead = async (req, res) => {
  try {
    const ownerId = getOwnerId(req);
    const loggedInUserId = req.user?._id || null;
    const lead = await Lead.create({
      ...req.body,
      created_by: ownerId,
      created_by_user: loggedInUserId
    });

    res.status(201).json(lead);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/* ---------------- GET LEADS ---------------- */
exports.getLeads = async (req, res) => {
  try {
    const ownerId = getOwnerId(req);

    const {
      page = 1,
      limit = 25,
      search = "",
      status = "all",
      created_by_user,
      assigned_to,
      company_name,
      customer_name,
      email,
      phone,
      division,
      lead_status,
      due_date,
      createdAt
    } = req.query;

    const query = {
      created_by: new mongoose.Types.ObjectId(ownerId),
    };

    if (req.query.includeConverted !== "true") {
      query.status = { $ne: "CONVERTED" };
    }

    if (status && status !== "all") {
      query.status = status;
    }
    if (req.user.role_type !== "admin" && !req.user.allLeadVisible) {
      if (req.user.project_type?.length) {
        query.division = { $in: req.user.project_type };
      }
    }
    if (created_by_user) {
      query.created_by_user = new mongoose.Types.ObjectId(created_by_user);
    }

    if (assigned_to) {
      query.assigned_to = new mongoose.Types.ObjectId(assigned_to);
    }

    if (lead_status) {
      query.lead_status = lead_status;
    }

    if (search) {
      const safeSearch = escapeRegex(search);
      const searchRegex = new RegExp(safeSearch, "i");

      const digits = search.replace(/\D/g, "");
      let phoneSearchQuery = searchRegex;
      if (digits.length > 0) {
        const phoneRegexPattern = digits.split("").map((digit) => `\\D*${digit}`).join("");
        phoneSearchQuery = new RegExp(phoneRegexPattern, "i");
      }

      query.$or = [
        { customer_name: searchRegex },
        { company_name: searchRegex },
        { phone: phoneSearchQuery },
        { email: searchRegex }
      ];
    }

    if (company_name) {
      query.company_name = new RegExp(escapeRegex(company_name), "i");
    }

    if (customer_name) {
      query.customer_name = new RegExp(escapeRegex(customer_name), "i");
    }

    if (email) {
      query.email = new RegExp(escapeRegex(email), "i");
    }

    if (phone) {
      const digits = phone.replace(/\D/g, "");
      if (digits.length > 0) {
        const phoneRegexPattern = digits.split("").map((digit) => `\\D*${digit}`).join("");
        query.phone = new RegExp(phoneRegexPattern, "i");
      } else {
        query.phone = new RegExp(escapeRegex(phone), "i");
      }
    }

    if (division) {
      query.division = new RegExp(escapeRegex(division), "i");
    }

    if (due_date) {
      const start = new Date(due_date);
      start.setHours(0, 0, 0, 0);

      const end = new Date(due_date);
      end.setHours(23, 59, 59, 999);

      query.due_date = {
        $gte: start,
        $lte: end
      };
    }

    if (createdAt) {
      const start = new Date(createdAt);
      start.setHours(0, 0, 0, 0);

      const end = new Date(createdAt);
      end.setHours(23, 59, 59, 999);

      query.createdAt = {
        $gte: start,
        $lte: end
      };
    }

    const total = await Lead.countDocuments(query);

    const leads = await Lead.find(query)
      .populate("assigned_to", "full_name email")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.json({
      data: leads,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit)
      }
    });

  } catch (err) {
    console.error("Get Leads Error:", err);
    res.status(500).json({ error: err.message });
  }
};

/* ---------------- ASSIGN LEAD TO USER ---------------- */
exports.assignLead = async (req, res) => {
  try {
    const { userId } = req.body;

    const lead = await Lead.findByIdAndUpdate(
      req.params.id,
      { assigned_to: userId },
      { new: true }
    ).populate("assigned_to", "full_name email");

    if (!lead) return res.status(404).json({ error: "Lead not found" });

    const creator = await getCreatorUser(lead);
    const divisionName = await getDivisionName(
      lead.division,
      lead.created_by
    );
    if (lead.assigned_to?.email) {
      const html = leadAssignedEmailTemplate(
        { ...lead, division_display: divisionName },
        lead.assigned_to,
        creator
      );

      try {
        await sendMail({
          from: creator?.companyName,
          to: lead.assigned_to.email,
          subject: "New Lead Assigned to You",
          html
        });
      } catch (mailErr) {
        console.error("Email failed:", mailErr.message);
      }
    }

    res.json(lead);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/* ---------------- CONVERT LEAD TO CUSTOMER ---------------- */
exports.convertLeadToCustomer = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);

    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    /* ---------------- PERMISSION CHECK ---------------- */
    const isAdmin = req.user.role_type === "admin" || req.user.allLeadVisible;
    const isAssignedUser =
      lead.assigned_to &&
      lead.assigned_to.toString() === req.user._id.toString();
    const permissions = req.user.permissions || [];
    const hasAllLeads = permissions.some(
      p => p.module?.toLowerCase() === "leads" &&
        p.submenu_module?.toLowerCase() === "allleads" &&
        p.canView
    );
    if (!isAdmin && !isAssignedUser && !hasAllLeads) {
      return res.status(403).json({
        error: "Only admin or leads all permissions user or assigned user can convert this lead"
      });
    }

    if (lead.status === "CONVERTED") {
      return res.status(400).json({ error: "Already converted" });
    }

    /* -------- CHECK EXISTING CUSTOMER -------- */

    let customer = await Customer.findOne({
      created_by: lead.created_by,
      $or: [
        { email: lead.email },
      ]
    });

    if (customer) {

      /* -------- UPDATE EXISTING CUSTOMER -------- */

      customer.company_name = lead.company_name || customer.company_name;
      customer.contact_name = lead.customer_name || customer.contact_name;
      customer.phone = lead.phone || customer.phone;
      customer.address = lead.billing_address || lead.site_address || customer.address;
      customer.billing_information = lead.notes || customer.billing_information;
      customer.division = lead.division || customer.division;

      await customer.save();

    } else {

      /* -------- CREATE NEW CUSTOMER -------- */

      customer = new Customer({
        company_name: lead.company_name || lead.customer_name,
        contact_name: lead.customer_name,
        email: lead.email,
        phone: lead.phone,
        address: lead.billing_address || lead.site_address,
        customer_type: "commercial",
        billing_information: lead.notes,
        division: lead.division,
        created_by: lead.created_by
      });

      await customer.save();
    }

    /* -------- MARK LEAD CONVERTED -------- */

    lead.status = "CONVERTED";
    await lead.save();

    /* -------- TRANSFER TAX EXEMPT STATUS -------- */
    if (customer && customer._id) {
      await PaymentSettings.updateMany(
        { taxExemptLeads: lead._id },
        { 
          $pull: { taxExemptLeads: lead._id },
          $addToSet: { taxExemptCustomers: customer._id }
        }
      );
    }

    res.json({
      message: "Lead converted successfully",
      customer,
      lead
    });

  } catch (err) {
    console.error("Convert lead error:", err);
    res.status(500).json({ error: err.message });
  }
};

/* ---------------- UPDATE LEAD ---------------- */
exports.updateLead = async (req, res) => {
  try {
    const ownerId = getOwnerId(req);

    const lead = await Lead.findOneAndUpdate(
      {
        _id: req.params.id,
        created_by: ownerId
      },
      {
        $set: {
          ...req.body
        }
      },
      {
        new: true,
        runValidators: true
      }
    ).populate("assigned_to", "full_name email");

    if (!lead) {
      return res.status(404).json({ error: "Lead not found or not authorized" });
    }

    res.json(lead);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/* ---------------- DELETE LEAD ---------------- */
exports.deleteLead = async (req, res) => {
  try {
    const ownerId = getOwnerId(req);

    const lead = await Lead.findOneAndDelete({
      _id: req.params.id,
      created_by: ownerId
    });

    if (!lead) {
      return res.status(404).json({ error: "Lead not found or not authorized" });
    }

    res.json({
      message: "Lead deleted successfully",
      lead
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/* ---------------- BULK DELETE LEADS ---------------- */
exports.bulkDeleteLeads = async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "No leads selected" });
    }

    const ownerId = getOwnerId(req);

    const result = await Lead.deleteMany({
      _id: { $in: ids },
      created_by: { $in: [ownerId, ownerId.toString()] }
    });

    res.json({
      success: true,
      deleted: result.deletedCount
    });
  } catch (err) {
    console.error("Bulk delete leads error:", err);
    res.status(500).json({ error: "Bulk delete failed" });
  }
};

exports.getLeadStats = async (req, res) => {
  try {
    const ownerId = getOwnerId(req);

    const userId = new mongoose.Types.ObjectId(req.user._id);
    const ownerObjectId = new mongoose.Types.ObjectId(ownerId);

    const permissions = req.user.permissions || [];
    const hasAllLeads = permissions.some(
      p => p.module?.toLowerCase() === "leads" &&
        p.submenu_module?.toLowerCase() === "allleads" &&
        p.canView
    );

    const hasAssignedLeads = permissions.some(
      p => p.module?.toLowerCase() === "leads" &&
        p.submenu_module?.toLowerCase() === "assignedleads" &&
        p.canView
    );

    // const now = new Date();
    // const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // const startOfWeek = new Date(now);
    // startOfWeek.setDate(now.getDate() - now.getDay());

    let baseQuery = {};

   if (req.user.role_type === "admin" || req.user.allLeadVisible) {
      baseQuery.created_by = ownerObjectId;
    }
    else if (hasAssignedLeads && !hasAllLeads) {
      baseQuery.assigned_to = userId;
      if (req.user.project_type?.length) {
        baseQuery.division = { $in: req.user.project_type };
      }
    }
    else if (hasAllLeads && !hasAssignedLeads) {
      baseQuery.created_by = ownerObjectId;

      if (req.user.project_type?.length) {
        baseQuery.division = { $in: req.user.project_type };
      }
    }
    else if (hasAllLeads && hasAssignedLeads) {
      baseQuery.$or = [
        { assigned_to: userId },
        {
          created_by: ownerObjectId,
          ...(req.user.project_type?.length && {
            division: { $in: req.user.project_type }
          })
        }
      ];
    }

    let assignedQuery = {};

   if (req.user.role_type === "admin" || req.user.allLeadVisible) {
      assignedQuery = {
        assigned_to: { $ne: null },
        status: { $ne: "CONVERTED" }
      };
    } else {
      assignedQuery = {
        assigned_to: userId,
        status: { $ne: "CONVERTED" }
      };
    }

    let unassignedQuery = {
      $and: [
        {
          $or: [
            { assigned_to: null },
            { assigned_to: { $exists: false } }
          ]
        },
        {
          status: { $ne: "CONVERTED" }
        }
      ]
    };

    const totalLeads = await Lead.countDocuments({
      ...baseQuery,
      // createdAt: { $gte: startOfMonth }
    });

    const assigned = await Lead.countDocuments({
      $and: [
        baseQuery,
        assignedQuery
      ]
      // createdAt: { $gte: startOfWeek }
    });

    const unassigned = await Lead.countDocuments({
      $and: [
        baseQuery,
        unassignedQuery
      ]
      // createdAt: { $gte: startOfMonth }
    });

    const converted = await Lead.countDocuments({
      ...baseQuery,
      status: "CONVERTED",
      // createdAt: { $gte: startOfMonth }
    });

    res.json({
      totalLeads,
      // newLeads,
      assigned,
      unassigned,
      converted
    });

  } catch (err) {
    console.error("Stats error:", err);
    res.status(500).json({ error: err.message });
  }
};

exports.getLeadSourceStats = async (req, res) => {
  try {
    const ownerId = getOwnerId(req);

    const userId = new mongoose.Types.ObjectId(req.user._id);
    const ownerObjectId = new mongoose.Types.ObjectId(ownerId);

    const permissions = req.user.permissions || [];

    const hasAllLeads = permissions.some(
      p => p.module?.toLowerCase() === "leads" &&
        p.submenu_module?.toLowerCase() === "allleads" &&
        p.canView
    );

    const hasAssignedLeads = permissions.some(
      p => p.module?.toLowerCase() === "leads" &&
        p.submenu_module?.toLowerCase() === "assignedleads" &&
        p.canView
    );

    let matchStage = {};

    const { from, to, division } = req.query;

    if (from || to) {
      matchStage.createdAt = {};

      if (from) {
        matchStage.createdAt.$gte = new Date(from);
      }

      if (to) {
        matchStage.createdAt.$lte = new Date(to);
      }
    }
    if (division && division !== "all") {
      matchStage.division = division;
    }

    if (req.user.role_type === "admin" || req.user.allLeadVisible) {
      matchStage.created_by = ownerObjectId;
    }
    else if (hasAssignedLeads && !hasAllLeads) {
      matchStage.assigned_to = userId;
      if (req.user.project_type?.length) {
        matchStage.division = { $in: req.user.project_type };
      }
    }
    else if (hasAllLeads && !hasAssignedLeads) {
      matchStage.created_by = ownerObjectId;

      if (req.user.project_type?.length) {
        matchStage.division = { $in: req.user.project_type };
      }
    }
    else if (hasAllLeads && hasAssignedLeads) {
      matchStage.$or = [
        { assigned_to: userId },
        {
          created_by: ownerObjectId,
          ...(req.user.project_type?.length && {
            division: { $in: req.user.project_type }
          })
        }
      ];
    }

    const data = await Lead.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: "$lead_source",
          count: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: "masterdatas",
          let: { value: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$value", "$$value"] },
                    { $eq: ["$created_by", ownerObjectId] },
                    { $eq: ["$type", "lead_source"] }
                  ]
                }
              }
            },
            { $limit: 1 }
          ],
          as: "source"
        }
      },
      {
        $unwind: {
          path: "$source",
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $project: {
          _id: 0,
          value: "$_id",
          name: "$source.display_name",
          count: 1
        }
      }
    ]);

    res.json(data);
  } catch (err) {
    console.error("Source stats error:", err);
    res.status(500).json({ error: err.message });
  }
};
