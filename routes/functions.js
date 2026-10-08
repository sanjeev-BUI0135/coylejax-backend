const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const mongoose = require('mongoose');

const { generateInvoicePdf } = require('../functions/generateInvoicePdf');
const { generateInvoiceDocx } = require('../functions/generateInvoiceDocx');
const { generateEstimatePdf } = require('../functions/generateEstimatePdf');
const { generateEstimateDocx } = require('../functions/generateEstimateDocx');
const { exportLaborToCsv } = require('../functions/exportLaborToCsv');
const { exportLaborToPdf } = require('../functions/exportLaborToPdf');

const Invoice = require('../models/Invoice');
const Project = require('../models/Project');
const Customer = require('../models/Customer');
const Estimate = require("../models/Estimate");
const User = require("../models/User");
const Client = require('../models/Client')
const { getTermsWithFallback } = require('../utils/termsAndConditions');
const { find } = require('../models/MasterData');
const MasterData = require('../models/MasterData');

const resolveUserById = async (id) => {
  if (!id) return null;

  try {
    let userId = id;

    if (typeof id === "object") {
      userId = id._id || id.id;
    }

    if (!userId) return null;

    userId = userId.toString();

    if (!mongoose.Types.ObjectId.isValid(userId)) return null;

    let user = await User.findById(userId)
      .select("email full_name companyName firstName lastName")
      .lean();

    if (user) {
      return { ...user, source: "user" };
    }

    let client = await Client.findById(userId)
      .select("email companyName firstName lastName")
      .lean();

    if (client) {
      return { ...client, source: "client" };
    }

    return null;

  } catch (err) {
    console.log("User resolve error:", err.message);
    return null;
  }
};

router.post('/get-public-invoice', async (req, res) => {
  try {
    const { token, type, sig } = req.body;
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    const invoice = await Invoice.findOne({ public_share_token: token });
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const crypto = require('crypto');
    let email_type = 'summary'; // safe fallback
    if (type && sig) {
      const expectedSig = crypto.createHmac('sha256', process.env.JWT_SECRET || 'secret')
                                .update(`${token}:${type}`)
                                .digest('hex')
                                .substring(0, 10);
      if (sig === expectedSig) {
        email_type = type === 'd' ? 'details' : 'summary';
      }
    }

    const project = await Project.findById(invoice.project_id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found for this invoice' });
    }

    // const { getTermsWithFallback } = require('../utils/termsAndConditions');
    // const termsAndConditions = await getTermsWithFallback(project._id, invoice.created_by);

    let customer = null;
    if (Array.isArray(project.customer_ids) && project.customer_ids.length > 0) {
      const firstCustomerId = project.customer_ids[0];
      if (mongoose.Types.ObjectId.isValid(firstCustomerId)) {
        customer = await Customer.findById(firstCustomerId);
      }
    }

    let createdByClient = null;

    if (invoice.created_by && mongoose.Types.ObjectId.isValid(invoice.created_by)) {
      createdByClient = await Client.findById(invoice.created_by);

      if (!createdByClient) {
        const user = await User.findById(invoice.created_by);
        if (
          user?.created_by &&
          mongoose.Types.ObjectId.isValid(user.created_by)
        ) {
          createdByClient = await Client.findById(user.created_by);
        }
      }
    }
    const createdById = invoice.created_by;

    const lookupIds = [];

    if (mongoose.Types.ObjectId.isValid(createdById)) {
      lookupIds.push(new mongoose.Types.ObjectId(createdById));
    }

    lookupIds.push(createdById.toString());

    const markupData = await MasterData.findOne({
      type: 'markup',
      created_by: { $in: lookupIds }
    }).lean();

    const divisionData = await MasterData.findOne({
      type: "divisions",
      value: project.project_type,
      created_by: { $in: lookupIds }
    }).lean();

    const termsAndConditions =
      divisionData?.terms_and_conditions || "";
      
    const divisionDisplayName = divisionData?.display_name || project?.project_type;

    // invoiceData.terms_and_conditions = divisionData?.terms_and_conditions || "";

    const categories = await MasterData.find({
      type: "categories",
      status: "active",
      created_by: {
        $in: [
          invoice.created_by?.toString(),
          new mongoose.Types.ObjectId(invoice.created_by)
        ]
      }
    }).lean();

    const categoryMap = {};

    categories.forEach(cat => {
      categoryMap[cat.value] =
        cat.display_name || cat.value;
    });

    const updatedLineItems = invoice.line_items.map(item => ({
      ...item.toObject?.() || item,
      category_display_name:
        categoryMap[item.category] ||
        item.category_display_name ||
        item.category
    }));

    let finalInvoice = invoice.toObject();
    finalInvoice.line_items = updatedLineItems;

    if (email_type === 'summary') {
      delete finalInvoice.subtotal;
      delete finalInvoice.tax_amount;
      delete finalInvoice.material_markup_amount;
      finalInvoice.line_items = finalInvoice.line_items.map(item => {
        delete item.unit_price;
        delete item.total;
        delete item.markup_percentage;
        return item;
      });
    }

    const createdByUser = await resolveUserById(invoice.created_by_user);

    res.json({
      invoice: {
        ...finalInvoice,
        id: invoice.id || invoice._id.toString(),
        _id: invoice._id,
        termsAndConditions,
        divisionDisplayName,
      },
      emailType: email_type,
      project,
      customer,
      createdBy: createdByClient,
      createdByUser,
      markupData: markupData || null,
    });

  } catch (err) {
    console.error('Error fetching public invoice:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/get-public-estimate', async (req, res) => {
  try {
    const { token, type, sig } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    // ---------------------------------------------------
    // 1. LOAD ESTIMATE
    // ---------------------------------------------------
    const estimate = await Estimate.findOne({
      public_share_token: token
    }).populate("project_id");

    if (!estimate) {
      return res.status(404).json({ error: 'Estimate not found or token is invalid' });
    }

    const crypto = require('crypto');
    let email_type = 'summary'; // default fallback
    if (type && sig) {
      const expectedSig = crypto.createHmac('sha256', process.env.JWT_SECRET || 'secret')
                                .update(`${token}:${type}`)
                                .digest('hex')
                                .substring(0, 10);
      if (sig === expectedSig) {
        email_type = type === 'd' ? 'details' : type === 'c' ? 'crew' : 'summary';
      }
    }

    // ---------------------------------------------------
    // 3. PROJECT (ONLY IF NOT QUICK)
    // ---------------------------------------------------
    let project = null;

    if (
      !estimate.is_quick_estimate &&
      estimate.project_id &&
      mongoose.Types.ObjectId.isValid(
        typeof estimate.project_id === "object"
          ? estimate.project_id._id
          : estimate.project_id
      )
    ) {
      const projectId =
        typeof estimate.project_id === "object"
          ? estimate.project_id._id
          : estimate.project_id;

      project = await Project.findById(projectId);
    }

    // ---------------------------------------------------
    // 4. CUSTOMER
    // ---------------------------------------------------
    let customer = null;

    if (estimate.is_quick_estimate) {
      // Quick estimate → virtual customer from estimate
      customer = {
        contact_name: estimate.quick_customer?.customer_name || "Customer",
        email: estimate.quick_customer?.email_address || "",
        phone: estimate.quick_customer?.phone_number || "",
        address: estimate.quick_customer?.site_address || "",
        city: "",
        state: "",
        zip_code: ""
      };
    } else if (project?.customer_ids && project.customer_ids.length > 0) {
      const customerId = Array.isArray(project.customer_ids)
        ? project.customer_ids[0]
        : project.customer_ids;

      if (mongoose.Types.ObjectId.isValid(customerId)) {
        customer = await Customer.findById(customerId);
      }
    }

    // ---------------------------------------------------
    // 5. CREATED BY (CLIENT / USER SAFE)
    // ---------------------------------------------------
    let createdByClient = null;

    if (estimate.created_by && mongoose.Types.ObjectId.isValid(estimate.created_by)) {
      createdByClient = await Client.findById(estimate.created_by);

      if (!createdByClient) {
        const user = await User.findById(estimate.created_by);
        if (
          user?.created_by &&
          mongoose.Types.ObjectId.isValid(user.created_by)
        ) {
          createdByClient = await Client.findById(user.created_by);
        }
      }
    }

    const categories = await MasterData.find({
      type: "categories",
      status: "active",
      created_by: {
        $in: [
          estimate.created_by?.toString(),
          new mongoose.Types.ObjectId(estimate.created_by)
        ]
      }
    }).lean();

    const categoryMap = {};

    categories.forEach(cat => {
      categoryMap[cat.value] =
        cat.display_name || cat.value;
    });

    const updatedLineItems = estimate.line_items.map(item => ({
      ...item.toObject?.() || item,
      category_display_name:
        categoryMap[item.category] ||
        item.category_display_name ||
        item.category
    }));

    let finalEstimate = estimate.toObject();
    finalEstimate.line_items = updatedLineItems;

    if (email_type === 'summary') {
      delete finalEstimate.subtotal;
      delete finalEstimate.tax_amount;
      delete finalEstimate.material_markup_amount;
      finalEstimate.line_items = finalEstimate.line_items.map(item => {
        delete item.unit_price;
        delete item.total;
        delete item.markup_percentage;
        return item;
      });
    } else if (email_type === 'crew') {
      delete finalEstimate.subtotal;
      delete finalEstimate.tax_amount;
      delete finalEstimate.material_markup_amount;
      delete finalEstimate.total_amount;
      finalEstimate.line_items = finalEstimate.line_items.map(item => {
        delete item.unit_price;
        delete item.total;
        delete item.markup_percentage;
        return item;
      });
    }

    const createdByUser = await resolveUserById(estimate.created_by_user);
    const createdById = estimate.created_by;

    const lookupIds = [];

    if (mongoose.Types.ObjectId.isValid(createdById)) {
      lookupIds.push(new mongoose.Types.ObjectId(createdById));
    }

    lookupIds.push(createdById.toString());

    const divisionValue = estimate.is_quick_estimate
      ? estimate.quick_customer?.division_type
      : project?.project_type;

    const divisionData = await MasterData.findOne({
      type: "divisions",
      value: divisionValue,
      created_by: { $in: lookupIds }
    }).lean();

    const termsAndConditions =
      divisionData?.terms_and_conditions || "";
      
    const divisionDisplayName = divisionData?.display_name || divisionValue;

    const markupData = await MasterData.findOne({
      type: 'markup',
      created_by: { $in: lookupIds }
    }).lean();

    // ---------------------------------------------------
    // 6. RESPONSE
    // ---------------------------------------------------
    res.json({
      estimate: {
        ...finalEstimate,
        id: estimate.id || estimate._id.toString(),
        _id: estimate._id,
        termsAndConditions,
        divisionDisplayName
      },
      emailType: email_type,
      project: project ? project.toObject() : null,
      customer: customer || null,
      createdBy: createdByClient,
      createdByUser: createdByUser,
      markupData: markupData || null
    });

  } catch (error) {
    console.error('Error fetching public estimate:', error);
    res.status(500).json({
      error: error.message || 'Failed to fetch estimate'
    });
  }
});


router.post('/generate-invoice-pdf', auth, async (req, res) => {
  try {
    const { invoice_id, pdf_type = 'details' } = req.body;
    if (!invoice_id) return res.status(400).json({ error: 'Invoice ID is required' });

    const pdfBuffer = await generateInvoicePdf(invoice_id, req, pdf_type);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=invoice-${invoice_id}-${pdf_type}.pdf`);
    res.send(pdfBuffer);

  } catch (err) {
    console.error('PDF generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/generate-estimate-pdf', auth, async (req, res) => {
  try {
    const { estimate_id, pdf_type = 'summary' } = req.body;

    if (!estimate_id) {
      return res.status(400).json({ error: 'Estimate ID is required' });
    }

    // Validate pdf_type
    if (!['summary', 'details', 'crew'].includes(pdf_type)) {
      return res.status(400).json({ error: 'Invalid PDF type. Must be "summary", "details", or "crew"' });
    }

    // Pass pdf_type to the PDF generation function
    const pdfBuffer = await generateEstimatePdf(estimate_id, req, pdf_type);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=estimate-${estimate_id}-${pdf_type}.pdf`);
    res.send(Buffer.from(pdfBuffer));
  } catch (error) {
    console.error('Error generating estimate PDF:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/generate-estimate-docx', auth, async (req, res) => {
  try {
    const { estimate_id, docx_type = 'summary' } = req.body;

    if (!estimate_id) {
      return res.status(400).json({ error: 'Estimate ID is required' });
    }

    // Validate docx_type
    if (!['summary', 'details', 'crew'].includes(docx_type)) {
      return res.status(400).json({ error: 'Invalid DOCX type. Must be "summary", "details", or "crew"' });
    }

    const docxBuffer = await generateEstimateDocx(estimate_id, req, docx_type);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename=estimate-${estimate_id}-${docx_type}.docx`);
    res.send(Buffer.from(docxBuffer));
  } catch (error) {
    console.error('Error generating estimate DOCX:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/generate-invoice-docx', auth, async (req, res) => {
  try {
    const { invoice_id, docx_type = 'details' } = req.body;

    if (!invoice_id) {
      return res.status(400).json({ error: 'Invoice ID is required' });
    }

    // Validate docx_type
    if (!['summary', 'details'].includes(docx_type)) {
      return res.status(400).json({ error: 'Invalid DOCX type. Must be "summary" or "details"' });
    }

    const docxBuffer = await generateInvoiceDocx(invoice_id, req, docx_type);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename=invoice-${invoice_id}-${docx_type}.docx`);
    res.send(Buffer.from(docxBuffer));
  } catch (error) {
    console.error('Error generating invoice DOCX:', error);
    res.status(500).json({ error: error.message });
  }
});

// Export Labor to CSV
router.post('/export-labor-csv', auth, async (req, res) => {
  try {
    const { entry_ids } = req.body;
    if (!entry_ids || !Array.isArray(entry_ids)) {
      return res.status(400).json({ error: 'Entry IDs array is required' });
    }

    const csvContent = await exportLaborToCsv(entry_ids);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=labor-export.csv');
    res.send(csvContent);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export Labor to PDF
router.post('/export-labor-pdf', auth, async (req, res) => {
  try {
    const { entry_ids, report_title } = req.body;
    if (!entry_ids || !Array.isArray(entry_ids)) {
      return res.status(400).json({ error: 'Entry IDs array is required' });
    }

    const pdfBuffer = await exportLaborToPdf(entry_ids, report_title);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=labor-report.pdf');
    res.send(Buffer.from(pdfBuffer));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Public estimate download
router.get("/download-estimate-public/:token", async (req, res) => {
  try {
    const estimate = await Estimate.findOne({ public_share_token: req.params.token });
    if (!estimate) return res.status(404).send("Estimate not found");
    
    const pdf_type = req.query.type || "summary";
    if (!['summary', 'details', 'crew'].includes(pdf_type)) {
      return res.status(400).send("Invalid PDF type");
    }

    const pdfBuffer = await generateEstimatePdf(estimate._id, req, pdf_type);

    res.setHeader("Content-Disposition", `attachment; filename=Estimate-${estimate.estimate_number || estimate.estimate_no}-${pdf_type}.pdf`);
    res.setHeader("Content-Type", "application/pdf");
    res.send(Buffer.from(pdfBuffer));
  } catch (err) {
    console.error("Estimate PDF Error:", err);
    if (!res.headersSent) {
      res.status(500).send("Error generating estimate PDF");
    }
  }
});

// Admin/Direct estimate download by ID
router.get("/download-estimate/:id", async (req, res) => {
  try {
    const estimate = await Estimate.findById(req.params.id);
    if (!estimate) return res.status(404).send("Estimate not found");
    
    let pdf_type = req.query.type || "summary";
    const sig = req.query.sig;

    if (sig) {
      const crypto = require('crypto');
      const expectedSig = crypto.createHmac('sha256', process.env.JWT_SECRET || 'secret')
                                .update(`${req.params.id}:${pdf_type}`)
                                .digest('hex')
                                .substring(0, 10);
      if (sig !== expectedSig) {
        // Tampered link, fallback to summary
        pdf_type = "summary";
      }
    } else {
      // No sig provided (old link or manual tamper), enforce summary
      pdf_type = "summary";
    }

    if (!['summary', 'details', 'crew'].includes(pdf_type)) {
      return res.status(400).send("Invalid PDF type");
    }

    const pdfBuffer = await generateEstimatePdf(estimate._id, req, pdf_type);

    res.setHeader("Content-Disposition", `attachment; filename=Estimate-${estimate.estimate_number || estimate.estimate_no}-${pdf_type}.pdf`);
    res.setHeader("Content-Type", "application/pdf");
    res.send(Buffer.from(pdfBuffer));
  } catch (err) {
    console.error("Estimate PDF Error:", err);
    if (!res.headersSent) {
      res.status(500).send("Error generating estimate PDF");
    }
  }
});

module.exports = router;
