module.exports = function estimateMail(
  magicLink,
  estimateNo,
  customerName,
  logo
) {

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Estimate Ready</title>
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
              <p>Your Invoice <b>${estimateNo}</b>is ready. Please review the details below:</p>
               <ul style="margin:0; padding-left:20px;">
                <li>Amount Due:<b>${TotalAmount}</li>
                <li>Due Date:<b>${Duedate}</b></li>
              </ul>
              <p>You can view and pay your invoice securely using the button below:</p>
            </td>
          </tr>

          <tr>
          <td align="center" style="padding: 10px 30px 20px;">
            <a href="${magicLink}" target="_blank" 
              style="background-color:#0056d2; color:#ffffff; padding:12px 24px; border-radius:6px; font-size:16px; font-weight:bold; text-decoration:none; display:inline-block;">
              View & Pay Invoice
            </a>
          </td>
          </tr>

          <tr>
            <td style="padding: 0 30px 20px; font-size:14px; color:#333;">
              <p><b style="color:black;">Payment Options:</b></p>
              <ul style="margin:0; padding-left:20px;">
                <li>Credit Card (3.5% processing fee applies)</li>
                <li>ACH (0% processing fee applies)</li>
                <li>Check (No fee – instructions provided on the invoice page)</li>
              </ul>
              <p>Thank you for your business!</p>
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


