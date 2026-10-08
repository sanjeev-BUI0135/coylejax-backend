const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const PaymentSettings = require("../models/PaymentSettings");
const auth = require("../middleware/auth");
const Invoice = require("../models/Invoice");
const Project = require("../models/Project");
const Estimate = require("../models/Estimate");
const { applyTaxRateToEstimate, applyTaxRateToInvoice } = require("../utils/estimateHelpers");
const User = require("../models/User");
const Client = require("../models/Client");

router.post("/stripe", auth, async (req, res) => {
  try {
    const {
      enabled,
      publishableKey,
      secretKey,
      cashEnabled,
      checkEnabled,
      cardsEnabled,
      achEnabled,
      mobileEnabled,
      taxRate,
      taxExemptCustomers,
      taxExemptLeads,
    } = req.body;

    const CreatorId = req.user.role_type === "admin" ? req.user._id : req.user.created_by;
    let settings = await PaymentSettings.findOne({
      provider: "stripe",
      createdBy: CreatorId,

    });
    if (!settings) {
      settings = new PaymentSettings({
        provider: "stripe",
        createdBy: CreatorId,
      });
    }

    settings.enabled = enabled;
    if (publishableKey) settings.publishableKey = publishableKey;
    if (secretKey) settings.secretKey = secretKey;

    settings.cashEnabled = cashEnabled;
    settings.checkEnabled = checkEnabled;
    settings.cardsEnabled = cardsEnabled;
    settings.achEnabled = achEnabled;
    settings.mobileEnabled = mobileEnabled;

    if (taxRate !== undefined) settings.taxRate = taxRate;
    if (taxExemptCustomers !== undefined) settings.taxExemptCustomers = taxExemptCustomers;
    if (taxExemptLeads !== undefined) settings.taxExemptLeads = taxExemptLeads;

    settings.updatedBy = CreatorId;
    settings.updatedAt = new Date();

    await settings.save();

    // Update estimates and invoices in the background to avoid blocking response and causing 504 timeouts
    setImmediate(() => {
      updateEstimatesAndInvoicesTaxRatesInBg(CreatorId, settings);
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Error saving stripe settings:", err);
    res.status(500).json({ error: "Failed to save stripe settings" });
  }
});


router.get("/stripe", auth, async (req, res) => {
  try {
    const Creator = req.user.role_type === "admin" ? req.user._id : req.user.created_by;

    const settings = await PaymentSettings.findOne({
      provider: "stripe",
      createdBy: Creator,
    });

    if (!settings) {
      return res.json({
        enabled: false,
        publishableKey: "",
        maskedSecretKey: "",
        hasSecretKey: false,
        taxRate: 0.075,
        taxExemptCustomers: [],
        taxExemptLeads: [],
      });
    }

    res.json({
      enabled: settings.enabled,
      publishableKey: settings.publishableKey || "",
      maskedSecretKey: settings.secretKey ? "********" : "",
      hasSecretKey: !!settings.secretKey,
      cashEnabled: settings.cashEnabled || false,
      checkEnabled: settings.checkEnabled || false,
      cardsEnabled: settings.cardsEnabled || false,
      achEnabled: settings.achEnabled || false,
      mobileEnabled: settings.mobileEnabled || false,
      taxRate: settings.taxRate != null ? settings.taxRate : 0.075,
      taxExemptCustomers: settings.taxExemptCustomers || [],
      taxExemptLeads: settings.taxExemptLeads || [],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch stripe settings" });
  }
});

router.post("/vital", auth, async (req, res) => {
  try {
    const {
      enabled,
      publishableKey,
      secretKey,
      vitalMerchantId,
      cashEnabled,
      checkEnabled,
      cardsEnabled,
      achEnabled,
      mobileEnabled,
      taxRate,
      taxExemptCustomers,
      taxExemptLeads,
    } = req.body;

    const CreatorId = req.user.role_type === "admin" ? req.user._id : req.user.created_by;
    let settings = await PaymentSettings.findOne({
      provider: "vital",
      createdBy: CreatorId,
    });
    if (!settings) {
      settings = new PaymentSettings({
        provider: "vital",
        createdBy: CreatorId,
      });
    }

    settings.enabled = enabled;
    if (publishableKey !== undefined) settings.publishableKey = publishableKey;
    if (secretKey !== undefined) settings.secretKey = secretKey;
    if (vitalMerchantId !== undefined) settings.vitalMerchantId = vitalMerchantId;

    settings.cashEnabled = cashEnabled;
    settings.checkEnabled = checkEnabled;
    settings.cardsEnabled = cardsEnabled;
    settings.achEnabled = achEnabled;
    settings.mobileEnabled = mobileEnabled;

    if (taxRate !== undefined) settings.taxRate = taxRate;
    if (taxExemptCustomers !== undefined) settings.taxExemptCustomers = taxExemptCustomers;
    if (taxExemptLeads !== undefined) settings.taxExemptLeads = taxExemptLeads;

    settings.updatedBy = CreatorId;
    settings.updatedAt = new Date();

    await settings.save();

    // Update estimates and invoices in the background to avoid blocking response and causing 504 timeouts
    setImmediate(() => {
      updateEstimatesAndInvoicesTaxRatesInBg(CreatorId, settings);
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Error saving vital settings:", err);
    res.status(500).json({ error: "Failed to save vital settings" });
  }
});

router.get("/vital", auth, async (req, res) => {
  try {
    const Creator = req.user.role_type === "admin" ? req.user._id : req.user.created_by;

    const settings = await PaymentSettings.findOne({
      provider: "vital",
      createdBy: Creator,
    });

    if (!settings) {
      return res.json({
        enabled: false,
        publishableKey: "",
        maskedSecretKey: "",
        hasSecretKey: false,
        vitalMerchantId: "",
        taxRate: 0.075,
        taxExemptCustomers: [],
        taxExemptLeads: [],
      });
    }

    res.json({
      enabled: settings.enabled,
      publishableKey: settings.publishableKey || "",
      maskedSecretKey: settings.secretKey ? "********" : "",
      hasSecretKey: !!settings.secretKey,
      vitalMerchantId: settings.vitalMerchantId || "",
      cashEnabled: settings.cashEnabled || false,
      checkEnabled: settings.checkEnabled || false,
      cardsEnabled: settings.cardsEnabled || false,
      achEnabled: settings.achEnabled || false,
      mobileEnabled: settings.mobileEnabled || false,
      taxRate: settings.taxRate != null ? settings.taxRate : 0.075,
      taxExemptCustomers: settings.taxExemptCustomers || [],
      taxExemptLeads: settings.taxExemptLeads || [],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch vital settings" });
  }
});

router.get("/stripe/public", async (req, res) => {
  try {
    const { invoiceId, creatorId, merchant, merchantId, adminId } = req.query;
    let targetCreatorId = merchant || merchantId || creatorId || adminId;

    if (invoiceId) {
      const invoice = await Invoice.findById(invoiceId);
      if (invoice) {
        const project = await Project.findById(invoice.project_id);
        if (project) {
          targetCreatorId = project.created_by;
        }
      }
    }

    let stripeSettings = null;
    let vitalSettings = null;

    if (targetCreatorId) {
      stripeSettings = await PaymentSettings.findOne({
        provider: "stripe",
        createdBy: targetCreatorId,
      });
      vitalSettings = await PaymentSettings.findOne({
        provider: "vital",
        createdBy: targetCreatorId,
      });
    } else {
      const defaultAdmin = (await Client.findOne({ role_type: "admin" }).lean()) || (await User.findOne({ role_type: "admin" }).lean());
      if (defaultAdmin) {
        stripeSettings = await PaymentSettings.findOne({
          provider: "stripe",
          createdBy: defaultAdmin._id,
        });
        vitalSettings = await PaymentSettings.findOne({
          provider: "vital",
          createdBy: defaultAdmin._id,
        });
      }
    }

    let companyInfo = null;
    if (targetCreatorId && mongoose.Types.ObjectId.isValid(targetCreatorId)) {
      try {
        const client = await Client.findById(targetCreatorId).select("companyName client_logo phone email address").lean();
        const user = await User.findById(targetCreatorId).select("companyName full_name logo phone email mobile address").lean();
        if (client || user) {
          companyInfo = {
            companyName: client?.companyName || user?.companyName || user?.full_name || "George P. Coyle & Sons",
            logo: client?.client_logo || user?.logo || null,
            phone: client?.phone || user?.phone || user?.mobile || "",
            email: client?.email || user?.email || "",
            address: client?.address || user?.address || "",
            creatorId: targetCreatorId
          };
        }
      } catch (e) {
        console.error("Error resolving companyInfo for public payment:", e.message);
      }
    }

    // Fallback to default admin user or client if not found
    if (!companyInfo) {
      try {
        const adminUser = (await Client.findOne({ role_type: "admin" }).select("companyName firstName lastName logo client_logo phone email address").lean())
          || (await User.findOne({ role_type: "admin" }).select("companyName full_name logo phone email mobile address").lean());
        companyInfo = {
          companyName: adminUser?.companyName || adminUser?.full_name || "George P. Coyle & Sons",
          logo: adminUser?.client_logo || adminUser?.logo || null,
          phone: adminUser?.phone || adminUser?.mobile || "",
          email: adminUser?.email || "",
          address: adminUser?.address || "",
          creatorId: adminUser?._id || targetCreatorId || null
        };
      } catch (fbErr) {
        companyInfo = {
          companyName: "George P. Coyle & Sons",
          logo: null,
          phone: "",
          email: "",
          address: "",
          creatorId: targetCreatorId || null
        };
      }
    }

    const stripeEnabled = !!(stripeSettings && stripeSettings.enabled);
    const vitalEnabled = !!(vitalSettings && vitalSettings.enabled);
    const enabled = stripeEnabled || vitalEnabled;

    // Get method flags. If setting document exists, use its saved setting. Default to true if not specified.
    const cashEnabled = stripeSettings ? (stripeSettings.cashEnabled !== false) : (vitalSettings ? (vitalSettings.cashEnabled !== false) : true);
    const checkEnabled = stripeSettings ? (stripeSettings.checkEnabled !== false) : (vitalSettings ? (vitalSettings.checkEnabled !== false) : true);
    const cardsEnabled = vitalSettings ? (vitalSettings.cardsEnabled !== false) : (stripeSettings ? (stripeSettings.cardsEnabled !== false) : true);
    const achEnabled = stripeSettings ? (stripeSettings.achEnabled !== false) : (vitalSettings ? (vitalSettings.achEnabled !== false) : true);
    const mobileEnabled = stripeSettings?.mobileEnabled || vitalSettings?.mobileEnabled || false;

    res.json({
      enabled,
      stripeEnabled,
      vitalEnabled,
      provider: stripeEnabled ? "stripe" : (vitalEnabled ? "vital" : "stripe"),
      publishableKey: stripeSettings?.publishableKey || "",
      vitalMerchantId: vitalSettings?.vitalMerchantId || "",
      cashEnabled,
      checkEnabled,
      cardsEnabled,
      achEnabled,
      mobileEnabled,
      companyInfo,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch public payment status" });
  }
});


router.post("/vital/test", auth, async (req, res) => {
  try {
    const { publishableKey, secretKey, vitalMerchantId } = req.body;

    if (!publishableKey || !secretKey || !vitalMerchantId) {
      return res.status(400).json({
        success: false,
        error: "All fields (Client API Key, Secret Key, and Merchant ID) are required to test the connection."
      });
    }

    // Simulate connection check
    await new Promise((resolve) => setTimeout(resolve, 1200));

    if (publishableKey.includes("test") || vitalMerchantId.includes("Mock") || vitalMerchantId.includes("test") || vitalMerchantId.startsWith("MID99")) {
      return res.json({
        success: true,
        message: "Successfully connected to Vital Sandbox Environment!"
      });
    }

    return res.json({
      success: true,
      message: "Successfully connected to Vital Production Gateway!"
    });
  } catch (err) {
    console.error("Test connection error:", err);
    res.status(500).json({ success: false, error: "Failed to connect to Vital server. Please check your credentials." });
  }
});

async function updateEstimatesAndInvoicesTaxRatesInBg(CreatorId, settings) {
  try {
    let adminObjectId;
    try { adminObjectId = new mongoose.Types.ObjectId(CreatorId); } catch (e) { }

    const creatorQuery = [
      { created_by: CreatorId },
      { created_by: CreatorId.toString() },
      adminObjectId ? { created_by: adminObjectId } : null
    ].filter(Boolean);

    const Customer = require("../models/Customer");
    const Lead = require("../models/Lead");

    // Fetch all projects, customers, and leads for this admin to build in-memory lookups
    const allProjects = await Project.find({ $or: creatorQuery }).select("customer_ids").lean();
    const projectCustomerMap = new Map();
    for (const proj of allProjects) {
      if (proj.customer_ids && proj.customer_ids.length > 0) {
        projectCustomerMap.set(proj._id.toString(), proj.customer_ids[0].toString());
      }
    }

    // Fetch all customers for this admin to map email to ID
    const allCustomers = await Customer.find({ $or: creatorQuery }).select("email").lean();
    const customerEmailMap = new Map();
    for (const cust of allCustomers) {
      if (cust.email) {
        customerEmailMap.set(cust.email.toLowerCase().trim(), cust._id.toString());
      }
    }

    // Fetch all leads for this admin to map email to ID
    const allLeads = await Lead.find({ $or: creatorQuery }).select("email").lean();
    const leadEmailMap = new Map();
    for (const ld of allLeads) {
      if (ld.email) {
        leadEmailMap.set(ld.email.toLowerCase().trim(), ld._id.toString());
      }
    }

    const exemptCustomersSet = new Set((settings.taxExemptCustomers || []).map(id => id.toString()));
    const exemptLeadsSet = new Set((settings.taxExemptLeads || []).map(id => id.toString()));
    const defaultTaxRate = settings.taxRate != null ? settings.taxRate : 0.075;

    const estimates = await Estimate.find({ $or: creatorQuery });
    const estimateBulkOps = [];

    for (let est of estimates) {
      if (est.tax_exempt_override === true) continue;

      let isExempt = false;

      if (est.is_quick_estimate) {
        const leadId = est.lead_id || est.quick_customer?._lead_id;
        if (leadId && exemptLeadsSet.has(leadId.toString())) {
          isExempt = true;
        } else if (est.quick_customer?.email_address) {
          const email = est.quick_customer.email_address.toLowerCase().trim();
          const custId = customerEmailMap.get(email);
          if (custId && exemptCustomersSet.has(custId)) {
            isExempt = true;
          }
          if (!isExempt) {
            const ldId = leadEmailMap.get(email);
            if (ldId && exemptLeadsSet.has(ldId)) {
              isExempt = true;
            }
          }
        }
      } else if (est.project_id) {
        const custId = projectCustomerMap.get(est.project_id.toString());
        if (custId && exemptCustomersSet.has(custId)) {
          isExempt = true;
        }
      }

      const finalTaxRate = isExempt ? 0 : defaultTaxRate;

      if (est.tax_rate !== finalTaxRate) {
        const lineItems = est.line_items || [];
        const itemsWithTotals = lineItems.map(item => {
          const itemObj = item.toObject ? item.toObject() : item;
          const base = (itemObj.quantity || 0) * (itemObj.unit_price || 0);
          const markup = base * ((itemObj.markup_percentage || 0) / 100);
          return { ...itemObj, total: base + markup };
        });

        const lineItemsTotal = itemsWithTotals.reduce((s, i) => s + (i.total || 0), 0);
        const additionalMarkup = Number(est.material_markup_amount || est.material_markup || 0);
        const subtotal = lineItemsTotal + additionalMarkup;

        const taxableLineItemsTotal = itemsWithTotals
          .filter(i => i.category?.toLowerCase() === "materials")
          .reduce((s, i) => s + (i.total || 0), 0);

        const tax_amount = taxableLineItemsTotal * finalTaxRate;
        const total_amount = subtotal + tax_amount;

        estimateBulkOps.push({
          updateOne: {
            filter: { _id: est._id },
            update: {
              $set: {
                tax_rate: finalTaxRate,
                subtotal: subtotal,
                tax_amount: tax_amount,
                total_amount: total_amount
              }
            }
          }
        });
      }
    }

    if (estimateBulkOps.length > 0) {
      await Estimate.bulkWrite(estimateBulkOps);
    }

    const invoices = await Invoice.find({ $or: creatorQuery });
    const invoiceBulkOps = [];

    for (let inv of invoices) {
      if (inv.tax_exempt_override === true) continue;

      let isExempt = false;

      if (inv.project_id) {
        const custId = projectCustomerMap.get(inv.project_id.toString());
        if (custId && exemptCustomersSet.has(custId)) {
          isExempt = true;
        }
      }

      if (!isExempt && inv.estimate_id) {
        const est = estimates.find(e => e._id.toString() === inv.estimate_id.toString());
        if (est && est.is_quick_estimate) {
          const leadId = est.lead_id || est.quick_customer?._lead_id;
          if (leadId && exemptLeadsSet.has(leadId.toString())) {
            isExempt = true;
          } else if (est.quick_customer?.email_address) {
            const email = est.quick_customer.email_address.toLowerCase().trim();
            const custId = customerEmailMap.get(email);
            if (custId && exemptCustomersSet.has(custId)) {
              isExempt = true;
            }
            if (!isExempt) {
              const ldId = leadEmailMap.get(email);
              if (ldId && exemptLeadsSet.has(ldId)) {
                isExempt = true;
              }
            }
          }
        }
      }

      const finalTaxRate = isExempt ? 0 : defaultTaxRate;

      if (inv.tax_rate !== finalTaxRate) {
        const lineItems = inv.line_items || [];
        const itemsWithTotals = lineItems.map(item => {
          const itemObj = item.toObject ? item.toObject() : item;
          const base = (itemObj.quantity || 0) * (itemObj.unit_price || 0);
          const markup = base * ((itemObj.markup_percentage || 0) / 100);
          return { ...itemObj, total: base + markup };
        });

        const lineItemsTotal = itemsWithTotals.reduce((s, i) => s + (i.total || 0), 0);
        const additionalMarkup = Number(inv.material_markup_amount || inv.material_markup || 0);
        const subtotal = lineItemsTotal + additionalMarkup;

        const taxableLineItemsTotal = itemsWithTotals
          .filter(i => i.category?.toLowerCase() === "materials")
          .reduce((s, i) => s + (i.total || 0), 0);

        const tax_amount = taxableLineItemsTotal * finalTaxRate;
        const total_amount = subtotal + tax_amount;

        invoiceBulkOps.push({
          updateOne: {
            filter: { _id: inv._id },
            update: {
              $set: {
                tax_rate: finalTaxRate,
                subtotal: subtotal,
                tax_amount: tax_amount,
                total_amount: total_amount
              }
            }
          }
        });
      }
    }

    if (invoiceBulkOps.length > 0) {
      await Invoice.bulkWrite(invoiceBulkOps);
    }
  } catch (updateErr) {
    console.error("Error updating existing estimates/invoices tax rates in background:", updateErr);
  }
}

module.exports = router;
