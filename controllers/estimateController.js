const Estimate = require("../models/Estimate");
const Project = require("../models/Project");
const Customer = require("../models/Customer");
const MaterialOrder = require("../models/MaterialOrder");
const MasterData = require("../models/MasterData");
const ActivityLog = require("../models/ActivityLog");
const User = require("../models/User");
const Client = require("../models/Client");
const Message = require("../models/Message");
const estimateMail = require("../utils/estimateMail");
const sendMail = require("../utils/sendMail");
const jwt = require('jsonwebtoken');
const crypto = require("crypto");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const { createIdQuery } = require("../utils/idHelper");
const { sendMessage, normalizePhone } = require("../utils/twilio");
const { logActivity } = require("../utils/activityLogger");
const { getContactName, getOwnerId } = require("../utils/estimateHelpers");
const { getTermsWithFallback } = require("../utils/termsAndConditions.js");
const { generateEstimatePdf } = require("../functions/generateEstimatePdf");

exports.convertToProject = async (req, res) => {
    try {
        const estimateId = req.params.id;
        const { project_id } = req.body;
        const query = createIdQuery(estimateId);

        // ================================
        // FETCH ESTIMATE
        // ================================
        const estimate = await Estimate.findOne(query);
        if (!estimate) {
            return res.status(404).json({ error: "Estimate not found" });
        }

        if (!estimate.is_quick_estimate) {
            return res.status(400).json({
                error: "Only quick estimates can be converted to projects"
            });
        }

        if (estimate.status !== "approved") {
            return res.status(400).json({
                error: "Only approved estimates can be converted to projects"
            });
        }

        if (estimate.converted_to_project) {
            return res.status(400).json({
                error: "This estimate has already been converted",
                project_id: estimate.converted_project_id
            });
        }

        const adminId = getOwnerId(req);
        const quickCustomer = estimate.quick_customer;

        // ================================
        // FETCH OWNER (CLIENT / ADMIN)
        // ================================
        let owner = await Client.findById(adminId);
        if (!owner) {
            owner = await User.findById(adminId);
        }

        if (!owner) {
            return res.status(400).json({ error: "Owner not found" });
        }

        // ================================
        // FIND CUSTOMER (CREATED AT APPROVAL)
        // ================================
        let customer = await Customer.findOne({
            email: quickCustomer.email_address?.toLowerCase().trim(),
            created_by: adminId
        });

        if (!customer && req.body.customer_id) {
            customer = await Customer.findById(req.body.customer_id);
        }

        if (!customer) {
            return res.status(400).json({
                error: "Customer not found. Please select a customer."
            });
        }
        const divisionType = estimate.quick_customer?.division_type;

        let divisionName = "Division";

        if (divisionType) {
            const division = await MasterData.findOne({
                type: "divisions",
                status: "active",
                value: divisionType
            }).select("display_name");

            if (division) {
                divisionName = division.display_name;
            }
        }
        // ================================
        // GENERATE PROJECT NUMBER (CLIENT CONFIG)
        // ================================
        const config = owner.project_number_config?.new_project;

        if (!config) {
            return res.status(400).json({
                error: "Project number config missing for this account"
            });
        }

        let currentUser = await User.findById(req.user._id);

        if (!currentUser) {
            currentUser = await Client.findById(req.user._id);
        }

        const prefix = currentUser?.project_number_config?.new_project?.prefix;

        const nextNumber = (config.current_number || config.start_number || 0) + 1;

        // Estimate la irunthu sequence eduthuka
        let estimateSequence = "0000";

        if (estimate.estimate_number) {
            const regex = new RegExp(`^EST-${config.year}(\\d{4})`);
            const match = estimate.estimate_number.match(regex);

            if (match) {
                estimateSequence = match[1];
            }
        }

        // First try same estimate sequence
        let projectSequence = estimateSequence;

        // Check project already exists ah
        const existingProject = await Project.findOne({
            created_by: { $in: [adminId, adminId.toString()] },
            project_creation_type: "new_project",
            project_number: `${config.year}${projectSequence}${prefix}`
        });

        // Already exists na next available sequence generate pannu
        if (existingProject) {

            const allProjects = await Project.find({
                created_by: { $in: [adminId, adminId.toString()] },
                project_creation_type: "new_project",
                project_number: {
                    $regex: `^${config.year}[0-9]+`
                }
            })
                .select("project_number")
                .lean();

            const allEstimates = await Estimate.find({
                created_by: { $in: [adminId, adminId.toString()] },
                estimate_number: {
                    $regex: `^EST-${config.year}[0-9]+`
                }
            })
                .select("estimate_number")
                .lean();
            
            let highestSeq = 0;
            const year = config.year;

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

            projectSequence = String(highestSeq + 1).padStart(4, "0");
        }

        // Final project number
        projectNumber = `${config.year}${projectSequence}${prefix}`;

        // Update config counter
        config.current_number = nextNumber;
        config.project_count = (config.project_count || 0) + 1;
        await owner.save();

        // ================================
        // CREATE OR LINK PROJECT
        // ================================
        let project;

        if (project_id) {
            project = await Project.findById(project_id);

            if (!project) {
                return res.status(404).json({ error: "Project not found" });
            }

            // Ensure customer is linked
            if (!project.customer_ids.includes(customer._id)) {
                project.customer_ids.push(customer._id);
                await project.save();
            }
        } else {
            const categories = await MasterData.find({
                type: "categories",
                status: "active"
            }).select("value display_name");
            const formattedDescription = (estimate.line_items || [])
                .map(item => {
                    const foundCategory = categories.find(c => c.value === item.category);

                    const categoryName =
                        foundCategory?.display_name ||
                        item.category_name ||
                        item.category ||
                        "General";

                    const desc = item.description || "";

                    return `${categoryName} - ${desc}`;
                })
                .join("\n");

            const newFiles = (req.body.file_attachments || []).map(file => ({
                file_name: file.file_name,
                file_url: file.file_url,
                crew_visible: file.crew_visible || false,
                uploaded_by: req.user?.full_name || `${req.user?.firstName} ${req.user?.lastName}`,
                uploaded_by_id: req.user?._id,
                uploaded_by_model: req.user?.role_type === "admin" ? "Client" : "User",
                createdAt: new Date()
            }));
            project = new Project({
                project_name: req.body.project_name || '',
                project_number: projectNumber,
                user_initials: (owner.firstName?.[0] || "U") + (owner.lastName?.[0] || "S"),
                location: req.body.location || quickCustomer.site_address || "",
                billing_address: req.body.billing_address || quickCustomer.billing_address || "",
                customer_ids: [customer._id],
                project_creation_type: req.body.project_creation_type,
                project_creation_type_name: req.body.project_creation_type_name,
                project_type: divisionType,
                project_type_name: divisionName,
                status: "processing",
                created_by: adminId,
                created_by_user: estimate.created_by_user || req.user?._id,
                description: req.body.description || formattedDescription || "",
                estimated_value: req.body.estimated_value || estimate.total_amount || 0,
                requirements: req.body.requirements || "",
                special_instructions: req.body.special_instructions || "",
                estimated_start_date: req.body.estimated_start_date || null,
                estimated_end_date: req.body.estimated_end_date || null,
                file_attachments: newFiles,
            });

            await project.save();
        }

        // ================================
        // UPDATE ESTIMATE
        // ================================
        estimate.project_id = project._id;
        estimate.is_quick_estimate = false;
        estimate.converted_to_project = true;
        estimate.converted_project_id = project._id;
        estimate.converted_at = new Date();

        // Automatically generate the approved PDF and append it to the Project's files 
        // because it was explicitly kept out of Estimate.file_attachments to prevent download duplication
        try {
            const pdfBuffer = await generateEstimatePdf(estimate._id, req, "summary");
            const uploadDir = path.join(process.cwd(), "uploads", "estimates");
            if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

            const pdfFileName = `${Date.now()}-Estimate-${estimate.estimate_number || 'Approved'}.pdf`;
            const pdfFilePath = path.join(uploadDir, pdfFileName);
            fs.writeFileSync(pdfFilePath, pdfBuffer);

            const pdfAttachment = {
                file_name: pdfFileName,
                file_url: `${process.env.BASE_URL}/uploads/estimates/${pdfFileName}`,
                object_id: new mongoose.Types.ObjectId().toString(),
            };

            await Project.findByIdAndUpdate(project._id, {
                $push: { file_attachments: pdfAttachment }
            });
        } catch (pdfErr) {
            console.error("Failed to generate and attach estimate PDF during conversion:", pdfErr);
        }

        await estimate.save();

        // ================================
        // (Fixes "Unknown Project")
        // ================================
        try {
            const result = await MaterialOrder.updateMany(
                { estimate_id: estimate._id },
                {
                    $set: {
                        project_id: project._id,
                        updatedAt: new Date()
                    }
                }
            );

            await ActivityLog.updateMany(
                { project_id: estimate._id },
                { $set: { project_id: project._id } }
            );

        } catch (materialError) {
            console.error("Material order project link error:", materialError);
        }

        res.json({
            success: true,
            message: "Estimate successfully converted to project",
            estimate: {
                ...estimate.toObject(),
                id: estimate._id.toString()
            },
            project: {
                ...project.toObject(),
                id: project._id.toString()
            },
            customer: {
                ...customer.toObject(),
                id: customer._id.toString()
            },
            auto_select: {
                customer_id: customer._id.toString(),
                division_type: divisionType,
                division_name: divisionName
            }
        });

        // Activity Logging
        await logActivity(
            project._id,
            req.user,
            'Project',
            'Create',
            `Project created from conversion of Estimate "${estimate.estimate_number}".`,
            { estimate_number: estimate.estimate_number, project_id: project._id },
            project._id,
            'Project'
        );

        await logActivity(
            project._id,
            req.user,
            'Estimate',
            'Update',
            `Estimate "${estimate.estimate_number}" converted to project.`,
            { estimate_number: estimate.estimate_number, project_id: project._id },
            estimate._id,
            'Estimate'
        );

    } catch (error) {
        console.error("Convert to project error:", error);
        res.status(500).json({ error: error.message });
    }
};

exports.sendEstimateSMS = async (req, res) => {
    try {
        const estimateId = req.params.id;
        const { phone_numbers = [], isWhatsApp = false, sms_type = "details" } = req.body;
        const query = createIdQuery(estimateId);

        const estimate = await Estimate.findOne(query).populate("project_id", "project_name location");

        if (!estimate) {
            return res.status(404).json({ error: "Estimate not found" });
        }

        let senderData = null;
        if (req.user.role_type === "admin") {
            senderData = req.user;
        } else {
            const dbUser = await User.findById(req.user._id);
            if (dbUser?.created_by && mongoose.Types.ObjectId.isValid(dbUser.created_by)) {
                const client = await Client.findById(dbUser.created_by);
                if (client) {
                    senderData = client;
                }
            }
        }
        if (!senderData) {
            return res.status(400).json({ error: "Unable to resolve sender details" });
        }

        let token = estimate.public_share_token;
        if (!token) token = crypto.randomUUID();

        const contactName = await getContactName(estimate.project_id);
        const estimateNo = estimate.estimate_number || "N/A";
        const magicLink = `${process.env.BASE_URL}/estimate-print?id=${estimate._id}&token=${token}`;
        const companyName = senderData.companyName || "Our Company";

        const urlType = sms_type === "summary" ? "s" : "d";
        const sigHmac = crypto.createHmac('sha256', process.env.JWT_SECRET || 'secret')
                              .update(`${token}:${urlType}`)
                              .digest('hex')
                              .substring(0, 10);

        let messageBody;
        if (req.body.message) {
            messageBody = req.body.message;
        } else if (sms_type === "summary") {
            messageBody = `Hello ${contactName}, your estimate summary ${estimateNo} from ${companyName} is ready. View it here: ${magicLink}&type=s&sig=${sigHmac}`;
        } else {
            messageBody = `Hello ${contactName}, your estimate details ${estimateNo} from ${companyName} is ready. View it here: ${magicLink}&type=d&sig=${sigHmac}`;
        }

        if (!phone_numbers.length) {
            return res.status(400).json({ error: "No phone numbers provided" });
        }

        const smsPromises = phone_numbers
            .filter(Boolean)
            .map(async (phoneNumber) => {
                const ownerId = getOwnerId(req);
                const phone = normalizePhone(phoneNumber)
                const result = await sendMessage(phone, messageBody, isWhatsApp, ownerId);

                // Record in chat history
                await Message.create({
                    direction: 'outbound',
                    from: process.env.TWILIO_NUMBER || '+12185357885',
                    to: phone,
                    body: messageBody,
                    isWhatsApp,
                    sid: result.sid,
                    status: 'sent',
                    created_by: getOwnerId(req),
                    timestamp: new Date()
                });

                return result;
            });

        await Promise.all(smsPromises);

        await Estimate.findOneAndUpdate(
            query,
            {
                $set: {
                    status: "sent",
                    sent_date: new Date(),
                    public_share_token: token,
                    updatedAt: new Date(),
                },
            },
            { new: true }
        );

        res.json({
            success: true,
            message: `Estimate ${estimateNo} sent successfully via ${isWhatsApp ? 'WhatsApp' : 'SMS'} to ${phone_numbers.length} contact(s)`
        });

        // Activity Logging

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
            'Sent',
            `Estimate "${estimateNo}" sent via SMS.`,
            { estimate_number: estimateNo, status: 'sent' },
            estimate._id,
            'Estimate'
        );
    } catch (error) {
        console.error("Send estimate SMS error:", error);
        res.status(500).json({ error: error.message });
    }
};

exports.getNextPONumber = async (req, res) => {
    try {
        const adminId = getOwnerId(req);
        const config = req.user?.project_number_config?.new_project || {};
        const year = config.year;
        const prefix = config.prefix || '';

        const estimateId = req.query.estimate_id || req.query.estimateId || req.body?.estimate_id || req.body?.estimateId;
        const estimateNumQuery = req.query.estimate_number || req.query.estimateNumber || req.body?.estimate_number || req.body?.estimateNumber;
        const projectId = req.query.project_id || req.query.projectId || req.body?.project_id || req.body?.projectId;

        let estimate = null;
        if (estimateId) {
            estimate = await Estimate.findOne(createIdQuery(estimateId));
        } else if (estimateNumQuery) {
            estimate = await Estimate.findOne({
                estimate_number: estimateNumQuery,
                created_by: { $in: [adminId, adminId.toString()] }
            });
        } else if (projectId) {
            estimate = await Estimate.findOne({
                project_id: projectId,
                created_by: { $in: [adminId, adminId.toString()] }
            }).sort({ createdAt: -1 });
        }

        let customer_po_number;
        if (estimate && estimate.estimate_number) {
            // Estimate already exists — derive PO from its number
            const baseEstNumber = estimate.estimate_number.replace(/-\d+$/, "");
            customer_po_number = baseEstNumber.replace(/^EST-/, 'PO-');
        } else {
            // No estimate yet — compute the NEXT estimate number using the
            // same logic as the create route (quick + new_project only)
            const newProjectIds = await Project.find({
                created_by: { $in: [adminId, adminId.toString()] },
                project_creation_type: "new_project"
            }).distinct("_id");

            const allEstimates = await Estimate.find({
                created_by: { $in: [adminId, adminId.toString()] },
                $or: [
                    { is_quick_estimate: true },
                    { project_id: { $in: newProjectIds } }
                ]
            }).select('estimate_number').lean();

            const allProjects = await Project.find({
                created_by: { $in: [adminId, adminId.toString()] },
                project_creation_type: "new_project"
            }).select('project_number').lean();

            let highestSeq = 0;
            const estRegex = new RegExp(`^EST-${year}(\\d{4})`);
            const projRegex = new RegExp(`^${year}(\\d{4})`);

            for (const est of allEstimates) {
                if (est.estimate_number) {
                    const match = est.estimate_number.match(estRegex);
                    if (match) {
                        const seq = parseInt(match[1], 10) || 0;
                        if (seq > highestSeq) highestSeq = seq;
                    }
                }
            }

            for (const proj of allProjects) {
                if (proj.project_number) {
                    const match = proj.project_number.match(projRegex);
                    if (match) {
                        const seq = parseInt(match[1], 10) || 0;
                        if (seq > highestSeq) highestSeq = seq;
                    }
                }
            }

            const nextSequence = Math.max(highestSeq, (config.start_number - 1) || 0) + 1;
            const nextEstNumber = `EST-${year}${String(nextSequence).padStart(4, '0')}${prefix}`;
            customer_po_number = nextEstNumber.replace(/^EST-/, 'PO-');

        }

        res.json({ customer_po_number });
    } catch (error) {
        console.error("Get next PO number error:", error);
        res.status(500).json({ error: error.message });
    }
}

exports.getEstimateById = async (req, res) => {
    try {
        const searchId = req.params.id;
        const query = createIdQuery(searchId);
        const estimate = await Estimate.findOne(query).populate("project_id");

        if (!estimate) {
            return res.status(404).json({ error: "Estimate not found" });
        }

        const termsAndConditions = await getTermsWithFallback(estimate.project_id);

        const token = estimate.public_share_token;
        let signatures = {};
        if (token) {
            const crypto = require('crypto');
            const hmac = (type) => crypto.createHmac('sha256', process.env.JWT_SECRET || 'secret').update(`${token}:${type}`).digest('hex').substring(0, 10);
            signatures = {
                s: hmac('s'),
                d: hmac('d'),
                c: hmac('c')
            };
        }

        const responseData = {
            ...estimate.toObject(),
            id: estimate.id || estimate._id.toString(),
            _id: estimate._id,
            termsAndConditions: termsAndConditions,
            signatures
        };

        res.json(responseData);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

exports.updateInvoicedAmount = async (req, res) => {
    const { invoiced_amount } = req.body;

    const estimate = await Estimate.findByIdAndUpdate(
        req.params.id,
        { invoiced_amount, updatedAt: new Date() },
        { new: true }
    );

    res.json(estimate);

    // Activity Logging
    await logActivity(
        estimate.project_id?._id || estimate.project_id,
        req.user,
        'Estimate',
        'Update',
        `Estimate "${estimate.estimate_number}" invoiced amount updated to ${invoiced_amount}.`,
        { estimate_number: estimate.estimate_number, invoiced_amount },
        estimate._id,
        'Estimate'
    );
}

exports.bulkDeleteEstimates = async (req, res) => {
    try {
        const { ids } = req.body;

        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: "No estimates selected" });
        }

        const ownerId = getOwnerId(req);
        const objectIds = ids.map(id => new mongoose.Types.ObjectId(id));

        const result = await Estimate.deleteMany({
            _id: { $in: objectIds },
            created_by: { $in: [ownerId, ownerId.toString()] }
        });

        await MaterialOrder.deleteMany({
            estimate_id: { $in: objectIds }
        });

        res.json({
            success: true,
            deleted: result.deletedCount
        });

    } catch (error) {
        console.error("Bulk delete estimates error:", error);
        res.status(500).json({ error: "Bulk delete failed" });
    }
}

exports.deleteEstimate = async (req, res) => {
    try {
        const estimateId = req.params.id;
        const query = createIdQuery(estimateId);

        const estimate = await Estimate.findOneAndDelete(query);
        if (!estimate) {
            return res.status(404).json({ error: "Estimate not found" });
        }
        try {
            await MaterialOrder.deleteMany({ estimate_id: estimate._id });
        } catch (error) { }

        res.json({ message: "Estimate deleted successfully" });

        // Activity Logging
        await logActivity(
            estimate.project_id?._id || estimate.project_id,
            req.user,
            'Estimate',
            'Delete',
            `Estimate "${estimate.estimate_number}" deleted.`,
            { estimate_number: estimate.estimate_number },
            estimate._id,
            'Estimate'
        );
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

exports.sendEstimateEmail = async (req, res) => {
    try {
        const estimateId = req.params.id;
        const { email_type, emails = [] } = req.body;
        const query = createIdQuery(estimateId);
        const estimate = await Estimate.findOne(query).populate(
            "project_id",
            "project_name location customer_ids"
        );

        if (!estimate) {
            return res.status(404).json({ error: "Estimate not found" });
        }

        const attachments = [];

        if (estimate.file_attachments?.length > 0) {
            estimate.file_attachments.forEach(file => {
                try {
                    const fileName = file.file_url.split("/uploads/")[1];

                    const filePath = path.join(
                        process.cwd(),
                        "uploads",
                        fileName
                    );

                    if (fs.existsSync(filePath)) {
                        attachments.push({
                            filename: file.file_name,
                            path: filePath
                        });
                    }
                } catch (err) {
                    console.error("Attachment error:", err);
                }
            });
        }

        let token = estimate.public_share_token;
        if (!token) token = crypto.randomUUID();

        const ContactName = estimate.is_quick_estimate
            ? estimate.quick_customer?.customer_name || "Customer"
            : await getContactName(estimate.project_id);
        const estimateNo = estimate.estimate_number || "N/A";

        const termsAndConditions = await getTermsWithFallback(estimate.project_id);

        let senderData = null;
        if (req.user.role_type === "admin") {
            senderData = req.user;
        } else {
            const dbUser = await User.findById(req.user._id);
            if (dbUser?.created_by && mongoose.Types.ObjectId.isValid(dbUser.created_by)) {
                const client = await Client.findById(dbUser.created_by);
                if (client) {
                    senderData = client;
                }
            }
        }
        if (!senderData) {
            return res.status(400).json({ error: "Unable to resolve sender details" });
        }
        const {
            email,
            companyPhone,
            companyName,
            address,
            full_name,
            logo,
        } = senderData;
        const userToken = jwt.sign(
            { email, companyPhone, companyName, address, full_name, logo },
            process.env.JWT_SECRET,
            { expiresIn: "2d" }
        );

        const urlType = email_type === "summary" ? "s" : email_type === "crew" ? "c" : "d";
        const sigHmac = crypto.createHmac('sha256', process.env.JWT_SECRET || 'secret')
                              .update(`${token}:${urlType}`)
                              .digest('hex')
                              .substring(0, 10);

        const magicLink =
            `${process.env.BASE_URL}/estimate-print?` +
            `id=${estimate._id}&type=${urlType}&sig=${sigHmac}&token=${token}`;

        const emailSubject =
            email_type === "summary"
                ? `Estimate Summary - ${estimateNo} for ${ContactName}`
                : `Estimate Details - ${estimateNo} for ${ContactName}`;

        const emailText =
            email_type === "summary"
                ? `Summary of estimate ${estimateNo} for ${ContactName}`
                : `Detailed estimate ${estimateNo} for ${ContactName}`;

        const emailHtml = estimateMail(
            magicLink,
            estimateNo,
            ContactName,
            email,
            companyPhone,
            companyName,
            address,
            full_name,
            logo,
            email_type,
            termsAndConditions,
        );

        if (!emails.length) {
            return res.status(400).json({ error: "No email recipients provided" });
        }

        setImmediate(async () => {
            try {
                const pdfBuffer = await generateEstimatePdf(estimate._id, req, email_type || 'summary');
                const estimateAttachment = {
                    filename: `Estimate-${estimateNo}.pdf`,
                    content: pdfBuffer,
                    contentType: 'application/pdf'
                };
                attachments.push(estimateAttachment);

                await Promise.all(emails.map((to) =>
                    sendMail({
                        from: companyName,
                        replyTo: email,
                        to,
                        subject: emailSubject,
                        text: emailText,
                        html: emailHtml,
                        attachments
                    })
                ));
            } catch (err) {
                console.error("Background estimate email error:", err);
            }
        });

        const updateData = {
            public_share_token: token,
            updatedAt: new Date(),
        };

        if (email_type !== "crew") {
            updateData.status = "sent";
            updateData.sent_date = new Date();
        }

        const updatedEstimate = await Estimate.findOneAndUpdate(
            query,
            { $set: updateData },
            { new: true, runValidators: true }
        ).populate("project_id", "project_name location");

        res.json({
            success: true,
            message: `Estimate ${estimateNo} sent successfully to ${emails.length} contact(s)`,
            token,
            userToken,
            estimate: {
                ...updatedEstimate.toObject(),
                id: updatedEstimate._id.toString(),
                _id: updatedEstimate._id,
            },
        });

        const activityProjectId =
            updatedEstimate.project_id &&
                mongoose.Types.ObjectId.isValid(
                    updatedEstimate.project_id?._id || updatedEstimate.project_id
                )
                ? updatedEstimate.project_id?._id || updatedEstimate.project_id
                : updatedEstimate._id;

        // Activity Logging
        const changes = [];
        if (email_type !== "crew" && estimate.status !== "sent") {
            changes.push({ field: 'Status', old: estimate.status || 'draft', new: 'sent' });
        }

        await logActivity(
            activityProjectId,
            req.user,
            'Estimate',
            'Sent',
            `Estimate "${estimateNo}" sent via email.`,
            changes.length > 0 ? changes : null,
            updatedEstimate._id,
            'Estimate'
        );

    } catch (error) {
        console.error("Send estimate email error:", error);
        res.status(500).json({ error: error.message });
    }
}
