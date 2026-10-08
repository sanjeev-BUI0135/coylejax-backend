const express = require("express");
const crypto = require("crypto");
const Stripe = require("stripe");
const router = express.Router();
const mongoose = require("mongoose");
const auth = require("../middleware/auth");

// Models
const Invoice = require("../models/Invoice");
const Payment = require("../models/Payment");
const Project = require("../models/Project");
const Customer = require("../models/Customer");
const User = require("../models/User");
const Client = require("../models/Client");
const PaymentSettings = require("../models/PaymentSettings");
const StripeSession = require("../models/StripeSession");

// Helpers & Services
const { logActivity } = require("../utils/activityLogger");
const { processVitalCharge } = require("../services/vitalPaymentService");
const { findOrCreateCustomer, applyPaymentToInvoice } = require("../services/customerPaymentService");
const { sendPaymentReceiptEmails } = require("../services/receiptEmailService");

const getOwnerId = (req) =>
  req.user.role_type === "admin" ? req.user._id : req.user.created_by;

// Stripe Instance Helper
async function getStripeByCreator(creatorId, creatorModel) {
  let settings = null;
  if (creatorId) {
    settings = await PaymentSettings.findOne({
      provider: "stripe",
      enabled: true,
      createdBy: creatorId,
    });
  }

  if (!settings && creatorId && creatorModel) {
    const creator =
      creatorModel === "Client"
        ? await Client.findById(creatorId)
        : await User.findById(creatorId);

    const adminId =
      creator?.role_type === "admin" ? creator._id : creator?.created_by;

    if (adminId) {
      settings = await PaymentSettings.findOne({
        provider: "stripe",
        enabled: true,
        createdBy: adminId,
      });
    }
  }

  if (!settings && !creatorId) {
    settings = await PaymentSettings.findOne({
      provider: "stripe",
      enabled: true,
    });
  }

  if (!settings || !settings.enabled || !settings.secretKey) {
    return null;
  }

  return new Stripe(settings.secretKey);
}

/* ==========================================================================
   1. STRIPE CHECKOUT SESSION (FOR ACH BANK PAYMENTS)
   ========================================================================== */
router.post("/create-checkout-session", async (req, res) => {
  try {
    const {
      invoiceId,
      invoiceNumber,
      amount,
      enteredAmount,
      processingFee,
      returnUrl,
      paymentMethod = "ach",
      customerInfo = {},
      adminId,
      merchant,
    } = req.body;

    if (!amount) {
      return res.status(400).json({ error: "amount is required" });
    }

    let invoice = null;
    let project = null;
    let creatorId = merchant || adminId || null;
    let creatorModel = "User";

    if (invoiceId && mongoose.Types.ObjectId.isValid(invoiceId)) {
      invoice = await Invoice.findById(invoiceId).lean();
      if (invoice?.project_id) {
        project = await Project.findById(invoice.project_id).lean();
        creatorId = project?.created_by || creatorId;
      }
    }

    if (!creatorId) {
      const adminUser = await User.findOne({ role_type: "admin" }).lean();
      creatorId = adminUser?._id;
    }

    const creatorClient = await Client.findById(creatorId).lean();
    if (creatorClient) creatorModel = "Client";

    const stripe = await getStripeByCreator(creatorId, creatorModel);
    if (!stripe) {
      return res.status(400).json({ error: "Stripe payments are currently disabled for this merchant." });
    }

    let paymentMethodTypes = ["us_bank_account"];
    let paymentMethodOptions = {
      us_bank_account: {
        financial_connections: { permissions: ["payment_method", "balances"] },
      },
    };

    if (paymentMethod === "card") {
      paymentMethodTypes = ["card"];
      paymentMethodOptions = {};
    }

    const invDisplay = invoice ? invoice.invoice_number : (invoiceNumber || "General Payment");
    const numAmount = enteredAmount !== undefined ? enteredAmount : amount / 100;
    const numFee = processingFee !== undefined ? processingFee : 0;
    const baseReturnUrl = returnUrl || `${process.env.FRONTEND_URL || "http://localhost:5173"}/pay`;
    const separator = baseReturnUrl.includes("?") ? "&" : "?";

    const session = await stripe.checkout.sessions.create({
      payment_method_types: paymentMethodTypes,
      payment_method_options: paymentMethodOptions,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Payment - ${invDisplay}`,
              description: `Payment by ${customerInfo.companyName || customerInfo.contactName || "Customer"}`,
            },
            unit_amount: Math.round(amount),
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${baseReturnUrl}${separator}session_id={CHECKOUT_SESSION_ID}&status=success`,
      cancel_url: `${baseReturnUrl}${separator}status=cancel`,
      customer_email: customerInfo.email || undefined,
      metadata: {
        invoiceId: invoice?._id ? invoice._id.toString() : "",
        invoiceNumber: invDisplay,
        creatorId: creatorId ? creatorId.toString() : "",
        creatorModel,
        enteredAmount: String(numAmount),
        processingFee: String(numFee),
        paymentMethod,
        customerName: customerInfo.contactName || customerInfo.companyName || "",
        customerEmail: customerInfo.email || "",
      },
    });

    await StripeSession.create({
      session_id: session.id,
      invoiceId: invoice?._id || null,
      invoiceNumber: invDisplay,
      creatorId: creatorId || null,
      creatorModel,
      enteredAmount: numAmount,
      processingFee: numFee,
      customerInfo,
    });

    res.json({ checkout_url: session.url, session_id: session.id });
  } catch (err) {
    console.error("[create-checkout-session Error]:", err);
    res.status(500).json({ error: err.message || "Failed to create Stripe session" });
  }
});

/* ==========================================================================
   2. RETRIEVE STRIPE SESSION DETAILS
   ========================================================================== */
router.get("/session-details", async (req, res) => {
  try {
    const { session_id } = req.query;
    if (!session_id) {
      return res.status(400).json({ error: "session_id is required" });
    }

    const dbSession = await StripeSession.findOne({ session_id: session_id }).lean();
    const stripe = await getStripeByCreator(dbSession?.creatorId, dbSession?.creatorModel);
    const session = await stripe.checkout.sessions.retrieve(session_id);

    const enteredAmount = dbSession?.enteredAmount ?? (session.metadata?.enteredAmount ? Number(session.metadata.enteredAmount) : session.amount_total / 100);
    const processingFee = dbSession?.processingFee ?? (session.metadata?.processingFee ? Number(session.metadata.processingFee) : 0);

    res.json({
      id: session.id,
      payment_status: session.payment_status,
      amount_received: session.amount_total ? session.amount_total / 100 : 0,
      currency: session.currency,
      payment_intent: session.payment_intent,
      customer_details: session.customer_details,
      invoiceId: dbSession?.invoiceId || session.metadata?.invoiceId || null,
      invoiceNumber: dbSession?.invoiceNumber || session.metadata?.invoiceNumber || null,
      creatorId: dbSession?.creatorId || session.metadata?.creatorId || null,
      enteredAmount,
      processingFee,
      customerInfo: dbSession?.customerInfo || {
        contactName: session.customer_details?.name || session.metadata?.customerName || "",
        email: session.customer_details?.email || session.metadata?.customerEmail || "",
      },
    });
  } catch (err) {
    console.error("[session-details Error]:", err);
    res.status(500).json({ error: err.message || "Failed to retrieve session details" });
  }
});

/* ==========================================================================
   3. UPDATE PAYMENT (STRIPE ACH / CHECKOUT CALLBACK)
   ========================================================================== */
router.post("/update-payment", async (req, res) => {
  try {
    const {
      invoiceId,
      invoiceNumber,
      creatorId,
      transaction,
      enteredAmount,
      processingFee,
      customerInfo,
      notes,
    } = req.body;

    if (!transaction) {
      return res.status(400).json({ error: "transaction details are required" });
    }

    const amountToAdd = enteredAmount !== undefined ? Number(enteredAmount) : transaction.amount_received;
    const feeToAdd = processingFee !== undefined ? Number(processingFee) : 0;
    const effectiveMethod = transaction.payment_method || "ach";
    const methodLabel = effectiveMethod === "ach" ? "ACH Bank Transfer" : "Card";

    // 1. General Payment (No DB invoice)
    if (!invoiceId) {
      let targetCreatorId = creatorId;
      if (!targetCreatorId) {
        const fallbackAdmin = await User.findOne({ role_type: "admin" }).lean();
        targetCreatorId = fallbackAdmin?._id;
      }

      const customerDoc = await findOrCreateCustomer({ customerInfo, creatorId: targetCreatorId });
      const txId = transaction.payment_intent || transaction.id || "tx_" + Date.now();

      const paymentRecord = await Payment.create({
        customer_id: customerDoc?._id || null,
        invoice_number: invoiceNumber || null,
        amount: amountToAdd,
        processing_fee: feeToAdd,
        payment_method: effectiveMethod,
        payment_date: new Date(),
        reference_number: txId,
        status: "received",
        notes: notes || `Online ${methodLabel} payment from ${customerInfo?.companyName || customerInfo?.contactName || 'Customer'} ${invoiceNumber ? `for Inv #${invoiceNumber}` : ''}`,
        customer_name: customerInfo?.contactName || transaction.customer_details?.name || customerDoc?.contact_name || "",
        company_name: customerInfo?.companyName || customerDoc?.company_name || "",
        customer_email: customerInfo?.email || transaction.customer_details?.email || customerDoc?.email || "",
        customer_phone: customerInfo?.phone || transaction.customer_details?.phone || customerDoc?.phone || "",
        created_by: targetCreatorId,
      });

      // Send Branded Image 2 Receipt Email
      setImmediate(() => {
        sendPaymentReceiptEmails({
          creatorId: targetCreatorId,
          customerEmail: customerInfo?.email || transaction.customer_details?.email || customerDoc?.email,
          customerName: customerInfo?.contactName || customerInfo?.companyName || transaction.customer_details?.name || customerDoc?.contact_name,
          paymentRecord,
          methodLabel,
          transactionId: txId,
          amount: amountToAdd,
          isPublicPayment: true,
        });
      });

      return res.json({ success: true, payment: paymentRecord });
    }

    // 2. Invoice Payment
    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });

    let custEmail = customerInfo?.email || transaction.customer_details?.email || "";
    let custName = customerInfo?.contactName || transaction.customer_details?.name || "";
    let compName = customerInfo?.companyName || "";
    let custPhone = customerInfo?.phone || transaction.customer_details?.phone || "";
    let custId = null;

    if (invoice.project_id) {
      const proj = await Project.findById(invoice.project_id).lean();
      if (proj?.customer_ids?.length > 0) {
        const c = await Customer.findById(proj.customer_ids[0]).lean();
        if (c) {
          custId = c._id;
          custEmail = custEmail || c.email || "";
          custName = custName || c.contact_name || c.company_name || "";
          compName = compName || c.company_name || "";
          custPhone = custPhone || c.phone || "";
        }
      }
    }

    const invUpdate = await applyPaymentToInvoice({
      invoiceId: invoice._id,
      amount: amountToAdd,
      processingFee: feeToAdd,
      transactionId: transaction.payment_intent,
      paymentMethod: effectiveMethod,
      status: transaction.status || "succeeded",
    });

    const paymentRecord = await Payment.create({
      project_id: invoice.project_id || null,
      invoice_id: invoice._id,
      invoice_number: invoice.invoice_number || invoiceNumber || null,
      customer_id: custId,
      customer_name: custName,
      company_name: compName,
      customer_email: custEmail,
      customer_phone: custPhone,
      amount: amountToAdd,
      processing_fee: feeToAdd,
      payment_method: effectiveMethod,
      payment_date: new Date(),
      reference_number: transaction.payment_intent,
      status: "received",
      notes: notes || `Payment for Invoice ${invoice.invoice_number}`,
      created_by: invoice.created_by,
    });

    // Send Branded Image 2 Receipt Email
    setImmediate(async () => {
      sendPaymentReceiptEmails({
        creatorId: invoice.created_by,
        customerEmail: custEmail,
        customerName: custName || compName || "Valued Customer",
        paymentRecord,
        methodLabel,
        transactionId: transaction.payment_intent,
        amount: amountToAdd,
        isPublicPayment: true,
      });
    });

    res.json({
      message: "Invoice updated and payment recorded successfully",
      invoice: invUpdate?.invoice || invoice,
      payment: paymentRecord,
    });

    // Activity Log
    await logActivity(
      invoice.project_id || null,
      { full_name: transaction.customer_details?.name || "Customer (ACH)" },
      "Payment",
      "Create",
      `Online payment of $${amountToAdd} received for invoice "${invoice.invoice_number}".`,
      [
        { field: "Payment Received", old: "-", new: amountToAdd },
        { field: "Status", old: invoice.status || "unpaid", new: invUpdate?.newStatus || "paid" },
        { field: "Payment Method", old: "-", new: effectiveMethod },
      ],
      invoice._id,
      "Invoice"
    );
  } catch (err) {
    console.error("[update-payment Error]:", err);
    res.status(500).json({ error: "Failed to update invoice/payment" });
  }
});

/* ==========================================================================
   4. VOID INVOICE
   ========================================================================== */
router.post("/void-invoice", async (req, res) => {
  try {
    const { invoiceId } = req.body;
    if (!invoiceId) return res.status(400).json({ error: "invoiceId is required" });

    const existingInvoice = await Invoice.findById(invoiceId).lean();
    const updatedInvoice = await Invoice.findByIdAndUpdate(invoiceId, { status: "void" }, { new: true });

    if (!updatedInvoice) return res.status(404).json({ error: "Invoice not found" });

    res.json({ message: "Invoice voided successfully", invoice: updatedInvoice });

    await logActivity(
      updatedInvoice.project_id || null,
      req.user || { full_name: "System" },
      "Invoice",
      "Update",
      `Invoice "${updatedInvoice.invoice_number}" was voided.`,
      [{ field: "Status", old: existingInvoice?.status || "unpaid", new: "void" }],
      updatedInvoice._id,
      "Invoice"
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ==========================================================================
   5. CREATE PAYMENT INTENT (INVOICE-LINKED - STRIPE)
   ========================================================================== */
router.post("/create-payment-intent", auth, async (req, res) => {
  try {
    const { invoiceId, amount, paymentMethod } = req.body;

    if (!invoiceId || !amount) {
      return res.status(400).json({ error: "invoiceId and amount are required" });
    }

    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });

    let creatorId = invoice.created_by;
    if (!creatorId && invoice.project_id) {
      const project = await Project.findById(invoice.project_id).lean();
      creatorId = project?.created_by;
    }

    const creatorClient = await Client.findById(creatorId).lean();
    const creatorModel = creatorClient ? "Client" : "User";

    const stripe = await getStripeByCreator(creatorId, creatorModel);
    if (!stripe) {
      return res.status(400).json({ error: "Stripe payments are currently disabled for this merchant." });
    }

    const intentOptions = {
      amount: Math.round(amount),
      currency: "usd",
      metadata: {
        invoiceId: invoiceId.toString(),
        invoiceNumber: invoice.invoice_number,
      },
      payment_method_types: paymentMethod === "ach" ? ["us_bank_account"] : ["card"],
    };

    const paymentIntent = await stripe.paymentIntents.create(intentOptions);
    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error("[create-payment-intent Error]:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ==========================================================================
   6. CREATE GENERAL PAYMENT INTENT (NO INVOICE - STRIPE)
   ========================================================================== */

router.post("/create-general-payment-intent", auth, async (req, res) => {
  try {
    const { customerId, amount, paymentMethod } = req.body;
    if (!amount) return res.status(400).json({ error: "amount is required" });

    const creatorId = req.user.role_type === "admin" ? req.user._id : req.user.created_by;
    const creatorClient = await Client.findById(creatorId);
    const creatorModel = creatorClient ? "Client" : "User";

    const stripe = await getStripeByCreator(creatorId, creatorModel);
    if (!stripe) {
      return res.status(400).json({ error: "Stripe payments are currently disabled for this merchant." });
    }
    const intentOptions = {
      amount: Math.round(amount),
      currency: "usd",
      metadata: { customerId: customerId ? customerId.toString() : "", general: "true" },
      payment_method_types: paymentMethod === "ach" ? ["us_bank_account"] : ["card"],
    };

    const paymentIntent = await stripe.paymentIntents.create(intentOptions);
    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ==========================================================================
   6. UPDATE GENERAL PAYMENT (AUTH REQUIRED)
   ========================================================================== */
router.post("/update-general-payment", auth, async (req, res) => {
  try {
    const { customerId, transaction, enteredAmount, processingFee, notes } = req.body;
    if (!transaction) return res.status(400).json({ error: "transaction is required" });

    const amountToAdd = enteredAmount !== undefined ? Number(enteredAmount) : transaction.amount_received;
    const feeToAdd = processingFee !== undefined ? Number(processingFee) : 0;
    const ownerId = getOwnerId(req);

    const paymentRecord = await Payment.create({
      customer_id: customerId,
      amount: amountToAdd,
      processing_fee: feeToAdd,
      payment_method: transaction.payment_method,
      payment_date: new Date(),
      reference_number: transaction.payment_intent,
      status: "received",
      notes: notes || "General Payment (No Invoice)",
      created_by: ownerId,
    });

    res.json({ message: "General payment recorded successfully", payment: paymentRecord });

    await logActivity(
      null,
      req.user,
      "Payment",
      "Create",
      `General payment of $${amountToAdd} received.`,
      [
        { field: "Payment Received", old: "-", new: amountToAdd },
        { field: "Payment Method", old: "-", new: transaction.payment_method },
      ],
      paymentRecord._id,
      "Payment"
    );

    // Send Branded Image 2 Receipt Email
    setImmediate(async () => {
      try {
        const customer = await Customer.findById(customerId).lean();
        sendPaymentReceiptEmails({
          creatorId: ownerId,
          customerEmail: customer?.email,
          customerName: customer?.contact_name || customer?.company_name || "Valued Customer",
          paymentRecord,
          methodLabel: transaction.payment_method,
          transactionId: transaction.payment_intent,
          amount: amountToAdd,
        });
      } catch (e) {
        console.error("Error sending receipt in update-general-payment:", e);
      }
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to update general payment" });
  }
});

/* ==========================================================================
   7. CHARGE VITAL MERCHANT (AUTHENTICATED GATEWAY)
   ========================================================================== */
router.post("/charge-vital", async (req, res) => {
  try {
    const {
      invoiceId,
      customerId,
      amount,
      cardDetails,
      bankDetails,
      paymentMethod = "card",
      processingFee,
      notes,
    } = req.body;

    const parsedAmount = Number(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      return res.status(400).json({ error: "Invalid payment amount" });
    }

    let invoice = null;
    let creatorId = null;

    if (invoiceId) {
      invoice = await Invoice.findById(invoiceId);
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });
      creatorId = invoice.created_by;
    } else if (customerId) {
      if (req.user) {
        creatorId = req.user.role_type === "admin" ? req.user._id : req.user.created_by;
      } else {
        const c = await Customer.findById(customerId).lean();
        creatorId = c?.created_by;
      }
    }

    // Payment settings
    let vitalSettings = null;
    if (creatorId) {
      vitalSettings = await PaymentSettings.findOne({ provider: "vital", enabled: true, createdBy: creatorId });
    }
    if (!vitalSettings || !vitalSettings.enabled) {
      return res.status(400).json({ error: "Vital Merchant payments are currently disabled for this merchant." });
    }

    const fee = processingFee !== undefined ? Number(processingFee) : 0;
    const totalAmount = Number((parsedAmount + fee).toFixed(2));

    let customerDoc = customerId ? await Customer.findById(customerId).lean() : null;

    // Process via vitalPaymentService
    const chargeResult = await processVitalCharge({
      vitalSettings,
      cardDetails,
      customerInfo: customerDoc || {},
      totalAmount,
      orderId: invoice ? invoice._id.toString() : "PAY_" + Date.now(),
    });

    if (!chargeResult.success) {
      return res.status(400).json({ error: chargeResult.error });
    }

    const transactionId = chargeResult.transactionId;
    const status = chargeResult.status || "succeeded";

    if (invoice) {
      let custName = customerDoc?.contact_name || customerDoc?.company_name || "";
      let compName = customerDoc?.company_name || "";
      let custEmail = customerDoc?.email || "";
      let custPhone = customerDoc?.phone || "";
      let custId = customerId || customerDoc?._id || null;

      if (!custName && invoice.project_id) {
        const proj = await Project.findById(invoice.project_id).lean();
        if (proj?.customer_ids?.length > 0) {
          const c = await Customer.findById(proj.customer_ids[0]).lean();
          if (c) {
            custId = custId || c._id;
            custName = c.contact_name || c.company_name || "";
            compName = compName || c.company_name || "";
            custEmail = custEmail || c.email || "";
            custPhone = custPhone || c.phone || "";
          }
        }
      }

      const invUpdate = await applyPaymentToInvoice({
        invoiceId: invoice._id,
        amount: parsedAmount,
        processingFee: fee,
        transactionId,
        paymentMethod,
        status,
      });

      const paymentRecord = await Payment.create({
        project_id: invoice.project_id || null,
        invoice_id: invoice._id,
        invoice_number: invoice.invoice_number || null,
        customer_id: custId,
        customer_name: custName,
        company_name: compName,
        customer_email: custEmail,
        customer_phone: custPhone,
        amount: parsedAmount,
        processing_fee: fee,
        payment_method: paymentMethod,
        payment_date: new Date(),
        reference_number: transactionId,
        status: "received",
        notes: notes || `Payment via Vital for Invoice ${invoice.invoice_number}`,
        created_by: invoice.created_by,
      });

      // Send Branded Image 2 Receipt Email
      setImmediate(() => {
        sendPaymentReceiptEmails({
          creatorId: invoice.created_by,
          customerEmail: customerDoc?.email,
          customerName: customerDoc?.contact_name || customerDoc?.company_name,
          paymentRecord,
          methodLabel: paymentMethod,
          transactionId,
          amount: parsedAmount,
        });
      });

      return res.json({
        success: true,
        message: "Invoice payment processed successfully",
        invoice: invUpdate?.invoice || invoice,
        payment: paymentRecord,
      });
    }

    // General Payment
    const paymentRecord = await Payment.create({
      customer_id: customerId,
      amount: parsedAmount,
      processing_fee: fee,
      payment_method: paymentMethod,
      payment_date: new Date(),
      reference_number: transactionId,
      status: "received",
      notes: notes || "General Payment via Vital",
      created_by: creatorId,
    });

    // Send Branded Image 2 Receipt Email
    setImmediate(() => {
      sendPaymentReceiptEmails({
        creatorId,
        customerEmail: customerDoc?.email,
        customerName: customerDoc?.contact_name || customerDoc?.company_name,
        paymentRecord,
        methodLabel: paymentMethod,
        transactionId,
        amount: parsedAmount,
      });
    });

    return res.json({
      success: true,
      message: "General payment processed successfully",
      payment: paymentRecord,
    });
  } catch (err) {
    console.error("[charge-vital Error]:", err);
    res.status(500).json({ error: err.message || "Failed to process Vital payment" });
  }
});

/* ==========================================================================
   8. PUBLIC INVOICE LOOKUP
   ========================================================================== */
router.get("/public-invoice-lookup", async (req, res) => {
  try {
    const { invoiceNumber, adminId, merchant, merchantId, creatorId } = req.query;
    const targetAdminId = merchant || merchantId || adminId || creatorId;
    if (!invoiceNumber || !invoiceNumber.trim()) {
      return res.status(400).json({ error: "invoiceNumber is required" });
    }

    const trimmed = invoiceNumber.trim();
    const cleanNum = trimmed.replace(/^INV-?/i, "");
    const regexPattern = new RegExp(`^(INV-?)?${cleanNum}$`, "i");

    const query = { invoice_number: { $regex: regexPattern } };
    if (targetAdminId && mongoose.Types.ObjectId.isValid(targetAdminId)) {
      query.created_by = targetAdminId;
    }

    const invoice = await Invoice.findOne(query).lean();
    if (!invoice) {
      return res.json({ found: false, message: "Invoice not found" });
    }

    const balanceDue = Number(Math.max(0, (invoice.total_amount || 0) - (invoice.amount_paid || 0)).toFixed(2));
    let customerData = null;
    let creatorData = null;

    if (invoice.project_id) {
      const project = await Project.findById(invoice.project_id).lean();
      if (project) {
        if (project.customer_ids && project.customer_ids.length > 0) {
          const cust = await Customer.findById(project.customer_ids[0]).lean();
          if (cust) {
            customerData = {
              company_name: cust.company_name || "",
              contact_name: cust.contact_name || "",
              phone: cust.phone || cust.mobile || "",
              address: cust.billing_address?.street || cust.address || "",
              email: cust.email || "",
            };
          }
        }
        if (project.created_by) {
          const client = await Client.findById(project.created_by).lean();
          const user = await User.findById(project.created_by).lean();
          creatorData = {
            id: project.created_by,
            companyName: client?.companyName || user?.companyName || user?.full_name || "CoyleJax",
            logo: client?.client_logo || user?.logo || null,
            phone: client?.phone || user?.companyPhone || user?.phone || "",
            email: client?.email || user?.email || "",
          };
        }
      }
    }

    if (!customerData && invoice.quick_customer) {
      customerData = {
        company_name: invoice.quick_customer.company_name || "",
        contact_name: invoice.quick_customer.contact_name || "",
        phone: invoice.quick_customer.phone || "",
        address: invoice.quick_customer.address || "",
        email: invoice.quick_customer.email_address || "",
      };
    }

    res.json({
      found: true,
      invoice: {
        _id: invoice._id,
        invoice_number: invoice.invoice_number,
        total_amount: invoice.total_amount || 0,
        amount_paid: invoice.amount_paid || 0,
        balance_due: balanceDue,
        status: invoice.status,
        issue_date: invoice.issue_date,
        due_date: invoice.due_date,
      },
      customer: customerData,
      creator: creatorData,
    });
  } catch (err) {
    console.error("[public-invoice-lookup Error]:", err);
    res.status(500).json({ error: "Failed to look up invoice" });
  }
});

/* ==========================================================================
   9. PUBLIC PAYMENT HANDLER (CREDIT CARD & DIRECT PAYMENT)
   ========================================================================== */
const publicPaymentHandler = async (req, res) => {
  try {
    const {
      invoiceId,
      invoiceNumber,
      amount,
      cardDetails,
      bankDetails,
      paymentMethod = "card",
      processingFee,
      customerInfo = {},
      notes,
      merchant,
      adminId,
    } = req.body;

    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      return res.status(400).json({ error: "Invalid payment amount. Please enter an amount greater than $0." });
    }

    let invoice = null;
    let creatorId = merchant || adminId || null;

    // Resolve Invoice if provided
    if (invoiceId && mongoose.Types.ObjectId.isValid(invoiceId)) {
      invoice = await Invoice.findById(invoiceId);
    } else if (invoiceNumber && invoiceNumber.trim()) {
      const cleanNum = invoiceNumber.trim().replace(/^INV-?/i, "");
      const regexPattern = new RegExp(`^(INV-?)?${cleanNum}$`, "i");
      const invQuery = { invoice_number: { $regex: regexPattern } };
      if (creatorId && mongoose.Types.ObjectId.isValid(creatorId)) {
        invQuery.created_by = creatorId;
      }
      invoice = await Invoice.findOne(invQuery);
    }

    if (invoice && !creatorId) {
      creatorId = invoice.created_by;
      if (!creatorId && invoice.project_id) {
        const proj = await Project.findById(invoice.project_id).lean();
        creatorId = proj?.created_by;
      }
    }

    if (!creatorId) {
      const fallbackUser = await User.findOne({ role_type: "admin" }).lean() || await Client.findOne().lean();
      creatorId = fallbackUser?._id;
    }

    // Payment settings lookup
    let vitalSettings = null;
    let stripeSettings = null;
    if (creatorId) {
      vitalSettings = await PaymentSettings.findOne({ provider: "vital", enabled: true, createdBy: creatorId });
      stripeSettings = await PaymentSettings.findOne({ provider: "stripe", enabled: true, createdBy: creatorId });
    }

    const isAch = paymentMethod === "ach";
    if (isAch && (!stripeSettings || !stripeSettings.enabled)) {
      return res.status(400).json({ error: "Stripe ACH payments are currently disabled for this merchant." });
    }
    if (!isAch && (!vitalSettings || !vitalSettings.enabled)) {
      return res.status(400).json({ error: "Vital Merchant payments are currently disabled for this merchant." });
    }

    // Fee calculations (Card: 3.5%, ACH: 0%)
    const calculatedFee = processingFee !== undefined
      ? parseFloat(processingFee)
      : (isAch ? 0 : parseFloat((parsedAmount * 0.035).toFixed(2)));
    const totalCharged = parseFloat((parsedAmount + calculatedFee).toFixed(2));

    let transactionId = "";
    let status = "succeeded";

    if (isAch) {
      transactionId = "ch_stripe_ach_sim_" + crypto.randomBytes(8).toString("hex");
    } else {
      if (!cardDetails || !cardDetails.cardNumber) {
        return res.status(400).json({ error: "Credit card details are required." });
      }

      const vitalResult = await processVitalCharge({
        vitalSettings,
        cardDetails,
        customerInfo,
        totalAmount: totalCharged,
        orderId: invoice ? invoice._id.toString() : "PAY_" + Date.now(),
      });

      if (!vitalResult.success) {
        return res.status(400).json({ error: vitalResult.error || "Payment declined by gateway." });
      }

      transactionId = vitalResult.transactionId;
      status = vitalResult.status || "succeeded";
    }

    // Customer record resolution
    const customerDoc = await findOrCreateCustomer({ customerInfo, creatorId });
    const methodLabel = isAch ? "ACH Bank Transfer" : "Card";
    let paymentRecord = null;

    if (invoice) {
      let invCust = null;
      if (invoice.project_id) {
        const proj = await Project.findById(invoice.project_id).lean();
        if (proj?.customer_ids?.length > 0) {
          invCust = await Customer.findById(proj.customer_ids[0]).lean();
        }
      }
      const targetCust = invCust || customerDoc;

      const invUpdate = await applyPaymentToInvoice({
        invoiceId: invoice._id,
        amount: parsedAmount,
        processingFee: calculatedFee,
        transactionId,
        paymentMethod,
        status,
      });

      paymentRecord = await Payment.create({
        project_id: invoice.project_id || null,
        invoice_id: invoice._id,
        invoice_number: invoice.invoice_number,
        customer_id: targetCust?._id || null,
        customer_name: customerInfo?.contactName || targetCust?.contact_name || "",
        company_name: customerInfo?.companyName || targetCust?.company_name || "",
        customer_email: customerInfo?.email || targetCust?.email || "",
        customer_phone: customerInfo?.phone || targetCust?.phone || "",
        amount: parsedAmount,
        processing_fee: calculatedFee,
        payment_method: paymentMethod,
        payment_date: new Date(),
        reference_number: transactionId,
        status: "received",
        notes: notes || `${methodLabel} payment for Invoice ${invoice.invoice_number} from ${customerInfo.companyName || customerInfo.contactName || 'Customer'}`,
        created_by: creatorId,
      });

      // Send Branded Image 2 Receipt Email
      setImmediate(() => {
        sendPaymentReceiptEmails({
          creatorId,
          customerEmail: customerInfo?.email || customerDoc?.email,
          customerName: customerInfo?.contactName || customerDoc?.contact_name || customerInfo?.companyName,
          paymentRecord,
          methodLabel,
          transactionId,
          amount: parsedAmount,
          isPublicPayment: true,
        });
      });

      // Activity Logging
      await logActivity(
        invoice.project_id || null,
        { full_name: customerInfo.contactName || customerInfo.companyName || `Public Customer (${methodLabel})` },
        "Payment",
        "Create",
        `Public ${isAch ? "ACH" : "card"} payment of $${parsedAmount} received for invoice "${invoice.invoice_number}".`,
        [
          { field: "Payment Received", old: "-", new: parsedAmount },
          { field: isAch ? "Processing Fee (0%)" : "Processing Fee (3.5%)", old: "-", new: calculatedFee },
          { field: "Status", old: invoice.status || "unpaid", new: invUpdate?.newStatus || "paid" },
        ],
        invoice._id,
        "Invoice"
      );
    } else {
      // General Payment (No DB Invoice)
      paymentRecord = await Payment.create({
        customer_id: customerDoc?._id || null,
        invoice_number: invoiceNumber ? invoiceNumber.trim() : null,
        customer_name: customerInfo?.contactName || customerDoc?.contact_name || "",
        company_name: customerInfo?.companyName || customerDoc?.company_name || "",
        customer_email: customerInfo?.email || customerDoc?.email || "",
        customer_phone: customerInfo?.phone || customerDoc?.phone || "",
        amount: parsedAmount,
        processing_fee: calculatedFee,
        payment_method: paymentMethod,
        payment_date: new Date(),
        reference_number: transactionId,
        status: "received",
        notes: notes || `General ${methodLabel} payment (${invoiceNumber ? 'Inv #' + invoiceNumber : 'No Invoice'}) from ${customerInfo.companyName || customerInfo.contactName || 'Customer'}`,
        created_by: creatorId,
      });

      // Send Branded Image 2 Receipt Email
      setImmediate(() => {
        sendPaymentReceiptEmails({
          creatorId,
          customerEmail: customerInfo?.email || customerDoc?.email,
          customerName: customerInfo?.contactName || customerDoc?.contact_name || customerInfo?.companyName,
          paymentRecord,
          methodLabel,
          transactionId,
          amount: parsedAmount,
          isPublicPayment: true,
        });
      });

      // Activity Logging
      await logActivity(
        null,
        { full_name: customerInfo.contactName || customerInfo.companyName || `Public Customer (${methodLabel})` },
        "Payment",
        "Create",
        `Public general ${isAch ? "ACH" : "card"} payment of $${parsedAmount} (Fee: $${calculatedFee}) received from ${customerInfo.companyName || customerInfo.contactName || 'Customer'}.`,
        [
          { field: "Payment Received", old: "-", new: parsedAmount },
          { field: isAch ? "Processing Fee (0%)" : "Processing Fee (3.5%)", old: "-", new: calculatedFee },
        ],
        paymentRecord._id,
        "Payment"
      );
    }

    res.json({
      success: true,
      message: "Payment processed successfully.",
      transactionId,
      amount: parsedAmount,
      processingFee: calculatedFee,
      totalCharged,
      paymentMethod,
      invoiceNumber: invoice?.invoice_number || invoiceNumber || "",
      paymentDate: new Date().toISOString(),
      payment: paymentRecord,
    });
  } catch (err) {
    console.error("[publicPaymentHandler Error]:", err);
    res.status(500).json({ error: err.message || "Failed to process payment." });
  }
};

router.post("/public-card-payment", publicPaymentHandler);
router.post("/public-payment", publicPaymentHandler);

module.exports = router;
