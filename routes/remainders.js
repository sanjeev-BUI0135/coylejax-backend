const express = require('express');
const router = express.Router();
const Reminder = require('../models/Reminder');
const jwt = require('jsonwebtoken');
const auth = require('../middleware/auth');
const sendMail = require('../utils/sendMail');
const Estimate = require('../models/Estimate');
const Project = require('../models/Project');
const Customer = require('../models/Customer');
const User = require('../models/User');
const Client = require('../models/Client');
const mongoose = require("mongoose");
const { DateTime } = require('luxon');
const { logActivity } = require('../utils/activityLogger');
const APP_TIMEZONE = process.env.APP_TIMEZONE || 'UTC';

const getOwnerId = (req) => {
  if (req.user.role_type === "admin") {
    return new mongoose.Types.ObjectId(req.user._id);
  }
  return new mongoose.Types.ObjectId(req.user.created_by);
};


function convertTo24Hour(time12h) {
  if (!time12h || typeof time12h !== 'string') {
    throw new Error('Invalid time format. Expected format: "HH:MM AM/PM" or "HH:MM"');
  }

  const trimmedTime = time12h.trim();

  const hasAMPM = /\s*(AM|PM|am|pm)$/i.test(trimmedTime);

  if (!hasAMPM) {
    const timeParts = trimmedTime.split(':');
    if (timeParts.length !== 2) {
      throw new Error(`Invalid time format: "${time12h}". Time should be in HH:MM format`);
    }

    const [hours, minutes] = timeParts;
    const hoursInt = parseInt(hours, 10);
    const minutesInt = parseInt(minutes, 10);

    if (isNaN(hoursInt) || hoursInt < 0 || hoursInt > 23) {
      throw new Error(`Invalid hours: "${hours}". Hours must be between 0 and 23`);
    }

    if (isNaN(minutesInt) || minutesInt < 0 || minutesInt > 59) {
      throw new Error(`Invalid minutes: "${minutes}". Minutes must be between 0 and 59`);
    }

    return trimmedTime;
  }

  const parts = trimmedTime.split(/\s+/);

  if (parts.length !== 2) {
    throw new Error(`Invalid time format: "${time12h}". Expected format: "HH:MM AM" or "HH:MM PM"`);
  }

  const [time, modifier] = parts;

  const timeParts = time.split(':');
  if (timeParts.length !== 2) {
    throw new Error(`Invalid time format: "${time12h}". Time should be in HH:MM format`);
  }

  let [hours, minutes] = timeParts;
  let hoursInt = parseInt(hours, 10);

  if (isNaN(hoursInt) || hoursInt < 1 || hoursInt > 12) {
    throw new Error(`Invalid hours: "${hours}". Hours must be between 1 and 12 for 12-hour format`);
  }

  if (isNaN(parseInt(minutes)) || parseInt(minutes) < 0 || parseInt(minutes) > 59) {
    throw new Error(`Invalid minutes: "${minutes}". Minutes must be between 0 and 59`);
  }

  const upperModifier = modifier.toUpperCase();

  if (upperModifier !== 'AM' && upperModifier !== 'PM') {
    throw new Error(`Invalid time modifier: "${modifier}". Must be AM or PM`);
  }

  if (upperModifier === 'PM' && hoursInt !== 12) {
    hoursInt = hoursInt + 12;
  } else if (upperModifier === 'AM' && hoursInt === 12) {
    hoursInt = 0;
  }

  return `${hoursInt.toString().padStart(2, '0')}:${minutes}`;
}

function convertTo12Hour(time24h) {
  if (!time24h || typeof time24h !== 'string') {
    return time24h;
  }

  if (/\s*(AM|PM|am|pm)$/i.test(time24h)) {
    return time24h;
  }

  let [hours, minutes] = time24h.split(':');
  let hoursInt = parseInt(hours, 10);

  if (isNaN(hoursInt)) {
    return time24h;
  }

  const modifier = hoursInt >= 12 ? 'PM' : 'AM';

  if (hoursInt === 0) {
    hoursInt = 12;
  } else if (hoursInt > 12) {
    hoursInt = hoursInt - 12;
  }

  return `${hoursInt.toString().padStart(2, '0')}:${minutes} ${modifier}`;
}

router.post('/', auth, async (req, res) => {
  try {
    const {
      projectName,
      projectNo,
      materialName,
      reminderDate,
      reminderTime,
      orderId,
      estimateId,
      projectId,
    } = req.body;

    const estimate = await Estimate.findById(estimateId).select('created_by_user');
    let displayName = projectName;
    if (projectId) {

      const project = await Project.findById(projectId);

      if (project) {
        const rawCustomer = Array.isArray(project.customer_ids)
          ? project.customer_ids[0]
          : project.customer_ids;

        const customerId =
          typeof rawCustomer === "object"
            ? rawCustomer?._id
            : rawCustomer;

        let customer = null;

        if (customerId) {
          customer = await Customer.findById(customerId);
        }

        displayName = [
          customer?.company_name,
          project.project_name,
          customer?.contact_name
        ]
          .filter(Boolean)
          .join(" - ") || project.project_name;
      }
    }

    let userEmail = req.user.email;
    const adminId = getOwnerId(req);

    if (estimate && estimate.created_by_user) {
      const creatorId = estimate.created_by_user;

      // Try finding in User model
      let creator = await User.findById(creatorId);

      // If not found in User, try Client model
      if (!creator) {
        creator = await Client.findById(creatorId);
      }

      if (creator && creator.email) {
        userEmail = creator.email;
      }
    }
    // Validate required fields
    if (!projectName || !projectNo || !materialName || !reminderDate || !reminderTime) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required'
      });
    }

    // Convert time to 24-hour format (handles both 12-hour and 24-hour input)
    let time24h;
    let time12h;
    try {
      time24h = convertTo24Hour(reminderTime);
      time12h = convertTo12Hour(time24h);
    } catch (conversionError) {
      return res.status(400).json({
        success: false,
        message: conversionError.message
      });
    }

    const [year, month, day] = reminderDate.split('-');
    const [hours, minutes] = time24h.split(':');

    const reminderDateTime = DateTime.fromObject(
      {
        year: parseInt(year),
        month: parseInt(month),
        day: parseInt(day),
        hour: parseInt(hours),
        minute: parseInt(minutes),
      },
      { zone: APP_TIMEZONE }
    )
      .toUTC()
      .toJSDate();

    if (isNaN(reminderDateTime.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date or time format'
      });
    }

    const now = new Date();
    const oneMinuteAgo = new Date(now.getTime() - 60000);

    if (reminderDateTime < oneMinuteAgo) {
      return res.status(400).json({
        success: false,
        message: 'Reminder date and time must be in the future'
      });
    }

    const reminder = new Reminder({
     projectName: displayName,
      projectNo,
      materialName,
      reminderDate,
      reminderTime: time12h,
      reminderDateTime,
      orderId: orderId || null,
      estimateId: estimateId || null,
      projectId: projectId || null,
      userId: req.user.id || req.user._id,
      userEmail: userEmail,
      status: 'pending',
      emailSent: false,
      createdAt: new Date(),
      created_by: adminId,
    });

    await reminder.save();

    if (projectId) {
      await logActivity(
        projectId,
        req.user,
        'Material Order',
        'Create',
        `Material Reminder set for "${materialName}".`,
        {},
        reminder._id,
        'Reminder'
      );
    }

    res.status(201).json({
      success: true,
      message: 'Reminder created successfully',
      data: reminder,
    });
  } catch (error) {
    console.error('Error creating reminder:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to create reminder',
      error: error.message,
    });
  }
});

// Get all reminders for a user
router.get('/', auth, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const reminders = await Reminder.find({ userId })
      .sort({ reminderDateTime: 1 });

    res.status(200).json({
      success: true,
      data: reminders,
    });
  } catch (error) {
    console.error('Error fetching reminders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reminders',
      error: error.message,
    });
  }
});

// Get pending reminders count
router.get('/pending-count', auth, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const count = await Reminder.countDocuments({
      userId,
      status: 'pending',
      emailSent: false,
      reminderDateTime: { $gte: new Date() }
    });

    res.status(200).json({
      success: true,
      count,
    });
  } catch (error) {
    console.error('Error counting reminders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to count reminders',
      error: error.message,
    });
  }
});

// Update a reminder
router.put('/:id', auth, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const {
      projectName,
      projectNo,
      materialName,
      reminderDate,
      reminderTime,
    } = req.body;

    let updateData = {
      projectName,
      projectNo,
      materialName,
      reminderDate,
    };

    if (reminderDate && reminderTime) {
      const time24h = convertTo24Hour(reminderTime);
      const time12h = convertTo12Hour(time24h);

      const [year, month, day] = reminderDate.split('-');
      const [hours, minutes] = time24h.split(':');
      const newReminderDateTime = new Date(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hours),
        parseInt(minutes),
        0
      );

      const oneMinuteAgo = new Date(Date.now() - 60000);
      if (newReminderDateTime < oneMinuteAgo) {
        return res.status(400).json({
          success: false,
          message: 'Reminder date and time must be in the future'
        });
      }

      updateData.reminderTime = time12h;
      updateData.reminderDateTime = newReminderDateTime;
      updateData.status = 'pending';
      updateData.emailSent = false;
    }

    const reminder = await Reminder.findOneAndUpdate(
      { _id: req.params.id, userId },
      updateData,
      { new: true }
    );

    if (!reminder) {
      return res.status(404).json({
        success: false,
        message: 'Reminder not found',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Reminder updated successfully',
      data: reminder,
    });
  } catch (error) {
    console.error('Error updating reminder:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update reminder',
      error: error.message,
    });
  }
});

// Delete a reminder
router.delete('/:id', auth, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const reminder = await Reminder.findOneAndDelete({
      _id: req.params.id,
      userId,
    });

    if (!reminder) {
      return res.status(404).json({
        success: false,
        message: 'Reminder not found',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Reminder deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting reminder:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete reminder',
      error: error.message,
    });
  }
});

function materialReminderMail(
  reminder,
  creator
) {

  const formattedDate = reminder?.reminderDate
    ? new Date(reminder.reminderDate).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
    : "";

  const BASE_URL = process.env.APP_URL;

  const logoUrl = creator?.logo
    ? `${BASE_URL}${creator.logo}`
    : `${BASE_URL}/default-logo.png`;

  const companyName = creator?.companyName || creator?.full_name;
  const companyPhone = creator?.companyPhone || "";
  const email = creator?.email || "";
  const address = creator?.address || "";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Material Reminder</title>
</head>

<body style="margin:0; padding:0; background-color:#f4f4f4; font-family: Arial, sans-serif;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%">

    <!-- Logo -->
    <td align="center" style="padding: 30px 20px 10px;">
      <img src="${logoUrl}"
        alt="Company Logo"
        width="200"
        style="max-width:200px; height:auto; display:block; margin-bottom:20px; border:0;">
    </td>

    <tr>
      <td align="center" bgcolor="#f4f4f4" style="padding: 20px;">
        <table border="0" cellpadding="0" cellspacing="0" width="600"
          style="background:#ffffff; border-radius:8px; box-shadow:0 2px 6px rgba(0,0,0,0.1);">

          <!-- Icon -->
          <tr>
            <td align="center" style="padding: 30px 20px 10px;">
              <img src="https://coylejax.app/icon_1.png"
                alt="Reminder Icon"
                width="100%"
                style="max-width:600px; height:auto; display:block;">
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 20px 30px; font-size:16px; line-height:24px; color:#333;">
              <p>Dear <b>${companyName}</b>,</p>

              <p>This is a reminder for your material order.</p>

              <p>Project Name:<b> ${reminder.projectName}</b></p>
              <p>Project Number:<b> ${reminder.projectNo}</b></p>
              <p>Material Name:<b> ${reminder.materialName}</b></p>
              <p>Reminder Date:<b>${formattedDate}</b></p>
              <p>Reminder Time:<b>${reminder.reminderTime}</b></p>
            </td>
          </tr>

          <!-- Closing -->
          <tr>
            <td style="padding: 0 30px 30px; font-size:14px; color:#333;">
              <p>Thank You,</p>
              <p><b>${companyName}</b></p>
            </td>
          </tr>

        </table>

        <!-- Footer -->
        <table border="0" cellpadding="0" cellspacing="0" width="600" style="margin-top:10px;">
          <tr>
            <td align="center" style="padding: 20px; font-size:12px; color:#555;">
              <p style="margin:2px;">${address}</p>
              <p style="margin:2px;">
                <a href="tel:${companyPhone}" style="color:#0056d2; text-decoration:none;">
                  ${companyPhone}
                </a> |
                <a href="mailto:${email}" style="color:#0056d2; text-decoration:none;">
                  ${email}
                </a>
              </p>
              <p style="margin:2px;">
                Copyright © ${new Date().getFullYear()} ${companyName}
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

// Function to send reminder email
async function sendReminderEmail(reminder) {
  try {

    let creator = await User.findById(reminder.created_by);

    if (!creator) {
      creator = await Client.findById(reminder.created_by);
    }

    const htmlContent = materialReminderMail(reminder, creator);

    const mailOptions = {
      from: `"${creator?.companyName || "Material Reminder"}" <${process.env.EMAIL_USER}>`,
      to: process.env.REMINDER_RECIPIENT_EMAIL || reminder.userEmail,
      subject: `Material Reminder: ${reminder.materialName}`,
      html: htmlContent
    };

    await sendMail(mailOptions);

    return true;

  } catch (error) {
    console.error("Email error:", error);
    return false;
  }
}

module.exports = { router, sendReminderEmail };