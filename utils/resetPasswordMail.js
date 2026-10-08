const formatUSPhone = require("../helpers/formatUSPhone");
module.exports = function resetPasswordMail(
    userName,
    resetLink,
    creator
) {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Reset Password</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>

<body style="margin:0; padding:0; background-color:#f4f4f4; font-family: Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    
    <tr>
      <td align="center" style="padding: 30px 20px 10px;">
        ${creator?.logo ? `
        <img src="${process.env.APP_URL}${creator.logo}"
          alt="Company Logo"
          width="200"
          style="max-width:200px; height:auto; display:block; border:0;" />
        ` : ""}
      </td>
    </tr>

    <tr>
      <td align="center" style="padding:20px;">
        <table width="600" cellpadding="0" cellspacing="0" border="0"
          style="max-width:600px; background:#ffffff; border-radius:8px; box-shadow:0 2px 6px rgba(0,0,0,0.1);">
       
          <tr>
            <td align="center" style="padding: 30px 20px 10px;">
              <img src="https://coylejax.app/icon_2.png"
                alt="Reset Password"
                style="max-width:600px; width:100%; height:auto; display:block;" />
            </td>
          </tr>
   
          <tr>
            <td style="padding: 20px 30px; font-size:16px; line-height:24px; color:#333;">
              <p style="margin:0 0 16px;">Dear <b>${userName}</b>,</p>

              <p style="margin:0 0 16px;">
                We received a request to reset your account password.
              </p>

              <p style="margin:0 0 16px;">
                Click the button below to create a new password:
              </p>
            </td>
          </tr>
         
          <tr>
            <td align="center" style="padding: 10px 30px 30px;">
              <a href="${resetLink}"
                style="background-color:#0056d2; color:#ffffff; padding:12px 24px; border-radius:6px; font-size:16px; font-weight:bold; text-decoration:none; display:inline-block;">
                Reset Password
              </a>
            </td>
          </tr>
         
          <tr>
            <td style="padding: 0 30px 30px; font-size:14px; color:#555;">
              <p style="margin:0 0 8px;">
                This link is valid for <b>15 minutes</b>.
              </p>
              <p style="margin:0;">
                If you didn’t request a password reset, please ignore this email.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding: 20px 30px 30px; font-size:14px; color:#333;">
              <p style="margin:16px 0 4px;">Thank You,</p>
              <p style="margin:0; font-weight:bold;">
                ${creator.companyName}
              </p>
            </td>
          </tr>
        </table>
      
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; margin-top:10px;">
          <tr>
            <td align="center" style="padding:20px; font-size:12px; color:#666;">
              <p style="margin:2px;">${creator?.address || ""}</p>
              <p style="margin:2px;">
                <a href="tel:${creator?.companyPhone}" style="color:#0056d2; text-decoration:none;">
                  ${formatUSPhone(creator?.companyPhone) || ""}
                </a>
                |
                <a href="mailto:${creator?.email}" style="color:#0056d2; text-decoration:none;">
                  ${creator?.email || ""}
                </a>
              </p>
              <p style="margin:2px;">
                Copyright © ${new Date().getFullYear()} ${creator?.companyName || "Coylejax"}
              </p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
};
