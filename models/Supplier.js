const mongoose = require('mongoose');

const supplierSchema = new mongoose.Schema({
  company_name: {
    type: String,
    required: [false, 'Company name is required'],
    trim: false
  },
  contact_name: {
    type: String,
    required: [false, 'Contact name is required'],
    trim: false
  },
  email: {
    type: String,
    required: [false, 'Email is required'],
    trim: false,
    lowercase: false,
    // match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email']
  },
  phone: {
    type: String,
    required: [false, 'Phone number is required'],
    trim: true
  },
  address: {
    type: String,
    required: [false, 'Address is required'],
    trim: true
  },
  created_by: {
    type: mongoose.Schema.Types.Mixed,
  },
}, {
  timestamps: true
});

supplierSchema.pre('save', function (next) {
  this.updated_date = Date.now();
  next();
});

module.exports = mongoose.model("Supplier", supplierSchema);  
