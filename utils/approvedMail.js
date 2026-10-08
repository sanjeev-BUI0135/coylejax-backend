const formatUSPhone = require("../helpers/formatUSPhone");
const { formatDateUS } = require("./dateformat");
module.exports = function approvedMail(
  magicLink,
  customerName,
  estimateNo,
  updatedAt,
  creator
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
      <img src="${process.env.APP_URL}/${creator?.logo}"
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
              <p>Thank you for reviewing our estimate. We're pleased to inform you that your estimate <b>${estimateNo}</b> has been <b>APPROVED.</b></p>
              <p>Summary:</p>
              <ul>
                <li>Estimate Number: <b>${estimateNo}</b></li>
                <li>Approved Date: <b>${formatDateUS(updatedAt)}</b></li>
                <li>Status: <b>APPROVED</b></li>
              </ul>
              <p>Our team will proceed with the next steps as per the agreement.</p>
              <p>If you have any questions, feel free to reply to this email.</p>
            </td>
          </tr>
          
           <hr style="margin:20px 0; border:0; border-top:1px solid #ddd;"/>

          <tr>
            <td style="padding: 0 30px 30px; font-size:14px; color:#333;">
              <p>Thank You,</p>
              <p><b>${creator?.companyName || 'Admin'}</b></p>
            </td>
          </tr>
        </table>

        <!-- Footer Table -->
        <table border="0" cellpadding="0" cellspacing="0" width="600" style="margin-top:10px;">
          <tr>
            <td align="center" style="padding: 20px; font-size:12px; color:#555;">
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
</html>`;
};
