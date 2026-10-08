function formatNoAutoLink(val) {
  if (val === undefined || val === null || val === '') return 'N/A';
  const str = String(val);
  if (str === 'N/A') return 'N/A';
  return str.replace(/(.{3})/g, '$1&zwnj;');
}

module.exports = function approvedMail(
  customerName, 
  estimateNo, 
  approvedDate,
  logo
) {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="format-detection" content="telephone=no">
  <title>Estimate Ready</title>
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
      <img src="${process.env.APP_URL}/${logo}"
         alt="Company Logo"
         width="200"
         style="max-width:200px; height:auto; display:block; margin-bottom:20px; border:0; outline:none; text-decoration:none;">
      </td>
    </tr>
      
    <tr>
      <td align="center" bgcolor="#f4f4f4" style="padding: 20px;">
        <table border="0" cellpadding="0" cellspacing="0" width="600" style="background:#ffffff; border-radius:8px; box-shadow:0 2px 6px rgba(0,0,0,0.1);">
          
          <tr>
            <td align="center" style="padding: 30px 20px 10px;">
              <img src="https://example.com/assets/list-image.png"
                  alt="List Image"
                  width="100%"
                  style="max-width:600px; height:auto; display:block; border:0; outline:none; text-decoration:none;">
            </td>
          </tr>

          <tr>   
            <td style="padding: 20px 30px; font-size:16px; line-height:24px; color:#333;">
              <p>Dear <b>${customerName}</b>,</p>
              <p>A new payment has been received.</p>
              <p><b>Payment Details:</b></p>
              <ul style="margin:0; padding-left:20px;">
                <li>Customer: <b>${customerName}</b></li>
                <li>Invoice Number: <b>${InvoiceNumber}</b></li>
                <li>Amount Paid:<b>${TotalAmount}</b></li>
                <li>Payment Method: Credit Card (Visa ending 1234)</li>
                <li>Date:<b>${date}</b></li>
                <li>Transaction ID: <b style="color: #333333;"><span style="color: #333333; text-decoration: none;">${formatNoAutoLink(TranscationId)}</span></b></li>
              </ul>
              <p>The invoice status has been updated to Paid.</p>
            </td>
          </tr> 

          <tr>
          <td align="center" style="padding: 10px 30px 20px;">
            <a href="${magicLink}" target="_blank" 
              style="background-color:#0056d2; color:#ffffff; padding:12px 24px; border-radius:6px; font-size:16px; font-weight:bold; text-decoration:none; display:inline-block;">
              Download Receipt
            </a>
          </td>
          </tr>

          <tr>
            <td style="padding: 0 30px 20px; font-size:14px; color:#333;">
              <p>If you have any questions regarding this payment, feel free to cantact us at contact@coylejax.com. </p>
              <p>Thank You for your business and prompt payment.</p>
            </td>
          </tr>
           <hr style="margin:20px 0; border:0; border-top:1px solid #ddd;"/>

          <tr>
            <td style="padding: 0 30px 30px; font-size:14px; color:#333;">
              <p>Thank You,</p>
              <p><b>George P. Coyle & Sons</b></p>
            </td>
          </tr>
        </table>

        <!-- Footer Table -->
        <table border="0" cellpadding="0" cellspacing="0" width="600" style="margin-top:10px;">
          <tr>
            <td align="center" style="padding: 20px; font-size:12px; color:#555;">
              <p style="margin:2px;">2361 Dennis Street, Jacksonville, FL 32204</p>
              <p style="margin:2px;"><a href="tel:9043564821" style="color:#0056d2; text-decoration:none;">904-356-4821</a> | <a href="mailto:contact@coylejax.com" style="color:#0056d2; text-decoration:none;">contact@coylejax.com</a></p>
              <p style="margin:2px;">Copyright © ${new Date().getFullYear()} George P. Coyle & Sons, Inc.</p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
};

  