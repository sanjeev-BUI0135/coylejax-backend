const formatUSPhone = require("../helpers/formatUSPhone");
const {formatDateUS} = require("./dateformat");

module.exports = function generateInvoiceEmailHTML(
  magicLink,
  invoiceNumber,
  contactName,
  emailType = 'summary',
  total_amount, due_date,
  email,
  companyPhone,
  companyName,
  address,
  logo,
  amount_paid = 0
) {
  const logoUrl = `${process.env.APP_URL}/${logo}`;
   const balance = (total_amount || 0) - (amount_paid || 0);
  let downloadLink = `${magicLink}&download=true`;
  try {
    if (magicLink && magicLink.includes('token=')) {
      const urlObj = new URL(magicLink);
      const token = urlObj.searchParams.get('token');
      const urlType = urlObj.searchParams.get('type');
      const pdfType = urlType === 's' ? 'summary' : 'details';
      if (token) {
        const crypto = require('crypto');
        const downloadSig = crypto.createHmac('sha256', process.env.JWT_SECRET || 'secret')
          .update(`${token}:${urlType || 's'}`)
          .digest('hex')
          .substring(0, 10);
        downloadLink = `${process.env.APP_URL}/api/download-invoice-public/${token}?type=${pdfType}&sig=${downloadSig}`;
      }
    }
  } catch (e) {
    console.error("Error generating download link in invoice email template:", e);
  }
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Invoice ${invoiceNumber}</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
        <tr>
          <td align="center" style="padding: 30px 20px 10px;">
            <img src="${logoUrl}"
               alt="Company Logo"
               width="200"
               style="max-width:200px; height:auto; display:block; margin-bottom:20px; border:0; outline:none; text-decoration:none;">
          </td>
        </tr>

        <tr>
          <td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
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
                  <p style="margin: 0 0 20px 0; font-size: 16px; color: #333333;">Dear <strong>${contactName}</strong>,</p>

                  <p style="margin: 0 0 20px 0; font-size: 16px; color: #555555; line-height: 1.6;">
                    Your invoice <strong>#${invoiceNumber}</strong> is now ready for review. 
                    ${emailType === 'details' ?
      'Below you will find the detailed breakdown of all items and services.' :
      'Below you will find the summary of items.'
    }
                  </p>

                  <ul style="margin: 0; padding-left: 20px;">
                    <li><strong>Total Amount Due:</strong> ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', }).format(total_amount)}</li>
                    <li><strong>Due Date:</strong> ${formatDateUS(due_date)}</li>
                  </ul>
                  <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0;">
                    <tr>
                      <td align="center">
                        <a href="${downloadLink}" target="_blank" style="display:inline-block; padding:12px 16px; background-color:#0052cc; color:#ffffff; text-decoration:none; border-radius:6px; font-weight:600; font-size:13px; margin-right: 10px; margin-bottom: 10px; white-space: nowrap;">
                          Download Invoice
                        </a>
                        <a href="${magicLink}&pm=card" style="display:inline-block; padding:12px 16px; background:#fff; color:#0052cc; border:2px solid #0052cc; text-decoration:none; border-radius:6px; font-weight:600; font-size:13px; margin-right: 10px; margin-bottom: 10px; white-space: nowrap;">
                          Pay by Card ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(balance * 1.035)}
                        </a>
                        <a href="${magicLink}&pm=ach" style="display:inline-block; padding:12px 16px; background:#fff; color:#0052cc; border:2px solid #0052cc; text-decoration:none; border-radius:6px; font-weight:600; font-size:13px; margin-bottom: 10px; white-space: nowrap;">
                          Pay by ACH ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(balance)}
                        </a>
                      </td>
                    </tr>
                  </table>
                  <ul style="margin:0; padding-left:20px;">
                    <li>Credit Card (3.5% processing fee applies)</li>
                    <li>ACH (0% processing fee applies)</li>
                    <li>Check (No fee – instructions provided on the invoice page)</li>
                  </ul>

                  <p style="margin: 20px 0 0 0; font-size: 14px; color: #777777; line-height: 1.6;">
                    If you have any questions regarding this invoice, please don't hesitate to contact us.
                  </p>
                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td style="background-color: #f8f9fa; padding: 30px; text-align: center; border-top: 1px solid #dee2e6;">
                  <p style="margin: 0 0 10px 0; font-size: 14px; color: #555555;"><strong>${companyName}</strong></p>
                  <p style="margin: 0 0 5px 0; font-size: 13px; color: #777777;">${address}</p>
                  <p style="margin: 0; font-size: 13px; color: #777777;">
                    <a href="${email}" style="color: #667eea; text-decoration: none;">${email}</a> | 
                    <a href="tel:${formatUSPhone(companyPhone)}" style="color: #667eea; text-decoration: none;">${formatUSPhone(companyPhone)}</a>
                  </p>
                  <p style="margin: 15px 0 0 0; font-size: 12px; color: #999999;">© ${new Date().getFullYear()} ${companyName}, Inc. All rights reserved.</p>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}
