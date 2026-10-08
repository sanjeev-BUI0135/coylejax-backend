function materialorderCustomerApprovalMail(
  approveLink,
  rejectLink,
  projectName,
  customerName,
  totalCost,
  inventoryStatus,
  orderNumber,
  approvalThreshold,
  orderId,
  estimateData = null
) {
  let actualOrderId = orderId;
  if (!actualOrderId && approveLink) {
    const urlParams = new URLSearchParams(approveLink.split("?")[1]);
    actualOrderId = urlParams.get("id");
  }

  const formattedTotalCost = totalCost ? Number(totalCost) : 0;
  const formattedThreshold = approvalThreshold ? Number(approvalThreshold) : 0;

  const displayProjectName = projectName || "Unknown Project";
  const displayCustomerName = customerName || "Valued Customer";
  const displayInventoryStatus = inventoryStatus || "No items";

  let approvalReason = "";
  if (
    formattedTotalCost > formattedThreshold &&
    displayInventoryStatus.toLowerCase().includes("out of stock")
  ) {
    approvalReason = `the cost exceeds ${formattedThreshold.toLocaleString()} and some materials are out of stock`;
  } else if (formattedTotalCost > formattedThreshold) {
    approvalReason = `the cost exceeds ${formattedThreshold.toLocaleString()}`;
  } else if (displayInventoryStatus.toLowerCase().includes("out of stock")) {
    approvalReason = `some materials are currently out of stock`;
  } else {
    approvalReason = `approval is required for this order`;
  }

  const approveApiLink = `${process.env.BASE_URL}/api/materialorders/approve/${actualOrderId}`;
  const rejectApiLink = `${process.env.BASE_URL}/api/materialorders/reject/${actualOrderId}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Material Order Approval Request</title>
</head>
<body style="margin:0; padding:0; background:#fafafa; font-family:Arial,sans-serif;">
  <table width="100%" style="background:#fafafa; padding:30px 0;">
    <tr>
      <td align="center">
        <table width="600" style="background:#fff; border-radius:10px;">

          <tr><td align="center" style="padding:30px 20px 10px;">
            <img src="${process.env.APP_URL}/pm-logo.png" style="max-width:180px; margin-bottom:15px;" />
          </td></tr>

                <tr><td align="center" style="padding:10px 20px 20px;">
            <img src="${process.env.APP_URL}/icon_1.png" style="width:120px; height:60px; margin-bottom:10px;" />
        </td></tr>

          <tr><td style="padding:0 40px 30px; font-size:15px; line-height:1.6; color:#333;">
            <p>Dear <strong>${displayCustomerName}</strong>,</p>
            <p>A new material work order has been created for your project: <strong>${displayProjectName}</strong>.</p>
            <p>
              Total Material Cost:
              <span style="font-weight:bold; color:#000;">$${formattedTotalCost.toLocaleString()}</span><br/>
              Inventory Status:
              <span style="font-weight:bold; color:#000;">${displayInventoryStatus}</span>
            </p>
            <p>Since ${approvalReason}, your approval is required before we can proceed with the order.</p>
            <p>Please review and <strong>approve</strong> or <strong>reject</strong> this material order:</p>

            <table align="center" style="margin:25px auto;">
              <tr>
                <td align="center" style="padding:0 10px;">
                  <a href="${approveApiLink}" 
                    style="background-color:#28a745; color:#ffffff; padding:12px 24px; border-radius:6px; font-size:16px; font-weight:bold; text-decoration:none; display:inline-block;">
                    Approve Order
                  </a>
                </td>
                <td align="center" style="padding:0 10px;">
                  <a href="${rejectApiLink}" 
                    style="background-color:#dc3545; color:#ffffff; padding:12px 24px; border-radius:6px; font-size:16px; font-weight:bold; text-decoration:none; display:inline-block;">
                    Reject Order
                  </a>
                </td>
              </tr>
            </table>

            <hr style="border:none; border-top:1px solid #ddd; margin:20px 0;"/>

            <p style="margin-top:20px;">If you have any questions about this order, please don't hesitate to contact us.</p>
            <p style="margin-top:20px;">Thank You,</p>
            <p style="font-weight:bold;">George P. Coyle & Sons Team</p>
          </td></tr>

          <tr><td align="center" style="background:#fafafa; padding:20px; font-size:13px; color:#666; line-height:1.6; border-top:1px solid #eee;">
            2361 Dennis Street, Jacksonville, FL 32204 <br/>
            <a href="tel:9043564821" style="color:#1976d2; text-decoration:none;">904-356-4821</a> |
            <a href="mailto:${process.env.EMAIL_USER}" style="color:#1976d2; text-decoration:none;">${process.env.EMAIL_USER}</a> <br/>
            © ${new Date().getFullYear()} George P. Coyle & Sons, Inc.
          </td></tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = materialorderCustomerApprovalMail;