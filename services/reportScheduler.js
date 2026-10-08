const CustomReport = require('../models/CustomReport');
const customReportController = require('../controllers/customReportController');
const { DateTime } = require('luxon');

const startReportScheduler = () => {

  let isRunning = false;

  // Run every minute using native setInterval to avoid node-cron warnings
  setInterval(async () => {

    // Skip this tick if the previous run is still in progress
    if (isRunning) return;
    isRunning = true;

    try {
      const APP_TIMEZONE = process.env.APP_TIMEZONE || 'UTC';
      const now = DateTime.now().setZone(APP_TIMEZONE);

      const currentTime = now.toFormat('HH:mm');
      const currentDay = now.toFormat('cccc');
      const currentDate = now.toFormat('d');
      const currentYear = now.toFormat('yyyy');
      const reports = await CustomReport.find({
        status: 'Active'
      });



      for (const report of reports) {

        let shouldRun = false;
        const dbTime = report.schedule_time


        if (dbTime === currentTime) {

          switch (report.interval) {

            case 'Daily':
              shouldRun = true;
              break;

            case 'Weekly':
              shouldRun = report.schedule_day === currentDay;
              break;

            case 'Monthly':
              shouldRun = String(report.schedule_date) === currentDate;
              break;

            case 'Yearly':
              const currentMonth = now.toFormat('M');
              const currentDayOfMonth = now.toFormat('d');
              shouldRun = String(report.schedule_year) === currentYear && currentMonth === '12' && currentDayOfMonth === '31';
              break;
          }
        }


        if (shouldRun) {

          const todayStart = now.startOf('day').toJSDate();

          if (!report.last_run || report.last_run < todayStart) {

            await customReportController.runReport(report._id);

            report.last_run = new Date();

            await report.save();

          }
        }
      }

    } catch (error) {

      console.error('Scheduler Error:', error);

    } finally {
      isRunning = false;
    }

  }, 60000); // 60,000 ms = 1 minute

  console.log('Report Scheduler Initialized');

};

module.exports = { startReportScheduler };