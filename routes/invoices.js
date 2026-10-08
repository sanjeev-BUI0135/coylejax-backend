const express = require('express');
const router = express.Router();
const Invoice = require('../models/Invoice');
const Customer = require('../models/Customer');
const Estimate = require('../models/Estimate');
const Project = require('../models/Project');
const Message = require('../models/Message');
const auth = require('../middleware/auth');
const { logActivity, getChanges } = require('../utils/activityLogger');
const { createIdQuery } = require('../utils/idHelper');
const sendMail = require('../utils/sendMail');
const mongoose = require('mongoose');
const crypto = require('crypto');
const generateInvoiceEmailHTML = require('../utils/invoiceEmailTemplate');
const Client = require('../models/Client');
const { sendMessage, normalizePhone } = require('../utils/twilio');
const User = require('../models/User');
const { getMarkupThreshold } = require('../helpers/getMarkupThreshold.js');
const { hasLowMarkupItems, getLowMarkupItems } = require('../helpers/markupHelper.js');
const { getLowMarkupRecipients } = require('../helpers/getLowMarkupRecipients.js');
const lowMarkupItemsMail = require("../utils/lowMarkupItemsMail");
const Payment = require('../models/Payment');
const applyScope = require('../helpers/applyScope.js');
const buildAggregationPipeline = require('../utils/aggregationBuilder.js');
const { getContactName, getOwnerId, applyTaxRateToInvoice } = require("../utils/estimateHelpers");

// Get all invoices with server-side pagination, sorting, and search
router.get("/", auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const isAll = req.query.all === "true";
    const limit = isAll ? null : parseInt(req.query.limit) || 10;
    const sort = req.query.sort || "-updatedAt";
    const search = req.query.search || "";
    const project_id = req.query.project_id || "";
    const company_name = req.query.company_name || "";
    const customer = req.query.customer || "";
    const status = req.query.status || "";
    const created_by_user = req.query.created_by_user || "";
    const baseQuery = {};
    if (created_by_user) {
      baseQuery.created_by_user = {
        $in: [
          created_by_user,
          new mongoose.Types.ObjectId(created_by_user)
        ]
      };
    }
    const finalQuery = applyScope(req, baseQuery, { excludeDivision: true });

    const { pipeline, countPipeline } = buildAggregationPipeline({ query: finalQuery, sort, search, page, limit, isAll, includeProject: true, includeCustomer: true, project_id, company_name, customer, status, user: req.user });
    const invoices = await Invoice.aggregate(pipeline);
    const totalAgg = await Invoice.aggregate(countPipeline);
    const total = totalAgg[0]?.total || 0;

    res.json({
      data: invoices,
      total,
      page,
      limit,
      pages: isAll ? 1 : Math.ceil(total / limit)
    });

  } catch (error) {
    console.error("Invoice GET error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/next-po-number", auth, async (req, res) => {
  try {
    const adminId = getOwnerId(req);
    const config = req.user?.project_number_config?.new_project || {};
    const year = config.year;
    const prefix = config.prefix || '';

    // If estimate_id or project_id is passed, derive PO from the linked estimate
    const estimateId = req.query.estimate_id || req.query.estimateId;
    const projectId = req.query.project_id || req.query.projectId;

    let linkedEstimate = null;

    if (estimateId) {
      const { createIdQuery } = require('../utils/idHelper');
      linkedEstimate = await Estimate.findOne(createIdQuery(estimateId))
        .select('customer_po_number estimate_number').lean();
    } else if (projectId) {
      linkedEstimate = await Estimate.findOne({
        project_id: projectId,
        created_by: { $in: [adminId, adminId.toString()] }
      })
        .select('customer_po_number estimate_number')
        .sort({ createdAt: -1 })
        .lean();
    }

    let customer_po_number = "";

    if (linkedEstimate?.estimate_number) {

      const baseEstimateNumber = linkedEstimate.estimate_number
        .replace(/-\d+$/, "")
        .replace(/^EST-/, "");

      customer_po_number = `PO-${baseEstimateNumber}`;

    } else if (projectId) {
      const projectData = await Project.findById(projectId)
        .select("project_number")
        .lean();

      if (projectData?.project_number) {
        const baseProjectNumber = projectData.project_number.replace(/-\d+$/, "");
        customer_po_number = `PO-${baseProjectNumber}`;
      }
    }

    return res.json({ customer_po_number });

    res.json({ customer_po_number });
  } catch (error) {
    console.error('Invoice next-po-number error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single invoice
router.get('/:id', auth, async (req, res) => {
  try {
    const searchId = req.params.id;
    const query = createIdQuery(searchId);

    const ownerQuery = getOwnerId(req);
    const invoice = await Invoice.findOne(query)
      .populate('project_id');

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const token = invoice.public_share_token;
    let signatures = {};
    if (token) {
      const hmac = (type) => crypto.createHmac('sha256', process.env.JWT_SECRET || 'secret').update(`${token}:${type}`).digest('hex').substring(0, 10);
      signatures = {
        s: hmac('s'),
        d: hmac('d')
      };
    }

    const responseData = {
      ...invoice.toObject(),
      id: invoice.id || invoice._id.toString(),
      _id: invoice._id,
      signatures
    };

    res.json(responseData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create invoice
router.post("/", auth, async (req, res) => {
  try {
    const adminId = getOwnerId(req);
    await applyTaxRateToInvoice(req.body, adminId);

    let totalamount;
    totalamount = req.body.total_amount
    totalamount = Number(totalamount.toFixed(2))
    const loggedInUserId = req.user?._id || null;
    if (req.body.customer_po_number) {
      const existing = await Invoice.findOne({
        customer_po_number: req.body.customer_po_number,
        created_by: { $in: [adminId, adminId.toString()] }
      });


    }
    const project = await Project.findById(req.body.project_id)
      .select("created_by_user")
      .lean();

    if (!project) {
      return res.status(404).json({
        error: "Project not found"
      });
    }
    const created_by = adminId;
    const materialMarkupPercent = parseFloat(req.body.material_markup) || 0;
    const markupLimit = await getMarkupThreshold(adminId);
    const year = req.body.invoice_year;
    const prefix = req.body.invoice_prefix || '';
    const estimateId = req.body.estimate_id;

    const allInvoices = await Invoice.find({
      created_by: { $in: [adminId, adminId.toString()] },
      invoice_number: { $regex: `^INV-${year}` }
    }).select('invoice_number customer_po_number estimate_id createdAt').lean();

    let invoice_number;

    if (req.body.project_id) {

      const projectData = await Project.findById(req.body.project_id)
        .select("project_number")
        .lean();

      if (!projectData) {
        return res.status(404).json({
          error: "Project not found"
        });
      }

      const baseInvoiceNumber = `INV-${projectData.project_number}`;

      const existingProjectInvoices = await Invoice.find({
        project_id: req.body.project_id
      })
        .select("invoice_number")
        .lean();

      const suffixes = existingProjectInvoices.map(inv => {

        // First invoice without suffix
        if (inv.invoice_number === baseInvoiceNumber) {
          return 1;
        }

        // Match invoices like INV-260131CM-2
        const match = inv.invoice_number.match(
          new RegExp(`^${baseInvoiceNumber}-(\\d+)$`)
        );

        return match ? parseInt(match[1], 10) : 0;
      });

      const nextSuffix =
        suffixes.length > 0
          ? Math.max(...suffixes) + 1
          : null;

      invoice_number =
        nextSuffix && nextSuffix > 1
          ? `${baseInvoiceNumber}-${nextSuffix}`
          : baseInvoiceNumber;

    }

    let customer_po_number = req.body.customer_po_number;

    // Final fallback: derive from invoice_number with correct PO- prefix
    if (!customer_po_number && invoice_number) {
      const base = invoice_number.replace(/-\d+$/, '');
      customer_po_number = base.replace(/^INV-/, 'PO-');
    }

    let additional_markup_status = "N/A";
    if (materialMarkupPercent > 0 && materialMarkupPercent < markupLimit) {
      additional_markup_status = "pending";
    }

    const hasLowMarkup = await hasLowMarkupItems(req.body.line_items, adminId);

    const invoice = new Invoice({
      ...req.body,
      invoice_number,
      customer_po_number,
      total_amount: totalamount,
      created_by,
      created_by_user: project.created_by_user || loggedInUserId,
      additional_markup_status,
      markup_status: hasLowMarkup ? "pending" : "N/A",
    });
    await invoice.save();
    await invoice.populate("project_id", "project_name location");

    // ---------------------------------------------------
    // LOW MATERIAL MARKUP EMAIL
    // ---------------------------------------------------
    try {
      if (hasLowMarkup) {
        const lowMarkupItems = await getLowMarkupItems(invoice.line_items, adminId);
        if (lowMarkupItems.length > 0) {
          let creator = await User.findById(adminId).lean();
          if (!creator) {
            creator = await Client.findById(adminId).lean();
          }

          if (creator) {
            const invoiceNo = invoice.invoice_number || "N/A";
            const recipients = await getLowMarkupRecipients(adminId);

            for (const user of recipients) {
              const emailHtml = lowMarkupItemsMail(
                user.full_name || "User",
                invoiceNo,
                lowMarkupItems,
                invoice.total_amount,
                new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }),
                invoice._id.toString(),
                creator,
                false,
                markupLimit,
                'Invoice'
              );

              await sendMail({
                from: creator.companyName,
                replyTo: creator.email,
                to: user.email,
                subject: `Low Material Markup Alert - Invoice ${invoiceNo}`,
                text: `Invoice ${invoiceNo} has line items with low material markup.`,
                html: emailHtml
              });
            }
          }
        }
      }
    } catch (mailErr) {
      console.error("Invoice low markup email error:", mailErr);
    }

    let signatures = {};
    if (invoice.public_share_token) {
      const hmac = (type) => crypto.createHmac('sha256', process.env.JWT_SECRET || 'secret').update(`${invoice.public_share_token}:${type}`).digest('hex').substring(0, 10);
      signatures = { s: hmac('s'), d: hmac('d') };
    }

    res.status(201).json({
      ...invoice.toObject(),
      signatures
    });

    // Activity Logging
    await logActivity(
      invoice.project_id?._id || invoice.project_id,
      req.user,
      'Invoice',
      'Create',
      `Invoice "${invoice.invoice_number}" created.`,
      { invoice_number: invoice.invoice_number, total_amount: invoice.total_amount },
      invoice._id,
      'Invoice'
    );
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Update invoice
router.put('/:id', auth, async (req, res) => {
  try {
    const adminId = getOwnerId(req);
    await applyTaxRateToInvoice(req.body, adminId);

    let totalAmount = Number(req.body.total_amount || 0);
    totalAmount = Math.round(totalAmount * 100) / 100;
    req.body.total_amount = totalAmount;

    const invoiceId = req.params.id;
    const query = createIdQuery(invoiceId);
    const ownerQuery = getOwnerId(req);

    const existingInvoice = await Invoice.findOne(query);
    if (req.body.customer_po_number) {
      const adminId = getOwnerId(req);

      const existingPO = await Invoice.findOne({
        customer_po_number: req.body.customer_po_number,
        created_by: { $in: [adminId, adminId.toString()] },
        _id: { $ne: existingInvoice._id }
      });

    }
    if (!existingInvoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const materialMarkupPercent = parseFloat(req.body.material_markup) || 0;
    const markupLimit = await getMarkupThreshold(adminId);

    if (materialMarkupPercent > 0 && materialMarkupPercent < markupLimit) {
      req.body.additional_markup_status = "pending";
    } else if (materialMarkupPercent >= markupLimit) {
      req.body.additional_markup_status = "approved";
    }

    if (req.body.line_items) {
      const hasLowMarkup = await hasLowMarkupItems(req.body.line_items, adminId);
      req.body.markup_status = hasLowMarkup ? "pending" : "N/A";
    }

    if ("created_by" in req.body) delete req.body.created_by;
    if ("created_by_user" in req.body) delete req.body.created_by_user;
    if ("created_by_model" in req.body) delete req.body.created_by_model;

    const invoice = await Invoice.findOneAndUpdate(
      query,
      { $set: req.body },
      {
        new: true,
        runValidators: true
      }
    ).populate('project_id', 'project_name location');

    let signatures = {};
    if (invoice.public_share_token) {
      const hmac = (type) => crypto.createHmac('sha256', process.env.JWT_SECRET || 'secret').update(`${invoice.public_share_token}:${type}`).digest('hex').substring(0, 10);
      signatures = { s: hmac('s'), d: hmac('d') };
    }

    res.json({
      ...invoice.toObject(),
      id: invoice.id || invoice._id.toString(),
      _id: invoice._id,
      signatures
    });

    // Activity Logging
    const isStatusChange = req.body.status && req.body.status !== existingInvoice.status;
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
      'amount_paid', 'due_date'
    ];
    const changes = getChanges(existingInvoice, invoice, trackedFields);

    await logActivity(
      invoice.project_id?._id || invoice.project_id,
      req.user,
      'Invoice',
      actionName,
      isStatusChange
        ? `Invoice "${invoice.invoice_number}" status changed to "${invoice.status}".`
        : `Invoice "${invoice.invoice_number}" details updated.`,
      changes.length > 0 ? changes : {
        invoice_number: invoice.invoice_number,
        status: invoice.status,
        previous_status: existingInvoice.status
      },
      invoice._id,
      'Invoice'
    );
  } catch (error) {
    console.error("Invoice update error:", error);
    res.status(400).json({ error: error.message });
  }
});

// DELETE /api/invoices/bulk
router.delete('/bulk', auth, async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "No invoices selected" });
    }

    const ownerId = getOwnerId(req);

    const invoicesToDelete = await Invoice.find({
      _id: { $in: ids },
      created_by: { $in: [ownerId, ownerId.toString()] }
    });

    // Only delete invoices belonging to this owner
    const result = await Invoice.deleteMany({
      _id: { $in: ids },
      created_by: { $in: [ownerId, ownerId.toString()] }
    });

    await Payment.deleteMany({
      $or: [
        { invoice_id: { $in: ids } },
        { invoice_id: { $in: ids.map(id => new mongoose.Types.ObjectId(id)) } }
      ]
    });
    const estimateIds = [
      ...new Set(
        invoicesToDelete
          .map(inv => inv.estimate_id)
          .filter(Boolean)
          .map(id => id.toString())
      )
    ];

    for (const estimateId of estimateIds) {
      const remainingInvoices = await Invoice.find({ estimate_id: estimateId });

      const total = remainingInvoices.reduce(
        (sum, inv) => sum + (inv.total_amount || 0),
        0
      );

      await Estimate.findByIdAndUpdate(estimateId, {
        invoiced_amount: total
      });
    }

    res.json({
      success: true,
      deleted_count: result.deletedCount
    });

  } catch (error) {
    console.error("Bulk delete invoice error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Delete invoice
router.delete('/:id', auth, async (req, res) => {
  try {
    const invoiceId = req.params.id;
    const query = createIdQuery(invoiceId);
    const ownerQuery = getOwnerId(req);
    const invoice = await Invoice.findOneAndDelete(query);
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    await Payment.deleteMany({
      $or: [
        { invoice_id: invoiceId },
        { invoice_id: new mongoose.Types.ObjectId(invoiceId) }
      ]
    });
    if (invoice.estimate_id) {
      const invoices = await Invoice.find({
        estimate_id: invoice.estimate_id
      });

      const total = invoices.reduce(
        (sum, inv) => sum + (inv.total_amount || 0),
        0
      );

      await Estimate.findByIdAndUpdate(invoice.estimate_id, {
        invoiced_amount: total
      });
    }
    res.json({ message: 'Invoice deleted successfully' });

    // Activity Logging
    await logActivity(
      invoice.project_id?._id || invoice.project_id,
      req.user,
      'Invoice',
      'Delete',
      `Invoice "${invoice.invoice_number}" deleted.`,
      { invoice_number: invoice.invoice_number }
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id/send-email', auth, async (req, res) => {

  try {
    const invoiceId = req.params.id;
    const { email_type, emails = [] } = req.body;
    const query = createIdQuery(invoiceId);
    const ownerQuery = getOwnerId(req);

    const invoice = await Invoice.findOne(query).populate("project_id", "project_name location customer_ids");

    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }
    const client = await Client.findById(invoice.created_by);

    if (!client) {
      return res.status(404).json({ error: "Invoice client not found" });
    }

    let token = invoice.public_share_token;
    if (!token) {
      token = crypto.randomUUID();
    }

    const ContactName = await getContactName(invoice.project_id);
    const urlType = email_type === 'summary' ? 's' : 'd';
    const sigHmac = crypto.createHmac('sha256', process.env.JWT_SECRET || 'secret')
                          .update(`${token}:${urlType}`)
                          .digest('hex')
                          .substring(0, 10);
    const magicLink = `${process.env.BASE_URL}/PublicInvoice?token=${token}&type=${urlType}&sig=${sigHmac}`;
    const invoiceNo = invoice.invoice_number || "N/A";

    try {
      let emailSubject, emailText, emailHtml;

      if (email_type === 'summary') {
        emailSubject = `Invoice Summary - ${invoiceNo} for ${ContactName}`;
        emailText = `Summary of invoice ${invoiceNo} for ${ContactName}`;
      } else {
        emailSubject = `Invoice Details - ${invoiceNo} for ${ContactName}`;
        emailText = `Detailed invoice ${invoiceNo} for ${ContactName}`;
      }
      const { email, companyPhone, companyName, address, logo } = client;
      emailHtml = generateInvoiceEmailHTML(
        magicLink,
        invoiceNo,
        ContactName,
        email_type,
        invoice.total_amount,
        invoice.due_date,
        email,
        companyPhone,
        companyName,
        address,
        logo,
        invoice.amount_paid || 0
      );

      if (!emails.length) {
        return res.status(400).json({ error: "No email recipients provided" });
      }

      const emailPromises = emails
        .filter(Boolean)
        .map(toEmail =>
          sendMail({
            from: companyName,
            replyTo: email,
            to: toEmail,
            subject: emailSubject,
            text: emailText,
            html: emailHtml,
          })
        );

      await Promise.all(emailPromises);

      const updatedInvoice = await Invoice.findOneAndUpdate(
        query,
        {
          $set: {
            status: 'sent',
            invoice_sent_date: new Date(),
            auto_resend_count:
              invoice.status !== 'sent'
                ? 0
                : (invoice.auto_resend_count || 0),
            public_share_token: token,
            updatedAt: new Date()
          }
        },
        { new: true, runValidators: true }
      ).populate("project_id", "project_name location");

      if (!updatedInvoice) {
        return res.status(404).json({ error: "Failed to update invoice status" });
      }

      res.json({
        success: true,
        message: `Invoice ${invoiceNo} sent successfully to ${emails.length} contact(s)`,
        invoice: {
          ...updatedInvoice.toObject(),
          id: updatedInvoice.id || updatedInvoice._id.toString(),
          _id: updatedInvoice._id,
        }
      });

      // Activity Logging
      await logActivity(
        updatedInvoice.project_id?._id || updatedInvoice.project_id,
        req.user,
        'Invoice',
        'Sent',
        `Invoice "${invoiceNo}" sent via email.`,
        [{ field: 'Status', old: invoice.status || '-', new: 'Sent' }],
        updatedInvoice._id,
        'Invoice'
      );
    } catch (mailError) {
      console.error('Email sending error:', mailError);
      res.status(500).json({
        error: mailError?.message || "Unknown email error",
        details: mailError,
      });
    }
  } catch (error) {
    console.error('Invoice email route error:', error);
    res.status(500).json({ error: error.message });
  }
});


router.put('/:id/send-sms', auth, async (req, res) => {
  try {
    const invoiceId = req.params.id;
    const { phone_numbers = [], isWhatsApp = false } = req.body;
    const query = createIdQuery(invoiceId);

    const invoice = await Invoice.findOne(query).populate("project_id", "project_name location");

    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    const client = await Client.findById(invoice.created_by);
    if (!client) {
      return res.status(404).json({ error: "Invoice client not found" });
    }

    let token = invoice.public_share_token;
    if (!token) {
      token = crypto.randomUUID();
    }

    const contactName = await getContactName(invoice.project_id);
    const magicLink = `${process.env.BASE_URL}/PublicInvoice?token=${token}`;
    const invoiceNo = invoice.invoice_number || "N/A";
    const companyName = client.companyName || "Our Company";

    const messageBody = req.body.message || `Hello ${contactName}, your invoice ${invoiceNo} from ${companyName} is ready. View it here: ${magicLink}`;

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

    await Invoice.findOneAndUpdate(
      query,
      {
        $set: {
          status: 'sent',
          sent_date: new Date(),
          public_share_token: token,
          updatedAt: new Date()
        }
      },
      { new: true }
    );

    res.json({
      success: true,
      message: `Invoice ${invoiceNo} sent successfully via ${isWhatsApp ? 'WhatsApp' : 'SMS'} to ${phone_numbers.length} contact(s)`
    });

    // Activity Logging
    await logActivity(
      invoice.project_id?._id || invoice.project_id,
      req.user,
      'Invoice',
      'Sent',
      `Invoice "${invoiceNo}" sent via ${isWhatsApp ? 'WhatsApp' : 'SMS'}.`,
      [{ field: 'Status', old: invoice.status || '-', new: 'Sent' }],
      invoice._id,
      'Invoice'
    );
  } catch (error) {
    console.error('Invoice SMS route error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/:id/markup-status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.query;

    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Error</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f4f4f4; }
            .container { max-width: 500px; margin: 50px auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.1); text-align: center; }
            .error { color: #dc3545; font-size: 24px; margin-bottom: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1 class="error">Invalid Status</h1>
            <p>The status must be either 'approved' or 'rejected'.</p>
          </div>
        </body>
        </html>
      `);
    }

    const query = createIdQuery(id);
    const updateData = {
      markup_status: status,
      markup_status_updated_at: new Date(),
      updatedAt: new Date(),
    };

    const invoice = await Invoice.findOneAndUpdate(
      query,
      updateData,
      { new: true, runValidators: true }
    ).populate("project_id", "project_name location");

    if (!invoice) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Error</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f4f4f4; }
            .container { max-width: 500px; margin: 50px auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.1); text-align: center; }
            .error { color: #dc3545; font-size: 24px; margin-bottom: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1 class="error">Invoice Not Found</h1>
            <p>The requested invoice could not be found.</p>
          </div>
        </body>
        </html>
      `);
    }

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Success</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f4f4f4; }
          .container { max-width: 500px; margin: 50px auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.1); text-align: center; }
          .message { color: #28a745; font-size: 24px; margin-bottom: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1 class="message">Success!</h1>
          <p>The markup has been ${status} for Invoice ${invoice.invoice_number || "N/A"}.</p>
        </div>
      </body>
      </html>
    `);

  } catch (error) {
    console.error("Invoice markup status error:", error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Error</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f4f4f4; }
          .container { max-width: 500px; margin: 50px auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.1); text-align: center; }
          .error { color: #dc3545; font-size: 24px; margin-bottom: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1 class="error">Error</h1>
          <p>Failed to update markup status: ${error.message}</p>
        </div>
      </body>
      </html>
    `);
  }
});

module.exports = router;