const express = require("express");
const router = express.Router();
const puppeteer = require("puppeteer");
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");

const Invoice = require("../models/Invoice");
const Project = require("../models/Project");
const Customer = require("../models/Customer");
const Payment = require("../models/Payment");
const MasterData = require("../models/MasterData");
const Client = require("../models/Client");
const { generateInvoicePdf } = require("../functions/generateInvoicePdf");
const { generatePaidInvoicePDF } = require("../functions/downloadPaidInvoice");
const { generatePaymentReceiptPdf } = require("../functions/downloadPaymentReceipt");
const User = require("../models/User");


/* =========================
   ROUTES
========================= */

// Public invoice download
router.get("/download-invoice-public/:token", async (req, res) => {
  try {
    const invoice = await Invoice.findOne({ public_share_token: req.params.token });
    if (!invoice) return res.status(404).send("Invoice not found");

    let pdf_type = req.query.type || "details";
    const sig = req.query.sig;

    if (sig) {
      const crypto = require('crypto');
      const urlType = pdf_type === 'summary' ? 's' : 'd';
      const expectedSig = crypto.createHmac('sha256', process.env.JWT_SECRET || 'secret')
                                .update(`${req.params.token}:${urlType}`)
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

    const pdfBuffer = await generateInvoicePdf(invoice._id, req, pdf_type);

    res.setHeader("Content-Disposition", `attachment; filename=Invoice-${invoice.invoice_number || invoice._id}-${pdf_type}.pdf`);
    res.setHeader("Content-Type", "application/pdf");
    res.send(Buffer.from(pdfBuffer));
  } catch (err) {
    console.error("Public Invoice PDF Error:", err);
    res.status(500).send("Error generating public invoice PDF");
  }
});

// Admin download
router.get("/download-invoice/:invoiceId", async (req, res) => {
  const invoice = await Invoice.findById(req.params.invoiceId);
  if (!invoice) return res.status(404).send("Invoice not found");
  await generatePaidInvoicePDF(invoice, req, res);
});

// Download Payment Receipt PDF
router.get('/download-payment-receipt/:id', async (req, res) => {
  try {
    const { pdfBuffer, payment } = await generatePaymentReceiptPdf(req.params.id, req);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Receipt-${payment._id.toString().substring(18, 24).toUpperCase()}.pdf"`);
    res.send(Buffer.from(pdfBuffer));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
