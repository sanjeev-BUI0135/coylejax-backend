const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const { logActivity, getChanges } = require('../utils/activityLogger');
const { createIdQuery } = require("../utils/idHelper");
const sendMail = require("../utils/sendMail");
const estimateMail = require("../utils/estimateMail");
const Estimate = require("../models/Estimate");
const multer = require("multer");
const approvedMail = require("../utils/approvedMail");
const internalMail = require("../utils/internalMail");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const Customer = require("../models/Customer");
const MaterialOrder = require("../models/MaterialOrder");
const lowMarkupItemsMail = require("../utils/lowMarkupItemsMail");
const upload = multer({ storage: multer.memoryStorage() });
const Project = require("../models/Project");
const { generateEstimatePdf } = require('../functions/generateEstimatePdf');
const Message = require('../models/Message');
const lowMarkupMail = require("../utils/lowMarkupMail");
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const MasterData = require("../models/MasterData");
const { getTermsWithFallback } = require("../utils/termsAndConditions.js");
const User = require("../models/User.js");
const Client = require("../models/Client.js");
const getRootCreator = require('../helpers/getRootCreator');
const Lead = require("../models/Lead");
const { getMarkupThreshold } = require('../helpers/getMarkupThreshold.js');
const { sendMessage } = require('../utils/twilio');
const { getLowMarkupRecipients } = require('../helpers/getLowMarkupRecipients.js');
const { hasLowMarkupItems, getLowMarkupItems } = require('../helpers/markupHelper.js');
const { autoTriggerMaterialApproval } = require("../helpers/autoTriggerMaterialApproval.js");
const ActivityLog = require('../models/ActivityLog');
const applyScope = require("../helpers/applyScope.js");
const buildAggregationPipeline = require("../utils/aggregationBuilder.js");
const estimateController = require("../controllers/estimateController");
const { getContactName, createMaterialOrderFromEstimate, createCustomerFromQuickEstimate, getUserEmailById, getOwnerId, applyTaxRateToEstimate } = require("../utils/estimateHelpers");

// create quick-estimate
router.post("/quick", auth, async (req, res) => {
  try {
    const { quick_customer, line_items, ...estimateData } = req.body;

    if (!quick_customer?.customer_name || !quick_customer?.email_address) {
      return res.status(400).json({
        error: "Customer name and email are required for quick estimates"
      });
    }

    const adminId = getOwnerId(req);
    if (req.body.customer_po_number) {
      const existingPO = await Estimate.findOne({
        customer_po_number: req.body.customer_po_number,
        created_by: { $in: [adminId, adminId.toString()] }
      });

    }
    const config = req.user?.project_number_config?.new_project || {};

    const year = config.year;
    const prefix = config.prefix || "";

    const newProjectIds = await Project.find({
      created_by: { $in: [adminId, adminId.toString()] },
      project_creation_type: "new_project"
    }).distinct("_id");

    const allEstimates = await Estimate.find({
      created_by: { $in: [adminId, adminId.toString()] },
      $or: [
        { is_quick_estimate: true },

        {
          project_id: {
            $in: newProjectIds
          }
        }
      ]
    })
      .select("estimate_number customer_po_number")
      .lean();

    const allProjects = await Project.find({
      created_by: { $in: [adminId, adminId.toString()] },
      project_creation_type: "new_project"
    })
      .select("project_number")
      .lean();

    let highestSeq = 0;
    const estRegex = new RegExp(`^EST-${year}(\\d{4})`);
    const projRegex = new RegExp(`^${year}(\\d{4})`);

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

    const nextSequence = Math.max(highestSeq, (config.start_number - 1) || 0) + 1;

    const estimate_number = `EST-${year}${String(nextSequence).padStart(4, "0")}${prefix}`;

    let customer_po_number = req.body.customer_po_number;

    if (!customer_po_number && estimate_number) {
      const baseEstNum = estimate_number.replace(/-\d+$/, "");
      customer_po_number = baseEstNum.startsWith('EST-')
        ? baseEstNum.replace(/^EST-/, 'PO-')
        : `PO-${baseEstNum}`;
    }

    const loggedInUserId = req.user?._id || null;

    // ---------------------------------------------------
    // PROCESS LINE ITEMS
    // ---------------------------------------------------
    let processedLineItems = [];
    if (Array.isArray(line_items) && line_items.length > 0) {
      processedLineItems = line_items.map(item => ({
        ...item,
        previous_unit_price: null
      }));
    }

    // ---------------------------------------------------
    // MARKUP STATUS
    // ---------------------------------------------------
    const materialMarkupPercent =
      parseFloat(estimateData.material_markup_amount) || 0;

    const markupLimit = await getMarkupThreshold(adminId);

    let additional_markup_status = "N/A";
    if (materialMarkupPercent > 0 && materialMarkupPercent < markupLimit) {
      additional_markup_status = "pending";
    }

    const hasLowMarkup = await hasLowMarkupItems(processedLineItems, adminId);

    // ---------------------------------------------------
    // CREATE ESTIMATE
    // ---------------------------------------------------
    const estimateObj = {
      ...estimateData,
      estimate_number,
      customer_po_number,
      is_quick_estimate: true,
      quick_customer,
      created_by_user: loggedInUserId,
      line_items: processedLineItems,
      created_by: adminId,
      additional_markup_status,
      markup_status: hasLowMarkup ? "pending" : "N/A",
      project_location: quick_customer.site_address || ""
    };
    await applyTaxRateToEstimate(estimateObj, adminId);

    const estimate = new Estimate(estimateObj);

    await estimate.save();

    // -------------------------------------
    // MARK LEAD AS CONVERTED (IF EXISTS)
    // -------------------------------------
    if (req.body.lead_id) {
      try {
        await Lead.findByIdAndUpdate(req.body.lead_id, {
          status: "CONVERTED",
          updatedAt: new Date()
        });
      } catch (leadErr) {
        console.error("Lead update error:", leadErr);
      }
    }

    // ---------------------------------------------------
    // AUTO-CREATE CUSTOMER IF APPROVED
    // ---------------------------------------------------
    let autoCreatedCustomer = null;
    if (estimate.status === "approved") {
      autoCreatedCustomer = await createCustomerFromQuickEstimate(
        estimate,
        adminId
      );
    }

    // ---------------------------------------------------
    // LOW MATERIAL MARKUP EMAIL (QUICK CUSTOMER)
    // ---------------------------------------------------
    try {
      const finalHasLowMarkup = await hasLowMarkupItems(estimate.line_items, adminId);

      if (
        finalHasLowMarkup &&
        estimate.quick_customer?.email_address
      ) {
        const lowMarkupItems = await getLowMarkupItems(estimate.line_items, adminId);

        if (lowMarkupItems.length > 0) {
          let creator = await User.findById(adminId).lean();
          if (!creator) {
            creator = await Client.findById(adminId).lean();
          }

          if (creator) {
            const ContactName =
              estimate.quick_customer.customer_name || "Customer";

            const estimateNo = estimate.estimate_number || "N/A";

            const recipients = await getLowMarkupRecipients(adminId);

            for (const user of recipients) {

              const emailHtml = lowMarkupItemsMail(
                user.full_name || "User",
                estimateNo,
                lowMarkupItems,
                estimate.total_amount,
                new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }),
                estimate._id.toString(),
                creator,
                false,
                markupLimit,
                'Estimate'
              );

              await sendMail({
                from: creator.companyName,
                replyTo: creator.email,
                to: user.email,
                subject: `Low Material Markup Alert - Estimate ${estimateNo}`,
                text: `Estimate ${estimateNo} has line items with low material markup.`,
                html: emailHtml
              });
            }
          }
        }
      }
    } catch (mailErr) {
      console.error("Quick low markup email error:", mailErr);
    }

    // ---------------------------------------------------
    // SEND ESTIMATE EMAIL (STATUS = SENT)
    // ---------------------------------------------------
    if (estimate.status === "sent" && quick_customer.email_address) {
      try {
        let creator = await User.findById(adminId).lean();
        if (!creator) {
          creator = await Client.findById(adminId).lean();
        }
        if (creator) {
          const magicLink = `${process.env.BASE_URL}/estimate-print?id=${estimate._id}`;

          const emailHtml = estimateMail(
            magicLink,
            estimate.estimate_number,
            quick_customer.customer_name,
            creator.email,
            creator.companyPhone,
            creator.companyName,
            creator.address,
            creator.full_name,
            creator.logo
          );

          await sendMail({
            from: creator.companyName,
            replyTo: creator.email,
            to: quick_customer.email_address,
            subject: `Estimate ${estimate.estimate_number} for ${quick_customer.customer_name}`,
            text: `Your estimate ${estimate.estimate_number} has been created.`,
            html: emailHtml
          });
        }
      } catch (mailError) {
        console.error("Estimate email error:", mailError);
      }
    }

    // ---------------------------------------------------
    // RESPONSE
    // ---------------------------------------------------
    const responseData = {
      ...estimate.toObject(),
      id: estimate._id.toString(),
      _id: estimate._id
    };

    if (autoCreatedCustomer) {
      responseData.auto_created_customer = {
        id: autoCreatedCustomer._id.toString(),
        contact_name: autoCreatedCustomer.contact_name,
        email: autoCreatedCustomer.email
      };
    }

    res.status(201).json(responseData);

    // Activity Logging
    const quickProjectName = quick_customer.project_name || 'N/A';
    const description = req.body.imported_via_planscan
      ? `Quick estimate "${estimate.estimate_number}" created with PlanScan AI for project "${quickProjectName}".`
      : `Quick estimate "${estimate.estimate_number}" created for project "${quickProjectName}".`;

    await logActivity(
      estimate.project_id || estimate._id,
      req.user,
      'Estimate',
      'Create',
      description,
      { estimate_number: estimate.estimate_number, is_quick: true, imported_via_planscan: !!req.body.imported_via_planscan },
      estimate._id,
      'Estimate'
    );
  } catch (error) {
    console.error("Quick estimate creation error:", error);
    res.status(400).json({ error: error.message });
  }
});

// get all estimate
router.get("/", auth, async (req, res) => {
  try {
    const { sort = "-updatedAt", limit = 25, page = 1, quick_only, created_by_user, search = "", project_id, company_name, customer, status, division_type, estimate_type, estimate_number, project_name,
      customer_name,
      type,
      total_amount, created_date } = req.query;

    const parsedLimit = parseInt(limit);
    const noLimit = parsedLimit === 0;

    const baseQuery = {};

    if (quick_only === "true") {
      baseQuery.is_quick_estimate = true;
    }

    if (created_by_user) {
      baseQuery.created_by_user = {
        $in: [
          created_by_user,
          new mongoose.Types.ObjectId(created_by_user)
        ]
      };
    }
    if (project_id) {
      baseQuery.project_id = {
        $in: [
          project_id,
          mongoose.Types.ObjectId.isValid(project_id)
            ? new mongoose.Types.ObjectId(project_id)
            : project_id
        ]
      };
    }

    // Status filter
    if (status) {
      baseQuery.status = status;
    }

    // Estimate Type filter
    if (estimate_type === "quick") {
      baseQuery.is_quick_estimate = true;
    }

    if (estimate_type === "project") {
      baseQuery.is_quick_estimate = false;
    }

    const finalQuery = applyScope(req, baseQuery, { excludeDivision: true });

    const { pipeline, countPipeline } = buildAggregationPipeline({
      query: finalQuery,
      search,
      sort,
      page: parseInt(page),
      limit: parsedLimit,
      isAll: noLimit,
      includeProject: true,
      includeCustomer: true,
      company_name,
      customer,
      division_type,
      estimate_number,
      project_name,
      customer_name,
      type,
      total_amount,
      created_date,
      status,
      user: req.user
    });

    const estimates = await Estimate.aggregate(pipeline);
    const totalAgg = await Estimate.aggregate(countPipeline);

    const total = totalAgg[0]?.total || 0;

    res.json({
      data: estimates,
      total,
      page: parseInt(page),
      limit: parsedLimit,
      pages: noLimit ? 1 : Math.ceil(total / parsedLimit)
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// get next PO number
router.get("/next-po-number", auth, estimateController.getNextPONumber);

// get estimate by id
router.get("/:id", auth, estimateController.getEstimateById);

// update estimate status
router.put( "/:estimateId/status", upload.single("signature"), async (req, res) => {
    try {
      const estimateId = req.params.estimateId;
      const status = req.body.status?.toLowerCase();
      const reject_reason = req.body.reject_reason;
      const query = createIdQuery(estimateId);

      const existingEstimate = await Estimate.findOne(query);
      if (!existingEstimate) return res.status(404).json({ error: "Estimate not found" });

      if (!["draft", "sent", "approved", "rejected", "expired"].includes(status)) {
        return res.status(400).json({ error: "Invalid status value" });
      }


      const updateData = {
        status,
        reject_reason,
        updatedAt: new Date(),
      };

      if (status === "approved") {
        updateData.approved_date = new Date();
        if (existingEstimate.line_items && existingEstimate.line_items.length > 0) {
          updateData.line_items = existingEstimate.line_items.map(item => ({
            ...item.toObject(),
            is_new: false
          }));
        }
      }
      if (status === "sent") updateData.sent_date = new Date();
      if (status === "rejected") updateData.rejected_date = new Date();

      // ---------------------------------------------------
      // SIGNATURE UPLOAD
      // ---------------------------------------------------
      let attachment = null;

      // Multipart upload
      if (req.file) {
        const uploadDir = path.join(__dirname, "../uploads/e-signature");
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

        const fileName = `${Date.now()}-${req.file.originalname}`;
        const filePath = path.join(uploadDir, fileName);

        fs.writeFileSync(filePath, req.file.buffer);

        attachment = {
          file_name: fileName,
          file_url: `${process.env.BASE_URL}/uploads/e-signature/${fileName}`,
          object_id: new mongoose.Types.ObjectId().toString(),
        };
      }

      // Base64 upload fallback
      if (req.body.signatureBase64) {
        const matches = req.body.signatureBase64.match(/^data:(.+);base64,(.+)$/);
        if (!matches) {
          return res.status(400).json({ error: "Invalid base64 signature format" });
        }

        const ext = matches[1].split("/")[1];
        const buffer = Buffer.from(matches[2], "base64");

        const uploadDir = path.join(__dirname, "../uploads/e-signature");
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

        const fileName = `${Date.now()}-signature.${ext}`;
        const filePath = path.join(uploadDir, fileName);

        fs.writeFileSync(filePath, buffer);

        attachment = {
          file_name: fileName,
          file_url: `${process.env.BASE_URL}/uploads/e-signature/${fileName}`,
        };
      }

      const queryUpdate = { $set: updateData };
      if (attachment) {
        queryUpdate.$push = { file_attachments: attachment };
      }

      // ---------------------------------------------------
      // UPDATE ESTIMATE
      // ---------------------------------------------------
      const estimate = await Estimate.findOneAndUpdate(
        query,
        queryUpdate,
        { new: true, runValidators: true }
      ).populate("project_id", "project_name location customer_ids");

      if (!estimate) {
        return res.status(404).json({ error: "Estimate not found" });
      }

      if (attachment && estimate.project_id) {
        try {
          await Project.findByIdAndUpdate(
            estimate.project_id._id || estimate.project_id,
            { $push: { file_attachments: attachment } }
          );
        } catch (err) {
          console.error("Failed to sync attachment to project:", err);
        }
      }

      if (status === "approved") {
        try {
          const pdfBuffer = await generateEstimatePdf(estimate._id, req, "summary");
          
          const uploadDir = path.join(__dirname, "../uploads/estimates");
          if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

          const pdfFileName = `${Date.now()}-Estimate-${estimate.estimate_number || 'Approved'}.pdf`;
          const pdfFilePath = path.join(uploadDir, pdfFileName);
          
          fs.writeFileSync(pdfFilePath, pdfBuffer);

          const pdfAttachment = {
            file_name: pdfFileName,
            file_url: `${process.env.BASE_URL}/uploads/estimates/${pdfFileName}`,
            object_id: new mongoose.Types.ObjectId().toString(),
          };

          if (estimate.project_id) {
            await Project.findByIdAndUpdate(
              estimate.project_id._id || estimate.project_id,
              { $push: { file_attachments: pdfAttachment } }
            );
          }
        } catch (pdfErr) {
          console.error("Failed to generate and attach estimate PDF:", pdfErr);
        }
      }

      let materialOrderCreated = false;
      let autoCreatedCustomer = null;

      // ---------------------------------------------------
      // HELPER: Resolve Creator ID (NO req.user)
      // ---------------------------------------------------
      const resolveCreatorId = async (estimateDoc, projectDoc = null) => {
        if (projectDoc?.created_by) return projectDoc.created_by;
        if (estimateDoc?.created_by) return estimateDoc.created_by;
        return null;
      };

      // ---------------------------------------------------
      // APPROVED FLOW
      // ---------------------------------------------------
      if (status === "approved") {
        let project = null;

        if (!estimate.is_quick_estimate && estimate.project_id) {
          project = await Project.findById(
            estimate.project_id._id || estimate.project_id
          ).lean();
        }

        // -------------------------------
        // QUICK ESTIMATE: AUTO CUSTOMER
        // -------------------------------
        if (estimate.is_quick_estimate && !estimate.converted_to_project) {
          const adminId = await resolveCreatorId(estimate, project);
          if (adminId) {
            autoCreatedCustomer = await createCustomerFromQuickEstimate(
              estimate,
              adminId
            );
          }
        }

        // -------------------------------
        // MATERIAL ORDER
        // -------------------------------
        try {
          const materialOrder = await createMaterialOrderFromEstimate(estimate);
          materialOrderCreated = !!materialOrder;
          const actingUser = req.user || {
            _id: null,
            full_name: estimate.is_quick_estimate
              ? `${estimate.quick_customer?.customer_name || 'Customer'} (Customer)`
              : 'Customer (via Link)'
          };
          if (materialOrder) {
            if (existingEstimate.status !== "approved") {
              await autoTriggerMaterialApproval(materialOrder);
            }

            await logActivity(
              estimate.project_id?._id || estimate.project_id || estimate._id,
              actingUser,
              'Material Order',
              'Create',
              `Material Order created from Estimate "${estimate.estimate_number}".`,
              {
                estimate_id: estimate._id,
                material_order_id: materialOrder._id
              },
              materialOrder._id,
              'MaterialOrder'
            );
          }

        } catch (err) {
          console.error("Material order creation error:", err);
        }

        // -------------------------------
        // EMAIL FLOW
        // -------------------------------
        try {
          const creatorId = await resolveCreatorId(estimate, project);
          let creator = null;

          if (creatorId) {
            creator = await User.findById(creatorId).lean();
            if (!creator) {
              creator = await Client.findById(creatorId).lean();
            }
          }

          if (!creator) {
            console.error("Creator not found for estimate:", estimate._id);
            throw new Error("Creator not found");
          }

          const magicLink = `${process.env.BASE_URL}/estimate-print?id=${estimate._id}`;
          const estimateNo = estimate.estimate_number || "N/A";

          const ContactName = estimate.is_quick_estimate
            ? estimate.quick_customer?.customer_name || "Customer"
            : await getContactName(estimate.project_id);

          const approvedAt = req.body.approvedAt
            ? new Date(req.body.approvedAt)
            : new Date();

          const formattedApprovedAt = approvedAt.toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          });

          const customerHtml = approvedMail(
            magicLink,
            ContactName,
            estimateNo,
            formattedApprovedAt,
            creator
          );

          const internalHtml = internalMail(
            ContactName,
            estimateNo,
            formattedApprovedAt,
            creator
          );

          // ---------------------------
          // ADMIN EMAIL
          // ---------------------------
          await sendMail({
            from: ContactName,
            to: creator.email,
            subject: `Estimate ${estimateNo} Approved`,
            text: `Estimate ${estimateNo} has been approved.`,
            html: internalHtml,
          });

          try {
            if (
              estimate.created_by_user &&
              estimate.created_by_user.toString() !== creatorId?.toString()
            ) {
              const creatorUser = await getUserEmailById(estimate.created_by_user);

              if (creatorUser?.email) {
                await sendMail({
                  from: creator.companyName,
                  replyTo: creator.email,
                  to: creatorUser.email,
                  subject: `Estimate ${estimateNo} Approved`,
                  text: `Estimate ${estimateNo} has been approved.`,
                  html: internalHtml,
                });
              }
            }
          } catch (err) {
            console.error("Created user mail error:", err);
          }
        } catch (mailErr) {
          console.error("Approval email error:", mailErr);
        }
      }

      // ---------------------------------------------------
      // REJECTED FLOW
      // ---------------------------------------------------
      if (status === "rejected") {
        try {
          const materialOrder = await MaterialOrder.findOne({
            estimate_id: estimate._id,
          });

          if (materialOrder) {
            await MaterialOrder.findByIdAndUpdate(materialOrder._id, {
              $set: {
                status: "rejected",
                rejected_date: new Date(),
                updatedAt: new Date(),
              },
            });
          }
        } catch (err) {
          console.error("Material order reject error:", err);
        }
      }

      // ---------------------------------------------------
      // FINAL RESPONSE
      // ---------------------------------------------------
      const responseData = {
        ...estimate.toObject(),
        materialOrderCreated,
        id: estimate._id.toString(),
        _id: estimate._id,
      };

      if (autoCreatedCustomer) {
        responseData.auto_created_customer = {
          id: autoCreatedCustomer._id.toString(),
          contact_name: autoCreatedCustomer.contact_name,
          email: autoCreatedCustomer.email,
        };
      }

      res.json(responseData);

      // Activity Logging
      let actionToLog = 'Status Change';
      if (status === 'sent') actionToLog = 'Sent';
      else if (status === 'approved') actionToLog = 'Approved';
      else if (status === 'rejected') actionToLog = 'Rejected';

      const ContactName = estimate.is_quick_estimate
        ? estimate.quick_customer?.customer_name || "Customer"
        : await getContactName(estimate.project_id);

      let actingUser = req.user || {
        full_name: ContactName ? `${ContactName} (Customer)` : 'Customer (via Link)'
      };

      if (!req.user) {
        const token = req.header('Authorization')?.replace('Bearer ', '');
        if (token) {
          try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret-key');
            if (decoded.type === 'user') {
              const currentUser = await User.findById(decoded.id).lean();
              if (currentUser) {
                const name = currentUser.full_name || `${currentUser.firstName || currentUser.first_name || ''} ${currentUser.lastName || currentUser.last_name || ''}`.trim();
                actingUser = {
                  full_name: `${name} (Manually Updated)`
                };
              }
            } else if (decoded.type === 'client') {
              const currentClient = await Client.findById(decoded.id).lean();
              if (currentClient) {
                const name = currentClient.contact_name || currentClient.full_name || `${currentClient.firstName || ''} ${currentClient.lastName || ''}`.trim();
                actingUser = {
                  full_name: `${name} (Manually Updated)`
                };
              }
            }
          } catch (e) {
            // Ignore invalid token
          }
        }
      } else if (req.user && (req.user.full_name || req.user.first_name || req.user.firstName)) {
         const name = req.user.full_name || `${req.user.firstName || req.user.first_name || ''} ${req.user.lastName || req.user.last_name || ''}`.trim();
         actingUser.full_name = `${name} (Manually Updated)`;
      }

      await logActivity(
        estimate.project_id?._id || estimate.project_id || estimate._id,
        actingUser,
        'Estimate',
        actionToLog,
        `Estimate "${estimate.estimate_number}" status changed to "${status}".`,
        [{ field: 'Status', old: existingEstimate.status || '-', new: status }],
        estimate._id,
        'Estimate'
      );
    } catch (error) {
      console.error("Status update error:", error);
      res.status(400).json({ error: error.message });
    }
  }
);

// create estimate
router.post("/", auth, async (req, res) => {
  try {
    const adminId = getOwnerId(req);
    if (req.body.customer_po_number) {
      const existingPO = await Estimate.findOne({
        customer_po_number: req.body.customer_po_number,
        created_by: { $in: [adminId, adminId.toString()] }
      });

    }
    const project = await Project.findById(req.body.project_id).lean();

    const isServiceProject =
      project.project_creation_type === "service_work_order";

    const config = isServiceProject
      ? req.user?.project_number_config?.service_project
      : req.user?.project_number_config?.new_project;

    const year = config.year;
    const prefix = config.prefix || '';

    if (!project) {
      return res.status(404).json({
        error: "Project not found"
      });
    }

    const projectNumberWithoutSuffix = project.project_number.replace(/[A-Za-z]+$/, '');

    const baseEstimateNumber = `EST-${projectNumberWithoutSuffix}${prefix}`;

    const existingProjectEstimates = await Estimate.find({
      project_id: { $in: [project._id, project._id.toString()] },
    })
      .select("estimate_number")
      .lean();

    let estimate_number = baseEstimateNumber;

    if (existingProjectEstimates.length > 0) {

      const suffixes = existingProjectEstimates.map(est => {

        const match = est.estimate_number.match(/-(\d+)$/);

        if (match) {
          return parseInt(match[1], 10);
        }

        return 1;
      });

      const nextSuffix = Math.max(...suffixes) + 1;

      estimate_number = `${baseEstimateNumber}-${nextSuffix}`;
    }

    let customer_po_number = req.body.customer_po_number;

    if (!customer_po_number && estimate_number) {
      const baseEstNum = estimate_number.replace(/-\d+$/, "");
      customer_po_number = baseEstNum.startsWith('EST-')
        ? baseEstNum.replace(/^EST-/, 'PO-')
        : `PO-${baseEstNum}`;
    }
    const markupLimit = await getMarkupThreshold(adminId);

    let creator = await User.findById(project.created_by).lean();
    if (!creator) {
      creator = await Client.findById(project.created_by).lean();
    }
    const loggedInUserId = req.user?._id || null;
    if (req.body.line_items && req.body.line_items.length > 0) {
      req.body.line_items = req.body.line_items.map(item => ({
        ...item,

        previous_unit_price: null
      }));

      if (req.body.total_amount != null) {
        req.body.total_amount =
          Math.round(Number(req.body.total_amount) * 100) / 100;
      }

    }
    const materialMarkupPercent = parseFloat(req.body.material_markup) || 0;
    if (materialMarkupPercent > 0 && materialMarkupPercent < markupLimit) {
      req.body.additional_markup_status = 'pending';
    } else if (materialMarkupPercent >= markupLimit || materialMarkupPercent === 0) {
      req.body.additional_markup_status = 'N/A';
    }

    const estimateObj = {
      ...req.body,
      estimate_number,
      customer_po_number,
      created_by: adminId,
      created_by_user: project.created_by_user || loggedInUserId,
    };
    await applyTaxRateToEstimate(estimateObj, adminId);

    const estimate = new Estimate(estimateObj);

    const hasLowMarkup = await hasLowMarkupItems(req.body.line_items, adminId);

    if (hasLowMarkup) {
      estimate.markup_status = 'pending';
    } else {
      estimate.markup_status = 'N/A';
    }

    await estimate.save();
    await estimate.populate("project_id", "project_name location customer_ids");

    if (estimate.status === "approved") {
      try {
        const materialOrder = await createMaterialOrderFromEstimate(estimate);
        if (materialOrder) {
          await autoTriggerMaterialApproval(materialOrder);
        }
        
      } catch (materialError) {
        console.error('Material order error:', materialError);
      }
    }

    const ContactName = await getContactName(estimate.project_id);
    const estimateNo = estimate.estimate_number || "N/A";

    const emailPromises = [];

    let customerIds = [];
    if (estimate.project_id && typeof estimate.project_id === 'object') {
      customerIds = estimate.project_id.customer_ids || [];
    } else if (estimate.project_id) {
      const project = await Project.findById(estimate.project_id).select('customer_ids');
      customerIds = project?.customer_ids || [];
    }

    let customers = [];
    if (customerIds && Array.isArray(customerIds) && customerIds.length > 0) {
      const customerIdStrings = customerIds.map(id => {
        if (typeof id === 'object' && id._id) {
          return id._id.toString();
        }
        return id.toString();
      });

      customers = await Customer.find({
        _id: { $in: customerIdStrings }
      }).select('email company_name contact_name');
    }

    const sendEmailToCustomers = async (subject, message, htmlContent) => {
      if (customers.length === 0) {
        return [];
      }

      const customerEmailPromises = customers.map(async (customer) => {
        const customerEmail = customer.email;

        if (customerEmail && customerEmail.trim() !== '') {
          try {
            await sendMail({
              from: creator.companyName,
              replyTo: creator.email,
              to: customerEmail,
              subject: subject,
              text: message,
              html: htmlContent
            });
            return { success: true, email: customerEmail, customer: customer.company_name };
          } catch (emailError) {
            return { success: false, email: customerEmail, error: emailError.message };
          }
        } else {
          return { success: false, email: null, reason: 'No email address' };
        }
      });

      const results = await Promise.allSettled(customerEmailPromises);
      return results;
    };


    const finalHasLowMarkup = await hasLowMarkupItems(estimate.line_items, creator._id);
    if (finalHasLowMarkup) {
      try {
        const lowMarkupItems = await getLowMarkupItems(
          estimate.line_items,
          creator._id
        );
        const recipients = await getLowMarkupRecipients(creator._id);
        const markupLimit = await getMarkupThreshold(creator._id);
        if (recipients.length > 0) {
          await Promise.all(
            recipients.map(user => {
              const html = lowMarkupItemsMail(
                user.full_name || "User",
                estimateNo,
                lowMarkupItems,
                estimate.total_amount,
                new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }),
                estimate._id.toString(),
                creator,
                false,
                markupLimit
              );
              return sendMail({
                from: creator.companyName,
                replyTo: creator.email,
                to: user.email,
                subject: `Low Material Markup Alert - Estimate ${estimateNo}`,
                text: `Estimate ${estimateNo} contains items with low markup.`,
                html
              });
            })
          );
        }
      } catch (err) {
        console.error("Low markup email error:", err);
      }

    }
    if (estimate.status === "sent") {
      try {
        const magicLink = `${process.env.BASE_URL}/estimate-print?id=${estimate._id}`;
        const emailHtml = estimateMail(magicLink, estimateNo, ContactName);

        emailPromises.push(
          sendEmailToCustomers(
            `Estimate ${estimateNo} Created for ${ContactName}`,
            `Your estimate ${estimateNo} has been created.`,
            emailHtml
          )
        );
      } catch (mailError) {
        console.error('Email error:', mailError);
      }
    }

    if (emailPromises.length > 0) {
      await Promise.allSettled(emailPromises);
    }


    const responseData = {
      ...estimate.toObject(),
      id: estimate.id || estimate._id.toString(),
      _id: estimate._id,
    };
    res.status(201).json(responseData);

    // Activity Logging
    const projectName = estimate.project_id?.project_name || estimate.project_id?.sub_project_name || req.body.project_name || 'N/A';
    const description = req.body.imported_via_planscan
      ? `Estimate "${estimate.estimate_number}" created with PlanScan AI for project "${projectName}".`
      : `Estimate "${estimate.estimate_number}" created for project "${projectName}".`;

    await logActivity(
      estimate.project_id?._id || estimate.project_id,
      req.user,
      'Estimate',
      'Create',
      description,
      { estimate_number: estimate.estimate_number, imported_via_planscan: !!req.body.imported_via_planscan },
      estimate._id,
      'Estimate'
    );
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// update estimate
router.put("/:id", auth, async (req, res) => {
  try {

    const estimateId = req.params.id;
    const query = createIdQuery(estimateId);

    // ---------------------------------------------------
    // 1. LOAD EXISTING ESTIMATE
    // ---------------------------------------------------
    const existingEstimate = await Estimate.findOne(query);

    if (req.body.customer_po_number) {
      const adminId = getOwnerId(req);

      const existingPO = await Estimate.findOne({
        customer_po_number: req.body.customer_po_number,
        created_by: { $in: [adminId, adminId.toString()] },
        _id: { $ne: existingEstimate._id }
      });

    }

    if (!existingEstimate) {
      return res.status(404).json({ error: "Estimate not found" });
    }

    // ---------------------------------------------------
    // 2. LOAD PROJECT IF NOT QUICK ESTIMATE
    // ---------------------------------------------------
    let project = null;

    if (!existingEstimate.is_quick_estimate) {

      if (!req.body.project_id) {
        return res.status(400).json({
          error: "Project ID is required for project-based estimates"
        });
      }

      if (!mongoose.Types.ObjectId.isValid(req.body.project_id)) {
        return res.status(400).json({
          error: "Invalid project ID"
        });
      }

      project = await Project.findById(req.body.project_id).lean();

      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      if (existingEstimate.status === "approved" && project?.status?.toLowerCase() === "completed") {
        req.body.status = "approved";
      }

    }

    // ---------------------------------------------------
    // 3. RESOLVE CREATOR
    // ---------------------------------------------------
    let creator = null;

    if (project) {

      creator = await User.findById(project.created_by).lean();

      if (!creator) {
        creator = await Client.findById(project.created_by).lean();
      }

    } else {

      creator = await User.findById(existingEstimate.created_by).lean();

      if (!creator) {
        creator = await Client.findById(existingEstimate.created_by).lean();
      }

    }

    if (!creator) {
      return res.status(400).json({ error: "Creator not found" });
    }

    // ---------------------------------------------------
    // 4. LINE ITEM PRICE HISTORY
    // ---------------------------------------------------
    if (Array.isArray(req.body.line_items)) {

      req.body.line_items = req.body.line_items.map((item, index) => {

        const existingItem = existingEstimate.line_items?.[index];

        if (existingItem && existingItem.unit_price !== item.unit_price) {

          return {
            ...item,
            previous_unit_price: existingItem.unit_price
          };

        }

        return {
          ...item,
          previous_unit_price: item.previous_unit_price || null
        };

      });

    }

    // ---------------------------------------------------
    // 5. MARKUP STATUS
    // ---------------------------------------------------
    if ('material_markup' in req.body) {
      const materialMarkupPercent = parseFloat(req.body.material_markup) || 0;
      if (materialMarkupPercent > 0 && materialMarkupPercent < 20) {
        req.body.additional_markup_status = "pending";
      } else {
        req.body.additional_markup_status = "N/A";
      }
    }

    if ('line_items' in req.body) {
      const hasLowMarkup = await hasLowMarkupItems(req.body.line_items, creator._id);
      if (hasLowMarkup) {
        req.body.markup_status = "pending";
      } else {
        req.body.markup_status = "N/A";
      }
    }

    // ---------------------------------------------------
    // 6. BUILD UPDATE DATA
    // ---------------------------------------------------
    const updateData = {
      ...req.body,
      is_quick_estimate: existingEstimate.is_quick_estimate,
      updatedAt: new Date()
    };
    await applyTaxRateToEstimate(updateData, creator._id);

    if ("estimate_number" in updateData) {
      delete updateData.estimate_number;
    }
    
    if ("created_by" in updateData) {
      delete updateData.created_by;
    }
    
    if ("created_by_user" in updateData) {
      delete updateData.created_by_user;
    }
    
    if ("created_by_model" in updateData) {
      delete updateData.created_by_model;
    }

    if (updateData.total_amount != null) {
      updateData.total_amount =
        Math.round(Number(updateData.total_amount) * 100) / 100;
    }

    // Only clear is_new flags when FIRST transitioning to approved status.
    // If the estimate was already approved and is being edited (admin added new items),
    // preserve is_new: true on those new items so the print page can hide them.
    const wasAlreadyApproved = existingEstimate.status === "approved";
    if (
      updateData.status === "approved" &&
      !wasAlreadyApproved &&
      Array.isArray(updateData.line_items)
    ) {
      updateData.line_items = updateData.line_items.map(item => ({
        ...item,
        is_new: false
      }));
    }

    // ---------------------------------------------------
    // 7. UPDATE ESTIMATE
    // ---------------------------------------------------
    const estimate = await Estimate.findOneAndUpdate(
      query,
      updateData,
      { new: true, runValidators: true }
    ).populate("project_id", "project_name location customer_ids");

    if (!estimate) {
      return res.status(404).json({ error: "Estimate not found after update" });
    }

    // ---------------------------------------------------
    // 8. MATERIAL ORDER ON APPROVE
    // ---------------------------------------------------
    if (estimate.status === "approved") {
      if (existingEstimate.status !== "approved") {
        try {
          const materialOrder = await createMaterialOrderFromEstimate(estimate);
          if (materialOrder) {
            await autoTriggerMaterialApproval(materialOrder);
          }
        } catch (err) {
          console.error("Material order error:", err);
        }
      } else {
        try {
          await createMaterialOrderFromEstimate(estimate);
        } catch (err) {
          console.error("Material order update error:", err);
        }
      }
    }

    // ---------------------------------------------------
    // 9. CONTACT NAME
    // ---------------------------------------------------
    const ContactName = estimate.is_quick_estimate
      ? estimate.quick_customer?.customer_name || "Customer"
      : await getContactName(estimate.project_id);

    const estimateNo = estimate.estimate_number || "N/A";

    // ---------------------------------------------------
    // 10. EMAIL HELPER
    // ---------------------------------------------------
    const sendEmail = async (to, subject, html, text = "") => {

      if (!to) return;

      try {

        await sendMail({
          from: creator.companyName,
          replyTo: creator.email,
          to,
          subject,
          text,
          html
        });

      } catch (err) {
        console.error("Email error:", err);
      }

    };

    // ---------------------------------------------------
    // 11. SENT EMAIL FLOW
    // ---------------------------------------------------
    if (
      req.body.status === "sent" &&
      existingEstimate.status !== "sent"
    ) {

      const magicLink = `${process.env.BASE_URL}/estimate-print?id=${estimate._id}`;

      const emailHtml = estimateMail(
        magicLink,
        estimateNo,
        ContactName,
        creator.email,
        creator.companyPhone,
        creator.companyName,
        creator.address,
        creator.full_name,
        creator.logo
      );

      if (estimate.is_quick_estimate) {

        await sendEmail(
          estimate.quick_customer?.email_address,
          `Estimate ${estimateNo}`,
          emailHtml,
          `Your estimate ${estimateNo} has been shared.`
        );

      } else {

        const projectData = await Project.findById(
          estimate.project_id._id || estimate.project_id
        ).select("customer_ids");

        const customerIds = projectData?.customer_ids || [];

        if (customerIds.length > 0) {

          const customers = await Customer.find({
            _id: { $in: customerIds }
          }).select("email");

          for (const customer of customers) {

            await sendEmail(
              customer.email,
              `Estimate ${estimateNo} Updated`,
              emailHtml,
              `Your estimate ${estimateNo} has been updated.`
            );

          }

        }

      }

    }

    // ---------------------------------------------------
    // 12. LOW MARKUP EMAIL (INTERNAL USERS)
    // ---------------------------------------------------
    const markupLimit = await getMarkupThreshold(creator._id);
    const finalHasLowMarkup = await hasLowMarkupItems(
      estimate.line_items,
      creator._id
    );
    if ('line_items' in req.body && finalHasLowMarkup && existingEstimate.markup_status !== "pending") {
      try {
        const lowMarkupItems = await getLowMarkupItems(
          estimate.line_items,
          creator._id
        );
        const recipients = await getLowMarkupRecipients(creator._id);
        if (recipients.length > 0) {
          await Promise.all(
            recipients.map(user => {
              const html = lowMarkupItemsMail(
                user.full_name || "User",
                estimateNo,
                lowMarkupItems,
                estimate.total_amount,
                new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }),
                estimate._id.toString(),
                creator,
                false,
                markupLimit
              );
              return sendMail({
                from: creator.companyName,
                replyTo: creator.email,
                to: user.email,
                subject: `Low Material Markup Alert - Estimate ${estimateNo}`,
                text: `Estimate ${estimateNo} contains items with low markup.`,
                html
              });
            })
          );
          
          await Estimate.updateOne(
            { _id: estimate._id },
            { $set: { markup_status: "pending" } }
          );
          estimate.markup_status = "pending";
        }
      } catch (err) {
        console.error("Low markup email error:", err);
      }

    }

    // ---------------------------------------------------
    // 13. RESPONSE
    // ---------------------------------------------------
    res.json({
      ...estimate.toObject(),
      id: estimate._id.toString()
    });

    // Activity Logging
    const isStatusChange = req.body.status && req.body.status !== existingEstimate.status;
    let actionName = isStatusChange ? 'Status Change' : 'Update';
    if (isStatusChange) {
      const s = req.body.status.toLowerCase();
      if (s === 'sent') actionName = 'Sent';
      else if (s === 'approved') actionName = 'Approved';
      else if (s === 'rejected') actionName = 'Rejected';
    }

    const trackedFields = [
      'status', 'total_amount', 'subtotal', 'tax_rate', 'tax_amount', 'material_markup',
      'material_markup_amount', 'terms_and_conditions', 'notes', 'invoiced_amount',
      'customer_po_number', 'line_items', 'Scope_of_work', 'project_manager',
      'project_location', 'valid_until', 'markup_status', 'additional_markup_status',
      'reject_reason', 'revision_date', 'is_quick_estimate'
    ];
    const changes = getChanges(existingEstimate, estimate, trackedFields);

    const activityProjectId =
      estimate.project_id &&
        mongoose.Types.ObjectId.isValid(
          estimate.project_id?._id || estimate.project_id
        )
        ? estimate.project_id?._id || estimate.project_id
        : estimate._id;


    await logActivity(
      activityProjectId,
      req.user,
      'Estimate',
      actionName,
      isStatusChange
        ? `Estimate "${estimate.estimate_number}" status changed to "${estimate.status}".`
        : (req.body.imported_via_planscan
            ? `Estimate "${estimate.estimate_number}" details updated with PlanScan AI.`
            : `Estimate "${estimate.estimate_number}" details updated.`),
      changes.length > 0 ? changes : {
        estimate_number: estimate.estimate_number,
        status: estimate.status,
        previous_status: existingEstimate.status,
        imported_via_planscan: !!req.body.imported_via_planscan
      },
      estimate._id,
      'Estimate'
    );

  } catch (error) {

    console.error("Error updating estimate:", error);

    res.status(400).json({
      error: error.message
    });

  }
});

// DELETE /estimates/bulk
router.delete("/bulk", auth, estimateController.bulkDeleteEstimates);

// delete estimate id
router.delete("/:id", auth, estimateController.deleteEstimate);

// send estimate email
router.put("/:id/send-email", auth, estimateController.sendEstimateEmail);

// update invoiced amount
router.put("/:id/invoiced-amount", auth, estimateController.updateInvoicedAmount);

// convert to project
router.post("/:id/convert-to-project", auth, estimateController.convertToProject);

// send estimate SMS
router.put("/:id/send-sms", auth, estimateController.sendEstimateSMS);

module.exports = router;
