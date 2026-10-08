const puppeteer = require("puppeteer");
const path = require("path");
const os = require("os");
const fs = require("fs");
const mongoose = require("mongoose");
const axios = require("axios");

const Estimate = require("../models/Estimate");
const Project = require("../models/Project");
const Customer = require("../models/Customer");
const Client = require("../models/Client");
const MasterData = require("../models/MasterData");
const User = require("../models/User");
const formatUSPhone = require("../helpers/formatUSPhone");
const { formatDateUS } = require("../utils/dateformat");

/* =========================
   HELPERS
========================= */
function formatCurrency(value) {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function sanitizeTerms(html) {
  if (!html) return "";
  return html
    .replace(/<script.*?>.*?<\/script>/gi, "")
    .replace(/on\w+=".*?"/gi, "")
    .replace(/font-size\s*:\s*[^;"]*;?/gi, "")
    .replace(/font-family\s*:\s*[^;"]*;?/gi, "")
    .replace(/background-color\s*:\s*[^;"]*;?/gi, "")
    .replace(/line-height\s*:\s*[^;"]*;?/gi, "");
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

  const query = {
    type: "divisions",
    value: divisionType,
    created_by: {
      $in: [
        createdByStr, // string
        new mongoose.Types.ObjectId(createdByStr) // ObjectId
      ]
    },
    status: "active",
  };

  const term = await MasterData.collection.findOne(query);
  return term?.terms_and_conditions || null;
}

async function getMarkup({ createdBy }) {
  if (!createdBy) return null;

  const createdByStr = createdBy.toString();
  const createdById = mongoose.Types.ObjectId.isValid(createdByStr)
    ? new mongoose.Types.ObjectId(createdByStr)
    : null;

  return await MasterData.findOne({
    type: "markup",
    status: "active",
    $or: [
      ...(createdById ? [{ created_by: createdById }] : []),
      { created_by: createdByStr },
      { created_by: { $exists: false } },
      { created_by: null },
    ],
  })
    .sort({ updatedAt: -1 })
    .lean();
}

function resolveFinalTerms({ estimate, divisionTerms, client }) {
  if (estimate?.termsAndConditions) return estimate.termsAndConditions;
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

  return category?.display_name || value; // fallback
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



async function generateEstimatePdf(estimateId, req, pdfType = "details") {
  const PDFMerger = (await import("pdf-merger-js")).default;
  try {
    /* ===== LOAD ESTIMATE ===== */
    const estimate = await Estimate.findById(estimateId).lean();
    if (!estimate) throw new Error("Estimate not found");

    /* ===== SAFE PROJECT + CUSTOMER FETCH ===== */
    let project = null;
    let customer = null;

    if (
      estimate.project_id &&
      mongoose.Types.ObjectId.isValid(estimate.project_id)
    ) {
      project = await Project.findById(estimate.project_id).lean();

      if (project?.customer_ids?.length) {
        customer = await Customer.findById(
          project.customer_ids[0]
        ).lean();
      }
    }

    let createdByUser = null;

    if (estimate.created_by_user) {
      const id = estimate.created_by_user;

      if (mongoose.Types.ObjectId.isValid(id)) {
        createdByUser = await User.findById(id).lean();
        if (!createdByUser) {
          createdByUser = await Client.findById(id).lean();
        }
      }
    }

    /* ===== QUICK ESTIMATE FALLBACK ===== */
    const quickCustomer = estimate.quick_customer || {};

    /* ===== CLIENT ===== */
    const client =
      estimate.created_by &&
        mongoose.Types.ObjectId.isValid(estimate.created_by)
        ? await Client.findById(estimate.created_by).lean()
        : null;

    /* ===== TERMS & MARKUP ===== */
    const divisionType = (project?.project_type || estimate?.division_type || estimate?.quick_customer?.division_type || "").trim();
    const divisionTerms = await getDivisionTerms({
      divisionType: divisionType,
      createdBy: estimate.created_by,
    });
    
    const divisionDisplayName = await getDivisionName(divisionType, estimate.created_by);

    const markupData = await getMarkup({
      createdBy: estimate.created_by,
    });

    const finalTerms = resolveFinalTerms({
      estimate,
      divisionTerms,
      client,
    });
    /* ===== LINE ITEMS ===== */
    const lineItemsHtmlArr = await Promise.all(
      (estimate.line_items || []).map(async (item) => {
        const categoryName = await getCategoryName(
          item.category,
          estimate.created_by
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
      <td class="desc-col" style="text-align:left;">
       ${preserveLineBreaks(capitalizeFirst(item.description))}
      </td>
    </tr>
  `;
        }

        if (pdfType === "crew") {
          return `
    <tr>
      <td>${capitalizeFirst(categoryName)}</td>
      <td>${preserveLineBreaks(capitalizeFirst(item.description))}</td>
      <td align="center">${item.quantity}</td>
    </tr>
  `;
        }

        return `
      <tr>
        <td>${capitalizeFirst(categoryName)}</td>
        <td>${preserveLineBreaks(capitalizeFirst(item.description))}</td>
        <td style="text-align: right;">$${formatCurrency(item.total)}</td>
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
        : pdfType === "crew"
          ? `
      <tr>
        <th style="width:15%">Category</th>
        <th style="width:65%">Description</th>
        <th style="width:20%; text-align:left">Quantity</th>
      </tr>
    `
          : `
      <tr>
        <th style="width:15%">Category</th>
        <th style="width:65%;">Description</th>
        <th style="width:20%;text-align:right">Total</th>
      </tr>
    `;

    /* ===== ROWS GENERATION ===== */
    const additionalRow =
      pdfType === "details" && estimate.material_markup_amount
        ? `
        <div class="row">
          <span>${markupData?.value || "Markup"}</span>
          <span>$${formatCurrency(estimate.material_markup_amount)}</span>
        </div>
      `
        : "";

    /* ===== SUMMARY ===== */
    const isCrew = pdfType === "crew";
    const isSummary = pdfType === "summary" || pdfType === "crew";
    const summary = {
      subtotal: formatCurrency(estimate.subtotal),
      taxRate: ((estimate.tax_rate || 0) * 100).toFixed(1),
      tax: formatCurrency(estimate.tax_amount),
      total: formatCurrency(estimate.total_amount),
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
    const totalRow = isCrew
      ? ""
      : `
    <div class="row total" style="margin-bottom: 0px;">
      <span>Total :</span>
      <span>$${summary.total}</span>
    </div>
  `;

    const summarySection = isCrew
      ? ""
      : `
    <div class="summary">
      ${additionalRow}
      ${subtotalRow}
      ${taxRow}
      ${totalRow}
    </div>
  `;

    const projectDisplayName = estimate?.is_quick_estimate
      ? (
        estimate?.quick_customer?.project_name ||
        [
          estimate?.quick_customer?.company_name,
          estimate?.quick_customer?.customer_name
        ]
          .filter(Boolean)
          .join(" - ")
      )
      : [
        project?.project_name,
      ]
        .filter(Boolean)
        .join(" - ");

    const createdByName = createdByUser?.full_name || [createdByUser?.firstName, createdByUser?.lastName].filter(Boolean).join(" ") || "N/A";

    const createdByEmail = createdByUser?.email || "N/A";

    /* ===== LOAD TEMPLATE ===== */
    const templatePath = path.join(__dirname, "../pdf/invoice.html");
    let html = fs.readFileSync(templatePath, "utf8");

    /* ===== DATA BINDING ===== */
    html = html
      .replace(/\{\{LOGO\}\}/g, getPublicLogoUrl(client?.logo, req))
      .replace(/\{\{DOC_TITLE\}\}/g, "Estimate")
      .replace(/\{\{DOC_NUMBER_LABEL\}\}/g, "Estimate Number")
      .replace(/\{\{DOC_NUMBER\}\}/g, estimate.estimate_number)
      .replace(/\{\{CUSTOMER_PO_NUMBER\}\}/g, estimate.customer_po_number || "N/A")
      .replace(/\{\{START_DATE\}\}/g, project?.estimated_start_date ? formatDateUS(new Date(project?.estimated_start_date)) : estimate?.createdAt ? formatDateUS(new Date(estimate.createdAt), "dd/MM/yyyy") : "N/A")
      .replace(/\{\{CREATED_BY\}\}/g, createdByName)
      .replace(/\{\{CREATEDEMAIL\}\}/g, createdByEmail)
      .replace(/\{\{DIVISION\}\}/g, divisionDisplayName)
      .replace(/\{\{DATE\}\}/g, estimate?.createdAt ? formatDateUS(new Date(estimate.createdAt), "dd/MM/yyyy"): "N/A")
      .replace(
        /\{\{PROJECT\}\}/g,
        projectDisplayName || "N/A"
      )
      .replace(/\{\{COMPANYNAME\}\}/g, customer?.company_name || quickCustomer.company_name || "N/A")
      .replace(/\{\{NAME\}\}/g, customer?.contact_name || quickCustomer.customer_name || "N/A" )
      .replace(/\{\{ADDRESS\}\}/g, (customer ? [customer.address, customer.city, customer.state, customer.zip_code].filter(Boolean).join(", ") : null) || quickCustomer?.billing_address || quickCustomer?.site_address || "N/A" )
      .replace(/\{\{ADDRESSS\}\}/g, project?.location || quickCustomer.site_address || "N/A" )
      .replace(
        /\{\{PHONE\}\}/g,
        customer?.phone ||
        quickCustomer.phone_number ||
        "N/A"
      )
      .replace(
        /\{\{EMAIL\}\}/g,
        customer?.email || quickCustomer.email_address || "N/A"
      )
      .replace(/\{\{TABLE_HEADER\}\}/g, tableHeader)
      .replace(/\{\{LINE_ITEMS\}\}/g, lineItemsHtml)
      .replace(/\$\{\{SUBTOTAL\}\}/g, `$${summary.subtotal}`)
      .replace(/\{\{ADDITIONAL_ROW\}\}/g, additionalRow)
      .replace(/\$\{\{TAX\}\}/g, `$${summary.tax}`)
      .replace(/\$\{\{TOTAL\}\}/g, `$${summary.total}`)
      .replace(/\{\{TOTAL_ROW\}\}/g, totalRow)
      .replace(/\{\{SUMMARY_SECTION\}\}/g, summarySection)
      .replace(/\{\{SIGNATURE_SECTION\}\}/g, (() => {
        let signatureUrl = [...(estimate.file_attachments || [])].reverse().find(f => f.file_name?.includes('signature') || f.file_url?.includes('e-signature'))?.file_url;
        if (signatureUrl && signatureUrl.includes('/uploads/')) {
            const pathPart = signatureUrl.substring(signatureUrl.indexOf('/uploads/'));
            signatureUrl = `${req.protocol}://${req.get("host")}${pathPart}`;
        }
        const minHeight = isCrew ? '70px' : '110px';
          if (estimate.status === 'approved') {
            return `
              <div style="page-break-inside: avoid; break-inside: avoid; width: 100%;">
                <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 5px;">
                  <h3 style="margin: 0; font-weight: 600; font-size: 13px;">Customer Signature </h3>
                  ${estimate.approved_date ? (() => {
                    let tz = process.env.APP_TIMEZONE ;
                    let formatted = '';
                    try {
                      formatted = new Date(estimate.approved_date).toLocaleString('en-US', { timeZone: tz, month: '2-digit', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
                    } catch (e) {
                      formatted = new Date(estimate.approved_date).toLocaleString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
                    }
                    return `<span style="font-size: 11px; color: #555; font-weight: 500;">Approved on: ${formatted}</span>`;
                  })() : ''}
                </div>
                <div style="border: 1px solid #ccc; padding: 10px; border-radius: 8px; background: #f9f9f9; flex: 1; display: flex; justify-content: center; align-items: center; text-align: center; min-height: ${minHeight};">
                  ${signatureUrl ? `<img src="${signatureUrl}" style="max-height: 100%; max-width: 100%; object-fit: contain;" />` : ''}
                </div>
              </div>
            `;
          } else {
            return `
              <div style="page-break-inside: avoid; break-inside: avoid; width: 100%;">
                <h3 style="margin-top:0; margin-bottom: 5px;">Customer Signature </h3>
                <div style="border: 1px solid #ccc; border-radius: 8px; background: #f9f9f9; flex: 1; min-height: ${minHeight};">
                </div>
              </div>
            `;
          }
      })())
      .replace(
        /\{\{TOTAL_BOX\}\}/g,
        isCrew ? "" : `
    <div class="total-box">
      <div class="label">Total Amount</div>
      <div class="amount">$${summary.total}</div>
    </div>
  `
      )
      .replace(/\{\{SUBTOTAL_ROW\}\}/g, subtotalRow)
      .replace(/\{\{TAX_ROW\}\}/g, taxRow)
      .replace(/\{\{INVOICE_ONLY_SECTION\}\}/g, "")
      .replace(/\{\{TAX_RATE\}\}/g, summary.taxRate)
      .replace(/\{\{COMPANY_NAME\}\}/g, client?.companyName || "")
      .replace(/\{\{COMPANY_ADDRESS\}\}/g, client?.address || "")
      .replace(/\{\{COMPANY_EMAIL\}\}/g, client?.email || "")
      .replace(/\{\{COMPANY_PHONE\}\}/g, formatUSPhone(client?.companyPhone || ""))
      .replace(/\{\{MARKUP_ROW\}\}/g, "")
      .replace(
        /\{\{TERMS_SECTION\}\}/g,
        `
          <div class="terms" style="border-top: 1px dashed #ccc; padding-top: 10px">
            ${(estimate.notes && isCrew) ? `
              <div class="terms-item" >
                <h3 class="terms-label" style="margin-top: 0; font-weight:600 ; font-size :13px">Notes</h3>
                <div class="terms-text">${sanitizeTerms(estimate.notes)}</div>
              </div>
            ` : ""}
            
            ${(estimate.Scope_of_work) ?`<div class="terms-item ">
              <h3 class="terms-label" style="margin-top: 0; font-weight:600 ; font-size :13px">Scope of Work</h3>
              <div class="terms-text">${sanitizeTerms(estimate.Scope_of_work) || "N/A"}</div>
            </div>` : ""}

            ${!isCrew && finalTerms ? `
              <div style="margin-top: 20px;">
                <h3 class="terms-label" style="margin-top: 0; font-weight:600; font-size :13px">Terms and Conditions</h3>
                <div class="terms-text">${sanitizeTerms(finalTerms)}</div>
              </div>
            ` : ""}
          </div>
        `
      )

    /* ===== PDF GENERATION ===== */
    const userDataDir = path.join(os.tmpdir(), `puppeteer_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    const browser = await puppeteer.launch({
      executablePath: "/usr/bin/chromium-browser",
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      userDataDir: userDataDir
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const mainPdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
    });
    const merger = new PDFMerger();

    const tempMainPdf = path.join(
      os.tmpdir(),
      `estimate_${Date.now()}.pdf`
    );

    fs.writeFileSync(tempMainPdf, mainPdfBuffer);

    await merger.add(tempMainPdf);

    // append uploaded pdf files
    for (const file of estimate.file_attachments || []) {
      const fileUrl = file.file_url || "";

      if (fileUrl.match(/\.pdf$/i)) {
        try {
          let pdfBuffer;
          if (fileUrl.includes('/uploads/')) {
            // Read directly from the local file system
            const uploadPath = fileUrl.substring(fileUrl.indexOf('/uploads/'));
            const localPath = path.join(__dirname, '..', uploadPath);
            pdfBuffer = fs.readFileSync(localPath);
          } else {
            // Fetch from external URL
            const response = await axios.get(fileUrl, {
              responseType: "arraybuffer",
            });
            pdfBuffer = response.data;
          }

          const tempAttachmentPath = path.join(
            os.tmpdir(),
            `${Date.now()}_${file.file_name}`
          );

          fs.writeFileSync(tempAttachmentPath, pdfBuffer);

          await merger.add(tempAttachmentPath);
        } catch (err) {
          console.error(
            "Attachment PDF merge failed:",
            file.file_name,
            err.message
          );
        }
      }
    }

    const finalPdfBuffer = await merger.saveAsBuffer();
    await browser.close();
    return finalPdfBuffer;
  } catch (err) {
    console.error("Estimate PDF error:", err);
    throw err;
  }
}

module.exports = { generateEstimatePdf };
