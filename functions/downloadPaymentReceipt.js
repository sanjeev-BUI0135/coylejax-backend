const puppeteer = require("puppeteer");
const Payment = require("../models/Payment");
const Customer = require("../models/Customer");
const InvoiceModel = require("../models/Invoice");
const ProjectModel = require("../models/Project");
const os = require("os");
const path = require("path");
const Client = require('../models/Client');
const User = require('../models/User');
const mongoose = require('mongoose');
const fs = require('fs');

async function generatePaymentReceiptPdf(paymentId, req) {
  try {
    const payment = await Payment.findById(paymentId)
      .populate('customer_id')
      .populate('invoice_id')
      .lean();

    if (!payment) {
      throw new Error("Payment not found");
    }

    let customer = null;

    // 1. If payment is linked to an invoice, get the authoritative customer from Invoice -> Project
    if (payment.invoice_id) {
      try {
        const invObj = typeof payment.invoice_id === "object" ? payment.invoice_id : await InvoiceModel.findById(payment.invoice_id).lean();
        if (invObj && invObj.project_id) {
          const projObj = await ProjectModel.findById(invObj.project_id).lean();
          if (projObj?.customer_ids?.length > 0) {
            const foundCust = await Customer.findById(projObj.customer_ids[0]).lean();
            if (foundCust) customer = foundCust;
          }
        }
      } catch (err) {
        console.error("Error resolving customer for payment receipt PDF:", err);
      }
    }

    // 2. Fallback to payment.customer_id if no invoice customer was found
    if (!customer || (!customer.contact_name && !customer.company_name && !customer.email)) {
      customer = payment.customer_id || {};
    }
    
    // Fetch Client or User to match the invoice
    let client = null;
    
    // Attempt to get client from invoice's creator, or payment's creator
    if (payment.invoice_id && payment.invoice_id.created_by && mongoose.Types.ObjectId.isValid(payment.invoice_id.created_by)) {
      client = await Client.findById(payment.invoice_id.created_by).lean();
      if (!client) client = await User.findById(payment.invoice_id.created_by).lean();
    } else if (payment.created_by && mongoose.Types.ObjectId.isValid(payment.created_by)) {
      client = await Client.findById(payment.created_by).lean();
      if (!client) client = await User.findById(payment.created_by).lean();
    } else {
      // Find the first client if we can't tie it to one
      client = await Client.findOne().lean();
      if (!client) client = await User.findOne({ role_type: 'admin' }).lean();
    }

    const logoPath = client?.logo || '/coyle.png';
    const cleanLogoPath = logoPath.startsWith('/') ? logoPath : `/${logoPath}`;
    
    const logoUrl = req 
      ? `${req.protocol}://${req.get("host")}${cleanLogoPath}`
      : (process.env.APP_URL ? `${process.env.APP_URL}${cleanLogoPath}` : `https://coylejax.com${cleanLogoPath}`);

    const templatePath = path.join(__dirname, "../pdf/paymentReceiptPdfTemplate.html");
    let html = fs.readFileSync(templatePath, "utf8");

    const receiptNo = `RCPT-${payment._id.toString().substring(18, 24).toUpperCase()}`;
    const dateStr = new Date(payment.payment_date || payment.createdAt).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
    const amountStr = `$${Number(payment.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    
    const invoiceNumber = payment.invoice_id?.invoice_number || payment.invoice_number || '';
    const invoiceRow = invoiceNumber ? `<p class="info">Invoice No: <b>${invoiceNumber}</b></p>` : '';
    const customerName = customer.contact_name || payment.customer_name || customer.company_name || payment.company_name || 'Valued Customer';
    const companyName = customer.company_name || payment.company_name || (customer.contact_name && customer.contact_name !== customerName ? customer.contact_name : '') || 'N/A';
    const customerEmail = customer.email || payment.customer_email || 'N/A';
    const notesStr = payment.notes ? ` - ${payment.notes.replace(/\bCustomer\b/g, customerName)}` : '';

    const methodDisplay = (payment.payment_method?.toLowerCase().includes('ach') || payment.payment_method?.toLowerCase().includes('us_bank')) ? 'ACH Bank Transfer' : (payment.payment_method || 'Card');

    html = html
      .replace(/\{\{PAID_CLASS\}\}/g, "") // Show PAID watermark
      .replace(/\{\{LOGO\}\}/g, logoUrl)
      .replace(/\{\{COMPANY_NAME\}\}/g, client?.companyName || client?.full_name || 'Our Company')
      .replace(/\{\{COMPANY_ADDRESS\}\}/g, client?.address || '')
      .replace(/\{\{COMPANY_EMAIL\}\}/g, client?.email || '')
      .replace(/\{\{COMPANY_PHONE\}\}/g, client?.companyPhone || '')
      .replace(/\{\{NAME\}\}/g, customerName)
      .replace(/\{\{COMPANY\}\}/g, companyName)
      .replace(/\{\{EMAIL\}\}/g, customerEmail)
      .replace(/\{\{RECEIPT_NO\}\}/g, receiptNo)
      .replace(/\{\{DATE\}\}/g, dateStr)
      .replace(/\{\{METHOD\}\}/g, methodDisplay)
      .replace(/\{\{REFERENCE\}\}/g, payment.reference_number || payment.check_number || 'N/A')
      .replace(/\{\{INVOICE_ROW\}\}/g, invoiceRow)
      .replace(/\{\{NOTES\}\}/g, notesStr)
      .replace(/\{\{PAID_AMOUNT\}\}/g, amountStr);

    const userDataDir = path.join(os.tmpdir(), `puppeteer_data_${Date.now()}`);
    const browserArgs = [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ];

    const browser = await puppeteer.launch({
      executablePath: "/usr/bin/chromium-browser",
      headless: "new",
      args: browserArgs,
      userDataDir: userDataDir
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0px", right: "0px", bottom: "0px", left: "0px" },
    });

    await browser.close();
    
    return {
      pdfBuffer,
      payment
    };

  } catch (error) {
    console.error("Payment Receipt PDF generation error:", error);
    throw error;
  }
}

module.exports = { generatePaymentReceiptPdf };
