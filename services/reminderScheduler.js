const Reminder = require('../models/Reminder');
const { sendReminderEmail } = require('../routes/remainders');
const { DateTime } = require('luxon');
const { logActivity } = require('../utils/activityLogger');
const User = require('../models/User');
const APP_TIMEZONE = process.env.APP_TIMEZONE || 'UTC';

// Run every minute to check for due reminders
function startReminderScheduler() {

  let isRunning = false;

  // Run every minute using native setInterval to avoid node-cron warnings
  setInterval(async () => {

    // Skip this tick if the previous run is still in progress
    if (isRunning) return;
    isRunning = true;

    try {
      const now = DateTime.now()
        .setZone(APP_TIMEZONE)
        .toUTC()
        .toJSDate();

      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
      const oneMinuteFromNow = new Date(now.getTime() + 1 * 60 * 1000);

      const dueReminders = await Reminder.find({
        status: 'pending',
        emailSent: false,
        reminderDateTime: {
          $gte: fiveMinutesAgo,
          $lte: oneMinuteFromNow,
        },
      });

      for (const reminder of dueReminders) {

        if (reminder.lastChecked) {
          const timeSinceLastCheck = now - reminder.lastChecked;
          if (timeSinceLastCheck < 120000) {
            continue;
          }
        }

        reminder.lastChecked = now;   
        await reminder.save();

        const emailSent = await sendReminderEmail(reminder);

        if (emailSent) {
          reminder.status = 'sent';
          reminder.emailSent = true;
          reminder.sentAt = now;      
          await reminder.save();

          if (reminder.projectId) {
            let user = await User.findById(reminder.created_by);
            if (!user) {
               const Client = require('../models/Client');
               user = await Client.findById(reminder.created_by);
            }
            await logActivity(
              reminder.projectId,
              user || { _id: reminder.created_by, full_name: 'System' },
              'Material Order',
              'Sent',
              `Material Reminder mail sent for "${reminder.materialName}".`,
              {},
              reminder._id,
              'Reminder'
            );
          }
        }
      }

    } catch (error) {
      console.error('Error in reminder scheduler:', error);
    } finally {
      isRunning = false;
    }
  }, 60000); 
}

module.exports = { startReminderScheduler };