const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const { logActivity } = require('../utils/activityLogger');
const { createIdQuery } = require("../utils/idHelper");
const MaterialOrder = require("../models/MaterialOrder");
const InventoryItem = require("../models/InventoryItem");
const Project = require("../models/Project");
const Estimate = require("../models/Estimate");
const Customer = require("../models/Customer");
const User = require("../models/User");
const sendMail = require("../utils/sendMail");
const materialordersApprovalMail = require("../utils/materialordersApprovalMail");
const Client = require("../models/Client");
const mongoose = require("mongoose");
const crypto = require("crypto");
const { getApprovalThreshold } = require("../helpers/getApprovalThreshold.js");
const applyScope = require("../helpers/applyScope.js");
const buildAggregationPipeline = require("../utils/aggregationBuilder.js");
const { notifyApprovalStatusChange } = require("../helpers/notifyApprovalStatusChange");

require('dotenv').config()

// Helper functions with better error handling and price calculation
const calculateTotalCost = (lineItems) => {
  if (!lineItems || !Array.isArray(lineItems)) {
    return 0;
  }

  const total = lineItems.reduce((total, item, index) => {
    const quantity = parseFloat(item.quantity_ordered) ||
      parseFloat(item.quantity) ||
      parseFloat(item.qty) || 0;

    let price = parseFloat(item.unit_price) ||
      parseFloat(item.price) ||
      parseFloat(item.cost) ||
      parseFloat(item.rate) ||
      parseFloat(item.amount) || 0;

    if (price === 0) {
      console.warn(`No price found for line item ${index}: ${item.description || 'Unknown item'}. Using price: 0`);
      price = 0;
    }

    const itemTotal = quantity * price;
    return total + itemTotal;
  }, 0);

  return total;
};

const checkInventoryStatus = async (lineItems) => {
    if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
        return "No items";
    }

    let outOfStockItems = [];
    let inventoryItemCount = 0;
    let notAvailableCount = 0;

    for (const item of lineItems) {
        if (!item.inventory_item_id) {
            notAvailableCount++;
            continue;
        }

        inventoryItemCount++;
        const inventory = await InventoryItem.findById(item.inventory_item_id)
            .select("quantity item_name");

        const qty = inventory?.quantity || 0;

        if (qty <= 0) {
            outOfStockItems.push(inventory?.item_name || "Unknown Item");
        }
    }

    let outOfStockCount = outOfStockItems.length;
    let status = "";

    if (notAvailableCount > 0) {
        if (outOfStockCount > 0) {
            status = "Some items out of stock and some items not available in inventory management";
        } else if (inventoryItemCount > 0) {
            status = "Some items not available in inventory management";
        } else {
            status = "Not available in inventory management";
        }
    } else {
        if (outOfStockCount === inventoryItemCount && inventoryItemCount > 0) {
            status = "All items out of stock";
        } else if (outOfStockCount > 0) {
            status = "Some items out of stock";
        } else {
            status = "All items in stock";
        }
    }

    return status;
};

const getProjectName = async (projectId, estimateId = null) => {
  try {
    if (projectId) {
      let project = null;
    try {
      const projectQuery = createIdQuery(projectId);
      project = await Project.findOne(projectQuery);
    } catch (objIdError) {
      console.warn("ObjectId lookup failed for project, trying string lookup");
    }

    if (!project) {
      const stringQueries = [
        { _id: projectId },
        { project_id: projectId },
        { projectId: projectId },
        { project_number: projectId },
        { code: projectId },
        { project_code: projectId }
      ];

      for (const query of stringQueries) {
        try {
          project = await Project.findOne(query);
          if (project) {
            break;
          }
        } catch (err) {
        }
      }
    }

    if (project) {
      return project.project_name || project.name || project.title || "Unknown Project";
    }
    }

    if (estimateId) {
      const estimate = await Estimate.findById(estimateId);
      if (estimate && estimate.is_quick_estimate && estimate.quick_customer && estimate.quick_customer.project_name) {
        return estimate.quick_customer.project_name;
      }
    }

    return "Unknown Project";

  } catch (error) {
    console.error("Error fetching project name:", error);
    return "Unknown Project";
  }
};

const fetchCustomerDetails = async (materialOrder) => {
  try {
    let customerName = "Valued Customer";
    let customerEmail = adminUser?.email;
    let projectName = "Unknown Project";

    if (materialOrder.project_id || materialOrder.estimate_id) {
      projectName = await getProjectName(materialOrder.project_id, materialOrder.estimate_id);
    } else if (materialOrder.project_name) {
      projectName = materialOrder.project_name;
    }

    const directCustomerName = materialOrder.customer_name ||
      materialOrder.contact_name ||
      materialOrder.client_name ||
      materialOrder.customer ||
      materialOrder.client;

    const directCustomerEmail = materialOrder.customer_email ||
      materialOrder.contact_email ||
      materialOrder.client_email ||
      materialOrder.email;

    if (directCustomerName && directCustomerEmail) {
      return {
        customerName: directCustomerName,
        customerEmail: directCustomerEmail,
        projectName: projectName
      };
    }

    if (materialOrder.customer_id) {
      try {
        const customerQuery = createIdQuery(materialOrder.customer_id);
        const customer = await Customer.findOne(customerQuery);

        if (customer) {
          customerName = customer.contact_name ||
            customer.name ||
            customer.customer_name ||
            customer.company_name ||
            (customer.firstName && customer.lastName ? `${customer.firstName} ${customer.lastName}` : null) ||
            (customer.first_name && customer.last_name ? `${customer.first_name} ${customer.last_name}` : null) ||
            "Valued Customer";

          customerEmail = customer.email ||
            customer.customer_email ||
            customer.contact_email ||
            customer.email_address ||
            customer.primary_email ||
            adminUser?.email;
          return { customerName, customerEmail, projectName };
        }
      } catch (error) {
        console.warn("Error fetching customer by customer_id:", error.message);
      }
    }

    if (materialOrder.project_id) {
      try {
        let project = null;

        try {
          const projectQuery = createIdQuery(materialOrder.project_id);
          project = await Project.findOne(projectQuery);
        } catch (objIdError) {
        }

        if (!project) {
          const stringQueries = [
            { project_id: materialOrder.project_id },
            { projectId: materialOrder.project_id },
            { project_number: materialOrder.project_id },
            { code: materialOrder.project_id },
            { project_code: materialOrder.project_id },
            { _id: materialOrder.project_id }
          ];

          for (const query of stringQueries) {
            try {
              project = await Project.findOne(query);
              if (project) {
                break;
              }
            } catch (err) {
            }
          }
        }

        if (project) {
          if (project.customer_id) {
            let customer = null;

            try {
              const customerQuery = createIdQuery(project.customer_id);
              customer = await Customer.findOne(customerQuery);
            } catch (custObjIdError) {
            }

            if (!customer) {
              const customerStringQueries = [
                { _id: project.customer_id },
                { customer_id: project.customer_id },
                { customerId: project.customer_id }
              ];

              for (const query of customerStringQueries) {
                try {
                  customer = await Customer.findOne(query);
                  if (customer) {
                    break;
                  }
                } catch (err) {
                }
              }
            }

            if (customer) {
              customerName = customer.contact_name ||
                customer.name ||
                customer.customer_name ||
                customer.company_name ||
                (customer.firstName && customer.lastName ? `${customer.firstName} ${customer.lastName}` : null) ||
                (customer.first_name && customer.last_name ? `${customer.first_name} ${customer.last_name}` : null) ||
                "Valued Customer";

              customerEmail = customer.email ||
                customer.customer_email ||
                customer.contact_email ||
                customer.email_address ||
                customer.primary_email ||
                adminUser?.email;
              return { customerName, customerEmail, projectName };
            }
          }
        }
      } catch (error) {
        console.warn("Error in project->customer lookup:", error.message);
      }
    }

    const alternativeCustomerFields = ['contact_name', 'client_name', 'customer', 'client', 'customer_name'];
    const alternativeEmailFields = ['contact_email', 'client_email', 'customer_email', 'email'];

    for (const field of alternativeCustomerFields) {
      if (materialOrder[field]) {
        customerName = materialOrder[field];
        break;
      }
    }

    for (const field of alternativeEmailFields) {
      if (materialOrder[field]) {
        customerEmail = materialOrder[field];
        break;
      }
    }
    return {
      customerName,
      customerEmail,
      projectName
    };

  } catch (error) {
    console.error("Error in fetchCustomerDetails:", error);
    return {
      customerName: "Valued Customer",
      customerEmail: adminUser?.email,
      projectName: "Unknown Project"
    };
  }
};

// UPDATED: Fetch approval user details with better error handling
const fetchApprovalUser = async (materialOrder) => {
  try {
    // Check various possible fields for approval user ID
    const approvalUserId = materialOrder.approval_user_id ||
      materialOrder.approval_user ||
      materialOrder.approved_by ||
      materialOrder.created_by;


    if (!approvalUserId) {
      return null;
    }

    // Try to fetch user with createIdQuery first
    let user = null;
    try {
      const userQuery = createIdQuery(approvalUserId);
      user = await User.findOne(userQuery);
    } catch (error) {
      // console.warn("ObjectId lookup failed for user, trying string lookup:", error.message);
    }

    // If not found, try alternative queries
    if (!user) {
      const stringQueries = [
        { _id: approvalUserId },
        { user_id: approvalUserId },
        { userId: approvalUserId }
      ];

      for (const query of stringQueries) {
        try {
          user = await User.findOne(query);
          if (user) {
            break;
          }
        } catch (err) {
          // console.warn('Query failed:', query, err.message);
        }
      }
    }

    if (user) {
      const userName = user.full_name || user.name || user.username || null;
      return userName;
    }

    return null;
  } catch (error) {
    console.error("Error fetching approval user:", error);
    return null;
  }
};

// Fetch estimate data from Estimate collection
const getEstimateData = async (estimateId) => {
  try {
    if (!estimateId) return null;

    const Estimate = require("../models/Estimate");
    const estimateQuery = createIdQuery(estimateId);
    const estimate = await Estimate.findOne(estimateQuery);

    if (estimate) {
      return {
        total_amount: estimate.total_amount || estimate.total_cost || 0,
        line_items: estimate.line_items || [],
        is_quick_estimate: estimate.is_quick_estimate,
        quick_customer: estimate.quick_customer
      };
    }

    return null;
  } catch (error) {
    console.error("Error fetching estimate data:", error);
    return null;
  }
};

const updateProjectMaterialStatus = async (projectId) => {
  if (!projectId) return null;

  try {
    // Fetch all material orders for this project
    const materialOrders = await MaterialOrder.find({
      $or: [
        { project_id: projectId },
        { project_id: projectId.toString() }
      ]
    });

    if (!materialOrders || materialOrders.length === 0) {
      return null;
    }

    // Calculate overall status across ALL orders
    let totalItems = 0;
    let notOrderedItems = 0;
    let fullyReceivedItems = 0;
    let partiallyReceivedItems = 0;
    let pendingDeliveryItems = 0;

    materialOrders.forEach(order => {
      if (!order.line_items || !Array.isArray(order.line_items)) return;

      order.line_items.forEach(item => {
        totalItems++;

        const ordered = parseFloat(item.quantity_ordered || item.quantity || 0);
        const received = parseFloat(item.quantity_received || 0);
        const status = (item.status || '').toLowerCase();

        if (status === 'not ordered' || ordered === 0) {
          notOrderedItems++;
        } else if (received >= ordered && ordered > 0) {
          fullyReceivedItems++;
        } else if (received > 0 && received < ordered) {
          partiallyReceivedItems++;
        } else if (status === 'ordered' || status === 'pending') {
          pendingDeliveryItems++;
        }
      });
    });

    // Determine overall status
    let newStatus = null;

    if (totalItems === 0) {
      newStatus = null;
    } else if (fullyReceivedItems === totalItems) {
      newStatus = 'All Materials In Stock';
    } else if (fullyReceivedItems > 0 || partiallyReceivedItems > 0) {
      newStatus = 'Partially Received';
    } else if (pendingDeliveryItems > 0) {
      newStatus = 'Pending Delivery';
    } else if (notOrderedItems === totalItems) {
      newStatus = 'Not Ordered';
    } else {
      newStatus = 'Partially Received';
    }

    // Update project with new status
    const projectQuery = createIdQuery(projectId);
    await Project.findOneAndUpdate(
      projectQuery,
      { materials_status: newStatus },
      { new: true }
    );

    return newStatus;

  } catch (error) {
    console.error(`Error updating project material status for ${projectId}:`, error);
    throw error;
  }
};

router.post("/:id/send-mail", auth, async (req, res) => {
  try {

    const adminId =
      req.user.role_type === "admin"
        ? req.user._id
        : req.user.created_by;

    const adminUser = await Client.findById(adminId);
    if (!adminUser) {
      return res.status(404).json({ error: "Admin user not found" });
    }

    const logo = adminUser.logo || req.user.logo;

    const { emails = [] } = req.body;

    const materialOrder = await MaterialOrder.findById(req.params.id);
    if (!materialOrder) {
      return res.status(404).json({ error: "Material order not found" });
    }

    const estimateData = await getEstimateData(materialOrder.estimate_id);

    const projectName =
      (await getProjectName(materialOrder.project_id, materialOrder.estimate_id)) ||
      materialOrder.project_name ||
      `Project ${materialOrder.project_id}`;

    const totalCost =
      estimateData?.total_amount
        ? parseFloat(estimateData.total_amount)
        : calculateTotalCost(materialOrder.line_items);

    const lineItemsForInventory =
      estimateData?.line_items?.length
        ? estimateData.line_items
        : materialOrder.line_items;

    const inventoryStatus = await checkInventoryStatus(lineItemsForInventory);

    const customerName = materialOrder.customer_name || "Customer";

    let displayName = "";

    if (estimateData?.is_quick_estimate) {
      displayName = [
        estimateData?.quick_customer?.company_name,
        estimateData?.quick_customer?.customer_name
      ]
        .filter(Boolean)
        .join(" - ");
    } else {
      let project = null;
      let customer = null;
      if (materialOrder.project_id) {
        try {
          project = await Project.findById(materialOrder.project_id);
          if (project?.customer_ids?.[0]) {
            customer = await Customer.findById(project.customer_ids[0]);
          }
        } catch (err) {
          console.warn("Error finding project or customer:", err.message);
        }
      }

      displayName = [
        customer?.company_name,
        project?.project_name,
        customer?.contact_name
      ]
        .filter(Boolean)
        .join(" - ");
    }

    const orderNumber =
      materialOrder.order_number ||
      materialOrder._id.toString().slice(-6);

    const approvalThreshold = await getApprovalThreshold(adminId);
    const approvalToken = crypto.randomBytes(32).toString("hex");

    // Save token to order
    await MaterialOrder.findByIdAndUpdate(
      materialOrder._id,
      { approval_token: approvalToken }
    );
    const recipients = [
      adminUser.email,
      ...emails
    ]
      .filter(Boolean)
      .map(e => e.toLowerCase())
      .filter((v, i, a) => a.indexOf(v) === i);

    await MaterialOrder.findByIdAndUpdate(
      materialOrder._id,
      {
        approver_emails: recipients,
        order_status: "Pending",
        requirement_status: "Pending"
      }
    );

    const emailPromises = recipients.map(async (recipientEmail) => {
      // Try to find user to attach userId to link
      let uId = null;
      let userDoc = await User.findOne({ email: recipientEmail });
      if (!userDoc) {
        userDoc = await Client.findOne({ email: recipientEmail });
      }
      if (userDoc) {
        uId = userDoc._id.toString();
      }

      const approveLink = `${process.env.FRONTEND_URL}/material-orders/${materialOrder._id}`;
      const rejectLink = `${process.env.FRONTEND_URL}/material-orders/${materialOrder._id}`;

      const emailHtml = materialordersApprovalMail(
        approveLink,
        rejectLink,
        displayName,
        customerName,
        totalCost,
        inventoryStatus,
        orderNumber,
        approvalThreshold,
        materialOrder._id.toString(),
        estimateData,
        logo,
        adminUser
      );

      return sendMail({
        from: adminUser.companyName,
        replyTo: adminUser.email,
        to: recipientEmail,
        subject: `Manual Material Order Approval - ${projectName}`,
        text: `Material order approval requested for ${projectName}.\nTotal Cost: ${totalCost.toFixed(2)}\nInventory Status: ${inventoryStatus}`,
        html: emailHtml
      });
    });

    await Promise.all(emailPromises);

    res.json({
      message: "Approval mail sent successfully",
      approvers: recipients
    });

  } catch (error) {
    console.error("Error sending approval mail:", error);
    res.status(500).json({ error: "Server error" });
  }
});

const sendApprovalEmails = async (materialOrder, isUpdate = false, req) => {
  try {
    const { customerName, projectName } = await fetchCustomerDetails(materialOrder);

    if (customerName === "Valued Customer") {
      console.warn("WARNING: Still using default customer name - customer fetch may have failed");
    }
    const adminId = materialOrder.created_by;
    const adminUser = await Client.findById(adminId);

    const approvalToken = crypto.randomBytes(32).toString("hex");
    await MaterialOrder.findByIdAndUpdate(
      materialOrder._id,
      { approval_token: approvalToken }
    );
    const estimateData = await getEstimateData(materialOrder.estimate_id);

    const totalCost = estimateData && estimateData.total_amount
      ? parseFloat(estimateData.total_amount)
      : calculateTotalCost(materialOrder.line_items);

    const lineItemsForInventory = estimateData && estimateData.line_items && estimateData.line_items.length > 0
      ? estimateData.line_items
      : materialOrder.line_items;

    const inventoryStatus = await checkInventoryStatus(lineItemsForInventory);
    const approvalThreshold = await getApprovalThreshold(adminId);
    const orderNumber = materialOrder.order_number || materialOrder._id.toString().slice(-6);

    const hasOutOfStockItems = inventoryStatus.toLowerCase().includes("out of stock");
    const allItemsInStock = inventoryStatus.toLowerCase().includes("all items in stock") ||
      inventoryStatus.toLowerCase().includes("available");

    let shouldSendEmail = false;
    let autoApprove = false;
    let reason = "";

    if (totalCost > approvalThreshold) {
      shouldSendEmail = true;
      reason = `Cost exceeds $${approvalThreshold.toLocaleString()} - Requires approval`;
    } else if (totalCost <= approvalThreshold && hasOutOfStockItems) {
      shouldSendEmail = true;
      reason = `Cost is below $${approvalThreshold.toLocaleString()} BUT inventory has out of stock items`;
    } else if (totalCost <= approvalThreshold && allItemsInStock) {
      autoApprove = true;
      reason = `Cost is below $${approvalThreshold.toLocaleString()} AND all items in stock - Auto approved`;
    } else {
      shouldSendEmail = true;
      reason = `Approval required for this order`;
    }

    if (autoApprove) {
      try {
        await MaterialOrder.findByIdAndUpdate(
          materialOrder._id,
          {
            order_status: "Approved",
            rejection_reason: null,
            approval_method: "Auto-approved",
            approval_user_id: req && req.user ? req.user._id : null
          }
        );
        return { success: true, message: "Order auto-approved", autoApproved: true };
      } catch (error) {
        console.error("Error auto-approving order:", error);
        return { success: false, error: error.message };
      }
    }

    if (shouldSendEmail) {
      const emailData = {
        approveLink: `${process.env.FRONTEND_URL}/material-orders/${materialOrder._id}`,
        rejectLink: `${process.env.FRONTEND_URL}/material-orders/${materialOrder._id}`,
        projectName,
        customerName,
        totalCost,
        inventoryStatus,
        orderNumber,
        approvalThreshold,
        orderId: materialOrder._id.toString(),
        estimateData
      };

      const emailPromises = [];

      try {
        const adminEmailHtml = materialordersApprovalMail(
          emailData.approveLink,
          emailData.rejectLink,
          emailData.projectName,
          emailData.customerName,
          emailData.totalCost,
          emailData.inventoryStatus,
          emailData.orderNumber,
          emailData.approvalThreshold,
          emailData.orderId,
          emailData.estimateData,
          adminUser?.logo || (req && req.user ? req.user.logo : undefined),
          adminUser
        );

        const adminSubject = isUpdate
          ? `Material Order Update Requires Approval - ${projectName}`
          : `Material Order Requires Approval - ${projectName}`;
        emailPromises.push(
          sendMail({
            from: adminUser?.companyName,
            replyTo: adminUser?.email,
            to: adminUser?.email,
            subject: adminSubject,
            text: `Material order for ${projectName} requires approval. Customer: ${customerName}. Total cost: ${totalCost.toLocaleString()}. Inventory: ${inventoryStatus}`,
            html: adminEmailHtml
          })
        );

        await Promise.all(emailPromises);
        return { success: true, message: "Emails sent successfully" };

      } catch (emailError) {
        console.error("Error sending emails:", emailError);
        return { success: false, error: emailError.message };
      }
    } else {
      return { success: false, message: reason };
    }
  } catch (error) {
    console.error("Error in sendApprovalEmails:", error);
    return { success: false, error: error.message };
  }
};

// UPDATED: Get all material orders with estimate data and approval user
router.get("/", auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || "";
    const project_id = req.query.project_id || "";
    const customer = req.query.customer || "";
    const company_name = req.query.company_name || "";
    const status = req.query.status || "";
    const isAll = req.query.all === "true";
    const project_name = req.query.project_name || "";
    const customer_name = req.query.customer_name || "";
    const estimate_number = req.query.estimate_number || "";
    const created_date = req.query.created_date || "";
    const created_by_user = req.query.created_by_user || "";
    const requiresApproval = req.query.requiresApproval || "all";

    const adminId =
      req.user.role_type === "admin"
        ? req.user._id
        : req.user.created_by;
    const approvalThreshold = await getApprovalThreshold(adminId);

    const baseQuery = {};
    if (created_by_user) {
      baseQuery.created_by_user = {
        $in: [
          created_by_user,
          mongoose.Types.ObjectId.isValid(created_by_user) ? new mongoose.Types.ObjectId(created_by_user) : created_by_user
        ]
      };
    }
    const finalQuery = applyScope(req, baseQuery, { excludeDivision: true });

    const { pipeline, countPipeline } = buildAggregationPipeline({
      query: finalQuery,
      sort: "-updatedAt",
      search,
      page,
      limit,
      isAll,
      includeProject: true,
      includeCustomer: true,
      includeEstimate: true,
      project_id,
      customer,
      company_name,
      status,
      user: req.user,
      project_name,
      customer_name,
      estimate_number,
      created_date,
      statusField: "order_status",
      requiresApproval,
      approvalThreshold
    });

    const materialOrders = await MaterialOrder.aggregate(pipeline);
    const totalAgg = await MaterialOrder.aggregate(countPipeline);

    const total = totalAgg[0]?.total || 0;

    const responseData = await Promise.all(
      materialOrders.map(async (materialOrder) => {
        let estimateData = null;
        let approvalUserName = null;

        if (materialOrder.estimate_id) {
          try {
            const estimateQuery = createIdQuery(materialOrder.estimate_id);
            estimateData = await Estimate.findOne(estimateQuery);
          } catch (error) {
            console.warn("Estimate fetch error:", materialOrder._id);
          }
        }

        approvalUserName = await fetchApprovalUser(materialOrder);

        return {
          ...materialOrder,
          id: materialOrder._id.toString(),
          _id: materialOrder._id,
          estimate_data: estimateData ? estimateData.toObject() : null,
          approval_user: approvalUserName,
          approval_user_id: materialOrder.approval_user_id
        };
      })
    );
    res.json({
      data: responseData,
      total,
      page,
      limit
    });

  } catch (err) {
    console.error("Material Order GET error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// UPDATED: Get single material order with estimate data and approval user
router.get("/:id", auth, async (req, res) => {
  try {
    const query = createIdQuery(req.params.id);
    const materialOrder = await MaterialOrder.findOne(query);
    if (!materialOrder) {
      return res.status(404).json({ error: "Material order not found" });
    }

    let estimateData = null;
    let approvalUserName = null;

    if (materialOrder.estimate_id) {
      try {
        const Estimate = require("../models/Estimate");
        const estimateQuery = createIdQuery(materialOrder.estimate_id);
        estimateData = await Estimate.findOne(estimateQuery);
      } catch (estimateError) {
        console.warn("Could not fetch estimate data:", estimateError.message);
      }
    }

    // Fetch approval user
    approvalUserName = await fetchApprovalUser(materialOrder);

    const response = {
      ...materialOrder.toObject(),
      id: materialOrder.id || materialOrder._id.toString(),
      _id: materialOrder._id,
      estimate_data: estimateData ? estimateData.toObject() : null,
      approval_user: approvalUserName,
      approval_user_id: materialOrder.approval_user_id
    };

    res.json(response);
  } catch (err) {
    console.error("Error fetching material order:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Create material order with enhanced debugging and customer data preservation
router.post("/", auth, async (req, res) => {
  try {
    const materialOrderData = {
      ...req.body,
      created_by: req.user._id,
      created_by_user: req.user._id,
      approval_user_id: req.user._id,
      customer_name: req.body.customer_name || req.body.contact_name || null,
      customer_email: req.body.customer_email || null,
      project_name: req.body.project_name || null,
      customer_id: req.body.customer_id || null
    };

    const materialOrder = new MaterialOrder(materialOrderData);
    await materialOrder.save();

    if (materialOrder.project_id) {
      try {
        await updateProjectMaterialStatus(materialOrder.project_id);
      } catch (statusError) {
        console.error("Failed to update project material status:", statusError);
      }
    }

    const emailResult = await sendApprovalEmails(materialOrder, false, req);

    if (emailResult.success) {
      if (emailResult.autoApproved) {
      } else {
      }
    } else if (emailResult.error) {
      console.error("Email sending failed but order created:", emailResult.error);
    }

    res.status(201).json(materialOrder);

    // Activity Logging
    await logActivity(
      materialOrder.project_id,
      req.user,
      'Material Order',
      'Create',
      `Material order "${materialOrder.order_number || materialOrder._id.toString().slice(-6)}" created.`,
      { order_number: materialOrder.order_number, order_status: materialOrder.order_status },
      materialOrder._id,
      'Material Order'
    );
  } catch (err) {
    console.error("Error creating material order:", err);
    res.status(500).json({ error: "Server error" });
  }
});

const getChanges = (oldData, newData) => {
  const changes = [];
  const trackedFields = [
    { key: 'order_status', label: 'Status' },
    { key: 'requirement_status', label: 'Requirement Status' },
    { key: 'notes', label: 'Notes' },
    { key: 'customer_name', label: 'Customer Name' },
    { key: 'project_name', label: 'Project Name' }
  ];

  trackedFields.forEach(({ key, label }) => {
    const oldVal = oldData[key];
    const newVal = newData[key];
    if (String(oldVal) !== String(newVal) && newVal !== undefined) {
      changes.push({
        field: label,
        old: oldVal || '-',
        new: newVal || '-'
      });
    }
  });

  if (newData.line_items) {
    const oldItems = oldData.line_items || [];
    const newItems = newData.line_items;

    newItems.forEach((newItem, index) => {
      const oldItem = oldItems.find(item => item._id && newItem._id && item._id.toString() === newItem._id.toString());
      const comparisonItem = oldItem ? oldItem : oldItems[index];

      if (!comparisonItem) {
        changes.push({
          field: newItem.description || `Line Item ${index + 1}`,
          old: '-',
          new: 'Add New'
        });
        return;
      }

      const itemFields = [
        { key: 'description', label: 'Description' },
        { key: 'quantity_ordered', label: 'Qty Ordered' },
        { key: 'quantity_received', label: 'Qty Received' },
        { key: 'status', label: 'Status' },
        { key: 'project_only', label: 'Project-only' },
        { key: 'unit_price', label: 'Unit Price' },
        { key: 'supplier', label: 'Supplier' },
        { key: 'location', label: 'Location' },
        { key: 'order_date', label: 'Order Date' },
        { key: 'expected_delivery_date', label: 'Expected Delivery Date' },
        { key: 'received_date', label: 'Received Date' }
      ];

      itemFields.forEach(({ key, label }) => {
        let oldValue = comparisonItem[key];
        let newValue = newItem[key];

        const isDate = (val) => val instanceof Date || (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(val));
        const formatDate = (val) => val ? new Date(val).toISOString().split('T')[0] : '-';

        let strOld = oldValue;
        let strNew = newValue;

        if (isDate(oldValue) || isDate(newValue) || key.includes('date')) {
          strOld = oldValue ? formatDate(oldValue) : '-';
          strNew = newValue ? formatDate(newValue) : '-';
        }

        if (String(strOld) !== String(strNew) && newValue !== undefined) {
          if (key === 'project_only') {
            changes.push({
              field: label,
              old: '-',
              new: newValue ? 'Enable Project-only' : 'Disable Project-only'
            });
          } else if (key === 'status') {
            changes.push({
              field: newItem.description || 'Line Item Status',
              old: strOld || '-',
              new: strNew || '-'
            });
          } else {
            changes.push({
              field: `${newItem.description || `Item ${index + 1}`} - ${label}`,
              old: strOld || '-',
              new: strNew || '-'
            });
          }
        }
      });
    });

    oldItems.forEach((oldItem, index) => {
      const stillExists = newItems.find(item => item._id && oldItem._id && item._id.toString() === oldItem._id.toString()) || newItems[index];
      if (!stillExists) {
        changes.push({
          field: oldItem.description || `Line Item ${index + 1}`,
          old: 'Exists',
          new: 'Deleted'
        });
      }
    });
  }

  return changes;
};

// Update material order with enhanced debugging
router.put("/:id", auth, async (req, res) => {
  try {
    const existingOrder = await MaterialOrder.findById(req.params.id);
    if (!existingOrder) {
      return res.status(404).json({ error: "Material order not found" });
    }

    if ("created_by" in req.body) delete req.body.created_by;
    if ("created_by_user" in req.body) delete req.body.created_by_user;
    if ("created_by_model" in req.body) delete req.body.created_by_model;

    const materialOrder = await MaterialOrder.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );

    if (materialOrder.project_id) {
      try {
        await updateProjectMaterialStatus(materialOrder.project_id);
      } catch (statusError) {
        console.error("Failed to update project material status:", statusError);
      }
    }

    res.json(materialOrder);

    // Activity Logging
    const changes = getChanges(existingOrder.toObject(), materialOrder.toObject());

    // Only log if something changed or it's a generic forced update
    if (changes.length > 0) {
      await logActivity(
        materialOrder.project_id?._id || materialOrder.project_id,
        req.user,
        'Material Order',
        'Update',
        `Material order "${materialOrder.order_number || materialOrder._id.toString().slice(-6)}" updated.`,
        changes,
        materialOrder._id,
        'Material Order'
      );
    }
  } catch (err) {
    console.error("Error updating material order:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/:id/approval-status", auth, async (req, res) => {
  try {
    const { order_status, rejection_reason } = req.body;

    if (!order_status) {
      return res.status(400).json({ error: "order_status is required in body" });
    }

    if (!["Pending", "Approved", "Rejected", "Ordered", "Fulfilled", "Cancelled"].includes(order_status)) {
      return res.status(400).json({ error: "Invalid order status" });
    }

    const order = await MaterialOrder.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ error: "Material order not found" });
    }

    let totalCost;

    const estimateData = await getEstimateData(order.estimate_id);

    if (estimateData?.total_amount) {
      totalCost = parseFloat(estimateData.total_amount);
    } else {
      totalCost = calculateTotalCost(order.line_items || []);
    }

    const updateData = {
      order_status,
      approval_user_id: req.user._id || req.user.id
    };

    if (order_status === "Rejected") {
      updateData.rejection_reason = rejection_reason || "No reason provided";
      updateData.requirement_status = "Rejected";
    } else if (order_status === "Approved") {
      updateData.requirement_status = "Approved";
    }

    const updatedOrder = await MaterialOrder.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );

    if (updatedOrder.project_id) {
      await updateProjectMaterialStatus(updatedOrder.project_id);
    }

    res.status(200).json({
      message: "Order status updated successfully",
      materialOrder: updatedOrder,
    });

    // Activity Logging
    let actionName = 'Status Change';
    if (order_status === 'Approved') actionName = 'Approved';
    if (order_status === 'Rejected') actionName = 'Rejected';

    await logActivity(
      updatedOrder.project_id?._id || updatedOrder.project_id,
      req.user,
      'Material Order',
      actionName,
      `Material order "${updatedOrder.order_number || updatedOrder._id.toString().slice(-6)}" order status changed to "${order_status}".`,
      [{ field: 'Status', old: order.order_status || '-', new: order_status }],
      updatedOrder._id,
      'Material Order'
    );

    if (order.order_status !== order_status && (order_status === 'Approved' || order_status === 'Rejected')) {
      await notifyApprovalStatusChange(updatedOrder, order_status, req.user._id || req.user.id);
    }
  } catch (error) {
    console.error("Error updating order status:", error);
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/:id/requirement-status", auth, async (req, res) => {
  try {

    const { requirement_status, rejection_reason } = req.body;

    if (!requirement_status) {
      return res.status(400).json({ error: "requirement_status is required in body" });
    }

    if (!["Pending", "Approved", "Rejected"].includes(requirement_status)) {
      return res.status(400).json({ error: "Invalid requirement status" });
    }

    const updateData = {
      requirement_status,
      approval_user_id: req.user._id // Store who changed the requirement status
    };

    if (requirement_status === "Rejected" && rejection_reason) {
      updateData.rejection_reason = rejection_reason;
    }

    const order = await MaterialOrder.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ error: "Material order not found" });
    }

    const updatedOrder = await MaterialOrder.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );

    if (!updatedOrder) {
      return res.status(404).json({ error: "Material order not found" });
    }

    if (updatedOrder.project_id) {
      try {
        await updateProjectMaterialStatus(updatedOrder.project_id);
      } catch (statusError) {
        console.error("Failed to update project material status:", statusError);
      }
    }

    res.status(200).json({
      message: "Requirement status updated successfully",
      materialOrder: updatedOrder,
    });

    // Activity Logging
    let actionName = 'Status Change';
    if (requirement_status === 'Approved') actionName = 'Approved';
    if (requirement_status === 'Rejected') actionName = 'Rejected';

    await logActivity(
      updatedOrder.project_id?._id || updatedOrder.project_id,
      req.user,
      'Material Order',
      actionName,
      `Material order "${updatedOrder.order_number || updatedOrder._id.toString().slice(-6)}" requirement status changed to "${requirement_status}".`,
      [{ field: 'Requirement Status', old: '-', new: requirement_status }],
      updatedOrder._id,
      'Material Order'
    );

    if (order.requirement_status !== requirement_status && (requirement_status === 'Approved' || requirement_status === 'Rejected')) {
      await notifyApprovalStatusChange(updatedOrder, requirement_status, req.user._id || req.user.id);
    }
  } catch (error) {
    console.error("Error updating requirement status:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// DELETE /api/materialorders/bulk
router.delete("/bulk", auth, async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "No material orders selected" });
    }

    const ownerId =
      req.user.role_type === "admin"
        ? req.user._id
        : new mongoose.Types.ObjectId(req.user.created_by);

    // Fetch orders that belong to this owner
    const orders = await MaterialOrder.find({
      _id: { $in: ids },
      created_by: ownerId
    });

    if (!orders.length) {
      return res.status(404).json({ error: "No valid material orders found" });
    }

    // Collect affected project IDs
    const affectedProjects = new Set();

    for (const order of orders) {
      if (order.project_id) {
        affectedProjects.add(order.project_id.toString());
      }
    }

    // Delete orders
    await MaterialOrder.deleteMany({
      _id: { $in: orders.map(o => o._id) }
    });

    // Update project material status for affected projects
    for (const projectId of affectedProjects) {
      try {
        await updateProjectMaterialStatus(projectId);
      } catch (statusError) {
        console.error("Failed to update project material status:", statusError);
      }
    }

    res.json({
      success: true,
      deleted_count: orders.length
    });

  } catch (error) {
    console.error("Bulk delete material orders error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.delete("/:id", auth, async (req, res) => {
  try {
    const materialOrder = await MaterialOrder.findByIdAndDelete(req.params.id);
    if (!materialOrder) {
      return res.status(404).json({ error: "Material order not found" });
    }
    if (materialOrder.project_id) {
      try {
        await updateProjectMaterialStatus(materialOrder.project_id);
      } catch (statusError) {
        console.error("Failed to update project material status:", statusError);
      }
    }
    res.json({ message: "Material order deleted successfully" });

    // Activity Logging
    await logActivity(
      materialOrder.project_id,
      req.user,
      'Material Order',
      'Delete',
      `Material order "${materialOrder.order_number || materialOrder._id.toString().slice(-6)}" deleted.`,
      { order_number: materialOrder.order_number }
    );
  } catch (err) {
    console.error("Error deleting material order:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/:id/approve-via-link", async (req, res) => {
  try {
    const { token, userId } = req.query;
    const order = await MaterialOrder.findById(req.params.id);

    if (!order) {
      return res.redirect(`${process.env.FRONTEND_URL}/materialorderdetails?id=${req.params.id}&toast=error`);
    }

    if (!token || order.approval_token !== token) {
      return res.redirect(`${process.env.FRONTEND_URL}/materialorderdetails?id=${req.params.id}&toast=invalid-token`);
    }

    const existingOrder = await MaterialOrder.findById(req.params.id);

    const updated = await MaterialOrder.findByIdAndUpdate(
      req.params.id,
      {
        order_status: "Approved",
        requirement_status: "Approved",
        approvaldata15K: "Approved",
        approval_token: null
      },
      { new: true }
    );

    // Activity Logging
    await logActivity(
      order.project_id?._id || order.project_id,
      { full_name: 'Customer (via Link)' },
      'Material Order',
      'Approved',
      `Material order "${order.order_number || order._id.toString().slice(-6)}" approved via email link.`,
      [{ field: 'Status', old: order.order_status || '-', new: 'Approved' }],
      order._id,
      'Material Order'
    );

    if (existingOrder.order_status !== "Approved") {
      await notifyApprovalStatusChange(order, "Approved", userId);
    }

    res.redirect(`${process.env.FRONTEND_URL}/materialorderdetails?id=${req.params.id}&toast=approved`);
  } catch (error) {
    console.error("Error approving via link:", error);
    res.redirect(`${process.env.FRONTEND_URL}/materialorderdetails?id=${req.params.id}&toast=error`);
  }
});

router.get("/:id/reject-via-link", async (req, res) => {
  try {
    const { token, userId } = req.query;
    const order = await MaterialOrder.findById(req.params.id);

    if (!order) {
      return res.redirect(`${process.env.FRONTEND_URL}/materialorderdetails?id=${req.params.id}&toast=error`);
    }

    if (!token || order.approval_token !== token) {
      return res.redirect(`${process.env.FRONTEND_URL}/materialorderdetails?id=${req.params.id}&toast=invalid-token`);
    }

    const existingOrder = await MaterialOrder.findById(req.params.id);

    const updated = await MaterialOrder.findByIdAndUpdate(
      req.params.id,
      {
        order_status: "Rejected",
        requirement_status: "Rejected",
        approvaldata15K: "Rejected",
        rejection_reason: "Rejected via Email Link",
        approval_token: null,
        rejected_at: new Date()
      },
      { new: true }
    );

    // Activity Logging
    await logActivity(
      order.project_id?._id || order.project_id,
      { full_name: 'Customer (via Link)' },
      'Material Order',
      'Rejected',
      `Material order "${order.order_number || order._id.toString().slice(-6)}" rejected via email link.`,
      [{ field: 'Status', old: order.order_status || '-', new: 'Rejected' }],
      order._id,
      'Material Order'
    );

    if (existingOrder.order_status !== "Rejected") {
      await notifyApprovalStatusChange(order, "Rejected", userId);
    }

    res.redirect(`${process.env.FRONTEND_URL}/materialorderdetails?id=${req.params.id}&toast=rejected`);
  } catch (error) {
    console.error("Error rejecting via link:", error);
    res.redirect(`${process.env.FRONTEND_URL}/materialorderdetails?id=${req.params.id}&toast=error`);
  }
});

router.put("/:id/approve-15k", auth, async (req, res) => {
  try {
    const { action } = req.body;
    if (!action || !['Approved', 'Rejected'].includes(action)) {
      return res.status(400).json({ error: "Action (Approved or Rejected) is required" });
    }

    const updateData = {
      approvaldata15K: action,
      approval_user_id: req.user._id
    };

    if (action === "Rejected") {
      updateData.order_status = "Rejected";
      updateData.requirement_status = "Rejected";
      updateData.rejected_at = new Date();
      updateData.rejection_reason = "Internal Threshold Rejection";
    } else if (action === "Approved") {
      updateData.order_status = "Approved";
      updateData.requirement_status = "Approved";
    }

    const existingOrder = await MaterialOrder.findById(req.params.id);
    const order = await MaterialOrder.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );

    if (!order) {
      return res.status(404).json({ error: "Material order not found" });
    }

    await logActivity(
      order.project_id?._id || order.project_id,
      req.user,
      'Material Order',
      action,
      `Material order "${order.order_number || order._id.toString().slice(-6)}" threshold internal ${action.toLowerCase()}.`,
      [{ field: 'Threshold Approval', old: 'Pending', new: action }],
      order._id,
      'Material Order'
    );

    if (existingOrder.approvaldata15K !== action) {
      await notifyApprovalStatusChange(order, action, req.user._id);
    }

    res.json({ message: `Order ${action.toLowerCase()} successfully`, order });
  } catch (error) {
    console.error("Error in approve-15k:", error);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;