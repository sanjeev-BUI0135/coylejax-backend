const formatUSPhone = require("../helpers/formatUSPhone");
module.exports = function lowMarkupItemsMail(
  customerName,
  estimateNo,
  lowMarkupItems,
  totalAmount,
  createdAt,
  estimateId,
  creator,
  showActions = false,
  markupLimit = 20,
  type = 'Estimate'
) {
  const lowerType = type.toLowerCase();
  const approveLink = `${process.env.APP_URL}/api/${lowerType}s/${estimateId}/markup-status?status=approved`;
  const rejectLink = `${process.env.APP_URL}/api/${lowerType}s/${estimateId}/markup-status?status=rejected`;


  const safeLowMarkupItems = Array.isArray(lowMarkupItems)
    ? lowMarkupItems.map(item => {
      return item._doc || item;
    })
    : [];

  const lowMarkupItemsRows = safeLowMarkupItems.map(item => {
    const description = item.description || 'N/A';
    const quantity = item.quantity || 0;
    const unit = item.unit || 'each';
    const unitPrice = item.unit_price || 0;
    const markupPercentage = item.markup_percentage || 0;
    const total = item.total || 0;

    return `
    <tr style="border-bottom: 1px solid #e5e7eb;">
      <td style="padding: 12px; text-align: left; border-bottom: 1px solid #e5e7eb;">${description}</td>
      <td style="padding: 12px; text-align: center; border-bottom: 1px solid #e5e7eb;">${quantity}</td>
      <td style="padding: 12px; text-align: left; border-bottom: 1px solid #e5e7eb;">${unit}</td>
      <td style="padding: 12px; text-align: right; border-bottom: 1px solid #e5e7eb;">$${parseFloat(unitPrice).toFixed(2)}</td>
      <td style="padding: 12px; text-align: center; border-bottom: 1px solid #e5e7eb; color: #dc3545; font-weight: bold;">${parseFloat(markupPercentage).toFixed(2)}%</td>
      <td style="padding: 12px; text-align: right; border-bottom: 1px solid #e5e7eb;">$${parseFloat(total).toFixed(2)}</td>
    </tr>
    `;
  }).join('');

  const itemsTableContent = safeLowMarkupItems.length > 0
    ? `
      <table width="100%" style="border-collapse: collapse; margin: 16px 0; font-size: 14px;">
        <thead>
          <tr style="background-color: #f8f9fa; border-bottom: 2px solid #e5e7eb;">
            <th style="padding: 12px; text-align: left; font-weight: bold;">Description</th>
            <th style="padding: 12px; text-align: center; font-weight: bold;">Qty</th>
            <th style="padding: 12px; text-align: left; font-weight: bold;">Unit</th>
            <th style="padding: 12px; text-align: right; font-weight: bold;">Unit Price</th>
            <th style="padding: 12px; text-align: center; font-weight: bold;">Markup %</th>
            <th style="padding: 12px; text-align: right; font-weight: bold;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${lowMarkupItemsRows}
        </tbody>
      </table>
    `
    : `<p style="color: #dc3545; font-style: italic;">No low markup items found or data unavailable.</p>`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Low Markup Items Alert</title>
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
              <p style="margin:0 0 16px 0;">Dear <b>${customerName || 'Valued Customer'}</b>,</p>
              <p style="margin:0 0 16px 0;">This is to inform you that ${lowerType} <b>${estimateNo || 'N/A'}</b> contains line items with markup below our standard ${markupLimit}% rate.</p>
              <div style="">
              </div>
              
              <p style="margin:16px 0 8px 0; font-weight:bold;">Low Markup Items:</p>
              ${itemsTableContent}

              <p style="margin:16px 0 8px 0; font-weight:bold;">${type} Summary:</p>
              <ul style="margin:0; padding-left:20px;">
                <li style="margin-bottom:8px;">${type} Number: <b>${estimateNo || 'N/A'}</b></li>
                <li style="margin-bottom:8px;">Total Amount: <b>$${(totalAmount || 0).toLocaleString()}</b></li>
                <li style="margin-bottom:8px;">Created Date: <b>${createdAt || 'N/A'}</b></li>
                <li style="margin-bottom:8px;">Low Markup Items: <b style="color:#dc3545;">${safeLowMarkupItems.length} items</b></li>
              </ul>
            </td>
          </tr>

          <!-- Action Buttons -->
          ${showActions ? `<tr>
            <td style="padding: 20px 30px; text-align:center; border-top: 2px solid #e9ecef;">
              <table border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center" style="padding: 0 5px;">
                    <a href="${approveLink}" style="background-color:#28a745; color:#ffffff; padding:12px 24px; border-radius:6px; font-size:16px; font-weight:bold; text-decoration:none; display:inline-block; width:100%; max-width:200px; text-align:center;">
                       Approve Markup
                    </a>
                  </td>
                  <td align="center" style="padding: 0 5px;">
                    <a href="${rejectLink}" style="background-color:#dc3545; color:#ffffff; padding:12px 24px; border-radius:6px; font-size:16px; font-weight:bold; text-decoration:none; display:inline-block; width:100%; max-width:200px; text-align:center;">
                       Reject Markup
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>` : ``}

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
</html>`;
};