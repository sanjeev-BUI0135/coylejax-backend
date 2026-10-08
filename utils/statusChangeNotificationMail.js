const formatUSPhone = require("../helpers/formatUSPhone");

const statusChangeNotificationMail = (
    projectName,
    action, 
    actionByUser,
    orderNumber,
    creator,
    totalEstimatedCost = 0
) => {
    const logoUrl = creator && creator.logo ? `${process.env.APP_URL}${creator.logo}` : null;
    const companyName = creator ? (creator.companyName || creator.full_name) : "The Management Team";

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Material Order ${action}</title>
</head>
<body style="margin:0; padding:0; background-color:#f4f4f4; font-family: Arial, sans-serif;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%">
    
    <tr>
      <td align="center" style="padding: 30px 20px 10px;">
      ${logoUrl ? `<img src="${logoUrl}"
         alt="Company Logo"
         width="200"
         style="max-width:200px; height:auto; display:block; margin-bottom:20px; border:0; outline:none; text-decoration:none;">` : ''}
      </td>
    </tr>

    <!-- Card -->
    <tr>
      <td align="center" bgcolor="#f4f4f4" style="padding: 20px;">
        <table border="0" cellpadding="0" cellspacing="0" width="600" 
          style="background:#ffffff; border-radius:10px; box-shadow:0 2px 8px rgba(0,0,0,0.1);">
          
            <tr>
            <td align="center" style="padding: 30px 20px 10px;">
              <img src="https://coylejax.app/icon_2.png"
                  alt="List Image"
                  width="100%"
                  style="max-width:600px; height:auto; display:block; border:0; outline:none; text-decoration:none;">
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 20px 30px; font-size:16px; line-height:24px; color:#333;">
              <p>Hello,</p>
              <p>The Material Order Estimate Ref :<b>${orderNumber}</b> for project <b>${projectName}</b> has been <b>${action}</b>.</p>

              <p style="margin:16px 0 8px 0; font-weight:bold;">Summary:</p>
              <ul style="margin:0; padding-left:20px;">
                <li>Estimate Ref: <b>${orderNumber}</b></li>
                <li>Project: <b>${projectName}</b></li>
                ${totalEstimatedCost ? `<li>Total Estimated Cost: <b>$${Number(totalEstimatedCost).toLocaleString()}</b></li>` : ''}
                <li>Status: <span style="color:black;"><b>${action.toUpperCase()}</b></span></li>
                <li>Action performed by: <b>${actionByUser}</b></li>
              </ul>
              
              <hr style="margin:20px 0; border:0; border-top:1px solid #ddd;"/>

              <p style="margin-top:20px; font-size:15px; color:#333;">
                Thank You,<br/>
                <b>${companyName}</b>
              </p>
            </td>
          </tr>
        </table>

        <!-- Footer -->
        <table border="0" cellpadding="0" cellspacing="0" width="600" style="margin-top:15px;">
          <tr>
            <td align="center" style="padding: 20px; font-size:12px; color:#555;">
               ${creator && creator.address ? `<p style="margin:2px;">${creator.address}</p>` : ''}
               ${creator && (creator.companyPhone || creator.email) ? `<p style="margin:2px;">${creator.companyPhone ? `<a href="tel:${formatUSPhone(creator.companyPhone)}" style="color:#0056d2; text-decoration:none;">${formatUSPhone(creator.companyPhone)}</a>` : ''} ${creator.companyPhone && creator.email ? '|' : ''} ${creator.email ? `<a href="mailto:${creator.email}" style="color:#0056d2; text-decoration:none;">${creator.email}</a>` : ''}</p>` : ''}
               <p style="margin:2px;">Copyright © ${new Date().getFullYear()} ${companyName}</p>
               <p style="margin:2px; margin-top:10px;">This is an automated notification. Please do not reply to this email.</p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
};

module.exports = statusChangeNotificationMail;
