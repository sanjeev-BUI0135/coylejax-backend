const express = require('express');
const router = express.Router();
const Project = require('../models/Project');
const Customer = require('../models/Customer');
const Estimate = require('../models/Estimate');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const LaborEntry = require('../models/LaborEntry');
const MaterialOrder = require('../models/MaterialOrder');
const mongoose = require('mongoose');
const { createIdQuery } = require('../utils/idHelper');
const { awardProject, sendProcessingEmail } = require('../utils/projectEmails');
const { logActivity } = require('../utils/activityLogger');
const auth = require('../middleware/auth');
const User = require("../models/User");
const Client = require("../models/Client");
const getRootCreator = require('../helpers/getRootCreator');
const applyScope = require('../helpers/applyScope');
const applyProjectFilters = require("../utils/projectFilters");

router.use(auth);

// GET /api/projects - Get all projects including sub-projects
router.get('/', async (req, res) => {
  try {
    const {
      sort = '-updatedAt',
      page = 1,
      skip = 0,
      parent_id,
      limit,
      created_by_user,
      search = "",
      company,
      customer,
      project,
      status,
      division,
      company_name,
      customer_name,
      project_name,
      project_number,
      project_type,
      project_creation_type,
      estimated_value,
      createdAt,
    } = req.query;

    const userId = req.user._id;
    const roleType = req.user.role_type?.toLowerCase();

    let query = {
      is_inactive: { $ne: true },
      status: { $ne: "completed" }
    };

    if (parent_id) {
      query.parent_project_id = parent_id;
    }
    if (created_by_user) {
      query.created_by_user = {
        $in: [
          created_by_user,
          new mongoose.Types.ObjectId(created_by_user)
        ]
      };
    }

    let finalQuery = applyScope(req, query);
    if (status && status !== "all") {
      finalQuery.status = status;
    }

    if (project && project !== "all") {
      finalQuery._id = project;
    }

    if (division && division !== "all") {
      finalQuery.project_type = {
        $regex: division,
        $options: "i"
      };
    }
    if (search?.trim()) {

      const customerIds = await Customer.find({
        $or: [
          {
            company_name: {
              $regex: search,
              $options: "i"
            }
          },
          {
            contact_name: {
              $regex: search,
              $options: "i"
            }
          }
        ]
      }).distinct("_id");

      finalQuery = {
        ...finalQuery,
        $and: [
          {
            $or: [
              {
                project_name: {
                  $regex: search,
                  $options: "i"
                }
              },

              {
                project_number: {
                  $regex: search,
                  $options: "i"
                }
              },

              {
                customer_ids: {
                  $in: customerIds
                }
              }
            ]
          }
        ]
      };
    }
    if (company && company !== "all") {

      const companyCustomerIds = await Customer.find({
        company_name: {
          $regex: company,
          $options: "i"
        }
      }).distinct("_id");

      finalQuery.customer_ids = {
        $in: companyCustomerIds
      };
    }

    if (customer && customer !== "all") {
      finalQuery.customer_ids = {
        $in: [
          new mongoose.Types.ObjectId(customer)
        ]
      };
    }

    finalQuery = await applyProjectFilters({
      finalQuery,
      filters: req.query
    });

    let projectsQuery = Project.find(finalQuery)
      .populate('customer_ids', 'company_name contact_name')
      .populate('parent_project_id', 'project_name project_number')
      .sort(sort);

    let total = 0;
    let isPaginated = false;
    let limitValue = 0;

    if (limit) {
      isPaginated = true;
      limitValue = parseInt(limit);

      const skipValue = skip
        ? parseInt(skip)
        : (parseInt(page) - 1) * limitValue;

      total = await Project.countDocuments(finalQuery);
      projectsQuery = projectsQuery.skip(skipValue).limit(limitValue);
    }

    const projects = await projectsQuery;

    const responseData = projects.map(project => ({
      ...project.toObject(),
      id: project.id || project._id.toString(),
      _id: project._id,
      is_warranty_work: project.status === 'reopen'
    }));

    if (isPaginated) {
      return res.json({
        data: responseData,
        total,
        page: parseInt(page),
        limit: limitValue,
        pages: Math.ceil(total / limitValue)
      });
    }

    return res.json(responseData);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});


// GET /api/projects/:id 
router.get('/:id', async (req, res) => {
  try {
    const searchId = req.params.id;
    const query = createIdQuery(searchId);
    const project = await Project.findOne(createIdQuery(searchId))
      .populate('customer_ids', 'company_name contact_name')
      .populate('parent_project_id', 'project_name project_number');

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    let subProjects = [];
    if (!project.is_sub_project) {
      subProjects = await Project.find({ parent_project_id: project._id })
        .populate('customer_ids', 'company_name contact_name');
    }

    const responseData = {
      ...project.toObject(),
      id: project.id || project._id.toString(),
      _id: project._id,
      is_warranty_work: project.status === 'reopen',
      sub_projects: subProjects.map(sp => ({
        ...sp.toObject(),
        id: sp.id || sp._id.toString(),
        _id: sp._id,
        is_warranty_work: sp.status === 'reopen'
      }))
    };

    res.json(responseData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const userId = req.user._id;
    const ownerType = req.user.role_type;
    const loggedInUserId = req.user?._id || null;
    const type = (req.body.project_creation_type || "").toLowerCase();

    if (!["new_project", "service_work_order"].includes(type)) {
      return res.status(400).json({
        error: "Invalid project_creation_type"
      });
    }

    const isNew = type === "new_project";
    const incField = isNew
      ? "project_number_config.new_project"
      : "project_number_config.service_project";

    const isAdmin = ownerType === "admin" || ownerType === "superadmin";
    const OwnerModel = ownerType === "admin" ? Client : User;

    let configOwner;
    let currentUser;
    let userPrefix;

    // ==============================
    // Determine Config Owner
    // ==============================

    if (ownerType === "superadmin" && req.body.created_by) {
      const targetId = req.body.created_by;
      configOwner =
        (await Client.findById(targetId)) ||
        (await User.findById(targetId));

      if (!configOwner) {
        return res.status(404).json({ error: "Target Admin/Client not found" });
      }
    } else if (ownerType === "admin") {
      configOwner = await OwnerModel.findById(userId);
      if (!configOwner) {
        return res.status(404).json({ error: "Admin not found" });
      }
    } else {
      currentUser = await User.findById(userId);
      if (!currentUser) {
        return res.status(404).json({ error: "User not found" });
      }

      const adminId = await getRootCreator(req.user);
      if (!adminId) {
        return res.status(400).json({
          error: "Cannot find admin configuration."
        });
      }

      configOwner =
        (await Client.findById(adminId)) ||
        (await User.findById(adminId));

      if (!configOwner) {
        return res.status(404).json({ error: "Admin not found" });
      }

      const userConfig = isNew
        ? currentUser.project_number_config?.new_project
        : currentUser.project_number_config?.service_project;

      userPrefix = userConfig?.prefix;
    }

    const AdminModel =
      configOwner.constructor.modelName === "Client" ? Client : User;

    // ==============================
    // STEP 1: READ CURRENT NUMBER
    // ==============================

    const owner = await AdminModel.findById(configOwner._id);

    const cfg = isNew
      ? owner.project_number_config.new_project
      : owner.project_number_config.service_project;

    if (!cfg) {
      return res.status(400).json({
        error: "Project number configuration missing."
      });
    }

    const finalPrefix = !isAdmin && userPrefix ? userPrefix : cfg.prefix;

    let projectNumber = "";

    if (isNew) {
      const newProjectIds = await Project.find({
        created_by: {
          $in: [configOwner._id, configOwner._id.toString()]
        },
        project_creation_type: "new_project"
      }).distinct("_id");

      const allEstimates = await Estimate.find({
        created_by: {
          $in: [configOwner._id, configOwner._id.toString()]
        },

        estimate_number: {
          $regex: `^EST-${cfg.year}\\d{4}[A-Z]+$`
        },

        $or: [
          { is_quick_estimate: true },

          {
            project_id: {
              $in: newProjectIds
            }
          }
        ]
      })
        .select("estimate_number")
        .lean();

      const allProjects = await Project.find({
        created_by: {
          $in: [configOwner._id, configOwner._id.toString()]
        },
        project_creation_type: "new_project",
        project_number: {
          $regex: `^${cfg.year}\\d{4}[A-Z]+$`
        }
      })
        .select("project_number")
        .lean();

      let highestSeq = 0;
      const estRegex = new RegExp(`^EST-${cfg.year}(\\d{4})[A-Z]+$`);
      const projRegex = new RegExp(`^${cfg.year}(\\d{4})[A-Z]+$`);

      for (const est of allEstimates) {
        if (est.estimate_number) {
          const match = est.estimate_number.match(estRegex);
          if (match) {
            const seq = parseInt(match[1], 10) || 0;
            if (seq > highestSeq) {
              highestSeq = seq;
            }
          }
        }
      }

      for (const proj of allProjects) {
        if (proj.project_number) {
          const match = proj.project_number.match(projRegex);
          if (match) {
            const seq = parseInt(match[1], 10) || 0;
            if (seq > highestSeq) {
              highestSeq = seq;
            }
          }
        }
      }

      const nextSequence = Math.max(highestSeq, (cfg.start_number - 1) || 0) + 1;

      const padded = String(nextSequence).padStart(4, "0");

      projectNumber = `${cfg.year}${padded}${finalPrefix}`;

    } else {
      const usedNumber = (cfg.current_number || cfg.start_number || 0) + 1;
      const padded = String(usedNumber).padStart(4, "0");
      projectNumber = `${cfg.year}${padded}${finalPrefix}`;
    }

    // Check duplicate
    const exists = await Project.findOne({
      project_number: projectNumber
    });

    if (exists) {
      return res.status(409).json({
        error: "Project number already exists. Please try again."
      });
    }

    // ==============================
    // STEP 2: CREATE PROJECT
    // ==============================

    const project = new Project({
      ...req.body,
      project_number: projectNumber,
      user_initials: finalPrefix,
      created_by: configOwner._id,
      created_by_user: loggedInUserId
    });

    await project.save();

    // ==============================
    // STEP 3: INCREMENT AFTER SAVE
    // ==============================

    await AdminModel.findByIdAndUpdate(configOwner._id, {
      $inc: {
        [`${incField}.current_number`]: 1,
        [`${incField}.project_count`]: 1
      }
    });

    const populatedProject = await Project.findById(project._id)
      .populate("customer_ids", "company_name contact_name")
      .populate("parent_project_id", "project_name project_number");

    res.status(201).json(populatedProject);

    // Activity Logging
    await logActivity(
      populatedProject._id,
      req.user,
      'Project',
      'Create',
      `Project "${populatedProject.project_name}" (${populatedProject.project_number}) created.`,
      { project_number: populatedProject.project_number }
    );

  } catch (error) {
    console.error("Project create error:", error);
    res.status(400).json({ error: error.message });
  }
});

// POST /api/projects/:id/sub-projects 
router.post('/:id/sub-projects', async (req, res) => {
  try {
    const parentId = req.params.id;
    const parentProject = await Project.findById(parentId);

    if (!parentProject) {
      return res.status(404).json({ error: 'Parent project not found' });
    }

    const subProjectData = {
      ...req.body,
      is_sub_project: true,
      parent_project_id: parentId,
      customer_ids: req.body.customer_ids || parentProject.customer_ids,
      project_type: req.body.project_type || parentProject.project_type,
      project_type_name: req.body.project_type_name || parentProject.project_type_name,
      location: req.body.location || parentProject.location,
      billing_address: req.body.billing_address || parentProject.billing_address,
      requirements: req.body.requirements || parentProject.requirements,
      special_instructions: req.body.special_instructions || parentProject.special_instructions,
      estimated_start_date: req.body.estimated_start_date || parentProject.estimated_start_date,
      estimated_end_date: req.body.estimated_end_date || parentProject.estimated_end_date,
      priority: req.body.priority || parentProject.priority,
      user_initials: parentProject.user_initials,
      created_by: parentProject.created_by,
      created_by_user: parentProject.created_by_user,
    };

    const subProject = new Project(subProjectData);
    await subProject.save();

    const populatedSubProject = await Project.findById(subProject._id)
      .populate('customer_ids', 'company_name contact_name')
      .populate('parent_project_id', 'project_name project_number');

    res.status(201).json(populatedSubProject);
    await logActivity(
      populatedSubProject._id,
      req.user,
      'Project',
      'Create',
      `Sub Project "${populatedSubProject.project_name}" created under "${parentProject.project_name}".`,
      {
        parent_project_id: parentProject._id,
        parent_project_number: parentProject.project_number
      }
    );
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// PUT /api/projects/:id
router.put('/:id', async (req, res) => {
  try {
    const projectId = req.params.id;
    const existingProject = await Project.findById(projectId);

    if (!existingProject) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const newStatus = req.body.status;
    const oldStatus = existingProject.status;

    // ================================
    // 1. Status Progression Tracking
    // ================================
    if (newStatus && newStatus !== oldStatus) {
      const changedBy = req.user?.email || 'system';
      existingProject.updateStatusProgression(newStatus, changedBy);
      await existingProject.save();
    }

    // ================================
    // 2. Inactive Project Logic
    // ================================
    // Auto move to inactive
    if (newStatus === 'lost' || newStatus === 'completed') {
      req.body.is_inactive = true;
      req.body.inactive_at = new Date();
    }

    // Reopen project (move back to active)
    if (newStatus === 'reopen' || newStatus === 'processing' || newStatus === 'awarded' || newStatus === 'open' || newStatus === 'bid_submitted' || newStatus === 'actively_working') {
      req.body.is_inactive = false;
      req.body.reopened_at = new Date();
    }

    // ================================
    // 3. Status-specific Date Logic
    // ================================
    if (newStatus === 'reopen') {
      if (existingProject.status !== 'completed') {
        return res.status(400).json({
          error: 'Only completed projects can be reopened for warranty work'
        });
      }

      if (!req.body.warranty_reopen_date) {
        req.body.warranty_reopen_date = new Date();
      }
      if (
        !req.body.original_completion_date &&
        existingProject.actual_end_date
      ) {
        req.body.original_completion_date =
          existingProject.actual_end_date;
      }
    }

    if (newStatus === 'completed') {
      if (
        !req.body.completed_date &&
        (!existingProject.completed_date ||
          existingProject.status !== 'completed')
      ) {
        req.body.completed_date = new Date();
      }

      if (
        !req.body.actual_end_date &&
        !existingProject.actual_end_date
      ) {
        req.body.actual_end_date = new Date();
      }
    }

    if (newStatus === 'processing' || newStatus === 'reopen') {
      if (
        !req.body.processing_start_date &&
        !existingProject.processing_start_date
      ) {
        req.body.processing_start_date = new Date();
      }
    }

    if (newStatus === 'awarded') {
      if (
        !req.body.awarded_date &&
        !existingProject.awarded_date
      ) {
        req.body.awarded_date = new Date();
      }
    }

    // ================================
    // 4. File Attachments Normalization
    // ================================
    if (Array.isArray(req.body.file_attachments)) {
      req.body.file_attachments = req.body.file_attachments.map(file => ({
        file_name: file.file_name,
        file_url: file.file_url,
        crew_visible: !!file.crew_visible,

        uploaded_by: file.uploaded_by || req.user?.full_name,
        uploaded_by_id: file.uploaded_by_id || req.user?._id,

        uploaded_by_model:
          file.uploaded_by_model ||
          (req.user?.role_type === "admin" ? "Client" : "User"),

        createdAt: file.createdAt || new Date()
      }));
    }

    // ================================
    // 5. Final Update
    // ================================
    
    if ("created_by" in req.body) delete req.body.created_by;
    if ("created_by_user" in req.body) delete req.body.created_by_user;
    if ("created_by_model" in req.body) delete req.body.created_by_model;

    const project = await Project.findByIdAndUpdate(
      projectId,
      {
        ...req.body,
        updated_by: req.user?.email
      },
      { new: true, runValidators: true }
    )
      .populate('customer_ids', 'company_name contact_name email')
      .populate(
        'parent_project_id',
        'project_name project_number'
      );

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // ================================
    // 6. Email Triggers
    // ================================
    if (newStatus === 'processing') {
      // Temporarily disabled
      // await sendProcessingEmail(project);
    }

    if (newStatus === 'awarded') {
      // Temporarily disabled
      // await awardProject(project);
    }

    // ================================
    // 7. Response
    // ================================
    const responseData = {
      ...project.toObject(),
      is_warranty_work: project.status === 'reopen'
    };

    res.json(responseData);

    // Activity Logging
    if (newStatus && newStatus !== oldStatus) {
      await logActivity(
        projectId,
        req.user,
        'Project',
        'Update',
        `Project status changed from "${oldStatus}" to "${newStatus}".`,
        { old_status: oldStatus, new_status: newStatus }
      );
    } else if (req.body.priority && req.body.priority !== existingProject.priority) {
      await logActivity(
        projectId,
        req.user,
        'Project',
        'Priority Change',
        `Project priority changed from "${existingProject.priority}" to "${req.body.priority}".`,
        { old_priority: existingProject.priority, new_priority: req.body.priority }
      );
    } else if (req.body.file_attachments && existingProject.file_attachments) {
      const oldFiles = existingProject.file_attachments.length;
      const newFiles = req.body.file_attachments.length;
      if (newFiles > oldFiles) {
        await logActivity(
          projectId,
          req.user,
          'Project',
          'Upload',
          `Uploaded ${newFiles - oldFiles} file(s).`,
          { file_count: newFiles }
        );
      } else if (newFiles < oldFiles) {
        await logActivity(
          projectId,
          req.user,
          'Project',
          'Delete',
          `Deleted ${oldFiles - newFiles} file(s).`,
          { file_count: newFiles }
        );
      } else {
        await logActivity(
          projectId,
          req.user,
          'Project',
          'Update',
          `Project details updated.`,
          req.body
        );
      }
    } else {
      await logActivity(
        projectId,
        req.user,
        'Project',
        'Update',
        `Project details updated.`,
        req.body
      );
    }
  } catch (error) {
    console.error('Error updating project:', error);
    res.status(400).json({ error: error.message });
  }
});


// POST /api/projects/duplicate/:id
router.post('/duplicate/:id', async (req, res) => {
  try {
    const originalProjectId = req.params.id;
    const originalProject = await Project.findById(originalProjectId);
    if (!originalProject) {
      return res.status(404).json({ error: 'Original project not found' });
    }
    const generateNewProjectNumber = async (baseNumber) => {
      if (!baseNumber) {
        throw new Error('Base project number is required');
      }
      const match = baseNumber.match(/^(.*)-(\d+)$/);
      let base, nextNumber;
      if (match) {
        base = match[1];
        const currentNumber = parseInt(match[2]);
        nextNumber = currentNumber + 1;
      } else {
        base = baseNumber;
        nextNumber = 1;
      }
      let proposedNumber = `${base}-${nextNumber.toString().padStart(2, '0')}`;
      let counter = 1;
      while (await Project.findOne({ project_number: proposedNumber })) {
        nextNumber += 1;
        proposedNumber = `${base}-${nextNumber.toString().padStart(2, '0')}`;
        counter += 1;

        if (counter > 100) {
          throw new Error('Too many duplicates, please use a different base name');
        }
      }
      return proposedNumber;
    };

    const projectData = originalProject.toObject();
    const duplicateData = {
      project_number: await generateNewProjectNumber(projectData.project_number),
      project_name: `${projectData.project_name}`,
      project_creation_type_name: projectData.project_creation_type_name,
      project_creation_type: projectData.project_creation_type,
      description: projectData.description,
      location: projectData.location,
      billing_address: projectData.billing_address,
      project_type: projectData.project_type,
      project_type_name: projectData.project_type_name,
      priority: projectData.priority,
      status: 'open',
      progress_percentage: 0,
      materials_status: 'Not Ordered',
      estimated_value: projectData.estimated_value,
      requirements: projectData.requirements,
      special_instructions: projectData.special_instructions,
      customer_ids: projectData.customer_ids || [],
      user_initials: projectData.user_initials,
      created_by: projectData.created_by,
      created_date: new Date(),
      lost_reason: null,
      bid_submission_date: null,
      award_date: null,
      completion_date: null,
      file_attachments: [],
      duplicated_from: originalProjectId,
      original_project_number: projectData.project_number,
      warranty_reopen_date: null,
      warranty_notes: null,
      original_completion_date: null,
      created_by_user: projectData.created_by_user,
    };

    const duplicatedProject = new Project(duplicateData);
    await duplicatedProject.save();
    const populatedProject = await Project.findById(duplicatedProject._id)
      .populate('customer_ids', 'company_name contact_name');
    const responseData = {
      ...populatedProject.toObject(),
      id: populatedProject._id.toString(),
    };

    res.status(201).json({
      message: 'Project duplicated successfully',
      project: responseData
    });
    await logActivity(
      duplicatedProject._id,
      req.user,
      'Project',
      'Create',
      `Project "${projectData.project_name}" duplicated from ${projectData.project_number} to ${duplicatedProject.project_number}.`,
      {
        original_project_id: originalProjectId,
        original_project_number: projectData.project_number,
        duplicated_project_number: duplicatedProject.project_number
      }
    );
  } catch (error) {
    console.error('Error duplicating project:', error);
    res.status(400).json({
      error: error.message || 'Failed to duplicate project'
    });
  }
});

// Helper function to delete all related data for a project
async function deleteProjectRelatedData(projectId) {
  try {
    const objectId = mongoose.Types.ObjectId.isValid(projectId)
      ? new mongoose.Types.ObjectId(projectId)
      : null;
    const idConditions = [
      { project_id: projectId.toString() },
    ];
    if (objectId) idConditions.push({ project_id: objectId });

    const invoices = await Invoice.find({ $or: idConditions });
    const invoiceIds = invoices.map(inv => inv._id);

    const deleteOperations = [
      Estimate.deleteMany({ $or: idConditions }),
      Invoice.deleteMany({ $or: idConditions }),
      Payment.deleteMany({
        $or: [
          { project_id: projectId.toString() },
          { project_id: objectId },
          { invoice_id: { $in: invoiceIds } },
        ],
      }),
      LaborEntry.deleteMany({ $or: idConditions }),
      MaterialOrder.deleteMany({ $or: idConditions }),
    ];

    const results = await Promise.all(deleteOperations);

    return results;
  } catch (error) {
    console.error(`Error deleting related data for project ${projectId}:`, error);
    throw error;
  }
}

// DELETE /api/projects/bulk
router.delete('/bulk', async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'No projects selected' });
    }

    const rootId = await getRootCreator(req.user);
    const userId = req.user._id;

    const allowedCreatorIds = [
      new mongoose.Types.ObjectId(userId),
      new mongoose.Types.ObjectId(rootId),
      userId.toString(),
      rootId?.toString()
    ];

    const projects = await Project.find({
      _id: { $in: ids },
      created_by: { $in: allowedCreatorIds }
    });

    if (!projects.length) {
      return res.status(404).json({ error: 'No valid projects found' });
    }

    for (const project of projects) {

      // Delete subprojects if main project
      if (!project.is_sub_project) {
        const subProjects = await Project.find({
          parent_project_id: project._id
        });

        for (const sub of subProjects) {
          await deleteProjectRelatedData(sub._id);
        }

        await Project.deleteMany({
          parent_project_id: project._id
        });
      }

      // Delete related data
      await deleteProjectRelatedData(project._id);

      // Delete project
      await Project.findByIdAndDelete(project._id);
    }

    res.json({
      success: true,
      deleted_count: projects.length
    });

  } catch (error) {
    console.error('Bulk project delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/projects/:id 
router.delete('/:id', async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (!project.is_sub_project) {
      const subProjects = await Project.find({ parent_project_id: project._id });
      for (const subProject of subProjects) {
        await deleteProjectRelatedData(subProject._id);
      }
      await Project.deleteMany({ parent_project_id: project._id });
    }

    await deleteProjectRelatedData(project._id);

    await Project.findByIdAndDelete(req.params.id);

    res.json({
      message: 'Project and all related data deleted successfully',
      deleted_project_id: req.params.id
    });

    // Activity Logging
    await logActivity(
      req.params.id,
      req.user,
      'Project',
      'Delete',
      `Project "${project.project_name}" deleted.`,
      { project_name: project.project_name }
    );
  } catch (error) {
    console.error('Error deleting project:', error);
    res.status(500).json({ error: error.message });
  }
});
// GET /api/projects/inactive/list

router.get('/inactive/list', async (req, res) => {
  try {

    const {
      page = 1,
      limit = 25,
      search = "",

      company,
      customer,
      project,
      status,
      division,

      company_name,
      customer_name,
      project_name,
      project_number,
      project_type,
      project_creation_type,
      estimated_value,
      createdAt,
      priority,
      created_by_user
    } = req.query;

    const rootId = await getRootCreator(req.user);
    const userId = req.user._id;

    let query = {
      created_by: {
        $in: [
          new mongoose.Types.ObjectId(userId),
          new mongoose.Types.ObjectId(rootId),
          userId.toString(),
          rootId?.toString()
        ]
      },
      $or: [
        { is_inactive: true },
        { status: "completed" }
      ],
      status: { $in: ["lost", "completed"] }
    };

    if (created_by_user) {
      query.created_by_user = {
        $in: [
          created_by_user,
          new mongoose.Types.ObjectId(created_by_user)
        ]
      };
    }

    // APPLY SCOPE
    let finalQuery = applyScope(req, query);

    // STATUS FILTER
    if (status && status !== "all") {
      finalQuery.status = status;
    }

    // PROJECT FILTER
    if (project && project !== "all") {
      finalQuery._id = project;
    }

    // DIVISION FILTER
    if (division && division !== "all") {
      finalQuery.project_type = {
        $regex: division,
        $options: "i"
      };
    }

    // GLOBAL SEARCH
    if (search?.trim()) {

      const customerIds = await Customer.find({
        $or: [
          {
            company_name: {
              $regex: search,
              $options: "i"
            }
          },
          {
            contact_name: {
              $regex: search,
              $options: "i"
            }
          }
        ]
      }).distinct("_id");

      finalQuery = {
        ...finalQuery,
        $and: [
          {
            $or: [
              {
                project_name: {
                  $regex: search,
                  $options: "i"
                }
              },

              {
                project_number: {
                  $regex: search,
                  $options: "i"
                }
              },

              {
                customer_ids: {
                  $in: customerIds
                }
              }
            ]
          }
        ]
      };
    }

    // COMPANY FILTER
    if (company && company !== "all") {

      const companyCustomerIds = await Customer.find({
        company_name: {
          $regex: company,
          $options: "i"
        }
      }).distinct("_id");

      finalQuery.customer_ids = {
        $in: companyCustomerIds
      };
    }

    // CUSTOMER FILTER
    if (customer && customer !== "all") {
      finalQuery.customer_ids = {
        $in: [new mongoose.Types.ObjectId(customer)]
      };
    }

    // COLUMN FILTERS
    finalQuery = await applyProjectFilters({
      finalQuery,
      filters: {
        company_name,
        customer_name,
        project_name,
        project_number,
        project_type,
        project_creation_type,
        estimated_value,
        createdAt,
        priority,
        status
      }
    });

    // PAGINATION
    const pageValue = parseInt(page);
    const limitValue = parseInt(limit);

    const skip = (pageValue - 1) * limitValue;

    const total = await Project.countDocuments(finalQuery);

    const projects = await Project.find(finalQuery)
      .populate('customer_ids', 'company_name contact_name')
      .populate('parent_project_id', 'project_name project_number')
      .sort('-updatedAt')
      .skip(skip)
      .limit(limitValue);

    return res.json({
      data: projects,
      total,
      page: pageValue,
      limit: limitValue,
      pages: Math.ceil(total / limitValue)
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: error.message
    });
  }
});

// GET /api/projects/all
router.get('/all/dashboard', async (req, res) => {
  try {
    const roleType = req.user.role_type?.toLowerCase();

    let query = {};

    // only admin/user scoped
    if (roleType !== "superadmin") {
      query = applyScope(req, {});
    }

    const projects = await Project.find(query)
      .populate('customer_ids', 'company_name contact_name')
      .sort('-updatedAt');

    res.json(projects);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});


module.exports = router;