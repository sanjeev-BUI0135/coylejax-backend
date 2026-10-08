const formatUSPhone = require("../helpers/formatUSPhone");
const { formatDateUS } = require("./dateformat");

const BASE_URL = process.env.BASE_URL || process.env.APP_URL || "http://localhost:5173";

function formatNoAutoLink(val) {
  if (val === undefined || val === null || val === '') return 'N/A';
  const str = String(val);
  if (str === 'N/A') return 'N/A';
  return str.replace(/(.{3})/g, '$1&zwnj;');
}

function adminEmailTemplate(invoice, payment, transaction, customer, creator) {
  const dateStr = payment?.payment_date
    ? formatDateUS(payment.payment_date)
    : (payment?.createdAt ? formatDateUS(payment.createdAt) : "N/A");

  const amountPaid = Number(transaction?.amount_received ?? payment?.amount ?? 0).toFixed(2);
  const companyName = creator?.companyName || creator?.full_name || "Admin";
  const contactName = customer?.contact_name || customer?.company_name || customer?.customer_name || "N/A";
  const invoiceNum = invoice?.invoice_number || payment?.invoice_number || "N/A";
  const paymentMethod = transaction?.payment_method || payment?.payment_method || "Card";
  const transactionId = transaction?.payment_intent || payment?.reference_number || "N/A";
  const phone = formatUSPhone(creator?.companyPhone || creator?.phone);
  const email = creator?.email || "";
  const address = creator?.address || "";
  const invoiceId = invoice?._id || payment?.invoice_id;
  const downloadUrl = invoiceId ? `${BASE_URL}/api/download-invoice/${invoiceId}` : "#";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="format-detection" content="telephone=no">
  <title>Payment Received</title>
  <style>
    a[x-apple-data-detectors], a[href^="tel"] {
      color: inherit !important;
      text-decoration: none !important;
      font-size: inherit !important;
      font-family: inherit !important;
      font-weight: inherit !important;
      line-height: inherit !important;
    }
  </style>
</head>
<body style="margin:0; padding:0; background-color:#f4f4f4; font-family: Arial, sans-serif;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%">
    ${creator?.logo ? `
    <tr>
      <td align="center" style="padding: 30px 20px 10px;">
        <img src="${BASE_URL}/${creator.logo}"
           alt="Company Logo"
           width="200"
           style="max-width:200px; height:auto; display:block; margin-bottom:20px; border:0; outline:none; text-decoration:none;">
      </td>
    </tr>` : ''}
      
    <tr>
      <td align="center" bgcolor="#f4f4f4" style="padding: 20px;">
        <table border="0" cellpadding="0" cellspacing="0" width="600" style="background:#ffffff; border-radius:8px; box-shadow:0 2px 6px rgba(0,0,0,0.1);">
          
          <tr>
            <td align="center" style="padding: 30px 20px 10px;">
              <img src="https://coylejax.app/icon_2.png"
                  alt="List Image"
                  width="100%"
                  style="max-width:600px; height:auto; display:block; border:0; outline:none; text-decoration:none;">
            </td>
          </tr>

          <tr>   
            <td style="padding: 20px 30px; font-size:16px; line-height:24px; color:#333;">
              <p>Dear <b>${companyName}</b>,</p>
              <p>A new payment has been received.</p>
              
              <p style="margin:16px 0 8px 0; font-weight:bold;">Payment Details:</p>
              <ul style="margin:0; padding-left:20px;">
                <li>Contact Name: <b>${contactName}</b></li>
                <li>Invoice Number: <b>${invoiceNum}</b></li>
                <li>Amount Paid: <b>$${amountPaid}</b></li>
                <li>Payment Method: <b>${paymentMethod}</b></li>
                <li>Date: <b>${dateStr}</b></li>
                <li>Transaction ID: <b style="color: #333333;"><span style="color: #333333; text-decoration: none;">${formatNoAutoLink(transactionId)}</span></b></li>
              </ul>
            </td>
          </tr> 

          ${invoiceId ? `
          <tr>
            <td align="center" style="padding: 10px 30px 20px;">
              <a href="${downloadUrl}" target="_blank" 
                style="background-color:#0056d2; color:#ffffff; padding:12px 24px; border-radius:6px; font-size:16px; font-weight:bold; text-decoration:none; display:inline-block;">
                Download Invoice
              </a>
            </td>
          </tr>` : ''}

           <hr style="margin:20px 0; border:0; border-top:1px solid #ddd;"/>

          <tr>
            <td style="padding: 0 30px 30px; font-size:14px; color:#333;">
              <p>Regards,</p>
              <p><b>${companyName}</b></p>
            </td>
          </tr>
        </table>

        <!-- Footer Table -->
        <table border="0" cellpadding="0" cellspacing="0" width="600" style="margin-top:10px;">
          <tr>
            <td align="center" style="padding: 20px; font-size:12px; color:#555;">
              ${address ? `<p style="margin:2px;">${address}</p>` : ''}
              <p style="margin:2px;">
                ${phone && phone !== 'N/A' ? `<a href="tel:${phone}" style="color:#0056d2; text-decoration:none;">${phone}</a> | ` : ''}
                ${email ? `<a href="mailto:${email}" style="color:#0056d2; text-decoration:none;">${email}</a>` : ''}
              </p>
              <p style="margin:2px;">Copyright © ${new Date().getFullYear()} ${companyName}</p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}

function customerEmailTemplate(invoice, payment, transaction, customer, creator) {
  const dateStr = payment?.payment_date
    ? formatDateUS(payment.payment_date)
    : (payment?.createdAt ? formatDateUS(payment.createdAt) : "N/A");

  const amountPaid = Number(transaction?.amount_received ?? payment?.amount ?? 0).toFixed(2);
  const companyName = creator?.companyName || creator?.full_name || "Our Company";
  const customerName = customer?.contact_name || customer?.company_name || customer?.contactName || customer?.companyName || "Valued Customer";
  const invoiceNum = invoice?.invoice_number || payment?.invoice_number || "N/A";
  const paymentMethod = transaction?.payment_method || payment?.payment_method || "Card";
  const transactionId = transaction?.payment_intent || payment?.reference_number || "N/A";
  const phone = formatUSPhone(creator?.companyPhone || creator?.phone);
  const email = creator?.email || "";
  const address = creator?.address || "";

  const token = invoice?.public_token || invoice?.public_share_token;
  const downloadUrl = token
    ? `${BASE_URL}/api/download-invoice-public/${token}`
    : (invoice?._id ? `${BASE_URL}/api/download-invoice/${invoice._id}` : (payment?._id ? `${BASE_URL}/api/download-payment-receipt/${payment._id}` : "#"));

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="format-detection" content="telephone=no">
  <title>Payment Confirmation</title>
  <style>
    a[x-apple-data-detectors], a[href^="tel"] {
      color: inherit !important;
      text-decoration: none !important;
      font-size: inherit !important;
      font-family: inherit !important;
      font-weight: inherit !important;
      line-height: inherit !important;
    }
  </style>
</head>
<body style="margin:0; padding:0; background-color:#f4f4f4; font-family: Arial, sans-serif;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%">
    ${creator?.logo ? `
    <tr>
      <td align="center" style="padding: 30px 20px 10px;">
        <img src="${BASE_URL}/${creator.logo}"
           alt="Company Logo"
           width="200"
           style="max-width:200px; height:auto; display:block; margin-bottom:20px; border:0; outline:none; text-decoration:none;">
      </td>
    </tr>` : ''}
      
    <tr>
      <td align="center" bgcolor="#f4f4f4" style="padding: 20px;">
        <table border="0" cellpadding="0" cellspacing="0" width="600" style="background:#ffffff; border-radius:8px; box-shadow:0 2px 6px rgba(0,0,0,0.1);">
          
          <tr>
            <td align="center" style="padding: 30px 20px 10px;">
              <img src="https://coylejax.app/icon_2.png"
                  alt="Payment Successful"
                  width="100%"
                  style="max-width:600px; height:auto; display:block; border:0; outline:none; text-decoration:none;">
            </td>
          </tr>

          <tr>   
            <td style="padding: 20px 30px; font-size:16px; line-height:24px; color:#333;">
              <p>Dear <b>${customerName}</b>,</p>
              <p>Thank you for your payment of <b>$${amountPaid}</b> for Invoice <b>${invoiceNum}</b>.</p>
              
              <p style="margin:16px 0 8px 0; font-weight:bold;">Payment Details:</p>
              <ul style="margin:0; padding-left:20px;">
                <li>Invoice Number: <b>${invoiceNum}</b></li>
                <li>Amount Paid: <b>$${amountPaid}</b></li>
                <li>Payment Method: <b>${paymentMethod}</b></li>
                <li>Date: <b>${dateStr}</b></li>
                <li>Transaction ID: <b style="color: #333333;"><span style="color: #333333; text-decoration: none;">${formatNoAutoLink(transactionId)}</span></b></li>
              </ul>
            </td>
          </tr> 

          <tr>
            <td align="center" style="padding: 10px 30px 20px;">
              <a href="${downloadUrl}" target="_blank" 
                style="background-color:#0056d2; color:#ffffff; padding:12px 24px; border-radius:6px; font-size:16px; font-weight:bold; text-decoration:none; display:inline-block;">
                Download Receipt
              </a>
            </td>
          </tr>

          <tr>
            <td style="padding: 0 30px 20px; font-size:14px; color:#333;">
              ${email ? `<p>If you have any questions, contact us at <a href="mailto:${email}" style="color: #0056D2;">${email}</a>.</p>` : ''}
              <p>Thank you for your business and prompt payment.</p>
            </td>
          </tr>
           <hr style="margin:20px 0; border:0; border-top:1px solid #ddd;"/>

          <tr>
            <td style="padding: 0 30px 30px; font-size:14px; color:#333;">
              <p>Regards,</p>
              <p><b>${companyName}</b></p>
            </td>
          </tr>
        </table>

        <!-- Footer Table -->
        <table border="0" cellpadding="0" cellspacing="0" width="600" style="margin-top:10px;">
          <tr>
            <td align="center" style="padding: 20px; font-size:12px; color:#555;">
              ${address ? `<p style="margin:2px;">${address}</p>` : ''}
              <p style="margin:2px;">
                ${phone && phone !== 'N/A' ? `<a href="tel:${phone}" style="color:#0056d2; text-decoration:none;">${phone}</a> | ` : ''}
                ${email ? `<a href="mailto:${email}" style="color:#0056d2; text-decoration:none;">${email}</a>` : ''}
              </p>
              <p style="margin:2px;">Copyright © ${new Date().getFullYear()} ${companyName}</p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = {
  adminEmailTemplate,
  customerEmailTemplate
};
