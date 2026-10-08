const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  company_name: {
    type: String,
    required: true
  },
  contact_name: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true,
    unique: true
  },
  phone: {
    type: String,
    required: true
  },
  address: String,
  city: String,
  state: String,
  zip_code: String,
  customer_type: {
    type: String,
    enum: ['residential', 'commercial', 'industrial'],
    default: 'residential'
  },
   division: {  
    type: String,
    trim: true
  },
  billing_information: String,
  file_attachments: [{
    file_name: String,
    file_url: String
  }],
  additional_contacts: [{
    contact_name: String,
    email: String,
    phone: String
  }],
  created_by: {
    type: mongoose.Schema.Types.Mixed,
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Customer', customerSchema);