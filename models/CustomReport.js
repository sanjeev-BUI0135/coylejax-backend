const mongoose = require('mongoose');

const customReportSchema = new mongoose.Schema({
  report_type: {
    type: String,
    enum: ['Project', 'Estimate', 'Invoice'],
    required: true
  },
  report_name: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['Active', 'Inactive'],
    default: 'Active'
  },
  filters: [{
    field: String,
    condition: String,
    value: mongoose.Schema.Types.Mixed,
    operator: String
  }],
  selected_fields: [String],
  interval: {
    type: String,
    enum: ['Daily', 'Weekly', 'Monthly', 'Yearly', 'Custom'],
    required: true
  },
  schedule_time: {
    type: String,
    required: true,
    default: '10:00'
  },
  schedule_day: String,
  schedule_date: String,
  schedule_year: String,
  attachment_type: {
    type: String,
    enum: ['Excel'],
    default: 'Excel'
  },
  target_users: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  additional_emails: String,
  email_subject: String,
  email_text: String,
  last_run: Date,
  created_by: {
    type: mongoose.Schema.Types.Mixed
  },
  created_by_user: {
    type: mongoose.Schema.Types.Mixed
  },
  created_by_name: {
    type: String
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('CustomReport', customReportSchema);
