const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  project_id: {
    type: mongoose.Schema.Types.Mixed, // Accepts both String and ObjectId
    required: false
  },
  customer_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: false
  },
  invoice_id: {
    type: mongoose.Schema.Types.Mixed, // Accepts both String and ObjectId
  },
  invoice_number: String,
  customer_name: String,
  company_name: String,
  customer_email: String,
  customer_phone: String,
  payment_type: {
    type: String,
    enum: ['deposit', 'progress', 'final', 'change_order']
  },
  amount: {
    type: Number,
    required: true
  },
   processing_fee: {
    type: Number,
    default: 0
  },
  // payment_method: {
  //   type: String,
  //   enum: ['cash', 'check', 'credit_card', 'bank_transfer', 'financing']
  // },
  payment_method: { type: String, required: true },

  payment_date: Date,
  reference_number: String,
  check_number: String,
  status: {
    type: String,
    enum: ['pending', 'received', 'failed', 'refunded'],
    default: 'pending'
  },
  notes: String,
  created_by: {
    type: mongoose.Schema.Types.Mixed, // Accepts both String and ObjectId
    //ref: 'User'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Payment', paymentSchema);