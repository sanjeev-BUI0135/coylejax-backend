const MasterData = require("../models/MasterData");
const User = require("../models/User");
const Client = require("../models/Client");
const sendMail = require("../utils/sendMail");
const statusChangeNotificationMail = require("../utils/statusChangeNotificationMail");
const Project = require("../models/Project");
const Estimate = require("../models/Estimate");

const getProjectName = async (projectId, estimateId = null) => {
    try {
        if (projectId) {
            const project = await Project.findById(projectId);
            if (project) {
                return project.project_name || project.name || "Unknown Project";
            }
        }

        if (estimateId) {
            const estimate = await Estimate.findById(estimateId);
            if (estimate && estimate.is_quick_estimate && estimate.quick_customer && estimate.quick_customer.project_name) {
                return estimate.quick_customer.project_name;
            }
        }
        return "Unknown Project";
    } catch (err) {
        return "Unknown Project";
    }
};

const notifyApprovalStatusChange = async (materialOrder, action, actionByUserId) => {
    try {
        if (!materialOrder) return;

        // Fetch master settings for approval users
        const settings = await MasterData.collection.find({
            type: "markup",
            status: "active",
            $or: [
                { created_by: materialOrder.created_by },
                { created_by: materialOrder.created_by.toString() }
            ]
        }).sort({ created_by: -1 }).limit(1).toArray();
        const setting = settings[0];

        let approvalUserIds = [];
        if (setting && setting.material_approval_users) {
            approvalUserIds = setting.material_approval_users.map(id => id.toString());
        }

        // Do not exclude the person who actually performed the action
        const actionByUserIdStr = actionByUserId ? actionByUserId.toString() : null;
        const recipientUserIds = approvalUserIds; // Removed the filter condition

        // Fetch email addresses of the other approvers
        const otherApprovers = await User.find({
            _id: { $in: recipientUserIds }
        }).select("email");

        let recipientEmails = otherApprovers.map(u => u.email).filter(Boolean);

        // Notify the user who created the material order (created_by_user)
        const creatorUserIdStr = materialOrder.created_by_user ? materialOrder.created_by_user.toString() : null;
        const creatorIdStr = materialOrder.created_by ? materialOrder.created_by.toString() : null;

        if (creatorUserIdStr && creatorUserIdStr !== actionByUserIdStr) {
            let creatorUser = await User.findById(creatorUserIdStr).select("email");
            if (!creatorUser) {
                creatorUser = await Client.findById(creatorUserIdStr).select("email");
            }
            if (creatorUser && creatorUser.email && !recipientEmails.includes(creatorUser.email)) {
                recipientEmails.push(creatorUser.email);
            }
        } else if (!creatorUserIdStr && creatorIdStr && creatorIdStr !== actionByUserIdStr) {
            // Fallback to created_by (admin) if created_by_user is not present
            let creator = await User.findById(creatorIdStr).select("email");
            if (!creator) {
                creator = await Client.findById(creatorIdStr).select("email");
            }
            if (creator && creator.email && !recipientEmails.includes(creator.email)) {
                recipientEmails.push(creator.email);
            }
        }

        if (recipientEmails.length === 0) {
            return; // No one to notify
        }

        // Find the name of the user who performed the action
        let actionByName = "An authorized user";
        if (actionByUserId) {
            let actionUser = await User.findById(actionByUserId);
            if (!actionUser) {
                actionUser = await Client.findById(actionByUserId);
            }
            if (actionUser) {
                actionByName = actionUser.full_name || actionUser.name || actionUser.companyName || "Authorized User";
            }
        }

        // Get Project Name
        const projectName = await getProjectName(materialOrder.project_id, materialOrder.estimate_id);

        const orderNumber = materialOrder.order_number || materialOrder._id.toString().slice(-6);

        // Fetch admin info for logo/company name
        const adminUser = await Client.findById(materialOrder.created_by);
        const logo = adminUser ? adminUser.logo : null;
        const fromCompany = adminUser ? adminUser.companyName : "Management Team";

        let totalEstimatedCost = 0;
        if (materialOrder.estimate_id) {
            const estimate = await Estimate.findById(materialOrder.estimate_id);
            if (estimate) {
                totalEstimatedCost = estimate.total_amount || 0;
            }
        }

        const emailHtml = statusChangeNotificationMail(
            projectName,
            action,
            actionByName,
            orderNumber,
            adminUser,
            totalEstimatedCost
        );

        await sendMail({
            from: fromCompany,
            replyTo: adminUser ? adminUser.email : process.env.EMAIL_FROM,
            to: recipientEmails.join(","),
            subject: `Material Order ${action} - ${projectName}`,
            text: `Material Order #${orderNumber} for project ${projectName} has been ${action} by ${actionByName}.`,
            html: emailHtml
        });

    } catch (err) {
        console.error("Error sending approval status change notification:", err);
    }
};

module.exports = {
    notifyApprovalStatusChange
};
