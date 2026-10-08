const LaborEntry = require('../models/LaborEntry');
const Project = require('../models/Project');
const User = require('../models/User');

const exportLaborToCsv = async (entryIds) => {
  try {
    const entries = await LaborEntry.find({ _id: { $in: entryIds } })
      .populate('project_id', 'project_name location')
      .populate('employee_id', 'full_name')
      .sort({ date: -1 });

    const headers = [
      'Date', 'Employee', 'Project', 'Location', 'Start Time', 
      'End Time', 'Total Hours', 'Rate/Hour', 'Total Cost', 'Description'
    ];

    const escapeCsvField = (field) => {
      const str = String(field || '');
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const csvRows = entries.map(entry => {
      const row = [
        entry.date ? new Date(entry.date).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : '',
        entry.employee_id ? entry.employee_id.full_name : '',
        entry.project_id ? entry.project_id.project_name : '',
        entry.project_id ? entry.project_id.location : '',
        entry.start_time || '',
        entry.end_time || '',
        entry.total_hours || 0,
        entry.rate_per_hour || 0,
        entry.total_cost || 0,
        entry.description || ''
      ];
      return row.map(escapeCsvField).join(',');
    });

    const csvContent = [headers.join(','), ...csvRows].join('\n');
    return csvContent;

  } catch (error) {
    throw new Error(`CSV export failed: ${error.message}`);
  }
};

module.exports = { exportLaborToCsv };