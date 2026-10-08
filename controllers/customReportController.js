const CustomReport = require('../models/CustomReport');
const Project = require('../models/Project');
const Estimate = require('../models/Estimate');
const Invoice = require('../models/Invoice');
const User = require('../models/User');
const MasterData = require('../models/MasterData');
const MaterialOrder = require('../models/MaterialOrder');
const Client = require('../models/Client');
const Customer = require('../models/Customer');
const CustomReportLog = require('../models/CustomReportLog');
const nodemailer = require('nodemailer');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const applyScope = require('../helpers/applyScope');

const getOwnerId = (req) => {
  let ownerId;

  if (req.user.role_type === "admin") {
    ownerId = req.user._id;
  } else {
    ownerId = req.user.created_by;
  }

  if (typeof ownerId === "object" && ownerId !== null) {
    return ownerId._id || ownerId.value || ownerId.toString();
  }

  return ownerId;
};

const customReportController = {
  getAll: async (req, res) => {
    try {
      const ownerId = getOwnerId(req);
      const ownerIdString = ownerId.toString();

      const reports = await CustomReport.find(applyScope(req)).sort('-createdAt').lean();

      const userIds = [...new Set(reports.map(r => r.created_by_user).filter(Boolean))];
      const users = await User.find({ _id: { $in: userIds } }).select('full_name').lean();
      const clients = await Client.find({ _id: { $in: userIds } }).select('firstName lastName').lean();

      const nameMap = {};
      users.forEach(u => nameMap[u._id.toString()] = u.full_name);
      clients.forEach(c => nameMap[c._id.toString()] = `${c.firstName} ${c.lastName}`);

      const reportsWithNames = reports.map(r => ({
        ...r,
        created_by_name:
          nameMap[r.created_by_user?.toString()] ||
          r.created_by_name ||
          "Admin"
      }));

      res.json(reportsWithNames);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  getById: async (req, res) => {
    try {
      const ownerId = getOwnerId(req);
      const report = await CustomReport.findById(req.params.id).lean();
      if (!report) return res.status(404).json({ error: 'Report not found' });

      if (report.created_by_user) {
        const creatorUser = await User.findById(report.created_by_user).select('full_name').lean();
        if (creatorUser) {
          report.created_by_name = creatorUser.full_name;
        } else {
          const creatorClient = await Client.findById(report.created_by_user).select('firstName lastName').lean();
          if (creatorClient) {
            report.created_by_name = `${creatorClient.firstName} ${creatorClient.lastName}`;
          }
        }
      }

      res.json(report);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    try {
      const ownerId = getOwnerId(req);
      const report = new CustomReport({
        ...req.body,
        created_by: ownerId,
        created_by_user: req.user._id,
        // created_by_name: req.user.full_name || `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || 'Admin'
      });
      await report.save();
      // await customReportController.runReport(report._id);
      res.status(201).json(report);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },

  update: async (req, res) => {
    try {
      const updateData = {
        ...req.body,
        last_run: null
      };

      const report = await CustomReport.findByIdAndUpdate(
        req.params.id,
        updateData,
        { new: true }
      );

      if (!report) {
        return res.status(404).json({ error: 'Report not found' });
      }

      res.json(report);

    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },

  delete: async (req, res) => {
    try {
      await CustomReport.findByIdAndDelete(req.params.id);
      await CustomReportLog.deleteMany({ report_id: req.params.id });
      res.json({ message: 'Report deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  getHistory: async (req, res) => {
    try {
      const logs = await CustomReportLog.find({ report_id: req.params.id })
        .sort('-execution_date')
        .limit(50);
      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  runNow: async (req, res) => {
    try {
      const reportId = req.params.id;
      const report = await CustomReport.findById(reportId);
      if (!report) return res.status(404).json({ error: 'Report not found' });
      await customReportController.runReport(reportId, req);

      res.json({ message: 'Report execution triggered successfully' });
    } catch (error) {
      console.error('Error in runNow:', error);
      res.status(500).json({ error: error.message });
    }
  },

  applyProjectTypeFilter: async (query, reportType, req = null, adminId = null) => {
    const finalQuery = { ...query };
    if (
      finalQuery.project_type &&
      (reportType === "Estimate" || reportType === "Invoice")
    ) {

      const projectFilter = finalQuery.project_type;

      let projectQuery = { project_type: projectFilter };

      if (req) {
        projectQuery = applyScope(req, projectQuery);
      } else if (adminId) {
        const adminObjectId = mongoose.Types.ObjectId.isValid(adminId)
          ? new mongoose.Types.ObjectId(adminId)
          : adminId;
        projectQuery = {
          ...projectQuery,
          $or: [
            { created_by: adminObjectId },
            { created_by: adminId.toString() }
          ]
        };
      }

      const projects = await Project.find(projectQuery).select("_id");

      finalQuery.project_id = {
        $in: projects.map(p => p._id)
      };

      delete finalQuery.project_type;
    }

    return finalQuery;
  },

  getData: async (req, res) => {
    try {

      const report = await CustomReport.findById(req.params.id);
      if (!report) {
        return res.status(404).json({
          error: 'Report not found'
        });
      }

      const { search, customer, status, created_by, startDate, endDate, page = 1, limit = 10, sortBy, sortOrder } = req.query;
      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const skip = (pageNum - 1) * limitNum;

      // Handle sorting
      let sortObj = { createdAt: -1 }; // default
      if (sortBy) {
        sortObj = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };
      }

      let query = await buildQuery(report.filters);

      // Merge runtime filters into query using $and to avoid conflicts
      const runtimeFilters = [];

      if (status && status !== 'all') {
        runtimeFilters.push({ status: { $regex: new RegExp(`^${status}$`, 'i') } });
      }

      if (created_by && created_by !== 'all') {
        const user = await User.findOne({
          $or: [
            { full_name: created_by },
            { _id: mongoose.Types.ObjectId.isValid(created_by) ? created_by : null }
          ]
        }).select('_id');
        if (user) runtimeFilters.push({ created_by_user: user._id });
      }

      if (startDate || endDate) {
        const dateRange = {};
        if (startDate) dateRange.$gte = new Date(startDate);
        if (endDate) dateRange.$lte = new Date(endDate + (endDate.includes('T') ? '' : "T23:59:59"));
        runtimeFilters.push({ createdAt: dateRange });
      }

      if (customer && customer !== 'all') {
        const matchingCustomers = await Customer.find({
          company_name: { $regex: customer, $options: 'i' }
        }).select('_id');
        const customerIds = matchingCustomers.map(c => c._id);

        if (report.report_type === 'Project') {
          runtimeFilters.push({ customer_ids: { $in: customerIds } });
        } else {
          const projects = await Project.find({ customer_ids: { $in: customerIds } }).select('_id');
          runtimeFilters.push({ project_id: { $in: projects.map(p => p._id) } });
        }
      }

      if (search) {
        // Search across names, numbers, and also company names
        const matchingCustomers = await Customer.find({
          company_name: { $regex: search, $options: 'i' }
        }).select('_id');
        const customerIds = matchingCustomers.map(c => c._id);

        const projectSearchOr = [
          { project_name: { $regex: search, $options: 'i' } },
          { project_number: { $regex: search, $options: 'i' } },
          { customer_ids: { $in: customerIds } }
        ];
        const matchingProjects = await Project.find({ $or: projectSearchOr }).select('_id');
        const projectIds = matchingProjects.map(p => p._id);

        const searchOr = [
          { project_name: { $regex: search, $options: 'i' } },
          { project_number: { $regex: search, $options: 'i' } },
          { estimate_number: { $regex: search, $options: 'i' } },
          { invoice_number: { $regex: search, $options: 'i' } },
        ];

        if (report.report_type === 'Project') {
          searchOr.push({ customer_ids: { $in: customerIds } });
        } else {
          searchOr.push({ project_id: { $in: projectIds } });
        }

        runtimeFilters.push({ $or: searchOr });
      }

      if (runtimeFilters.length > 0) {
        query = { $and: [query, ...runtimeFilters] };
      }

      // Handle column-specific filters from frontend
      if (req.query.colFilters) {
        try {
          const colFilters = JSON.parse(req.query.colFilters);
          const colRuntimeFilters = [];

          for (const [field, value] of Object.entries(colFilters)) {
            if (!value) continue;

            let dbField = field;
            if (field === 'install_date') dbField = 'estimated_start_date';
            if (field === 'completion_date') dbField = 'estimated_end_date';

            // Handle date fields
            if (dbField.includes('date') || dbField === 'createdAt') {
              const d = new Date(value);
              if (!isNaN(d)) {
                const startOfDay = new Date(d);
                startOfDay.setHours(0, 0, 0, 0);
                const endOfDay = new Date(d);
                endOfDay.setHours(23, 59, 59, 999);
                const dateFilter = { $gte: startOfDay, $lte: endOfDay };

                if ((dbField === 'estimated_start_date' || dbField === 'estimated_end_date') && report.report_type !== 'Project') {
                  const projects = await Project.find({ [dbField]: dateFilter }).select('_id');
                  colRuntimeFilters.push({ project_id: { $in: projects.map(p => p._id) } });
                } else {
                  colRuntimeFilters.push({ [dbField]: dateFilter });
                }
              }
              continue;
            }

            // Handle specific field mappings
            if (field === 'company_name' || field === 'contact_name') {
              const matchingCustomers = await Customer.find({
                $or: [
                  { company_name: { $regex: value, $options: 'i' } },
                  { contact_name: { $regex: value, $options: 'i' } }
                ]
              }).select('_id');
              const customerIds = matchingCustomers.map(c => c._id);

              if (report.report_type === 'Project') {
                colRuntimeFilters.push({ customer_ids: { $in: customerIds } });
              } else {
                const projects = await Project.find({ customer_ids: { $in: customerIds } }).select('_id');
                colRuntimeFilters.push({ project_id: { $in: projects.map(p => p._id) } });
              }
            } else if (field === 'project_name' || field === 'project_number') {
              if (report.report_type === 'Project') {
                colRuntimeFilters.push({ [field]: { $regex: value, $options: 'i' } });
              } else {
                const projects = await Project.find({ [field]: { $regex: value, $options: 'i' } }).select('_id');
                colRuntimeFilters.push({ project_id: { $in: projects.map(p => p._id) } });
              }
            } else if (field === 'status') {
              colRuntimeFilters.push({ status: { $regex: new RegExp(`^${value}$`, 'i') } });
            } else {
              // Generic regex match for other fields
              colRuntimeFilters.push({ [field]: { $regex: value, $options: 'i' } });
            }
          }

          if (colRuntimeFilters.length > 0) {
            query = { $and: [query, ...colRuntimeFilters] };
          }
        } catch (e) {
          console.error("Error parsing colFilters:", e);
        }
      }

      let data = [];

      // =========================================
      // PROJECT REPORT
      // =========================================
      if (report.report_type === 'Project') {

        const finalQuery =
          await customReportController.applyProjectTypeFilter(
            query,
            report.report_type,
            req
          );

        // Fetch all projects matching the query to expand them into rows
        const projects = await Project.find(applyScope(req, finalQuery))
          .populate('customer_ids', 'company_name contact_name')
          .sort(sortObj)
          .lean();

        let expandedData = [];
        for (const project of projects) {
          const materialOrders = await MaterialOrder.find({
            project_id: project._id
          }).lean();

          if (materialOrders.length > 0) {
            materialOrders.forEach((mo) => {
              const orderTotal = (mo.line_items || []).reduce(
                (sum, li) => sum + (Number(li.quantity_ordered || 0) * Number(li.unit_price || 0)),
                0
              );

              expandedData.push({
                ...project,
                material_cost: orderTotal,
                material_order_id: mo._id
              });
            });
          } else {
            expandedData.push({
              ...project,
              material_cost: 0
            });
          }
        }

        const totalItems = expandedData.length;
        const paginatedData = expandedData.slice(skip, skip + limitNum);

        data = paginatedData;
        var totalCount = totalItems;
      }

      // =========================================
      // ESTIMATE REPORT
      // =========================================
      else if (report.report_type === 'Estimate') {

        const finalQuery =
          await customReportController.applyProjectTypeFilter(
            query,
            report.report_type,
            req
          );

        const totalCountVal = await Estimate.countDocuments(applyScope(req, finalQuery));
        var totalCount = totalCountVal;

        data = await Estimate.find(applyScope(req, finalQuery))
          .populate({
            path: 'project_id',
            populate: {
              path: 'customer_ids',
              select: 'company_name contact_name'
            }
          })
          .sort(sortObj)
          .skip(skip)
          .limit(limitNum)
          .lean();
      }

      // =========================================
      // INVOICE REPORT
      // =========================================
      else if (report.report_type === 'Invoice') {

        const finalQuery =
          await customReportController.applyProjectTypeFilter(
            query,
            report.report_type,
            req
          );

        const totalCountVal = await Invoice.countDocuments(applyScope(req, finalQuery));
        var totalCount = totalCountVal;

        data = await Invoice.find(applyScope(req, finalQuery))
          .populate({
            path: 'project_id',
            populate: {
              path: 'customer_ids',
              select: 'company_name contact_name'
            }
          })
          .sort('-createdAt')
          .skip(skip)
          .limit(limitNum)
          .lean();
      }

      // Resolve creator names for all items
      const resolvedData = await Promise.all(data.map(async (item) => {
        const creatorId = item.created_by_user || item.created_by;
        if (creatorId && mongoose.Types.ObjectId.isValid(creatorId)) {
          const user = await User.findById(creatorId).select('full_name').lean();
          if (user) return { ...item, created_by_name: user.full_name };
          const client = await Client.findById(creatorId).select('full_name').lean();
          if (client) return { ...item, created_by_name: client.full_name };
        }
        return { ...item, created_by_name: item.created_by_name || "N/A" };
      }));

      return res.json({
        report,
        data: resolvedData,
        pagination: {
          total: totalCount,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(totalCount / limitNum)
        }
      });

    } catch (error) {

      console.error("getData Error:", error);

      return res.status(500).json({
        error: error.message
      });

    }
  },

  exportExcel: async (req, res) => {
    try {
      const report = await CustomReport.findById(req.params.id);
      if (!report) return res.status(404).json({ error: 'Report not found' });

      const { search, customer, status, created_by, startDate, endDate, sortBy, sortOrder } = req.query;

      // Handle sorting
      let sortObj = { createdAt: -1 };
      if (sortBy) {
        sortObj = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };
      }

      let query = await buildQuery(report.filters);
      const runtimeFilters = [];

      if (status && status !== 'all') {
        runtimeFilters.push({ status: { $regex: new RegExp(`^${status}$`, 'i') } });
      }

      if (created_by && created_by !== 'all') {
        const user = await User.findOne({
          $or: [
            { full_name: created_by },
            { _id: mongoose.Types.ObjectId.isValid(created_by) ? created_by : null }
          ]
        }).select('_id');
        if (user) runtimeFilters.push({ created_by_user: user._id });
      }

      if (startDate || endDate) {
        const dateRange = {};
        if (startDate) dateRange.$gte = new Date(startDate);
        if (endDate) dateRange.$lte = new Date(endDate + (endDate.includes('T') ? '' : "T23:59:59"));
        runtimeFilters.push({ createdAt: dateRange });
      }

      if (customer && customer !== 'all') {
        const matchingCustomers = await Customer.find({
          company_name: { $regex: customer, $options: 'i' }
        }).select('_id');
        const customerIds = matchingCustomers.map(c => c._id);

        if (report.report_type === 'Project') {
          runtimeFilters.push({ customer_ids: { $in: customerIds } });
        } else {
          const projects = await Project.find({ customer_ids: { $in: customerIds } }).select('_id');
          runtimeFilters.push({ project_id: { $in: projects.map(p => p._id) } });
        }
      }

      if (search) {
        const matchingCustomers = await Customer.find({
          company_name: { $regex: search, $options: 'i' }
        }).select('_id');
        const customerIds = matchingCustomers.map(c => c._id);

        const projectSearchOr = [
          { project_name: { $regex: search, $options: 'i' } },
          { project_number: { $regex: search, $options: 'i' } },
          { customer_ids: { $in: customerIds } }
        ];
        const matchingProjects = await Project.find({ $or: projectSearchOr }).select('_id');
        const projectIds = matchingProjects.map(p => p._id);

        const searchOr = [
          { project_name: { $regex: search, $options: 'i' } },
          { project_number: { $regex: search, $options: 'i' } },
          { estimate_number: { $regex: search, $options: 'i' } },
          { invoice_number: { $regex: search, $options: 'i' } },
        ];

        if (report.report_type === 'Project') {
          searchOr.push({ customer_ids: { $in: customerIds } });
        } else {
          searchOr.push({ project_id: { $in: projectIds } });
        }

        runtimeFilters.push({ $or: searchOr });
      }

      if (runtimeFilters.length > 0) {
        query = { $and: [query, ...runtimeFilters] };
      }

      // Handle column-specific filters
      if (req.query.colFilters) {
        try {
          const colFilters = JSON.parse(req.query.colFilters);
          const colRuntimeFilters = [];
          for (const [field, value] of Object.entries(colFilters)) {
            if (!value) continue;
            let dbField = field;
            if (field === 'install_date') dbField = 'estimated_start_date';
            if (field === 'completion_date') dbField = 'estimated_end_date';

            if (dbField.includes('date') || dbField === 'createdAt') {
              const d = new Date(value);
              if (!isNaN(d)) {
                const startOfDay = new Date(d);
                startOfDay.setHours(0, 0, 0, 0);
                const endOfDay = new Date(d);
                endOfDay.setHours(23, 59, 59, 999);
                const dateFilter = { $gte: startOfDay, $lte: endOfDay };
                if ((dbField === 'estimated_start_date' || dbField === 'estimated_end_date') && report.report_type !== 'Project') {
                  const projects = await Project.find({ [dbField]: dateFilter }).select('_id');
                  colRuntimeFilters.push({ project_id: { $in: projects.map(p => p._id) } });
                } else {
                  colRuntimeFilters.push({ [dbField]: dateFilter });
                }
              }
              continue;
            }

            if (field === 'company_name' || field === 'contact_name') {
              const matchingCustomers = await Customer.find({
                $or: [
                  { company_name: { $regex: value, $options: 'i' } },
                  { contact_name: { $regex: value, $options: 'i' } }
                ]
              }).select('_id');
              const customerIds = matchingCustomers.map(c => c._id);
              if (report.report_type === 'Project') {
                colRuntimeFilters.push({ customer_ids: { $in: customerIds } });
              } else {
                const projects = await Project.find({ customer_ids: { $in: customerIds } }).select('_id');
                colRuntimeFilters.push({ project_id: { $in: projects.map(p => p._id) } });
              }
            } else if (field === 'project_name' || field === 'project_number') {
              if (report.report_type === 'Project') {
                colRuntimeFilters.push({ [field]: { $regex: value, $options: 'i' } });
              } else {
                const projects = await Project.find({ [field]: { $regex: value, $options: 'i' } }).select('_id');
                colRuntimeFilters.push({ project_id: { $in: projects.map(p => p._id) } });
              }
            } else if (field === 'status') {
              colRuntimeFilters.push({ status: { $regex: new RegExp(`^${value}$`, 'i') } });
            } else {
              colRuntimeFilters.push({ [field]: { $regex: value, $options: 'i' } });
            }
          }
          if (colRuntimeFilters.length > 0) {
            query = { $and: [query, ...colRuntimeFilters] };
          }
        } catch (e) {
          console.error("Error parsing colFilters in export:", e);
        }
      }

      let data = [];
      if (report.report_type === 'Project') {
        const finalQuery = await customReportController.applyProjectTypeFilter(query, report.report_type, req);
        const projects = await Project.find(applyScope(req, finalQuery)).populate('customer_ids', 'company_name contact_name').sort(sortObj).lean();
        for (const project of projects) {
          const materialOrders = await MaterialOrder.find({ project_id: project._id }).lean();
          if (materialOrders.length > 0) {
            materialOrders.forEach((mo) => {
              const orderTotal = (mo.line_items || []).reduce((sum, li) => sum + (Number(li.quantity_ordered || 0) * Number(li.unit_price || 0)), 0);
              data.push({ ...project, material_cost: orderTotal, material_order_id: mo._id });
            });
          } else {
            data.push({ ...project, material_cost: 0 });
          }
        }
      } else if (report.report_type === 'Estimate') {
        const finalQuery = await customReportController.applyProjectTypeFilter(query, report.report_type, req);
        data = await Estimate.find(applyScope(req, finalQuery)).populate({ path: 'project_id', populate: { path: 'customer_ids', select: 'company_name contact_name' } }).sort(sortObj).lean();
      } else if (report.report_type === 'Invoice') {
        const finalQuery = await customReportController.applyProjectTypeFilter(query, report.report_type, req);
        data = await Invoice.find(applyScope(req, finalQuery)).populate({ path: 'project_id', populate: { path: 'customer_ids', select: 'company_name contact_name' } }).sort(sortObj).lean();
      }

      const filePath = await generateExcel(report, data);
      const today = new Date();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      const yy = String(today.getFullYear()).slice(-2);
      const formattedDate = `${mm}-${dd}-${yy}`;

      const downloadFileName =
        `${report.report_name.replace(/\s+/g, '_')}_${formattedDate}.xlsx`;

      res.download(filePath, downloadFileName, (err) => {
        if (err) console.error("Download Error:", err);

        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      });

    } catch (error) {
      console.error("exportExcel Error:", error);
      res.status(500).json({ error: error.message });
    }
  },

  runReport: async (reportId, req = null) => {
    let emailStatus = 'Success';
    let errorMessage = null;
    let recipients = [];
    let report = null;
    const sortObj = { createdAt: -1 };
    try {
      report = await CustomReport.findById(reportId)
        .populate('target_users')
        .populate('created_by');

      if (!report) {
        console.error(`Report ${reportId} not found`);
        return;
      }

      let creator = null;
      if (report.created_by) {
        const creatorId = report.created_by;
        if (creatorId) {
          creator = await Client.findById(creatorId);
        }
      }
      const companyDetails = {
        name: creator?.companyName || "George P. Coyle & Sons",
        logo: creator?.logo ? `${process.env.APP_URL}/${creator.logo}` : "https://coylejax.app/logo_2.png",
        address: creator?.address || "2361 Dennis Street, Jacksonville, FL 32204",
        phone: creator?.companyPhone || "904-356-4821",
        email: creator?.email || "contact@coylejax.com"
      };

      if (report.status === 'Inactive') {
        return;
      }

      const query = await buildQuery(report.filters);
      let scopedQuery = query;
      if (req) {
        scopedQuery = applyScope(req, query);
      } else {
        const adminId = report.created_by;
        if (adminId) {
          const adminObjectId = mongoose.Types.ObjectId.isValid(adminId)
            ? new mongoose.Types.ObjectId(adminId)
            : adminId;

          scopedQuery = {
            ...query,
            $or: [
              { created_by: adminObjectId },
              { created_by: adminId.toString() }
            ]
          };
        }
      }

      let data = [];
      if (report.report_type === 'Project') {
        const finalQuery = await customReportController.applyProjectTypeFilter(
          scopedQuery,
          report.report_type,
          req,
          report.created_by
        );

        const projects = await Project.find(finalQuery)
          .populate('customer_ids', 'company_name contact_name')
          .sort('-createdAt')
          .lean();

        for (let project of projects) {
          const materialOrders = await MaterialOrder.find({ project_id: project._id });

          if (materialOrders.length > 0) {
            materialOrders.forEach(mo => {
              const orderTotal = (mo.line_items || []).reduce((s, li) => s + (li.quantity_ordered * (li.unit_price || 0)), 0);
              data.push({
                ...project,
                material_cost: orderTotal,
                material_order_id: mo._id
              });
            });
          } else {
            data.push({
              ...project,
              material_cost: 0
            });
          }
        }
      } else if (report.report_type === 'Estimate') {
        const finalQuery = await customReportController.applyProjectTypeFilter(
          scopedQuery,
          report.report_type,
          req,
          report.created_by
        );

        data = await Estimate.find(finalQuery)
          .populate({
            path: 'project_id',
            populate: { path: 'customer_ids', select: 'company_name contact_name' }
          })
          .sort(sortObj)
          .lean();
      } else if (report.report_type === 'Invoice') {
        const finalQuery = await customReportController.applyProjectTypeFilter(
          scopedQuery,
          report.report_type,
          req,
          report.created_by
        );

        data = await Invoice.find(finalQuery)
          .populate({
            path: 'project_id',
            populate: { path: 'customer_ids', select: 'company_name contact_name' }
          })
          .sort(sortObj)
          .lean();
      }

      if (data.length === 0) {
        report.last_run = new Date();
        await report.save();

        // Log skip due to no data?
        await CustomReportLog.create({
          report_id: reportId,
          report_name: report.report_name,
          interval: report.interval,
          schedule_time: report.schedule_time,
          email_status: 'Success',
          error_message: 'No data found for the current filters.'
        });
        return;
      }

      const filePath = await generateExcel(report, data);

      console.log('STARTING EMAIL SEND');

      try {
        recipients = await sendReportEmails(report, filePath, companyDetails);
        console.log('EMAIL SEND FINISHED');
      } catch (err) {
        emailStatus = 'Failed';
        errorMessage = err.message;
        console.error('Email send error:', err);
      }

      report.last_run = new Date();
      await report.save();

      console.log('Report Executed Successfully');

      // Create Log
      await CustomReportLog.create({
        report_id: reportId,
        report_name: report.report_name,
        interval: report.interval,
        schedule_time: report.schedule_time,
        email_status: emailStatus,
        error_message: errorMessage,
        recipients: recipients,
        file_path: filePath // Note: we delete this below, but we could keep it if we wanted downloads
      });

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

    } catch (error) {
      console.error(`Error running report ${reportId}:`, error);
      if (report) {
        await CustomReportLog.create({
          report_id: reportId,
          report_name: report.report_name,
          interval: report.interval,
          schedule_time: report.schedule_time,
          email_status: 'Failed',
          error_message: error.message
        });
      }
    }
  }
}

async function buildQuery(filters) {
  const query = {};
  if (!filters || filters.length === 0) return query;

  const fieldMap = {
    'Status': 'status',
    'Division': 'project_type',
    'CreatedAt': 'createdAt'
  };

  const andFields = {};
  const orConditions = [];

  for (const filter of filters) {
    let val = filter.value;
    const dbField = fieldMap[filter.field] || filter.field;

    // Resolve Division ObjectIds -> actual project_type values from MasterData
    if (filter.field === 'Division' && Array.isArray(val) && val.length > 0) {
      try {
        const divisions = await MasterData.find({ _id: { $in: val } }).select('value').lean();
        val = divisions.map(d => d.value).filter(Boolean);
      } catch (e) {
        console.error('Failed to resolve division MasterData:', e);
      }
    }

    const valArray = Array.isArray(val) ? val : (val != null ? [val] : []);

    if (filter.operator === 'OR') {
      let cond;
      if (dbField === 'status') {
        cond = { [dbField]: { $in: valArray.map(v => new RegExp(`^${v}$`, 'i')) } };
      } else {
        cond = { [dbField]: { $in: valArray.map(v => parseValue(v)) } };
      }
      orConditions.push(cond);
    } else {
      // AND: accumulate all values per field for later merging
      if (!andFields[dbField]) {
        andFields[dbField] = { originalField: filter.field, values: [], condition: filter.condition };
      }
      andFields[dbField].values.push(...valArray);
    }
  }

  // Build merged AND conditions - same field, multiple values => $in
  for (const [dbField, info] of Object.entries(andFields)) {
    const { originalField, values, condition } = info;

    if (condition === '=(equal)') {
      if (originalField === 'Status' || dbField === 'status') {
        const normalizedValues = values.map(v =>
          v.toLowerCase().replace(/\s+/g, "_")
        );

        query[dbField] =
          normalizedValues.length === 1
            ? new RegExp(`^${normalizedValues[0]}$`, "i")
            : {
              $in: normalizedValues.map(
                v => new RegExp(`^${v}$`, "i")
              )
            };
      } else {
        const parsed = values.map(v => parseValue(v));
        query[dbField] = parsed.length === 1 ? parsed[0] : { $in: parsed };
      }
    } else {
      // For non-equality operators just use the first value
      const v = parseValue(values[0]);
      if (condition === '>(greater than)') query[dbField] = { $gt: v };
      else if (condition === '>=(greater than & equal)') query[dbField] = { $gte: v };
      else if (condition === '<(less than)') query[dbField] = { $lt: v };
      else if (condition === '<=(less than & equal)') query[dbField] = { $lte: v };
    }
  }

  if (orConditions.length > 0) {
    query.$or = orConditions;
  }

  return query;
}


function parseValue(val) {
  if (typeof val !== 'string') return val;

  if (val.match(/^\d{4}-\d{2}-\d{2}/)) {
    const date = new Date(val);
    if (!isNaN(date.getTime())) return date;
  }

  return val;
}

function applyDocsHyperlinkStyling(worksheet, columns) {
  const docsColumnIndex = columns.findIndex(c => c.key === 'docs') + 1;
  if (docsColumnIndex === 0) return;

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const cell = row.getCell(docsColumnIndex);
    if (!cell.value || typeof cell.value !== 'string') return;

    let attachments = [];
    try {
      attachments = JSON.parse(cell.value);
    } catch {
      return;
    }
    if (!Array.isArray(attachments) || attachments.length === 0) {
      cell.value = '';
      return;
    }

    if (attachments.length === 1) {
      // Single file → clickable hyperlink
      cell.value = {
        text: attachments[0].name,
        hyperlink: attachments[0].url,
        tooltip: attachments[0].url
      };
      cell.font = {
        color: { argb: 'FF0000FF' },
        underline: true,
        size: 10
      };
    } else {
      // Multiple files → first file clickable + rest as plain text below
      const richText = [
        {
          font: { color: { argb: 'FF0000FF' }, underline: true, size: 10 },
          text: attachments[0].name
        },
        ...attachments.slice(1).map(att => ({
          font: { color: { argb: 'FF000000' }, size: 10 },
          text: '\n' + att.name
        }))
      ];
      cell.value = { richText };
      row.height = Math.max(20, attachments.length * 18);
    }

    cell.alignment = {
      vertical: 'middle',
      horizontal: 'left',
      wrapText: true
    };
  });
}

// FIXED: Shared constants for currency and right-align columns
const CURRENCY_FIELDS = new Set([
  'material_cost',
  'estimated_value',
  'total_amount',
  'amount_paid',
  'balance',
  'final_value'
]);

const RIGHT_ALIGN_FIELDS = new Set([
  'material_cost',
  'estimated_value',
  'total_amount',
  'amount_paid',
  'balance',
  'final_value'
]);

const CURRENCY_FORMAT = '"$"#,##0.00';

// FIXED: Helper to apply consistent cell styling (font, alignment, border, numFmt)
// Used for both data rows and total rows in all sheet types.
function applyDataCellStyle(cell, colKey, options = {}) {
  const { isTotalRow = false, isCompletedOrBilled = false, isNeedInfo = false, isSeparator = false } = options;

  // --- Number format for currency columns ---
  if (CURRENCY_FIELDS.has(colKey) && typeof cell.value === 'number') {
    cell.numFmt = CURRENCY_FORMAT;
  }

  // --- Alignment ---
  cell.alignment = {
    vertical: 'middle',
    horizontal: colKey === 'docs'
      ? 'center'
      : RIGHT_ALIGN_FIELDS.has(colKey)
        ? 'right'
        : 'left'
  };

  // --- Font ---
  if (!isSeparator) {
    let cellFont = { size: 10, color: { argb: 'FF000000' } };
    if (isTotalRow) {
      cellFont.bold = true;
    } else if (isNeedInfo) {
      cellFont.bold = true;
      cellFont.color = { argb: 'FFFF0000' };
    } else if (isCompletedOrBilled) {
      cellFont.bold = true;
    }
    cell.font = cellFont;
  }

  // --- Background fill for total rows ---
  if (isTotalRow) {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFFF00' } // Yellow
    };
  }

  // --- Border ---
  const borderColor = isSeparator || !isTotalRow
    ? { argb: 'FFCCCCCC' }
    : { argb: 'FFCCCCCC' };

  cell.border = {
    top: { style: 'thin', color: borderColor },
    bottom: { style: 'thin', color: borderColor },
    left: { style: 'thin', color: borderColor },
    right: { style: 'thin', color: borderColor }
  };
}

async function generateExcel(report, data) {
  const workbook = new ExcelJS.Workbook();

  const isDivisionFilterSelected = report.filters && report.filters.some(f => f.field === 'Division');

  const getCleanSheetName = (divisionName) => {
    if (!divisionName || divisionName === 'N/A') {
      return 'Other';
    }

    // Keep FULL division name
    return divisionName
      .replace(/[\\/?*\[\]:]/g, '') // remove invalid excel chars
      .substring(0, 31) // excel max sheet name length
      .trim() || 'Other';
  };

  const usedNames = new Set();
  const getUniqueSheetName = (divisionName) => {
    const baseName = getCleanSheetName(divisionName);
    let name = baseName;
    let counter = 1;
    while (usedNames.has(name.toLowerCase())) {
      counter++;
      const suffix = ` ${counter}`;
      name = baseName.substring(0, 31 - suffix.length) + suffix;
    }
    usedNames.add(name.toLowerCase());
    return name;
  };

  const fieldLabelMap = {
    'project_name': 'Project Name',
    'company_name': 'Company Name',
    'status': 'Status/Progress',
    'project_number': isDivisionFilterSelected ? 'Project ID' : 'Project ID',
    'docs': 'Docs',
    'project_type_name': 'Division',
    'createdAt': 'Created Date',
    'material_cost': 'Material Cost',
    'estimated_value': 'Estimate Value',
    'install_date': 'Install Date',
    'completion_date': 'Completion Date',
    'contact_name': 'Contact Name',
    'total_amount': 'Total Amount',
    'amount_paid': 'Paid',
    'balance': 'Balance',
    'due_date': 'Due Date',
    'issue_date': 'Issue Date',
    'customer_po_number': 'Customer PO Number',
    'final_value': 'Final Value',
  };
  const columns = report.selected_fields.map(field => ({
    header: fieldLabelMap[field] || field.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    key: field,
    width: 22
  }));

  const buildRowData = (item) => {
    const row = {};
    report.selected_fields.forEach(field => {
      let val;

      switch (field) {
        case 'company_name':
          if (report.report_type === 'Project') {
            val = item.customer_ids?.[0]?.company_name || 'N/A';
          } else {
            val = item.project_id?.customer_ids?.[0]?.company_name
              || item.quick_customer?.company_name
              || 'N/A';
          }
          break;

        case 'contact_name':
          if (report.report_type === 'Project') {
            val = item.customer_ids?.[0]?.contact_name || 'N/A';
          } else {
            val = item.project_id?.customer_ids?.[0]?.contact_name
              || item.quick_customer?.customer_name
              || 'N/A';
          }
          break;

        case 'project_name':
          val = item.project_name || item.project_id?.project_name || 'N/A';
          break;

        case 'status': {
          const s = item.status || 'N/A';
          val = s.charAt(0).toUpperCase() + s.slice(1);
          break;
        }

        case 'project_number':
          val = item.project_number || item.project_id?.project_number || 'N/A';
          break;

        case 'docs': {
          const attachments = (
            item.file_attachments ||
            item.project_id?.file_attachments ||
            []
          ).filter(att => {
            const fileName = (att.file_name || '').toLowerCase();
            const fileUrl = (att.file_url || '').toLowerCase();
            return !fileName.includes('signature') && !fileUrl.includes('e-signature');
          });

          if (attachments.length > 0) {
            // Store as JSON so we can process it later into hyperlinks
            val = JSON.stringify(attachments.map(att => ({
              name: att.file_name || 'Document',
              url: att.file_url || ''
            })));
          } else {
            val = '';
          }
          break;
        }
        case 'project_type_name': {
          val = item.project_type_name
            || item.project_id?.project_type_name
            || item.quick_customer?.division_type
            || 'N/A';
          break;
        }

        case 'createdAt':
          val = item.createdAt ? new Date(item.createdAt).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit', timeZone: process.env.APP_TIMEZONE || 'UTC' }) : '';
          break;

        case 'install_date': {
          const rawInstallDate = item.estimated_start_date || item.install_date || item.createdAt;
          val = rawInstallDate ? new Date(rawInstallDate).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit', timeZone: process.env.APP_TIMEZONE || 'UTC' }) : '';
          break;
        }

        case 'completion_date':
          val = (item.estimated_end_date || item.completion_date)
            ? new Date(item.estimated_end_date || item.completion_date).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' })
            : '';
          break;

        case 'issue_date':
        case 'due_date':
          val = item[field] ? new Date(item[field]).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' }) : '';
          break;

        case 'estimated_value':
          val = Number(item.estimated_value || 0);
          break;

        case 'material_cost':
          val = Number(item.material_cost || 0);
          break;

        case 'total_amount':
        case 'amount_paid':
        case 'final_value':
          val = Number(item[field] || 0);
          break;

        case 'balance': {
          const total = Number(item.total_amount || 0);
          const paid = Number(item.amount_paid || 0);
          val = total - paid;
          break;
        }

        default:
          val = item[field] ?? '';
      }

      row[field] = val;
    });
    return row;
  };

  const buildTotalRowData = (items, label = 'Total') => {
    const row = {};
    let firstColAssigned = false;
    report.selected_fields.forEach(field => {
      if (!firstColAssigned) {
        row[field] = label;
        firstColAssigned = true;
      } else if (['material_cost', 'total_amount', 'amount_paid', 'estimated_value', 'final_value'].includes(field)) {
        const sum = items.reduce((acc, item) => acc + Number(item[field] || 0), 0);
        row[field] = Number(sum.toFixed(2));
      } else if (field === 'balance') {
        const sum = items.reduce((acc, item) => {
          const total = Number(item.total_amount || 0);
          const paid = Number(item.amount_paid || 0);
          return acc + (total - paid);
        }, 0);
        row[field] = Number(sum.toFixed(2));
      } else {
        row[field] = '';
      }
    });
    return row;
  };

  // FIXED: Helper to apply header row styling (shared across all sheet types)
  const applyHeaderRowStyle = (worksheet) => {
    const headerRow = worksheet.getRow(1);
    headerRow.height = 26;
    headerRow.eachCell((cell, colNumber) => {
      const colKey = columns[colNumber - 1].key;
      cell.font = {
        bold: true,
        size: 11,
        color: { argb: 'FF000000' }
      };
      cell.fill = {
        type: 'pattern',
        pattern: 'none'
      };
      cell.alignment = {
        vertical: 'middle',
        horizontal: colKey === 'docs'
          ? 'center'
          : RIGHT_ALIGN_FIELDS.has(colKey)
            ? 'right'
            : 'left'
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FFCCCCCC' } },
        right: { style: 'thin', color: { argb: 'FFCCCCCC' } }
      };
    });
  };

  if (isDivisionFilterSelected) {
    // Group data by dynamic division and export separate worksheets
    const groupedData = {};
    data.forEach(item => {
      const divName = item.project_type_name
        || item.project_id?.project_type_name
        || item.quick_customer?.division_type
        || 'N/A';
      if (!groupedData[divName]) {
        groupedData[divName] = [];
      }
      groupedData[divName].push(item);
    });

    const divisionNames = Object.keys(groupedData);

    if (divisionNames.length === 0) {
      const worksheet = workbook.addWorksheet(report.report_name || 'Report');
      worksheet.columns = columns;
      applyHeaderRowStyle(worksheet); // FIXED: use shared helper
    } else {
      divisionNames.forEach(divName => {
        const sheetName = getUniqueSheetName(divName);
        const worksheet = workbook.addWorksheet(sheetName);
        worksheet.columns = columns;

        const divData = groupedData[divName];

        // Add data rows
        divData.forEach(item => {
          const rowData = buildRowData(item);
          const excelRow = worksheet.addRow(rowData);
          const statusText = (item.status || '').toLowerCase();
          const isCompletedOrBilled = statusText.includes('billed') || statusText.includes('paid') || statusText.includes('completed');

          excelRow.height = 20;
          // FIXED: Apply per-cell styling for data rows in division sheets
          excelRow.eachCell((cell, colNumber) => {
            const colKey = columns[colNumber - 1].key;
            const valStr = String(cell.value || '');
            applyDataCellStyle(cell, colKey, {
              isCompletedOrBilled,
              isNeedInfo: valStr.includes('NEED INFO')
            });
          });
        });

        // Add totals row
        if (divData.length > 0) {
          const totalRowData = buildTotalRowData(divData, 'Totals');
          const totalExcelRow = worksheet.addRow(totalRowData);
          totalExcelRow.height = 20;
          // FIXED: Apply per-cell styling for total row in division sheets
          totalExcelRow.eachCell((cell, colNumber) => {
            const colKey = columns[colNumber - 1].key;
            applyDataCellStyle(cell, colKey, { isTotalRow: true });
          });
        }

        applyDocsHyperlinkStyling(worksheet, columns);
        applyHeaderRowStyle(worksheet); // FIXED: use shared helper
      });
    }
  } else {
    // Export single worksheet matching classical accounting layout with default font style
    const worksheet = workbook.addWorksheet(report.report_name || 'Report');
    worksheet.columns = columns;

    const rowsToAdd = [];
    if (report.report_type === 'Project') {
      const nonCompleted = [];
      const completed = [];

      data.forEach(item => {
        if (item.status && item.status.toLowerCase() === 'completed') {
          completed.push(item);
        } else {
          nonCompleted.push(item);
        }
      });

      nonCompleted.forEach(item => {
        rowsToAdd.push({ type: 'data', item, data: buildRowData(item) });
      });
      if (nonCompleted.length > 0) {
        rowsToAdd.push({ type: 'total', item: {}, data: buildTotalRowData(nonCompleted, 'Total (Active)') });
      }

      if (nonCompleted.length > 0 && completed.length > 0) {
        rowsToAdd.push({ type: 'empty' });
      }

      completed.forEach(item => {
        rowsToAdd.push({ type: 'data', item, data: buildRowData(item) });
      });
      if (completed.length > 0) {
        rowsToAdd.push({ type: 'total', item: {}, data: buildTotalRowData(completed, 'Total (Completed)') });
      }
    } else {
      data.forEach(item => {
        rowsToAdd.push({ type: 'data', item, data: buildRowData(item) });
      });
      if (data.length > 0) {
        rowsToAdd.push({ type: 'total', item: {}, data: buildTotalRowData(data, 'Total') });
      }
    }

    rowsToAdd.forEach(r => {
      if (r.type === 'empty') {
        worksheet.addRow({});
      } else {
        worksheet.addRow(r.data);
      }
    });

    applyDocsHyperlinkStyling(worksheet, columns);
    applyHeaderRowStyle(worksheet); // FIXED: use shared helper

    // Style the data rows
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;

      const rowInfo = rowsToAdd[rowNumber - 2];
      if (!rowInfo || rowInfo.type === 'empty') {
        // Style empty separator row
        row.height = 20;
        row.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFCCCCCC' } },
            bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
            left: { style: 'thin', color: { argb: 'FFCCCCCC' } },
            right: { style: 'thin', color: { argb: 'FFCCCCCC' } }
          };
        });
        return;
      }

      const item = rowInfo.item;
      const isTotalRow = rowInfo.type === 'total';
      const statusText = (item?.status || '').toLowerCase();
      const isCompletedOrBilled = statusText.includes('billed') || statusText.includes('paid') || statusText.includes('completed');

      row.height = 20;

      row.eachCell((cell, colNumber) => {
        const colKey = columns[colNumber - 1].key;
        const valStr = String(cell.value || '');

        // FIXED: use shared applyDataCellStyle which handles numFmt, alignment, font, border
        applyDataCellStyle(cell, colKey, {
          isTotalRow,
          isCompletedOrBilled,
          isNeedInfo: valStr.includes('NEED INFO')
        });

        // Docs hyperlink font override (keep existing behaviour)
        if (
          colKey === 'docs' &&
          cell.value &&
          cell.value.hyperlink
        ) {
          cell.font = {
            ...cell.font,
            color: { argb: 'FF0000FF' },
            underline: true,
            bold: true
          };
          cell.alignment = {
            vertical: 'middle',
            horizontal: 'center'
          };
        }
      });
    });
  }

  const fileName = `report_${Date.now()}.xlsx`;
  const filePath = path.join(__dirname, '../tmp', fileName);

  if (!fs.existsSync(path.join(__dirname, '../tmp'))) {
    fs.mkdirSync(path.join(__dirname, '../tmp'));
  }

  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

async function sendReportEmails(report, filePath, companyDetails) {
  const isSsl = process.env.EMAIL_PORT === '465';

  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT),
    secure: isSsl,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    },
    tls: {
      rejectUnauthorized: false
    }
  });

  await transporter.verify();

  const recipients = [
    ...(report.target_users
      ? report.target_users.map(u => u.email)
      : []),

    ...(report.additional_emails
      ? report.additional_emails
        .split('\n')
        .map(e => e.trim())
        .filter(e => e)
      : [])
  ];

  const uniqueRecipients = [...new Set(recipients)];

  if (uniqueRecipients.length === 0) {
    throw new Error('No recipients found');
  }

  const dateStr = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  const iconUrl = "https://coylejax.app/icon_2.png";

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Automated Report</title>
</head>
<body style="margin:0; padding:0; background-color:#f4f7f9; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%">
    <tr>
      <td align="center" style="padding: 40px 20px 20px;">
        <img src="${companyDetails.logo}" alt="Company Logo" width="220" style="display:block; margin-bottom:20px;">
      </td>
    </tr>
    <tr>
      <td align="center" style="padding: 0 20px 40px;">
        <table border="0" cellpadding="0" cellspacing="0" width="600" style="background:#ffffff; border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,0.08); overflow:hidden;">
          <tr>
            <td align="center" style="padding: 40px 40px 20px;">
              <img src="${iconUrl}" alt="Report Icon" width="280" style="display:block;">
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 50px 10px; font-size:16px; line-height:24px; color:#333;">
              <p>Dear <strong>${companyDetails.name}</strong>,</p>
              <p>Attached are the <strong>${report.report_name}</strong> for ${dateStr}.</p>
              ${report.email_text ? '<p style="margin-top:15px; white-space:pre-wrap;">' + report.email_text + '</p>' : ''}
            </td>
          </tr>
          <tr>
            <td style="padding: 0 50px 40px; font-size:16px; line-height:24px; color:#333;">
              <div style="border-top:1px solid #eee; margin:20px 0;"></div>
              <p style="margin:0;">Thank You,</p>
              <p style="margin:5px 0 0 0; font-weight:bold; font-size:18px;">${companyDetails.name}</p>
            </td>
          </tr>
        </table>

        <table border="0" cellpadding="0" cellspacing="0" width="600" style="margin-top:30px;">
          <tr>
            <td align="center" style="font-size:13px; color:#666; line-height:20px;">
              <p style="margin:0;">${companyDetails.address}</p>
              <p style="margin:5px 0;">
                <a href="tel:${companyDetails.phone}" style="color:#2563eb; text-decoration:none;">${companyDetails.phone}</a> | 
                <a href="mailto:${companyDetails.email}" style="color:#2563eb; text-decoration:none;">${companyDetails.email}</a>
              </p>
              <p style="margin:5px 0 0 0;">Copyright © ${new Date().getFullYear()} ${companyDetails.name}, Inc.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  const today = new Date();

  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const yy = String(today.getFullYear()).slice(-2);

  const formattedDate = `${mm}-${dd}-${yy}`;

  await transporter.sendMail({
    from: `"${companyDetails.name} Reports" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
    to: uniqueRecipients.join(','),
    subject: report.email_subject || `${report.report_name} - ${dateStr}`,
    html: htmlBody,

    attachments: [
      {
        filename: `${report.report_name}_${formattedDate}.xlsx`,
        path: filePath
      }
    ]
  });

  return uniqueRecipients;
}

module.exports = customReportController;
