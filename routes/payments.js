const express = require('express');
const router = express.Router();
const Payment = require('../models/Payment');
const auth = require('../middleware/auth');
const { logActivity } = require('../utils/activityLogger');
const sendMail = require('../utils/sendMail');
const paymentReceiptMail = require('../utils/paymentReceiptMail');
const Client = require('../models/Client');
const mongoose = require('mongoose');

// Resolve admin owner ID (same pattern used in invoices, projects, estimates)
const getOwnerId = (req) =>
  req.user.role_type === 'admin' ? req.user._id : req.user.created_by;

// Get all payments — scoped by admin (created_by)
router.get('/', auth, async (req, res) => {
  try {
    const ownerId = getOwnerId(req);
    const ownerObjectId = mongoose.Types.ObjectId.isValid(ownerId)
      ? new mongoose.Types.ObjectId(ownerId)
      : null;

    // Build admin-scoped base query
    const ownerFilter = ownerObjectId
      ? { $or: [{ created_by: ownerObjectId }, { created_by: ownerId.toString() }] }
      : { created_by: ownerId.toString() };

    const query = { ...ownerFilter };

    if (req.query.project_id) {
      const projectConditions = [{ project_id: req.query.project_id }];
      if (mongoose.Types.ObjectId.isValid(req.query.project_id)) {
        projectConditions.push({ project_id: new mongoose.Types.ObjectId(req.query.project_id) });
      }
      // Merge with owner filter using $and
      query.$and = [ownerFilter, { $or: projectConditions }];
      delete query.$or;
    }

    const sort = req.query.sort || '-createdAt';

    const payments = await Payment.find(query)
      .populate('project_id', 'project_name')
      .populate('invoice_id', 'invoice_number')
      .populate('customer_id', 'contact_name company_name email phone')
      .sort(sort);

    const responseData = payments.map(payment => ({
      ...payment.toObject(),
      id: payment.id || payment._id.toString(),
      _id: payment._id
    }));

    res.json(responseData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create payment
router.post('/', auth, async (req, res) => {
  try {
    const ownerId = getOwnerId(req);
    const payment = new Payment({
      ...req.body,
      created_by: ownerId
    });
    await payment.save();
    await payment.populate(['project_id', 'invoice_id', 'customer_id']);
    res.status(201).json(payment);

      // Activity Logging
    await logActivity(
      payment.project_id?._id || payment.project_id,
      req.user,
      'Payment',
      'Create',
      `Payment of $${payment.amount} recorded for invoice "${payment.invoice_id?.invoice_number || 'N/A'}".`,
      [
        { field: 'Payment Received', old: '-', new: payment.amount },
        { field: 'Payment Method', old: '-', new: payment.payment_method }
      ],
      payment.invoice_id?._id || payment.invoice_id,
      'Invoice'
    );

    // Send Payment Receipt Email
    if (payment.customer_id && payment.customer_id.email) {
      try {
        const ownerObjectId = mongoose.Types.ObjectId.isValid(ownerId) ? new mongoose.Types.ObjectId(ownerId) : null;
        const client = ownerObjectId ? await Client.findById(ownerObjectId).lean() : null;
        const logo = client?.client_logo || 'coyle.png';
        const downloadLink = `${process.env.APP_URL || 'http://localhost:5000'}/api/download-payment-receipt/${payment._id}`;
        
        const customerName = payment.customer_id.contact_name || payment.customer_id.company_name;
        
        const html = paymentReceiptMail(
          customerName,
          payment.amount,
          payment.payment_method,
          payment.payment_date || payment.createdAt,
          payment.reference_number || payment.check_number,
          downloadLink,
          client
        );

        await sendMail({
          from: client?.companyName || 'Our Company',
          to: payment.customer_id.email,
          subject: `Payment Receipt - ${client?.companyName || 'Our Company'}`,
          html: html
        });
      } catch (mailErr) {
        console.error('Error sending payment receipt email:', mailErr);
      }
    }
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Update payment
router.put('/:id', auth, async (req, res) => {
  try {
    const payment = await Payment.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    ).populate(['project_id', 'invoice_id', 'customer_id']);

    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    res.json(payment);

    // Activity Logging
    await logActivity(
      payment.project_id?._id || payment.project_id,
      req.user,
      'Payment',
      'Update',
      `Payment details updated for invoice "${payment.invoice_id?.invoice_number || 'N/A'}".`,
      [
        { field: 'Payment Amount', old: '-', new: payment.amount },
        { field: 'Payment Method', old: '-', new: payment.payment_method }
      ],
      payment.invoice_id?._id || payment.invoice_id,
      'Invoice'
    );
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;