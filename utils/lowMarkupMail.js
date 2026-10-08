const formatUSPhone = require("../helpers/formatUSPhone");
module.exports = function lowMarkupMail(
  customerName,
  estimateNo,
  materialMarkup,
  totalAmount,
  updatedAt,
  estimateId,
  creator
) {
 
  const approveLink = `${process.env.APP_URL}/api/estimates/${estimateId}/additional-markup-status?status=approved`;
  const rejectLink = `${process.env.APP_URL}/api/estimates/${estimateId}/additional-markup-status?status=rejected`;
  
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Low Markup Alert</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0; padding:0; background-color:#f4f4f4; font-family: Arial, sans-serif;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%">
    <tr>
      <td align="center" style="padding: 30px 20px 10px;">
        <img src="${process.env.APP_URL}${creator.logo}"
           alt="Company Logo"
           width="200"
           style="max-width:200px; height:auto; display:block; margin-bottom:20px; border:0; outline:none; text-decoration:none;">
      </td>
    </tr>

    <tr>
      <td align="center" bgcolor="#f4f4f4" style="padding: 20px;">
        <table border="0" cellpadding="0" cellspacing="0" width="600" style="max-width:600px; background:#ffffff; border-radius:8px; box-shadow:0 2px 6px rgba(0,0,0,0.1);">
          
          <tr>
            <td align="center" style="padding: 30px 20px 10px;">
              <img src="https://coylejax.app/icon_2.png"
                  alt="Alert Icon"
                  width="100%"
                  style="max-width:600px; height:auto; display:block; border:0; outline:none; text-decoration:none;">
            </td>
          </tr>

          <tr>
            <td style="padding: 20px 30px; font-size:16px; line-height:24px; color:#333;">
              <p style="margin:0 0 16px 0;">Dear <b>${customerName}</b>,</p>
              <p style="margin:0 0 16px 0;">This is to inform you that estimate <b>${estimateNo}</b> has been created with a material markup of <b style="color:#dc3545;">${(materialMarkup).toFixed(1)}%</b>.</p>
              
              <p style="margin:16px 0 8px 0; font-weight:bold;">Estimate Summary:</p>
              <ul style="margin:0; padding-left:20px;">
                <li style="margin-bottom:8px;">Estimate Number: <b>${estimateNo}</b></li>
                <li style="margin-bottom:8px;">Material Markup: <b style="color:#dc3545;">${(materialMarkup).toFixed(1)}%</b></li>
                <li style="margin-bottom:8px;">Total Amount: <b>${totalAmount.toLocaleString()}</b></li>
                <li style="margin-bottom:8px;">Created Date: <b>${updatedAt}</b></li>
              </ul>
            </td>
          </tr>

          <!-- Action Buttons -->
          <tr>
            <td style="padding: 20px 30px; text-align:center;border-top: 2px solid #e9ecef;">
              <table border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center" style="padding: 0 5px;">
                    <a href="${approveLink}" style="background-color:#28a745; color:#ffffff; padding:12px 24px; border-radius:6px; font-size:16px; font-weight:bold; text-decoration:none; display:inline-block; width:100%; max-width:200px; text-align:center;">
                       Approved 
                    </a>
                  </td>
                  <td align="center" style="padding: 0 5px;">
                    <a href="${rejectLink}" style="background-color:#dc3545; color:#ffffff; padding:12px 24px; border-radius:6px; font-size:16px; font-weight:bold; text-decoration:none; display:inline-block; width:100%; max-width:200px; text-align:center;">
                       Rejected
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding: 20px 30px 30px; font-size:14px; color:#333;">
              <p style="margin:16px 0 4px 0;">Thank You,</p>
              <p style="margin:0; font-weight:bold;">${creator?.companyName}</p>
            </td>
          </tr>
        </table>

        <!-- Footer Table -->
        <table border="0" cellpadding="0" cellspacing="0" width="600" style="max-width:600px; margin-top:10px;">
          <tr>
            <td align="center" style="padding: 20px; font-size:12px; color:#666; line-height:18px;">
              <p style="margin:2px;">${creator?.address}</p>
              <p style="margin:2px;"><a href="tel:${formatUSPhone(creator?.companyPhone)}" style="color:#0056d2; text-decoration:none;">${formatUSPhone(creator?.companyPhone)}</a> | <a href="mailto:${creator?.email}" style="color:#0056d2; text-decoration:none;">${creator?.email}</a></p>
              <p style="margin:2px;">Copyright © ${new Date().getFullYear()} ${creator?.companyName || creator?.full_name}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`};