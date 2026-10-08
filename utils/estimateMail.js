const formatUSPhone = require("../helpers/formatUSPhone");
const crypto = require("crypto");

module.exports = function estimateMail(
  magicLink,
  estimateNo,
  customerName,
  email,
  companyPhone,
  companyName,
  address,
  full_name,
  logo,
  email_type
) {
  const logoUrl = `${process.env.APP_URL}${logo}`;
  
  const typeStr = email_type || 'summary';
  let downloadSig = '';
  let downloadId = '';
  try {
    if (magicLink.includes('id=')) {
      downloadId = new URL(magicLink).searchParams.get('id');
      if (downloadId) {
        downloadSig = crypto.createHmac('sha256', process.env.JWT_SECRET || 'secret')
          .update(`${downloadId}:${typeStr}`)
          .digest('hex')
          .substring(0, 10);
      }
    }
  } catch (e) {
    console.error("Error generating download signature in estimateMail:", e);
  }

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
      <img src="${logoUrl}"
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
              <img src="https://coylejax.app/icon_2.png"
                  alt="List Image"
                  width="100%"
                  style="max-width:600px; height:auto; display:block; border:0; outline:none; text-decoration:none;">
            </td>
          </tr>

          <tr>
            <td style="padding: 20px 30px; font-size:16px; line-height:24px; color:#333;">
              <p>Dear <b>${customerName}</b>,</p>
              <p>Thank you for considering <b>${companyName || full_name}</b>.</p>
              <p>We’ve prepared Estimate <b>${estimateNo}</b> for you.</p>
              <p>You can review the estimate securely by clicking the link below:</p>
            </td>
          </tr>

          <tr>
          <td align="center" style="padding: 10px 30px 20px;">
            <a href="${magicLink}" target="_blank" 
              style="background-color:#0056d2; color:#ffffff; padding:12px 24px; border-radius:6px; font-size:16px; font-weight:bold; text-decoration:none; display:inline-block;">
              View Estimate
            </a>
          </td>
          </tr>

            ${email_type !== "crew" ? `
          <tr>
            <td style="padding: 0 30px 20px; font-size:14px; color:#333;">
                Once you’ve reviewed, you can easily approve it online by clicking the 
                <a href="${magicLink}" style="color:#0056d2; text-decoration:none; font-weight:bold;">Approve</a> button on that page.
            </td>
          </tr>
` : ""}
         

          <tr>
            <td style="padding: 0 30px 20px; font-size:14px; color:#333;">
              <p><b style="color:red;">Note:</b></p>
              <ul style="margin:0; padding-left:20px;">
                <li>This link is secure and unique to you. No login is required.</li>
              </ul>
              <p>If you have any questions about this estimate, feel free to reply to this email or call us at 
                <b>${formatUSPhone(companyPhone)}</b>.
              </p>
            </td>
          </tr>

            <hr style="margin:20px 0; border:0; border-top:1px solid #ddd;"/>

          <tr>
            <td style="padding: 0 30px 30px; font-size:14px; color:#333;">
              <p>Thank You,</p>
              <p><b>${companyName || full_name}</b></p>
            </td>
          </tr>
        </table>

        <!-- Footer Table -->
        <table border="0" cellpadding="0" cellspacing="0" width="600" style="margin-top:10px;">
          <tr>
            <td align="center" style="padding: 20px; font-size:12px; color:#555;">
              <p style="margin:2px;">${address}</p>
              <p style="margin:2px;"><a href="tel:${formatUSPhone(companyPhone)}" style="color:#0056d2; text-decoration:none;">${formatUSPhone(companyPhone)}</a> | <a href="mailto:${email}" style="color:#0056d2; text-decoration:none;">${email}</a></p>
              <p style="margin:2px;">Copyright © ${new Date().getFullYear()} ${companyName || full_name}</p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
};