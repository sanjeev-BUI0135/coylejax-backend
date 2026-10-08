const cron = require("node-cron");
const Project = require('../models/Project');

const activeJobs = new Map();

function scheduleRemindersUntilStart(project, { sendReminderEmail, sendProcessingEmail }) {
  const customer = project.customer_ids?.[0];
  if (!customer?.email || !project.estimated_start_date) return;

  const projectId = project._id.toString();
  const startDate = new Date(project.estimated_start_date);
  if (isNaN(startDate.getTime())) return;

  if (activeJobs.has(projectId)) {
    activeJobs.get(projectId).stop();
    activeJobs.delete(projectId);
  }
  const CRON_SCHEDULE = process.env.REMINDER_CRON;
  const job = cron.schedule(CRON_SCHEDULE, async () => {

    try {
      const projectDoc = await Project.findById(projectId).populate('customer_ids', 'email contact_name');
      if (!projectDoc || projectDoc.status !== 'awarded') {
        job.stop();
        activeJobs.delete(projectId);
        return;
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0); 
      
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);

      if (today >= start) {
        projectDoc.status = 'processing';
        await projectDoc.save();
        await sendProcessingEmail(projectDoc);
        job.stop();
        activeJobs.delete(projectId);
        return;
      }

      // await sendReminderEmail(projectDoc, customer);
    } catch (err) {
      console.error('Error in scheduled job:', err.message);
    }
  });

  activeJobs.set(projectId, job);
}
async function initializeAwardedProjects({ sendReminderEmail, sendProcessingEmail }) {
  try {
    
    const awardedProjects = await Project.find({ status: 'awarded' })
      .populate('customer_ids', 'email contact_name');

    if (awardedProjects.length === 0) {
      
      return;
    }


    for (const project of awardedProjects) {
      if (!project.user_initials || !project.project_number) {
        console.warn(`Skipping project ${project._id}: Missing required fields (user_initials or project_number)`);
        continue;
      }
      const startDate = new Date(project.estimated_start_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      startDate.setHours(0, 0, 0, 0);

      if (today >= startDate) {
        project.status = 'processing';
        await project.save();
        await sendProcessingEmail(project);
      }
      //  else {
      //   scheduleRemindersUntilStart(project, { sendReminderEmail, sendProcessingEmail });
      // }
    }

  } catch (error) {
    console.error('Error initializing awarded projects:', error);
  }
}

function stopProjectReminder(projectId) {
  if (activeJobs.has(projectId)) {
    activeJobs.get(projectId).stop();
    activeJobs.delete(projectId);
  }
}

module.exports = { 
  scheduleRemindersUntilStart, 
  initializeAwardedProjects,
  stopProjectReminder 
};