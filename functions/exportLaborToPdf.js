const jsPDF = require('jspdf');
require('jspdf-autotable');
const { formatDateUS } = require("../utils/dateformat");
const LaborEntry = require('../models/LaborEntry');

const exportLaborToPdf = async (entryIds, reportTitle = 'Labor Report') => {
  try {
    const entries = await LaborEntry.find({ _id: { $in: entryIds } })
      .populate('project_id', 'project_name location')
      .populate('employee_id', 'full_name')
      .sort({ date: -1 });

    const doc = new jsPDF();
    
    // Header
    doc.setFontSize(20);
    doc.setTextColor(15, 23, 42);
    doc.setFont(undefined, 'bold');
    doc.text('George P. Coyle and Sons', 105, 20, { align: 'center' });
    
    doc.setFontSize(16);
    doc.text(reportTitle, 105, 35, { align: 'center' });
    
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(`Generated on ${formatDateUS(new Date())}`, 105, 45, { align: 'center' });

    // Table
    const tableColumn = ['Date', 'Employee', 'Project', 'Hours', 'Rate', 'Cost'];
    const tableRows = [];
    
    let totalHours = 0;
    let totalCost = 0;

    entries.forEach(entry => {
      const hours = entry.total_hours || 0;
      const cost = entry.total_cost || 0;
      totalHours += hours;
      totalCost += cost;

      tableRows.push([
        entry.date ? new Date(entry.date).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : '',
        entry.employee_id ? entry.employee_id.full_name : '',
        entry.project_id ? entry.project_id.project_name : '',
        hours.toFixed(2),
        `$${(entry.rate_per_hour || 0).toFixed(2)}`,
        `$${cost.toFixed(2)}`
      ]);
    });

    // Add totals row
    tableRows.push([
      '', '', 'TOTALS:', 
      totalHours.toFixed(2), 
      '', 
      `$${totalCost.toFixed(2)}`
    ]);

    doc.autoTable({
      head: [tableColumn],
      body: tableRows,
      startY: 60,
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [71, 85, 105], textColor: [255, 255, 255] },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 20, right: 20 }
    });

    return doc.output('arraybuffer');

  } catch (error) {
    throw new Error(`PDF export failed: ${error.message}`);
  }
};

module.exports = { exportLaborToPdf };