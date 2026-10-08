const { scheduleRemindersUntilStart } = require('./cron');
const User = require('../models/User');
const Client = require('../models/Client');
const sendMail = require('../utils/sendMail');
const formatUSPhone = require("../helpers/formatUSPhone");
async function getProjectCreator(project) {
  if (!project?.created_by) return null;

  let creator = await User.findById(project.created_by).lean();
  if (!creator) {
    creator = await Client.findById(project.created_by).lean();
  }
  return creator;
}

async function awardProject(project, bid) {
  if (!project) return;

  const creator = await getProjectCreator(project);

  const customer = project.customer_ids?.[0];
  if (customer?.email) {
    await sendAwardedEmail(project, creator, {
      name: customer.contact_name || 'Customer',
      email: customer.email,
      type: 'customer',
    });
  }

  if (bid?.bidder_email) {
    await sendAwardedEmail(project, creator, {
      name: bid.bidder_name,
      email: bid.bidder_email,
      type: 'bidder',
    });
  }
}

function formatDate(date) {
  if (!date) return 'Not set';

  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    timeZone: 'UTC',
  });
}


// Send immediate "Awarded" email
async function sendAwardedEmail(project, creator, recipient) {
  const customer = project.customer_ids?.[0];
  if (!recipient?.email) {
    return;
  }

  const htmlContent = `<table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f9fc; padding:40px 0;">
    <tr>
      <td align="center" style="padding:30px;">
        <img src="${process.env.APP_URL}${creator.logo}" width="200" alt="Coyle Logo" style="display:block; border:0;"/>
      </td>
    </tr>
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:10px; box-shadow:0 2px 8px rgba(0,0,0,0.05);">
          <tr>
            <td align="center" style="padding:0 20px 20px;">
              <img src="https://coylejax.app/icon_2.png" width="600" alt="Project Image" style="width:100%; max-width:600px; display:block;"/>
            </td>
          </tr>
          <tr>
            <td style="padding:30px; font-family:Arial, sans-serif;">
              <h2 style="color:#0074c2; text-align:center;">Congratulations! Your Project Has Been Awarded</h2>
              <p>Dear <strong>${recipient.name}</strong>,</p>
              <p>Your project <strong>${project.project_name}</strong> has been <strong>awarded</strong>.</p>
              <p>Estimated start date: <strong>${formatDate(project.estimated_start_date)}</strong>.</p>
              <p>We'll remind you daily until the start date. Thank you!</p>
              <p style="margin-top:30px;">Best regards,<br><strong>${creator?.companyName}</strong></p>
            </td>
          </tr>
          <tr>
            <td align="center" bgcolor="#f1f4f8" style="padding:20px; font-size:13px; color:#555;">
              <p style="margin:2px;">${creator?.address}</p>
              <p style="margin:2px;"><a href="tel:${formatUSPhone(creator?.companyPhone)}" style="color:#0056d2; text-decoration:none;">${formatUSPhone(creator?.companyPhone)}</a> | <a href="mailto:${creator?.email}" style="color:#0056d2; text-decoration:none;">${creator?.email}</a></p>
              <p style="margin:2px;">Copyright © ${new Date().getFullYear()} ${creator?.companyName || creator?.full_name}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;

  try {
    await sendMail({
      from: creator?.companyName,
      replyTo: creator?.email,
      to: recipient.email,
      subject: `Project "${project.project_name}" Awarded!`,
      html: htmlContent,
    });
  } catch (error) {
    console.error(' Error sending awarded email:', error);
  }
}

// Send "Processing Started" email
async function sendProcessingEmail(project) {
  const creator = await getProjectCreator(project)
  const customer = project.customer_ids?.[0];
  if (!customer?.email) {
    return;
  }

  const htmlContent = `<table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f9fc; padding:40px 0;">
    <tr>
      <td align="center" style="padding:30px;">
        <img src="${process.env.APP_URL}${creator.logo}" width="200" alt="Coyle Logo" style="display:block; border:0;"/>
      </td>
    </tr>
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:10px; box-shadow:0 2px 8px rgba(0,0,0,0.05);">
          <tr>
            <td align="center" style="padding:0 20px 20px;">
              <img src="https://coylejax.app/icon_2.png" width="600" alt="Project Image" style="width:100%; max-width:600px; display:block;"/>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:30px; font-family:Arial, sans-serif;">
              <h2 style="color:#0074c2; text-align:center;">Project Started Processing</h2>
              <p>Dear <strong>${customer.contact_name || 'Customer'}</strong>,</p>
              <p>Your project <strong>${project.project_name}</strong> has started processing today.</p>
              <p>We'll keep you updated on progress. Thank you.</p>
              <p style="margin-top:30px;">Best regards,<br><strong>${creator?.companyName || creator?.full_name}</strong></p>
            </td>
          </tr>
          <tr>
            <td align="center" bgcolor="#f1f4f8" style="padding:20px; font-size:13px; color:#555;">
              <p style="margin:2px;">${creator?.address}</p>
              <p style="margin:2px;"><a href="tel:${formatUSPhone(creator?.companyPhone)}" style="color:#0056d2; text-decoration:none;">${formatUSPhone(creator?.companyPhone)}</a> | <a href="mailto:${creator?.email}" style="color:#0056d2; text-decoration:none;">${creator?.email}</a></p>
              <p style="margin:2px;">Copyright © ${new Date().getFullYear()} ${creator?.companyName || creator?.full_name}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;

  try {
    await sendMail({
      from: creator?.companyName,
      replyTo: creator?.email,
      to: customer.email,
      subject: `Project "${project.project_name}" is now Processing`,
      html: htmlContent,
    });
  } catch (error) {
    console.error(' Error sending proces  sing email:', error);
  }
}

module.exports = {
  awardProject,
  sendProcessingEmail,
};