const formatUSPhone = require("../helpers/formatUSPhone");

function formatNoAutoLink(val) {
  if (val === undefined || val === null || val === '') return 'N/A';
  const str = String(val);
  if (str === 'N/A') return 'N/A';
  return str.replace(/(.{3})/g, '$1&zwnj;');
}

module.exports = function paymentReceiptMail(
  customerName, 
  amount,
  paymentMethod,
  paymentDate,
  transactionId,
  downloadLink,
  client
) {
    const companyName = client?.companyName || client?.full_name || 'Our Company';
    const logoUrl = client?.logo ? `${process.env.APP_URL || 'https://coylejax.com'}/${client.logo}` : '';
    const phone = client?.companyPhone ? formatUSPhone(client.companyPhone) : '';
    const email = client?.email || '';
    const address = client?.address || '';
    const year = new Date().getFullYear();

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="format-detection" content="telephone=no">
  <title>Payment Receipt</title>
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

    <tr>
      <td align="center" style="padding: 30px 20px 10px;">
        ${logoUrl ? `<img src="${logoUrl}" alt="Company Logo" width="200" style="max-width:200px; height:auto; display:block; margin-bottom:20px; border:0; outline:none; text-decoration:none;">` : `<h2>${companyName}</h2>`}
      </td>
    </tr>
      
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
              <p>Dear <b>${customerName}</b>,</p>
              <p>Thank you for your payment. We have successfully received it.</p>
              
              <p style="margin:16px 0 8px 0; font-weight:bold;">Payment Details:</p>
              <ul style="margin:0; padding-left:20px;">
                <li>Amount Paid: <b>$${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b></li>
                <li>Payment Method: <b>${paymentMethod || 'N/A'}</b></li>
                <li>Date: <b>${new Date(paymentDate).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })}</b></li>
                <li>Transaction ID / Ref: <b style="color: #333333;"><span style="color: #333333; text-decoration: none;">${formatNoAutoLink(transactionId)}</span></b></li>
              </ul>
            </td>
          </tr> 

          <tr>
            <td align="center" style="padding: 10px 30px 20px;">
              <a href="${downloadLink}" target="_blank" 
                style="background-color:#0056d2; color:#ffffff; padding:12px 24px; border-radius:6px; font-size:16px; font-weight:bold; text-decoration:none; display:inline-block;">
                Download Receipt
              </a>
            </td>
          </tr>

          <tr>
            <td style="padding: 0 30px 20px; font-size:14px; color:#333;">
              <p>If you have any questions regarding this payment, feel free to contact us at <a href="mailto:${email}" style="color: #0056D2;">${email}</a>.</p>
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
              <p style="margin:2px;">${address}</p>
              <p style="margin:2px;"><a href="tel:${phone}" style="color:#0056d2; text-decoration:none;">${phone}</a> | <a href="mailto:${email}" style="color:#0056d2; text-decoration:none;">${email}</a></p>
              <p style="margin:2px;">Copyright © ${year} ${companyName}</p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
};
