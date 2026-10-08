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

const Invoice = require("../models/Invoice");
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
    .replace(/<p>&nbsp;<\/p>/gi, "<br/>");
  
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
      else if (tag.startsWith('<s') || tag.startsWith('<del') || tag.includes('line-through')) isStrike = true;
      else if (tag.startsWith('</s') || tag.startsWith('</del') || tag.startsWith('</span')) isStrike = false;
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
async function generateInvoiceDocx(invoiceId, req, docxType = "details") {
  try {
    /* ===== LOAD DATA ===== */
    const invoice = await Invoice.findById(invoiceId).lean();
    if (!invoice) throw new Error("Invoice not found");

    const project = await Project.findById(invoice.project_id).lean();
    const customer = project?.customer_ids?.length
      ? await Customer.findById(project.customer_ids[0]).lean()
      : null;

    let createdByUser = null;
    if (invoice.created_by_user && mongoose.Types.ObjectId.isValid(invoice.created_by_user)) {
      createdByUser = await User.findById(invoice.created_by_user).lean();
      if (!createdByUser) {
        createdByUser = await Client.findById(invoice.created_by_user).lean();
      }
    }

    const client = invoice.created_by && mongoose.Types.ObjectId.isValid(invoice.created_by)
      ? await Client.findById(invoice.created_by).lean()
      : null;

    const divisionTerms = await getDivisionTerms({
      divisionType: project?.project_type,
      createdBy: invoice.created_by,
    });
    
    const divisionDisplayName = await getDivisionName(project?.project_type, invoice.created_by);
    const markupData = await getMarkup({ createdBy: invoice.created_by });
    const finalTerms = resolveFinalTerms({ divisionTerms, client });

    const createdByName = createdByUser?.full_name || [createdByUser?.firstName, createdByUser?.lastName].filter(Boolean).join(" ") || "N/A";
    const createdByEmail = createdByUser?.email || "N/A";

    const projectDisplayName = project?.project_name || "N/A";

    const customerCompanyName = customer?.company_name || "N/A";
    const customerContactName = customer?.contact_name || "N/A";
    const customerAddress = customer ? [customer.address, customer.city, customer.state, customer.zip_code].filter(Boolean).join(", ") : "N/A";
    const customerPhone = customer?.phone || "N/A";
    const customerEmail = customer?.email || "N/A";

    const companyName = client?.companyName || "";
    const companyAddress = client?.address || "";
    const companyEmail = client?.email || "";
    const companyPhone = formatUSPhone(client?.companyPhone || "");

    const subtotalVal = formatCurrency(invoice.subtotal);
    const taxRateVal = ((invoice.tax_rate || 0) * 100).toFixed(1);
    const taxVal = formatCurrency(invoice.tax_amount);
    const totalVal = formatCurrency(invoice.total_amount);
    const balanceDue = (invoice.total_amount || 0) - (invoice.amount_paid || 0);

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
      createPdfStyleField("Site Address", project?.location || "N/A", false),
    ];

    const rightDetails = [
      createParagraph("Invoice", { bold: true, size: 20, color: "0F5BA7", alignment: AlignmentType.RIGHT, spacing: { before: 100, after: 150 } }),
      createPdfStyleField("Invoice Number", invoice.invoice_number, true),
      createPdfStyleField("Created Date", invoice.issue_date ? formatDateUS(new Date(invoice.issue_date), "dd/MM/yyyy") : "N/A", true),
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

    const columns = [];
    let tableHeaderRow = null;

    if (docxType === "summary") {
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
    } else {
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

    for (const item of (invoice.line_items || [])) {
      const categoryName = await getCategoryName(item.category, invoice.created_by);
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
      } else {
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

    /* ===== SUMMARY SECTION ===== */
    const summaryRows = [];

    if (docxType === "details") {
      if (invoice.material_markup_amount) {
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
                children: [createParagraph(`$${formatCurrency(invoice.material_markup_amount)}`, { size: 18, alignment: AlignmentType.RIGHT })],
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

    // Total Row (D9D9D9)
    summaryRows.push(
      new TableRow({
        children: [
          new TableCell({
            width: { size: 60, type: WidthType.PERCENTAGE },
            shading: { fill: "D9D9D9" },
            margins: { top: 120, bottom: 120, left: 150, right: 150 },
            children: [createParagraph("Total :", { size: 20, bold: true, color: "000000" })],
          }),
          new TableCell({
            width: { size: 40, type: WidthType.PERCENTAGE },
            shading: { fill: "D9D9D9" },
            margins: { top: 120, bottom: 120, left: 150, right: 150 },
            children: [createParagraph(`$${totalVal}`, { size: 20, bold: true, color: "000000", alignment: AlignmentType.RIGHT })],
          }),
        ],
      })
    );

    // Amount Paid (F0F0F0)
    summaryRows.push(
      new TableRow({
        children: [
          new TableCell({
            width: { size: 60, type: WidthType.PERCENTAGE },
            shading: { fill: "F0F0F0" },
            margins: { top: 100, bottom: 100, left: 150, right: 150 },
            children: [createParagraph("Amount Paid", { size: 18, bold: true, color: "333333" })],
          }),
          new TableCell({
            width: { size: 40, type: WidthType.PERCENTAGE },
            shading: { fill: "F0F0F0" },
            margins: { top: 100, bottom: 100, left: 150, right: 150 },
            children: [createParagraph(`$${formatCurrency(invoice.amount_paid || 0)}`, { size: 18, alignment: AlignmentType.RIGHT })],
          }),
        ],
      })
    );

    // Balance Due (F0F0F0, bold)
    summaryRows.push(
      new TableRow({
        children: [
          new TableCell({
            width: { size: 60, type: WidthType.PERCENTAGE },
            shading: { fill: "F0F0F0" },
            margins: { top: 100, bottom: 100, left: 150, right: 150 },
            children: [createParagraph("Balance Due", { size: 18, bold: true, color: "000000" })],
          }),
          new TableCell({
            width: { size: 40, type: WidthType.PERCENTAGE },
            shading: { fill: "F0F0F0" },
            margins: { top: 100, bottom: 100, left: 150, right: 150 },
            children: [createParagraph(`$${formatCurrency(balanceDue)}`, { size: 18, bold: true, color: "000000", alignment: AlignmentType.RIGHT })],
          }),
        ],
      })
    );

    const summaryTable = new Table({
      width: { size: 45, type: WidthType.PERCENTAGE },
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

    docChildren.push(summaryTable);
    docChildren.push(new Paragraph({ spacing: { before: 80, after: 80 } }));

    if (invoice.Scope_of_work) {
      docChildren.push(createParagraph("Scope of Work", { bold: true, size: 20, color: "0F5BA7", spacing: { before: 150, after: 100 } }));
      docChildren.push(...parseHtmlToDocxParagraphs(invoice.Scope_of_work, { size: 18, color: "000000", spacing: { before: 40, after: 100 } }));
    }

    if (finalTerms) {
      docChildren.push(createParagraph("Terms and Conditions", { bold: true, size: 20, color: "0F5BA7", spacing: { before: 150, after: 100 } }));
      docChildren.push(...parseHtmlToDocxParagraphs(finalTerms, { size: 18, color: "000000", spacing: { before: 40, after: 100 } }));
    }

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

module.exports = { generateInvoiceDocx };
