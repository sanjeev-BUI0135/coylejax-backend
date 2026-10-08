const mongoose = require("mongoose");
const User = require("../models/User");
const Client = require("../models/Client");
const sendMail = require("../utils/sendMail");
const paymentReceiptMail = require("../utils/paymentReceiptMail");
const { getPaymentRecipients } = require("../helpers/getPaymentRecipients");


async function sendPaymentReceiptEmails({
  creatorId,
  customerEmail,
  customerName,
  paymentRecord,
  methodLabel = "Card",
  transactionId,
  amount,
  isPublicPayment = false,
}) {
  if (!paymentRecord) return;

  try {
    let creator = null;
    if (creatorId && mongoose.Types.ObjectId.isValid(creatorId)) {
      creator = await Client.findById(creatorId).lean() || await User.findById(creatorId).lean();
    }
    if (!creator) {
      creator = await Client.findOne().lean() || await User.findOne({ role_type: "admin" }).lean();
    }

    // Company branding fallback
    if (!creator?.companyName || !creator?.logo) {
      const companyClient = await Client.findOne().lean();
      if (companyClient) {
        creator = {
          ...creator,
          companyName: creator?.companyName || companyClient.companyName || "George P. Coyle & Sons",
          companyPhone: creator?.companyPhone || companyClient.companyPhone,
          logo: creator?.logo || companyClient.logo,
          address: creator?.address || companyClient.address,
        };
      }
    }

    const compName = creator?.companyName || creator?.full_name || "George P. Coyle & Sons";
    const downloadBase = process.env.APP_URL || process.env.BACKEND_URL || process.env.BASE_URL || "http://localhost:3001";
    const downloadLink = `${downloadBase}/api/download-payment-receipt/${paymentRecord._id}`;
    const txId = transactionId || paymentRecord.reference_number || paymentRecord._id.toString();
    const payAmt = amount !== undefined ? amount : paymentRecord.amount;
    const payDate = paymentRecord.payment_date || paymentRecord.createdAt || new Date();
    const custName = customerName || paymentRecord.customer_name || paymentRecord.company_name || "Valued Customer";

    // Format payment method display
    const isAch = methodLabel?.toLowerCase().includes("ach") || methodLabel?.toLowerCase().includes("us_bank");
    const displayMethod = isAch ? "ACH Bank Transfer" : "Credit Card";

    // Generate branded HTML receipt
    const receiptHtml = paymentReceiptMail(
      custName,
      payAmt,
      displayMethod,
      payDate,
      txId,
      downloadLink,
      creator
    );

    // 1. Always send receipt to the customer
    const cleanCustEmail = (customerEmail || paymentRecord.customer_email || "").trim();
    if (cleanCustEmail) {
      try {
        await sendMail({
          from: compName,
          replyTo: creator?.email,
          to: cleanCustEmail,
          subject: `Payment Receipt - ${compName}`,
          html: receiptHtml,
        });
      } catch (custErr) {
        console.error(`[ReceiptEmailService] Customer receipt delivery error:`, custErr.message);
      }
    } else {
      console.warn(`[ReceiptEmailService] No customer email — skipping customer receipt.`);
    }

    // 2. Customer Payment Alert — ONLY for public payment link payments
    if (!isPublicPayment) {
      return;
    }

    try {
      const staffRecipients = await getPaymentRecipients(creatorId || creator?._id);
      const staffEmails = [...new Set(staffRecipients.map((r) => r.email).filter(Boolean))];

      if (staffEmails.length === 0) {
        return;
      }

      for (const email of staffEmails) {
        try {
          await sendMail({
            from: compName,
            replyTo: creator?.email,
            to: email,
            subject: `Customer Payment Alert - ${compName} - $${payAmt}`,
            html: receiptHtml,
          });
        } catch (staffErr) {
          console.error(`[ReceiptEmailService] Alert delivery error for ${email}:`, staffErr.message);
        }
      }
    } catch (alertErr) {
      console.error(`[ReceiptEmailService] Customer Payment Alert error:`, alertErr.message);
    }
  } catch (err) {
    console.error(`[ReceiptEmailService] Error:`, err.message);
  }
}

module.exports = {
  sendPaymentReceiptEmails,
};
