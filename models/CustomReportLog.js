const mongoose = require('mongoose');

const customReportLogSchema = new mongoose.Schema({
  report_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CustomReport',
    required: true
  },
  report_name: String,
  interval: String,
  schedule_time: String,
  execution_date: {
    type: Date,
    default: Date.now
  },
  email_status: {
    type: String,
    enum: ['Success', 'Failed'],
    default: 'Success'
  },
  error_message: String,
  recipients: [String],
  file_path: String
}, {
  timestamps: true
});

module.exports = mongoose.model('CustomReportLog', customReportLogSchema);
