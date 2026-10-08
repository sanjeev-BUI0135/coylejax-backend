const materialordersApprovalMail = require("../utils/materialordersApprovalMail");
const MaterialOrder = require("../models/MaterialOrder");
const MasterData = require("../models/MasterData");
const { createIdQuery } = require("../utils/idHelper");
const Project = require("../models/Project");
const sendMail = require("../utils/sendMail");
const Client = require("../models/Client");
const crypto = require("crypto");
const User = require("../models/User");
const InventoryItem = require("../models/InventoryItem");
const Estimate = require("../models/Estimate");

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

//auto trigger material approval
async function autoTriggerMaterialApproval(materialOrder) {
    try {

        if (!materialOrder) return;

        const settings = await MasterData.find({
            type: "markup",
            status: "active",
            $or: [
                { created_by: materialOrder.created_by },
                { created_by: materialOrder.created_by.toString() }
            ]
        }).sort({ created_by: -1 })
            .limit(1)
            .lean();
        const setting = settings[0];
        if (!setting) return;

        const threshold = setting.estimate_amount || 0;

        const estimateData = await getEstimateData(materialOrder.estimate_id);

        const totalCost =
            estimateData?.total_amount
                ? parseFloat(estimateData.total_amount)
                : calculateTotalCost(materialOrder.line_items);

        if (totalCost < threshold) return;

        const approvalUsers = await User.find({
            _id: { $in: setting.material_approval_users }
        }).select("email full_name");

        if (!approvalUsers.length) return;

        const adminUser = await Client.findById(materialOrder.created_by);
        if (!adminUser) return;

        const projectName = (await getProjectName(materialOrder.project_id, materialOrder.estimate_id)) || `Project ${materialOrder.project_id}`;
        const inventoryStatus = await checkInventoryStatus(materialOrder.line_items);

        // Trigger mail only if estimate >= threshold
        if (totalCost < threshold) {
            return;
        }
        const orderNumber =
            materialOrder.order_number ||
            materialOrder._id.toString().slice(-6);

        const approvalToken = crypto.randomBytes(32).toString("hex");

        await MaterialOrder.findByIdAndUpdate(
            materialOrder._id,
            { approval_token: approvalToken }
        );

        const emailPromises = approvalUsers.map(u => {
            const approveLink = `${process.env.FRONTEND_URL}/material-orders/${materialOrder._id}`;
            const rejectLink = `${process.env.FRONTEND_URL}/material-orders/${materialOrder._id}`;

            const emailHtml = materialordersApprovalMail(
                approveLink,
                rejectLink,
                projectName,
                "Customer",
                totalCost,
                inventoryStatus,
                orderNumber,
                threshold,
                materialOrder._id.toString(),
                estimateData,
                adminUser.logo,
                adminUser
            );

            return sendMail({
                from: adminUser.companyName,
                replyTo: adminUser.email,
                to: u.email,
                subject: `Material Order Approval Required - ${projectName}`,
                text: `Material order approval required for ${projectName}. Total Cost: ${totalCost}`,
                html: emailHtml
            });
        });

        const recipients = approvalUsers.map(u => u.email);

        await MaterialOrder.findByIdAndUpdate(
            materialOrder._id,
            {
                approver_emails: recipients,
                order_status: "Pending",
                requirement_status: "Pending"
            }
        );

        await Promise.all(emailPromises);
    } catch (err) {
        console.error("Auto approval email error:", err);
    }
}

module.exports = {
    autoTriggerMaterialApproval,
};
