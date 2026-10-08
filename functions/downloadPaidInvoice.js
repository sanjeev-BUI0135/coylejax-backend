
const puppeteer = require("puppeteer");
const path = require("path");
const os = require("os");
const fs = require("fs");
const mongoose = require("mongoose");

const Invoice = require("../models/Invoice");
const Project = require("../models/Project");
const Customer = require("../models/Customer");
const Payment = require("../models/Payment");
const MasterData = require("../models/MasterData");
const Client = require("../models/Client");
const User = require("../models/User");

function formatCurrency(value) {
  return `$${Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
function capitalizeFirst(text) {
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}
function preserveLineBreaks(text) {
  if (!text) return "";
  return text.replace(/\n/g, "<br/>");
}
function stripHtml(html) {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, "");
}

function getPublicLogoUrl(clientLogo, req) {
  if (!clientLogo) return "";
  return `${req.protocol}://${req.get("host")}${clientLogo}`;
}

async function getInvoiceTerms(invoice, project, client) {
  if (client?.invoice_terms) return client.invoice_terms;
  if (project?.invoice_terms) return project.invoice_terms;

  if (project?.project_type) {
    const division = await MasterData.findOne({
      type: "divisions",
      value: project.project_type,
      status: "active",
    }).lean();

    if (division?.terms_and_conditions) {
      return division.terms_and_conditions;
    }
  }

  return "Payment is due upon receipt.";
}

async function getCategoryName(value, createdBy) {
  if (!value) return "";

  const createdByStr = createdBy?.toString();

  const category = await MasterData.findOne({
    type: "categories",
    value: value,
    status: "active",
    created_by: {
      $in: [
        createdByStr,
        new mongoose.Types.ObjectId(createdByStr)
      ]
    }
  }).lean();

  return category?.display_name || value;
}

async function getDivisionName(value, createdBy) {
  if (!value) return "N/A";
  const createdByStr = createdBy?.toString();
  const division = await MasterData.findOne({
    type: "divisions",
    value: value,
    status: "active",
    created_by: {
      $in: [
        createdByStr,
        new mongoose.Types.ObjectId(createdByStr)
      ]
    }
  }).lean();

  if (division && division.display_name) {
    return division.display_name;
  }
  return value
    .replace(/_/g, ' ')
    .replace(/client(\d+)/gi, 'Client $1')
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

async function generatePaidInvoicePDF(invoice, req, res) {
  try {
    const project = await Project.findById(invoice.project_id).lean();
    const customer = project?.customer_ids?.length
      ? await Customer.findById(project.customer_ids[0]).lean()
      : null;

    const payments = await Payment.find({ invoice_id: invoice._id }).lean();

    const client =
      invoice.created_by && mongoose.Types.ObjectId.isValid(invoice.created_by)
        ? await Client.findById(invoice.created_by).lean()
        : null;

    const terms = await getInvoiceTerms(invoice, project, client);
    const divisionType = project?.project_type || invoice?.division_type;
    const divisionDisplayName = await getDivisionName(divisionType, invoice.created_by);
    let createdByUser = null;

    if (invoice.created_by_user) {
      const id = invoice.created_by_user;

      if (mongoose.Types.ObjectId.isValid(id)) {
        createdByUser = await User.findById(id).lean();
        if (!createdByUser) {
          createdByUser = await Client.findById(id).lean();
        }
      }
    }

    const projectDisplayName = invoice?.is_quick_estimate
      ? [
        quickCustomer?.company_name,
        quickCustomer?.customer_name
      ]
        .filter(Boolean)
        .join(" - ")
      : [
        customer?.company_name,
        project?.project_name,
        customer?.contact_name
      ]
        .filter(Boolean)
        .join(" - ");

    const billedTo = {
      project: projectDisplayName || "N/A",
      name: customer?.contact_name || "N/A",
      address: customer
        ? [customer.address, customer.city, customer.state]
          .filter(Boolean)
          .join(", ")
        : "N/A",
      phone: customer?.phone || "N/A",
      companyName: customer?.company_name || "N/A",
      email: customer?.email || "N/A",
      project_address:project?.location
    };

    const lineItemsHtmlArr = await Promise.all(
      (invoice.line_items || []).map(async (item) => {
        const categoryName = await getCategoryName(
          item.category,
          invoice.created_by
        );

        return `
      <tr>
        <td>${capitalizeFirst(categoryName)}</td>
        <td class="desc-col" style="text-align:left;">
          ${preserveLineBreaks(capitalizeFirst(item.description))}
        </td>
      </tr>
    `;
      })
    );

    const lineItemsHtml = lineItemsHtmlArr.join("");

    const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
    const total_amount = invoice.amount_paid || 0;
    const balanceDue = (invoice.total_amount ?? 0) - total_amount;

    const latestPayment = payments.length
      ? payments.sort((a, b) => new Date(b.payment_date) - new Date(a.payment_date))[0]
      : null;

    const paymentDetails = latestPayment
      ? {
        amount: formatCurrency(totalPaid),
        method: latestPayment.payment_method || "N/A",
        date: latestPayment.payment_date
          ? new Date(latestPayment.payment_date).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
          : "N/A",
        transactionId: latestPayment.reference_number || "N/A",
      }
      : null;

    const summary = {
      subtotal: formatCurrency(invoice.subtotal),
      additional: formatCurrency(invoice.material_markup_amount),
      taxRate: ((invoice.tax_rate || 0) * 100).toFixed(1),
      tax: formatCurrency(invoice.tax_amount),
      total: formatCurrency(invoice.total_amount),
    };

    const termsSection =
      invoice?.Scope_of_work || terms
        ? `
      <div class="terms" style="border-top: 1px dashed #ccc; padding-top: 10px">

        ${invoice?.Scope_of_work
          ? `
          <div class="terms-item">
            <span class="terms-label">Scope of Work</span>
            <div class="terms-text">${preserveLineBreaks(invoice.Scope_of_work)}</div>
          </div>
        `
          : ""
        }

        ${terms
          ? `
          <div class="terms-item" >
            <span class="terms-label">Terms & Conditions</span>
            <div class="terms-text">${preserveLineBreaks(terms)}</div>
          </div>
        `
          : ""
        }

      </div>
    `
        : "";

    const createdByName = createdByUser?.full_name || [createdByUser?.firstName, createdByUser?.lastName].filter(Boolean).join(" ") || "N/A";
    const createdByEmail = createdByUser?.email || "N/A";

    /* ================= LOAD HTML ================= */
    const templatePath = path.join(__dirname, "../pdf/downloadreciept.html");
    let html = fs.readFileSync(templatePath, "utf8");

    html = html
      .replace(/\{\{LOGO\}\}/g, getPublicLogoUrl(client?.logo, req))
      .replace(/\{\{INVOICE_NO\}\}/g, invoice.invoice_number || "N/A")
      .replace(/\{\{DATE\}\}/g, new Date(invoice.issue_date || Date.now()).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }))
      .replace(/\{\{PROJECT\}\}/g, billedTo.project)
      .replace(/\{\{NAME\}\}/g, billedTo.name)
      .replace(/\{\{ADDRESS\}\}/g, billedTo.address)
      .replace(/\{\{ADDRESSS\}\}/g, billedTo.project_address)
      .replace(/\{\{PHONE\}\}/g, billedTo.phone)
      .replace(/\{\{EMAIL\}\}/g, billedTo.email)
      .replace(/\{\{COMPANYNAME\}\}/g, billedTo.companyName)
      .replace(/\{\{CUSTOMER_PO_NUMBER\}\}/g, invoice.customer_po_number || "N/A")
      .replace(/\{\{CREATED_BY\}\}/g, createdByName)
      .replace(/\{\{CREATEDEMAIL\}\}/g, createdByEmail)
      .replace(/\{\{DIVISION\}\}/g, divisionDisplayName)
      .replace(/\{\{START_DATE\}\}/g, project?.estimated_start_date ? new Date(project.estimated_start_date).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : "N/A")
      .replace(/\{\{LINE_ITEMS\}\}/g, lineItemsHtml)
      .replace(/\$\{\{SUBTOTAL\}\}/g, summary.subtotal)
      .replace(/\$\{\{ADDITIONAL\}\}/g, summary.additional)
      .replace(/\$\{\{TAX\}\}/g, summary.tax)
      .replace(/\$\{\{TOTAL\}\}/g, summary.total)
      .replace(/\{\{TAX_RATE\}\}/g, summary.taxRate)
      .replace(/\{\{TERMS\}\}/g, termsSection)
      .replace(/\{\{PAID_AMOUNT\}\}/g, paymentDetails?.amount || "$0.00")
      .replace(/\{\{PAYMENT_METHOD\}\}/g, paymentDetails?.method || "-")
      .replace(/\{\{PAYMENT_DATE\}\}/g, paymentDetails?.date || "-")
      .replace(/\{\{TRANSACTION_ID\}\}/g, paymentDetails?.transactionId || "-")
      .replace(/\{\{BALANCE_DUE\}\}/g, formatCurrency(balanceDue))
      .replace(/\{\{COMPANY_NAME\}\}/g, client?.companyName || "")
      .replace(/\{\{COMPANY_ADDRESS\}\}/g, client?.address || "")
      .replace(/\{\{COMPANY_EMAIL\}\}/g, client?.email || "")
      .replace(/\{\{COMPANY_PHONE\}\}/g, client?.companyPhone || "")
      .replace(/\{\{PAID_CLASS\}\}/g, balanceDue <= 0 ? "" : "hidden")
      .replace(/\{\{PAYMENT_CLASS\}\}/g, payments.length ? "" : "hidden");

    /* ================= PUPPETEER ================= */
    const userDataDir = path.join(os.tmpdir(), `puppeteer_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    const browser = await puppeteer.launch({
      executablePath: "/usr/bin/chromium-browser",
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      userDataDir: userDataDir
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
    });

    await browser.close();

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=Invoice-${invoice.invoice_number}.pdf`
    );
    res.setHeader("Content-Type", "application/pdf");
    res.send(pdfBuffer);
  } catch (err) {
    console.error("Invoice PDF Error:", err);
    if (!res.headersSent) {
      res.status(500).send("Error generating invoice PDF");
    }
  }
}

module.exports = { generatePaidInvoicePDF };

