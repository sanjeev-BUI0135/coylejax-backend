const puppeteer = require("puppeteer");
const path = require("path");
const os = require("os");
const fs = require("fs");
const mongoose = require("mongoose");

const Invoice = require("../models/Invoice");
const Project = require("../models/Project");
const Customer = require("../models/Customer");
const Client = require("../models/Client");
const MasterData = require("../models/MasterData");
const User = require("../models/User");
const formatUSPhone = require("../helpers/formatUSPhone");
/* =========================
   HELPERS
========================= */
function formatCurrency(value) {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function capitalizeFirst(text) {
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function preserveLineBreaks(text) {
  if (!text) return "";
  return text.replace(/\n/g, "<br/>");
}


function linkifyUrls(text) {
  if (!text) return "";
  const tempParts = text.split(/(<a\b[^>]*>.*?<\/a>)/ig);
  for (let i = 0; i < tempParts.length; i++) {
    if (!/^<a\b/i.test(tempParts[i])) {
      tempParts[i] = tempParts[i].replace(/(https?:\/\/[^\s<]+)/ig, '<a href="$1" target="_blank" style="color: #0f5ba7; text-decoration: underline;">$1</a>');
    }
  }
  return tempParts.join('');
}
function stripHtml(html) {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, "");
}

function getPublicLogoUrl(clientLogo, req) {
  if (!clientLogo) return "";
  return `${req.protocol}://${req.get("host")}${clientLogo}`;
}

async function getDivisionTerms({ divisionType, createdBy }) {
  if (!divisionType || !createdBy) return null;

  const createdByStr = createdBy.toString();

  const term = await MasterData.findOne({
    type: "divisions",
    value: divisionType,
    status: "active",
    created_by: {
      $in: [
        createdByStr,
        new mongoose.Types.ObjectId(createdByStr)
      ]
    }
  }).lean();

  return term?.terms_and_conditions || null;
}

async function getMarkup({ createdBy }) {
  if (!createdBy) return null;
  return await MasterData.findOne({
    type: "markup",
    status: "active",
    $or: [
      { created_by: createdBy },
      { created_by: { $exists: false } },
      { created_by: null },
    ],
  })
    .sort({ updatedAt: -1 })
    .lean();
}

function resolveFinalTerms({ divisionTerms, client }) {
  if (divisionTerms) return divisionTerms;
  if (client?.terms_and_conditions) return client.terms_and_conditions;
  return "";
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

async function generateInvoicePdf(invoiceId, req, pdfType = "details") {
  try {
    const invoice = await Invoice.findById(invoiceId).lean();
    if (!invoice) throw new Error("Invoice not found");
    const project = await Project.findById(invoice.project_id).lean();
    const customer = project?.customer_ids?.length
      ? await Customer.findById(project.customer_ids[0]).lean()
      : null;

    const client =
      invoice.created_by && mongoose.Types.ObjectId.isValid(invoice.created_by)
        ? await Client.findById(invoice.created_by).lean()
        : null;

    const divisionTerms = await getDivisionTerms({
      divisionType: project?.project_type,
      createdBy: invoice.created_by,
    });
    
    const divisionDisplayName = await getDivisionName(project?.project_type, invoice.created_by);
    const markupData = await getMarkup({
      createdBy: invoice.created_by
    })
    const finalTerms = resolveFinalTerms({ divisionTerms, client, markupData });

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
      ? (
        estimate?.quick_customer?.project_name ||
        [
          estimate?.quick_customer?.company_name,
          estimate?.quick_customer?.customer_name
        ]
          .filter(Boolean)
          .join(" - ")
      )
      : [ project?.project_name]
        .filter(Boolean)
        .join(" - ");

    const billedTo = {
      project: projectDisplayName || "N/A",
      company:customer?.company_name || "N/A",
      name: customer?.contact_name || "N/A",
      address: customer
        ? [customer.address, customer.city, customer.state]
          .filter(Boolean)
          .join(", ")
        : "N/A",
      porject_address:project.location,
      phone: customer?.phone || "N/A",
      email: customer?.email || "N/A",
    };

    /* ===== LINE ITEMS ===== */
    const lineItemsHtmlArr = await Promise.all(
      (invoice.line_items || []).map(async (item) => {
        const categoryName = await getCategoryName(
          item.category,
          invoice.created_by
        );

        if (item.is_section) {
          const colSpan = pdfType === "summary" ? 2 : 3;
          return `
            <tr>
              <td colspan="${colSpan}" style="background-color: #f3f4f6; font-weight: 600; text-align: left; padding: 10px;">
                ${preserveLineBreaks(capitalizeFirst(item.description))}
              </td>
            </tr>
          `;
        }

        if (pdfType === "summary") {
          return `
            <tr>
               <td>${capitalizeFirst(categoryName)}</td>
              <td class="desc-col" style="text-align:left;">${preserveLineBreaks(capitalizeFirst(item.description))}</td>
            </tr>
          `;
        }

        return `
      <tr>
        <td>${capitalizeFirst(categoryName)}</td>
        <td style="text-align:left;">
          ${preserveLineBreaks(capitalizeFirst(item.description))}
        </td>
        <td style="text-align: right; font-weight: bold;">$${formatCurrency(item.total)}</td>
      </tr>
    `;
      })
    );
    const lineItemsHtml = lineItemsHtmlArr.join("");

    /* ===== TABLE HEADER ===== */
    const tableHeader =
      pdfType === "summary"
        ? `
          <tr>
            <th style="width:15%">Category</th>
            <th style="width:85%">Description</th>
          </tr>
        `
        : `
          <tr>
            <th style="width:15%">Category</th>
            <th style="width:65%">Description</th>
            <th style="width:20%;text-align:right">Total</th>
          </tr>
        `;

    /* ===== ADDITIONAL ROW ===== */

    const additionalRow =
      pdfType === "details" && invoice.material_markup_amount
        ? `
      <div class="row">
        <span>${markupData?.value || "Markup"}</span>
        <span>$${formatCurrency(invoice.material_markup_amount)}</span>
      </div>
    `
        : "";
    const balanceDue = (invoice.total_amount || 0) - (invoice.amount_paid || 0);
    const isSummary = pdfType === "summary";
    const summary = {
      subtotal: formatCurrency(invoice.subtotal),
      taxRate: ((invoice.tax_rate || 0) * 100).toFixed(1),
      tax: formatCurrency(invoice.tax_amount),
      additional: pdfType === "details" ? formatCurrency(invoice.material_markup_amount) : null,
      markUpData:
        pdfType === "details" ? formatCurrency(markupData?.value) : null,
      total: formatCurrency(invoice.total_amount),
      amountPaid: formatCurrency(invoice.amount_paid || 0),
      balanceDue: formatCurrency(balanceDue),
    };
    const subtotalRow = isSummary
      ? ""
      : `
    <div class="row">
      <span>Subtotal :</span>
      <span>$${summary.subtotal}</span>
    </div>
  `;

    const taxRow = isSummary
      ? ""
      : `
    <div class="row">
      <span>Tax (${summary.taxRate}%) :</span>
      <span>$${summary.tax}</span>
    </div>
  `;

    const summarySection = `
  <div class="summary">
    ${additionalRow}
    ${subtotalRow}
    ${taxRow}
    <div class="row total">
      <span>Total :</span>
      <span>$${summary.total}</span>
    </div>

    <div class="row">
      <span>Amount Paid</span>
      <span>$${summary.amountPaid}</span>
    </div>

    <div class="row balance">
      <span><strong>Balance Due</strong></span>
      <span><strong>$${summary.balanceDue}</strong></span>
    </div>
  </div>
`;

    const termsSection =
  invoice?.Scope_of_work || finalTerms
    ? `
      <div class="terms" style="border-top: 1px dashed #ccc; padding-top: 10px">

        ${
          invoice?.Scope_of_work
            ? `
          <div class="terms-item">
            <h3 class="terms-label" style="margin-top: 0;">Scope of Work</h3>
            <div class="terms-text">${invoice.Scope_of_work}</div>
          </div>
        `
            : ""
        }

        ${
          finalTerms
            ? `
          <div class="terms-item">
            <h3 class="terms-label" style="margin-top: 0;">Terms & Conditions</h3>
            <div class="terms-text">${finalTerms}</div>
          </div>
        `
            : ""
        }

      </div>
    `
    : "";
    const totalBox = `
  <div class="total-box">
    <div class="label">Total Amount</div>
    <div class="amount">$${summary.total}</div>
  </div>
`;
    const createdByName = createdByUser?.full_name || [createdByUser?.firstName, createdByUser?.lastName].filter(Boolean).join(" ") || "N/A";
    const createdByEmail = createdByUser?.email || "N/A";

    const formattedDate = new Date(
      invoice.issue_date || Date.now()
    ).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });

    /* ===== LOAD TEMPLATE ===== */
    const templatePath = path.join(__dirname, "../pdf/invoice.html");
    let html = fs.readFileSync(templatePath, "utf8");

    /* ===== REPLACE PLACEHOLDERS ===== */
    html = html
      .replace(/\{\{LOGO\}\}/g, getPublicLogoUrl(client?.logo, req))
      .replace(/\{\{DOC_TITLE\}\}/g, "Invoice")
      .replace(/\{\{DOC_NUMBER_LABEL\}\}/g, "Invoice Number")
      .replace(/\{\{DOC_NUMBER\}\}/g, invoice.invoice_number)
      .replace(/\{\{DATE\}\}/g, formattedDate)
      .replace(/\{\{PROJECT\}\}/g, billedTo.project)
      .replace(/\{\{NAME\}\}/g, billedTo.name)
      .replace(/\{\{ADDRESS\}\}/g, billedTo.address)
      .replace(/\{\{ADDRESSS\}\}/g, billedTo.porject_address)
      .replace(/\{\{COMPANYNAME\}\}/g, billedTo.company)
      .replace(/\{\{PHONE\}\}/g, billedTo.phone)
      .replace(/\{\{EMAIL\}\}/g, billedTo.email)
      .replace(/\{\{CUSTOMER_PO_NUMBER\}\}/g, invoice.customer_po_number || "N/A")
      .replace(/\{\{START_DATE\}\}/g, project?.estimated_start_date ? new Date(project?.estimated_start_date).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : "N/A")
      .replace(/\{\{CREATED_BY\}\}/g, createdByName)
      .replace(/\{\{CREATEDEMAIL\}\}/g, createdByEmail)
      .replace(/\{\{DIVISION\}\}/g, divisionDisplayName)
      .replace(/\{\{TABLE_HEADER\}\}/g, tableHeader)
      .replace(/\{\{LINE_ITEMS\}\}/g, lineItemsHtml)
      .replace(/\$\{\{SUBTOTAL\}\}/g, `$${summary.subtotal}`)
      .replace(/\{\{ADDITIONAL_ROW\}\}/g, additionalRow)
      .replace(/\$\{\{TAX\}\}/g, `$${summary.tax}`)
      .replace(/\$\{\{TOTAL\}\}/g, `$${summary.total}`)
      .replace(/\{\{SUBTOTAL_ROW\}\}/g, subtotalRow)
      .replace(/\{\{TAX_ROW\}\}/g, taxRow)
      .replace(/\{\{TAX_RATE\}\}/g, summary.taxRate)
      .replace(/\{\{COMPANY_NAME\}\}/g, client?.companyName || "")
      .replace(/\{\{COMPANY_ADDRESS\}\}/g, client?.address || "")
      .replace(/\{\{COMPANY_EMAIL\}\}/g, client?.email || "")
      .replace(/\{\{COMPANY_PHONE\}\}/g, formatUSPhone(client?.companyPhone || ""))
      .replace(/\{\{SUMMARY_SECTION\}\}/g, summarySection)
      .replace(/\{\{TERMS_SECTION\}\}/g, termsSection)
      .replace(/\{\{TOTAL_BOX\}\}/g, totalBox)
      .replace(/\{\{INVOICE_ONLY_SECTION\}\}/g, `
  <div class="row">
    <span>Amount Paid</span>
    <span>$${summary.amountPaid}</span>
  </div>
  <div class="row balance">
    <span><strong>Balance Due</strong></span>
    <span><strong>$${summary.balanceDue}</strong></span>
  </div>
`)
      .replace(/\{\{SIGNATURE_SECTION\}\}/g, "")
      .replace(/\{\{MARKUP_ROW\}\}/g, "")
      .replace(/\{\{TERMS\}\}/g, stripHtml(finalTerms));

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
    return pdfBuffer;
  } catch (error) {
    console.error("Invoice PDF generation error:", error);
    throw error;
  }
}

module.exports = { generateInvoicePdf };
