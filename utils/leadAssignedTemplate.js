const formatUSPhone = require("../helpers/formatUSPhone");
const { formatDateUS } = require("./dateformat");

function leadAssignedEmailTemplate(lead, assignedUser, creator) {
  const dateStr = formatDateUS(new Date());


  return `
  <div style="font-family: Arial, sans-serif; max-width: 100%; margin: auto; border: 20px solid #f8f9fc; background: #f8f9fc; border-radius: 8px; overflow: hidden;">
    
    <!-- Header -->
    <div style="background: #f8f9fc; padding: 30px 0; text-align: center;">
      <img src="${process.env.APP_URL}/${creator?.logo || "icon_2.png"}" 
           alt="Company Logo" 
           style="height: 60px;">
    </div>

    <!-- Body -->
    <div style="margin: 0 50px; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; background: #fff; padding: 30px;">
      
      <div style="background: #fff; padding: 20px 0; text-align: center;">
        <img src="https://coylejax.app/icon_2.png" alt="CRM Icon" style="height: 50px;">
      </div>

      <p>Dear <strong>${assignedUser?.full_name || "Team Member"}</strong>,</p>

      <p>You have been assigned a new lead. Please find the details below:</p>

      <h3 style="margin-top: 20px;">Lead Details:</h3>
      <ul>
        <li>Contact Name: <strong>${lead?._doc.customer_name || "N/A"}</strong></li>
        <li>Company Name: <strong>${lead?. _doc.company_name || "N/A"}</strong></li>
       <li>Phone: ${lead?. _doc.phone
      ? `<a href="tel:${lead. _doc.phone}" style="color:#0056d2; text-decoration:none;">
           <strong>${lead. _doc.phone}</strong>
         </a>`
      : "N/A"
    }
  </li>
        <li>Email: ${lead?. _doc.email
      ? `<a href="mailto:${lead. _doc.email}" style="color:#0056d2; text-decoration:none;">
         <strong>${lead. _doc.email}</strong>
       </a>`
      : "N/A"
    }</li>
        <li>Division: <strong>${lead?.division_display || "N/A"}</strong></li>
        <li>Assigned On: <strong>${dateStr}</strong></li>
      </ul>

      <p style="margin-top: 30px;">
        Regards,<br>
        <strong>${creator?.companyName || creator?.full_name}</strong>
      </p>
    </div>

    <!-- Footer -->
    <div style="padding: 20px; background: #f8f9fc; font-size: 12px; color: #6c757d; text-align: center;">
      <p style="margin:2px;">${creator?.address || ""}</p>
      <p style="margin:2px;">
        <a href="tel:${formatUSPhone(creator?.companyPhone) || ""}" style="color:#0056d2; text-decoration:none;">
          ${formatUSPhone(creator?.companyPhone) || ""}
        </a> | 
        <a href="mailto:${creator?.email || ""}" style="color:#0056d2; text-decoration:none;">
          ${creator?.email || ""}
        </a>
      </p>
      <p style="margin:2px;">
        Copyright © ${new Date().getFullYear()} ${creator?.companyName || creator?.full_name}
      </p>
    </div>

  </div>
  `;
}

module.exports = leadAssignedEmailTemplate;
