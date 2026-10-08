const formatUSPhone = require("../helpers/formatUSPhone");
function materialordersApprovalMail(
  approveLink,
  rejectLink,
  displayName,
  customerName,
  totalCost,
  inventoryStatus,
  orderNumber,
  approvalThreshold,
  orderId,
  estimateData = null,
  logo,
  adminUser
) {
  let actualOrderId = orderId;
  if (!actualOrderId && approveLink) {
    const urlParams = new URLSearchParams(approveLink.split("?")[1]);
    actualOrderId = urlParams.get("id");
  }

  const dynamicApproveLink = approveLink;
  const dynamicRejectLink = rejectLink;



  const formattedTotalCost =
    estimateData && estimateData.total_cost
      ? Number(estimateData.total_cost)
      : totalCost
        ? Number(totalCost)
        : 0;

  const formattedThreshold = approvalThreshold ? Number(approvalThreshold) : 0;

  const displayProjectName = displayName || "Unknown Project";
  const displayInventoryStatus = inventoryStatus || "No items";

  let inventoryStatusHtml = '';
  if (displayInventoryStatus === "All Items In Stock") {
    inventoryStatusHtml = `<strong style="color: #4caf50;">${displayInventoryStatus}</strong>`;
  } else if (displayInventoryStatus.toLowerCase().includes("out of stock")) {
    // Parse out of stock items and display them in red
    inventoryStatusHtml = `<strong style="color: #d32f2f;">${displayInventoryStatus}</strong>`;
  } else {
    inventoryStatusHtml = `<strong>${displayInventoryStatus}</strong>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Material Order Approval Email</title>
</head>
<body style="margin:0; padding:0; background-color:#fafafa; font-family: Arial, sans-serif;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#fafafa; padding:30px 0;">
    <tr>
            <td align="center" style="padding:30px 20px 10px;">
              <img src="${process.env.APP_URL}${logo}" alt="Coyle Logo" width="200" height="auto" style="max-width:200px; height:auto; display:block; margin-bottom:20px; border:0; outline:none; text-decoration:none;" />
            </td>
          </tr>
    <tr>
      <td align="center">
        <table width="600" border="0" cellspacing="0" cellpadding="0" style="background:#fff; border-radius:10px;">
          <tr>
            <td align="center" style="padding:10px 20px 20px;">
              <img src="https://coylejax.app/icon_2.png" alt="Order Icon" width="100%" height="auto" style="max-width:600px; height:auto; display:block; border:0; outline:none; text-decoration:none;" />
            </td>
          </tr>

          <tr>
            <td style="padding:0 40px 30px; font-size:15px; line-height:1.6; color:#333;">
              <p>Dear <strong>${adminUser?.companyName}</strong>,</p>
              <p>A new material work order has been created for Project <strong>${displayProjectName}</strong>.</p>
              <p>
                Total Material Cost: <strong> $${formattedTotalCost.toLocaleString()}</strong><br/>
                Inventory Status: ${inventoryStatusHtml}
              </p>
              
              <p>
                Since the cost exceeds $${formattedThreshold.toLocaleString()}, approval is required before placing the order.
              </p>
              <p>Please review and <strong>approve</strong> or <strong>reject</strong> the order:</p>
              
              <table border="0" cellspacing="0" cellpadding="0" align="center" style="margin:25px auto;">
                <tr>
                  <td align="center" style="padding:0 10px;">
                    <a href="${dynamicApproveLink}" style="display:inline-block; background-color:#28a745; color:#ffffff; padding:12px 24px; border-radius:6px; font-size:16px; font-weight:bold; text-decoration:none;">
                      Approve Order
                    </a>
                  </td>
                  <td align="center" style="padding:0 10px;">
                    <a href="${dynamicRejectLink}" style="display:inline-block; background-color:#dc3545; color:#ffffff; padding:12px 24px; border-radius:6px; font-size:16px; font-weight:bold; text-decoration:none;">
                      Reject Order
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Line below Approve/Reject buttons -->
              <hr style="border:0; border-top:1px solid #ddd; margin:25px 0;"/>

              <p style="margin-top:20px;">Thank You,</p>
              <p style="font-weight:bold;">${adminUser?.companyName}</p>
            </td>
          </tr>

          <tr>
            <td align="center" style="background-color:#fafafa; padding:20px; font-size:13px; color:#666; line-height:1.6; border-top:1px solid #eee;">
             <p style="margin:2px;">${adminUser?.address}</p>
              <p style="margin:2px;"><a href="tel:${formatUSPhone(adminUser?.companyPhone)}" style="color:#0056d2; text-decoration:none;">${formatUSPhone(adminUser?.companyPhone)}</a> | <a href="mailto:${adminUser?.email}" style="color:#0056d2; text-decoration:none;">${adminUser?.email}</a></p>
              <p style="margin:2px;">Copyright © ${new Date().getFullYear()} ${adminUser?.companyName || adminUser?.full_name}</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = materialordersApprovalMail;