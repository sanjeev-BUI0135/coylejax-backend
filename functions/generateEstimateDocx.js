const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
  ImageRun,
  ExternalHyperlink,
  UnderlineType,
  HeadingLevel
} = require("docx");
const path = require("path");
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
   HELPERS & FORMATTING
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

function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function parseHtmlToDocxParagraphs(html, defaultFormat = {}) {
  if (!html) return [];
  
  let cleanHtml = html
    .replace(/<p><br\s*\/?><\/p>/gi, "<br/>")
    .replace(/<p>&nbsp;<\/p>/gi, "<br/>")
    .replace(/font-size\s*:\s*[^;"]*;?/gi, "")
    .replace(/font-family\s*:\s*[^;"]*;?/gi, "")
    .replace(/background-color\s*:\s*[^;"]*;?/gi, "")
    .replace(/line-height\s*:\s*[^;"]*;?/gi, "");
  
  const regex = /(<[^>]+>)|([^<]+)/g;
  let match;
  
  const paragraphs = [];
  let currentRuns = [];
  
  let isBold = false;
  let isItalic = false;
  let isUnderline = false;
  let isStrike = false;
  let currentLink = null;
  
  const flushParagraph = () => {
    if (currentRuns.length > 0) {
      paragraphs.push(new Paragraph({
        children: currentRuns,
        spacing: defaultFormat.spacing || { before: 40, after: 100 }
      }));
      currentRuns = [];
    }
  };

  while ((match = regex.exec(cleanHtml)) !== null) {
    if (match[1]) {
      let tag = match[1].toLowerCase();
      if (tag.startsWith('<b') || tag.startsWith('<strong')) isBold = true;
      else if (tag.startsWith('</b') || tag.startsWith('</strong')) isBold = false;
      else if (tag.startsWith('<i') || tag.startsWith('<em')) isItalic = true;
      else if (tag.startsWith('</i') || tag.startsWith('</em')) isItalic = false;
      else if (tag.startsWith('<u')) isUnderline = true;
      else if (tag.startsWith('</u')) isUnderline = false;
      else if (tag.match(/^<s[\s>]/) || tag.startsWith('<strike') || tag.startsWith('<del') || tag.includes('line-through')) isStrike = true;
      else if (tag.match(/^<\/s>/) || tag.startsWith('</strike>') || tag.startsWith('</del>')) isStrike = false;
      // Do nothing special for <span> or </span>, just let text pass through
      else if (tag.startsWith('<a')) {
        let hMatch = match[1].match(/href=["']([^"']+)["']/i);
        if (hMatch) currentLink = hMatch[1];
      }
      else if (tag.startsWith('</a')) currentLink = null;
      else if (tag.startsWith('<p') || tag.startsWith('<div')) flushParagraph();
      else if (tag.startsWith('</p') || tag.startsWith('</div') || tag.startsWith('<br')) flushParagraph();
    } else if (match[2]) {
      let text = match[2]
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
        
      if (text.trim() || text.includes(" ")) {
        let textRunOpts = {
          text: text,
          bold: isBold || defaultFormat.bold,
          italics: isItalic || defaultFormat.italics,
          underline: (isUnderline || defaultFormat.underline) ? {} : undefined,
          strike: isStrike || defaultFormat.strike,
          size: defaultFormat.size || 18,
          color: defaultFormat.color || "000000",
          font: "Arial"
        };
        
        if (currentLink) {
          textRunOpts.color = "0563C1"; // Standard link blue
          textRunOpts.underline = { type: UnderlineType.SINGLE, color: "0563C1" };
          
          currentRuns.push(new ExternalHyperlink({
            children: [new TextRun(textRunOpts)],
            link: currentLink
          }));
        } else {
          currentRuns.push(new TextRun(textRunOpts));
        }
      }
    }
  }
  
  flushParagraph();
  return paragraphs;
}

function resolveLocalPath(fileUrlOrPath) {
  if (!fileUrlOrPath) return null;
  let relativePath = fileUrlOrPath;
  if (fileUrlOrPath.includes('/uploads/')) {
    relativePath = fileUrlOrPath.substring(fileUrlOrPath.indexOf('/uploads/'));
  }
  if (relativePath.startsWith('/')) {
    relativePath = relativePath.slice(1);
  }
  const fullPath = path.join(__dirname, '..', relativePath);
  if (fs.existsSync(fullPath)) {
    return fullPath;
  }
  return null;
}

async function getImageBuffer(urlOrPath) {
  if (!urlOrPath) return null;
  const localPath = resolveLocalPath(urlOrPath);
  if (localPath) {
    try {
      return fs.readFileSync(localPath);
    } catch (e) {
      console.error(`Failed to read local image: ${localPath}`, e.message);
    }
  }
  try {
    const response = await axios.get(urlOrPath, { responseType: 'arraybuffer' });
    return Buffer.from(response.data);
  } catch (e) {
    console.error(`Failed to fetch remote image: ${urlOrPath}`, e.message);
  }
  return null;
}

function getImageDimensions(buffer) {
  if (!buffer) return null;
  try {
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      return { width, height };
    }
    if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
      let offset = 2;
      while (offset < buffer.length) {
        const marker = buffer.readUInt16BE(offset);
        offset += 2;
        if (marker === 0xFFC0 || marker === 0xFFC2) {
          const height = buffer.readUInt16BE(offset + 3);
          const width = buffer.readUInt16BE(offset + 5);
          return { width, height };
        }
        if ((marker & 0xFF00) !== 0xFF00) break;
        const length = buffer.readUInt16BE(offset);
        offset += length;
      }
    }
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
      const width = buffer.readUInt16LE(6);
      const height = buffer.readUInt16LE(8);
      return { width, height };
    }
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
      const type = buffer.toString('ascii', 12, 16);
      if (type === 'VP8 ') {
        const width = buffer.readUInt16LE(26) & 0x3FFF;
        const height = buffer.readUInt16LE(28) & 0x3FFF;
        return { width, height };
      } else if (type === 'VP8L') {
        const val = buffer.readUInt32LE(21);
        const width = (val & 0x3FFF) + 1;
        const height = ((val >> 14) & 0x3FFF) + 1;
        return { width, height };
      } else if (type === 'VP8X') {
        const width = (buffer.readUInt32LE(24) & 0xFFFFFF) + 1;
        const height = (buffer.readUInt32LE(27) & 0xFFFFFF) + 1;
        return { width, height };
      }
    }
  } catch (err) {
    console.error("Error reading image dimensions:", err);
  }
  return null;
}

async function getDivisionTerms({ divisionType, createdBy }) {
  if (!divisionType || !createdBy) return null;
  const createdByStr = createdBy.toString();
  const query = {
    type: "divisions",
    value: divisionType,
    created_by: {
      $in: [
        createdByStr,
        new mongoose.Types.ObjectId(createdByStr)
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

// DOCX Creation Utilities
function createParagraph(text, options = {}) {
  const {
    bold = false,
    italic = false,
    size = 20, // 10pt (half-points)
    color = "2D3748",
    alignment = AlignmentType.LEFT,
    spacing = { before: 40, after: 40 },
    font = "Arial",
    keepNext = false,
    keepLines = false,
  } = options;

  const lines = (text || "").split("\n");
  const children = [];
  
  const urlRegex = /(https?:\/\/[^\s]+)/g;

  lines.forEach((line, index) => {
    let lastIndex = 0;
    let match;

    while ((match = urlRegex.exec(line)) !== null) {
      if (match.index > lastIndex) {
        children.push(new TextRun({
          text: line.substring(lastIndex, match.index),
          bold,
          italic,
          size,
          color,
          font,
        }));
      }
      children.push(new ExternalHyperlink({
        children: [
          new TextRun({
            text: match[0],
            bold,
            italic,
            size,
            color: "0F5BA7",
            font,
            underline: {
              type: UnderlineType.SINGLE,
              color: "0F5BA7"
            }
          })
        ],
        link: match[0]
      }));
      lastIndex = urlRegex.lastIndex;
    }

    if (lastIndex < line.length) {
      children.push(new TextRun({
        text: line.substring(lastIndex),
        bold,
        italic,
        size,
        color,
        font,
      }));
    }

    if (index < lines.length - 1) {
      children.push(new TextRun({ break: 1 }));
    }
  });

  return new Paragraph({
    alignment,
    spacing,
    children,
    keepNext,
    keepLines,
  });
}

function createPdfStyleField(label, value, isRight = false, fontSize = 18) {
  return new Paragraph({
    alignment: isRight ? AlignmentType.RIGHT : AlignmentType.LEFT,
    spacing: { before: 40, after: 40 },
    children: [
      new TextRun({
        text: label + " : ",
        size: fontSize,
        color: "4A5568", // Slate/gray label
        font: "Arial",
      }),
      new TextRun({
        text: value || "N/A",
        bold: true,
        size: fontSize,
        color: "000000", // Black bold value
        font: "Arial",
      }),
    ],
  });
}

/* ========================================================
   MAIN GENERATOR FUNCTION
   ======================================================== */
async function generateEstimateDocx(estimateId, req, docxType = "details") {
  try {
    /* ===== LOAD DATA ===== */
    const estimate = await Estimate.findById(estimateId).lean();
    if (!estimate) throw new Error("Estimate not found");

    let project = null;
    let customer = null;

    if (
      estimate.project_id &&
      mongoose.Types.ObjectId.isValid(estimate.project_id)
    ) {
      project = await Project.findById(estimate.project_id).lean();
      if (project?.customer_ids?.length) {
        customer = await Customer.findById(project.customer_ids[0]).lean();
      }
    }

    let createdByUser = null;
    if (estimate.created_by_user && mongoose.Types.ObjectId.isValid(estimate.created_by_user)) {
      createdByUser = await User.findById(estimate.created_by_user).lean();
      if (!createdByUser) {
        createdByUser = await Client.findById(estimate.created_by_user).lean();
      }
    }

    const quickCustomer = estimate.quick_customer || {};
    const client = estimate.created_by && mongoose.Types.ObjectId.isValid(estimate.created_by)
      ? await Client.findById(estimate.created_by).lean()
      : null;

    const divisionType = (project?.project_type || estimate?.division_type || estimate?.quick_customer?.division_type || "").trim();
    const divisionTerms = await getDivisionTerms({
      divisionType: divisionType,
      createdBy: estimate.created_by,
    });
    
    const divisionDisplayName = await getDivisionName(divisionType, estimate.created_by);
    const markupData = await getMarkup({ createdBy: estimate.created_by });
    const finalTerms = resolveFinalTerms({ estimate, divisionTerms, client });

    const createdByName = createdByUser?.full_name || [createdByUser?.firstName, createdByUser?.lastName].filter(Boolean).join(" ") || "N/A";
    const createdByEmail = createdByUser?.email || "N/A";

    const projectDisplayName = estimate?.is_quick_estimate
      ? (estimate?.quick_customer?.project_name || [estimate?.quick_customer?.company_name, estimate?.quick_customer?.customer_name].filter(Boolean).join(" - "))
      : (project?.project_name || "N/A");

    const customerCompanyName = customer?.company_name || quickCustomer.company_name || "N/A";
    const customerContactName = customer?.contact_name || quickCustomer.customer_name || "N/A";
    const customerAddress = (customer ? [customer.address, customer.city, customer.state, customer.zip_code].filter(Boolean).join(", ") : null) || quickCustomer.billing_address || quickCustomer.site_address || "N/A";
    const customerPhone = customer?.phone || quickCustomer.phone_number || "N/A";
    const customerEmail = customer?.email || quickCustomer.email_address || "N/A";

    const companyName = client?.companyName || "";
    const companyAddress = client?.address || "";
    const companyEmail = client?.email || "";
    const companyPhone = formatUSPhone(client?.companyPhone || "");

    const subtotalVal = formatCurrency(estimate.subtotal);
    const taxRateVal = ((estimate.tax_rate || 0) * 100).toFixed(1);
    const taxVal = formatCurrency(estimate.tax_amount);
    const totalVal = formatCurrency(estimate.total_amount);

    const docChildren = [];

    /* ===== CLIENT LOGO & HEADER ===== */
    let logoImage = null;
    let logoW = 120;
    if (client?.logo) {
      const logoBuffer = await getImageBuffer(client.logo);
      if (logoBuffer) {
        logoW = 120;
        let logoH = 50;
        const dims = getImageDimensions(logoBuffer);
        if (dims && dims.width && dims.height) {
          const ratio = dims.width / dims.height;
          if (ratio > 120 / 50) {
            logoW = 120;
            logoH = Math.round(120 / ratio);
          } else {
            logoH = 50;
            logoW = Math.round(50 * ratio);
          }
        }
        logoImage = new ImageRun({
          data: logoBuffer,
          transformation: {
            width: logoW,
            height: logoH,
          },
        });
      }
    }

    const leftCellChildren = [];
    if (logoImage) {
      // Create nested table for logo + client info side-by-side inside left cell
      const nestedHeaderTable = new Table({
        width: { size: 100, type: WidthType.AUTO },
        borders: {
          top: { style: BorderStyle.NONE },
          bottom: { style: BorderStyle.NONE },
          left: { style: BorderStyle.NONE },
          right: { style: BorderStyle.NONE },
          insideHorizontal: { style: BorderStyle.NONE },
          insideVertical: { style: BorderStyle.NONE },
        },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                verticalAlign: "center",
                children: [
                  new Paragraph({ children: [logoImage], spacing: { after: 0 } })
                ],
              }),
              new TableCell({
                verticalAlign: "center",
                children: [
                  createParagraph(companyName, { bold: true, size: 24, color: "FFFFFF" }),
                  createParagraph(companyAddress, { size: 18, color: "FFFFFF" }),
                  createParagraph(`${companyEmail} | ${companyPhone}`, { size: 18, color: "FFFFFF" }),
                ],
              }),
            ],
          }),
        ],
      });
      leftCellChildren.push(nestedHeaderTable);
    } else {
      leftCellChildren.push(createParagraph(companyName, { bold: true, size: 26, color: "FFFFFF" }));
      if (companyAddress) leftCellChildren.push(createParagraph(companyAddress, { size: 18, color: "FFFFFF" }));
      if (companyEmail || companyPhone) {
        leftCellChildren.push(createParagraph(`${companyEmail} | ${companyPhone}`, { size: 18, color: "FFFFFF" }));
      }
    }

    const rightCellChildren = [];
    if (docxType !== "crew") {
      const totalBoxTable = new Table({
        width: { size: 85, type: WidthType.PERCENTAGE },
        alignment: AlignmentType.RIGHT,
        borders: {
          top: { style: BorderStyle.SINGLE, size: 4, color: "0F5BA7" },
          bottom: { style: BorderStyle.SINGLE, size: 4, color: "0F5BA7" },
          left: { style: BorderStyle.SINGLE, size: 4, color: "0F5BA7" },
          right: { style: BorderStyle.SINGLE, size: 4, color: "0F5BA7" },
        },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                shading: { fill: "FFFFFF" },
                margins: { top: 120, bottom: 120, left: 150, right: 150 },
                children: [
                  createParagraph("Total Amount", { size: 18, color: "0F5BA7", alignment: AlignmentType.CENTER, spacing: { after: 30 } }),
                  createParagraph(`$${totalVal}`, { size: 24, color: "0F5BA7", bold: true, alignment: AlignmentType.CENTER, spacing: { after: 0 } }),
                ],
              }),
            ],
          }),
        ],
      });
      rightCellChildren.push(totalBoxTable);
    } else {
      // For crew view, we put ESTIMATE title inside right header cell
      rightCellChildren.push(createParagraph("ESTIMATE", { bold: true, size: 30, color: "FFFFFF", alignment: AlignmentType.RIGHT }));
    }

    const headerTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.NONE },
        bottom: { style: BorderStyle.NONE },
        left: { style: BorderStyle.NONE },
        right: { style: BorderStyle.NONE },
        insideHorizontal: { style: BorderStyle.NONE },
        insideVertical: { style: BorderStyle.NONE },
      },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: 68, type: WidthType.PERCENTAGE },
              shading: { fill: "0F5BA7" },
              margins: { top: 150, bottom: 150, left: 200, right: 150 },
              verticalAlign: "center",
              children: leftCellChildren,
            }),
            new TableCell({
              width: { size: 32, type: WidthType.PERCENTAGE },
              shading: { fill: "0F5BA7" },
              margins: { top: 150, bottom: 150, left: 150, right: 200 },
              verticalAlign: "center",
              children: rightCellChildren,
            }),
          ],
        }),
      ],
    });

    docChildren.push(headerTable);

    /* ===== SIDE-BY-SIDE INFORMATION SECTION ===== */
    const leftDetails = [
      createParagraph("Project Information", { bold: true, size: 20, color: "0F5BA7", spacing: { before: 100, after: 150 } }),
      createPdfStyleField("Project Name", projectDisplayName),
      createPdfStyleField("Company Name", customerCompanyName),
      createPdfStyleField("Contact Name", customerContactName),
      createPdfStyleField("Company Email", customerEmail),
      createPdfStyleField("Company Phone Number", customerPhone),
      createPdfStyleField("Site Address", project?.location || quickCustomer?.site_address || "N/A", false),
    ];

    const rightDetails = [
      createParagraph("Estimate", { bold: true, size: 20, color: "0F5BA7", alignment: AlignmentType.RIGHT, spacing: { before: 100, after: 150 } }),
      createPdfStyleField("Estimate Number", estimate.estimate_number, true),
      createPdfStyleField("Created Date", estimate?.createdAt ? formatDateUS(new Date(estimate.createdAt), "dd/MM/yyyy") : "N/A", true),
      createPdfStyleField("Created By", createdByName, true),
      createPdfStyleField("Email", createdByEmail, true),
      createPdfStyleField("Division", divisionDisplayName, true),
      createPdfStyleField("Billing Address", customerAddress, true),
    ];

    const detailsGridTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.NONE },
        bottom: { style: BorderStyle.NONE },
        left: { style: BorderStyle.NONE },
        right: { style: BorderStyle.NONE },
        insideHorizontal: { style: BorderStyle.NONE },
        insideVertical: { style: BorderStyle.NONE },
      },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: 50, type: WidthType.PERCENTAGE },
              margins: { left: 0, right: 100 },
              children: leftDetails,
            }),
            new TableCell({
              width: { size: 50, type: WidthType.PERCENTAGE },
              margins: { left: 100, right: 0 },
              children: rightDetails,
            }),
          ],
        }),
      ],
    });

    docChildren.push(detailsGridTable);

    // Full-width address fields removed to return them to side-by-side layout

    /* ===== LINE ITEMS TABLE ===== */
    docChildren.push(createParagraph("Line Items", { bold: true, size: 20, color: "0F5BA7", spacing: { before: 120, after: 80 } }));

    // Define table columns
    const columns = [];
    let tableHeaderRow = null;

    if (docxType === "summary") {
      // 2 Columns: Category (25%), Description (75%)
      columns.push({ size: 25, type: WidthType.PERCENTAGE });
      columns.push({ size: 75, type: WidthType.PERCENTAGE });
      tableHeaderRow = new TableRow({
        children: [
          new TableCell({
            width: columns[0],
            shading: { fill: "1E87C8" },
            margins: { top: 120, bottom: 120, left: 120, right: 120 },
            children: [createParagraph("Category", { bold: true, color: "FFFFFF", size: 18 })],
          }),
          new TableCell({
            width: columns[1],
            shading: { fill: "1E87C8" },
            margins: { top: 120, bottom: 120, left: 120, right: 120 },
            children: [createParagraph("Description", { bold: true, color: "FFFFFF", size: 18 })],
          }),
        ],
      });
    } else if (docxType === "crew") {
      // 3 Columns: Category (20%), Description (65%), Quantity (15%)
      columns.push({ size: 20, type: WidthType.PERCENTAGE });
      columns.push({ size: 65, type: WidthType.PERCENTAGE });
      columns.push({ size: 15, type: WidthType.PERCENTAGE });
      tableHeaderRow = new TableRow({
        children: [
          new TableCell({
            width: columns[0],
            shading: { fill: "1E87C8" },
            margins: { top: 120, bottom: 120, left: 120, right: 120 },
            children: [createParagraph("Category", { bold: true, color: "FFFFFF", size: 18 })],
          }),
          new TableCell({
            width: columns[1],
            shading: { fill: "1E87C8" },
            margins: { top: 120, bottom: 120, left: 120, right: 120 },
            children: [createParagraph("Description", { bold: true, color: "FFFFFF", size: 18 })],
          }),
          new TableCell({
            width: columns[2],
            shading: { fill: "1E87C8" },
            margins: { top: 120, bottom: 120, left: 120, right: 120 },
            children: [createParagraph("Quantity", { bold: true, color: "FFFFFF", size: 18, alignment: AlignmentType.CENTER })],
          }),
        ],
      });
    } else {
      // "details" -> 3 Columns: Category (20%), Description (60%), Total (20%)
      columns.push({ size: 20, type: WidthType.PERCENTAGE });
      columns.push({ size: 60, type: WidthType.PERCENTAGE });
      columns.push({ size: 20, type: WidthType.PERCENTAGE });
      tableHeaderRow = new TableRow({
        children: [
          new TableCell({
            width: columns[0],
            shading: { fill: "1E87C8" },
            margins: { top: 120, bottom: 120, left: 120, right: 120 },
            children: [createParagraph("Category", { bold: true, color: "FFFFFF", size: 18 })],
          }),
          new TableCell({
            width: columns[1],
            shading: { fill: "1E87C8" },
            margins: { top: 120, bottom: 120, left: 120, right: 120 },
            children: [createParagraph("Description", { bold: true, color: "FFFFFF", size: 18 })],
          }),
          new TableCell({
            width: columns[2],
            shading: { fill: "1E87C8" },
            margins: { top: 120, bottom: 120, left: 120, right: 120 },
            children: [createParagraph("Total", { bold: true, color: "FFFFFF", size: 18, alignment: AlignmentType.RIGHT })],
          }),
        ],
      });
    }

    const tableRows = [tableHeaderRow];
    const cellBorders = {
      top: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
      left: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
      right: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
    };

    for (const item of (estimate.line_items || [])) {
      const categoryName = await getCategoryName(item.category, estimate.created_by);
      const displayCategory = capitalizeFirst(categoryName);
      const displayDesc = capitalizeFirst(item.description);

      if (item.is_section) {
        const colSpan = docxType === "summary" ? 2 : 3;
        tableRows.push(
          new TableRow({
            children: [
              new TableCell({
                columnSpan: colSpan,
                shading: { fill: "F1F5F9" },
                borders: cellBorders,
                margins: { top: 120, bottom: 120, left: 120, right: 120 },
                children: [createParagraph(displayDesc, { bold: true, size: 18, color: "000000" })],
              }),
            ],
          })
        );
        continue;
      }

      if (docxType === "summary") {
        tableRows.push(
          new TableRow({
            children: [
              new TableCell({
                width: columns[0],
                borders: cellBorders,
                margins: { top: 100, bottom: 100, left: 120, right: 120 },
                children: [createParagraph(displayCategory, { size: 18 })],
              }),
              new TableCell({
                width: columns[1],
                borders: cellBorders,
                margins: { top: 100, bottom: 100, left: 120, right: 120 },
                children: [createParagraph(displayDesc, { size: 18 })],
              }),
            ],
          })
        );
      } else if (docxType === "crew") {
        tableRows.push(
          new TableRow({
            children: [
              new TableCell({
                width: columns[0],
                borders: cellBorders,
                margins: { top: 100, bottom: 100, left: 120, right: 120 },
                children: [createParagraph(displayCategory, { size: 18 })],
              }),
              new TableCell({
                width: columns[1],
                borders: cellBorders,
                margins: { top: 100, bottom: 100, left: 120, right: 120 },
                children: [createParagraph(displayDesc, { size: 18 })],
              }),
              new TableCell({
                width: columns[2],
                borders: cellBorders,
                margins: { top: 100, bottom: 100, left: 120, right: 120 },
                children: [createParagraph(item.quantity?.toString() || "0", { size: 18, alignment: AlignmentType.CENTER })],
              }),
            ],
          })
        );
      } else {
        // "details"
        tableRows.push(
          new TableRow({
            children: [
              new TableCell({
                width: columns[0],
                borders: cellBorders,
                margins: { top: 100, bottom: 100, left: 120, right: 120 },
                children: [createParagraph(displayCategory, { size: 18 })],
              }),
              new TableCell({
                width: columns[1],
                borders: cellBorders,
                margins: { top: 100, bottom: 100, left: 120, right: 120 },
                children: [createParagraph(displayDesc, { size: 18 })],
              }),
              new TableCell({
                width: columns[2],
                borders: cellBorders,
                margins: { top: 100, bottom: 100, left: 120, right: 120 },
                children: [createParagraph(`$${formatCurrency(item.total)}`, { size: 18, alignment: AlignmentType.RIGHT })],
              }),
            ],
          })
        );
      }
    }

    const itemsTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
        left: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
        right: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: "E2E8F0" },
        insideVertical: { style: BorderStyle.SINGLE, size: 2, color: "E2E8F0" },
      },
      rows: tableRows,
    });

    docChildren.push(itemsTable);
    docChildren.push(new Paragraph({ spacing: { before: 60, after: 60 } }));

    /* ===== SIGNATURE & SUMMARY SIDE-BY-SIDE SECTION ===== */
    let signatureUrl = [...(estimate.file_attachments || [])].reverse().find(f => f.file_name?.includes('signature') || f.file_url?.includes('e-signature'))?.file_url;
    let signatureImage = null;

    if (estimate.status === 'approved' && signatureUrl) {
      if (signatureUrl.includes('/uploads/')) {
        const pathPart = signatureUrl.substring(signatureUrl.indexOf('/uploads/'));
        signatureUrl = `${req.protocol}://${req.get("host")}${pathPart}`;
      }
      const sigBuffer = await getImageBuffer(signatureUrl);
      if (sigBuffer) {
        signatureImage = new ImageRun({
          data: sigBuffer,
          transformation: {
            width: 150,
            height: 60,
          },
        });
      }
    }

    const signatureBoxChildren = [];
    if (signatureImage) {
      signatureBoxChildren.push(new Paragraph({ children: [signatureImage], alignment: AlignmentType.CENTER }));
    } else {
      const spacingBefore = docxType === "crew" ? 500 : 850;
      signatureBoxChildren.push(new Paragraph({ text: "", spacing: { before: spacingBefore } })); // Blank height
    }

    const signatureBoxTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 2, color: "CBD5E1" },
        bottom: { style: BorderStyle.SINGLE, size: 2, color: "CBD5E1" },
        left: { style: BorderStyle.SINGLE, size: 2, color: "CBD5E1" },
        right: { style: BorderStyle.SINGLE, size: 2, color: "CBD5E1" },
      },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: 100, type: WidthType.PERCENTAGE },
              shading: { fill: "F9F9F9" },
              margins: { top: 120, bottom: 120, left: 120, right: 120 },
              children: signatureBoxChildren,
            }),
          ],
        }),
      ],
    });

    const leftColChildren = [
      signatureBoxTable
    ];

    const rightColChildren = [];
    if (docxType !== "crew") {
      const summaryRows = [];

      if (docxType === "details") {
        if (estimate.material_markup_amount) {
          summaryRows.push(
            new TableRow({
              children: [
                new TableCell({
                  width: { size: 60, type: WidthType.PERCENTAGE },
                  shading: { fill: "F0F0F0" },
                  margins: { top: 100, bottom: 100, left: 150, right: 150 },
                  children: [createParagraph(markupData?.value || "Markup", { size: 18, bold: true, color: "333333" })],
                }),
                new TableCell({
                  width: { size: 40, type: WidthType.PERCENTAGE },
                  shading: { fill: "F0F0F0" },
                  margins: { top: 100, bottom: 100, left: 150, right: 150 },
                  children: [createParagraph(`$${formatCurrency(estimate.material_markup_amount)}`, { size: 18, alignment: AlignmentType.RIGHT })],
                }),
              ],
            })
          );
        }

        summaryRows.push(
          new TableRow({
            children: [
              new TableCell({
                width: { size: 60, type: WidthType.PERCENTAGE },
                shading: { fill: "F0F0F0" },
                margins: { top: 100, bottom: 100, left: 150, right: 150 },
                children: [createParagraph("Subtotal :", { size: 18, bold: true, color: "333333" })],
              }),
              new TableCell({
                width: { size: 40, type: WidthType.PERCENTAGE },
                shading: { fill: "F0F0F0" },
                margins: { top: 100, bottom: 100, left: 150, right: 150 },
                children: [createParagraph(`$${subtotalVal}`, { size: 18, alignment: AlignmentType.RIGHT })],
              }),
            ],
          })
        );

        summaryRows.push(
          new TableRow({
            children: [
              new TableCell({
                width: { size: 60, type: WidthType.PERCENTAGE },
                shading: { fill: "F0F0F0" },
                margins: { top: 100, bottom: 100, left: 150, right: 150 },
                children: [createParagraph(`Tax (${taxRateVal}%) :`, { size: 18, bold: true, color: "333333" })],
              }),
              new TableCell({
                width: { size: 40, type: WidthType.PERCENTAGE },
                shading: { fill: "F0F0F0" },
                margins: { top: 100, bottom: 100, left: 150, right: 150 },
                children: [createParagraph(`$${taxVal}`, { size: 18, alignment: AlignmentType.RIGHT })],
              }),
            ],
          })
        );
      }

      // Total Row with darker background (D9D9D9)
      summaryRows.push(
        new TableRow({
          children: [
            new TableCell({
              width: { size: 60, type: WidthType.PERCENTAGE },
              shading: { fill: "D9D9D9" },
              margins: { top: 140, bottom: 140, left: 150, right: 150 },
              children: [createParagraph("Total :", { size: 20, bold: true, color: "000000" })],
            }),
            new TableCell({
              width: { size: 40, type: WidthType.PERCENTAGE },
              shading: { fill: "D9D9D9" },
              margins: { top: 140, bottom: 140, left: 150, right: 150 },
              children: [createParagraph(`$${totalVal}`, { size: 20, bold: true, color: "000000", alignment: AlignmentType.RIGHT })],
            }),
          ],
        })
      );

      const summaryTable = new Table({
        width: { size: 90, type: WidthType.PERCENTAGE },
        alignment: AlignmentType.RIGHT,
        borders: {
          top: { style: BorderStyle.NONE },
          bottom: { style: BorderStyle.NONE },
          left: { style: BorderStyle.NONE },
          right: { style: BorderStyle.NONE },
          insideHorizontal: { style: BorderStyle.NONE },
          insideVertical: { style: BorderStyle.NONE },
        },
        rows: summaryRows,
      });
      
      rightColChildren.push(summaryTable);
    }

    const footerTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.NONE },
        bottom: { style: BorderStyle.NONE },
        left: { style: BorderStyle.NONE },
        right: { style: BorderStyle.NONE },
        insideHorizontal: { style: BorderStyle.NONE },
        insideVertical: { style: BorderStyle.NONE },
      },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: 50, type: WidthType.PERCENTAGE },
              children: [],
            }),
            new TableCell({
              width: { size: 50, type: WidthType.PERCENTAGE },
              children: rightColChildren,
            }),
          ],
        }),
      ],
    });

    docChildren.push(footerTable);
    docChildren.push(new Paragraph({ spacing: { before: 80, after: 80 } }));

    /* ===== NOTES, SCOPE & TERMS ===== */
    if (estimate.notes && docxType === "crew") {
      docChildren.push(createParagraph("Notes", { bold: true, size: 20, color: "0F5BA7", spacing: { before: 150, after: 100 } }));
      docChildren.push(...parseHtmlToDocxParagraphs(estimate.notes, { size: 18, color: "000000", spacing: { before: 40, after: 100 } }));
    }

    if (estimate.Scope_of_work) {
      docChildren.push(createParagraph("Scope of Work", { bold: true, size: 20, color: "0F5BA7", spacing: { before: 150, after: 100 } }));
      docChildren.push(...parseHtmlToDocxParagraphs(estimate.Scope_of_work, { size: 18, color: "000000", spacing: { before: 40, after: 100 } }));
    }

    if (docxType !== "crew" && finalTerms) {
      docChildren.push(createParagraph("Terms and Conditions", { bold: true, size: 20, color: "0F5BA7", spacing: { before: 150, after: 100 } }));
      docChildren.push(...parseHtmlToDocxParagraphs(finalTerms, { size: 18, color: "000000", spacing: { before: 40, after: 100 } }));
    }

    /* ===== CUSTOMER SIGNATURE ===== */
    const finalSignatureTable = new Table({
      width: { size: 50, type: WidthType.PERCENTAGE },
      alignment: AlignmentType.RIGHT,
      borders: {
        top: { style: BorderStyle.NONE },
        bottom: { style: BorderStyle.NONE },
        left: { style: BorderStyle.NONE },
        right: { style: BorderStyle.NONE },
        insideHorizontal: { style: BorderStyle.NONE },
        insideVertical: { style: BorderStyle.NONE },
      },
      rows: [
        new TableRow({
          cantSplit: true,
          children: [
            new TableCell({
              width: { size: 100, type: WidthType.PERCENTAGE },
              children: [
                (estimate.status === 'approved' && estimate.approved_date) ? (() => {
                  let tz = process.env.APP_TIMEZONE ;
                  let formatted = '';
                  try { formatted = new Date(estimate.approved_date).toLocaleString('en-US', { timeZone: tz, month: '2-digit', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }); }
                  catch (e) { formatted = new Date(estimate.approved_date).toLocaleString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }); }
                  return new Paragraph({
                    tabStops: [{ type: "right", position: 6000 }],
                    spacing: { before: 200, after: 80 },
                    children: [
                      new TextRun({ text: "Customer Signature ", bold: true, size: 20, color: "0F5BA7" }),
                      new TextRun({ text: "\t" }),
                      new TextRun({ text: `Approved on: ${formatted}`, size: 20, color: "555555" })
                    ]
                  });
                })() : createParagraph("Customer Signature ", { bold: true, size: 20, color: "0F5BA7", spacing: { before: 200, after: 80 }, keepNext: true, keepLines: true }),
                signatureBoxTable,
              ],
            }),
          ],
        }),
      ],
    });

    docChildren.push(finalSignatureTable);

    /* ===== DOCUMENT PACKING ===== */
    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: 432,    // 0.3 inches
                bottom: 432, // 0.3 inches
                left: 432,   // 0.3 inches
                right: 432,  // 0.3 inches
              }
            }
          },
          children: docChildren,
        },
      ],
    });

    return await Packer.toBuffer(doc);

  } catch (error) {
    console.error("DOCX generator error:", error);
    throw error;
  }
}

module.exports = { generateEstimateDocx };
