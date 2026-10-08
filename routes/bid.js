const express = require('express');
const router = express.Router();
const Bid = require('../models/Bid');
const Project = require('../models/Project');
const User = require('../models/User');
const { awardProject } = require('../utils/projectEmails');
const { getProjectCreator } = require('../helpers/getProjectCreator');
const sendMail = require('../utils/sendMail');

// GET /api/bids - Get all bids with filter by submitted_by_id
router.get('/', async (req, res) => {
  try {
    const { project_id, status, submitted_by_id } = req.query;
    const query = {};

    if (project_id) query.project_id = project_id;
    if (status) query.status = status;
    if (submitted_by_id) query.submitted_by_id = submitted_by_id;

    const bids = await Bid.find(query)
      .populate('project_id', 'project_name project_number')
      .populate('submitted_by_id', 'full_name email')
      .sort('-createdAt');

    res.json(bids);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/bids/project/:projectId - Get bids for a specific project
router.get('/project/:projectId', async (req, res) => {
  try {
    const bids = await Bid.find({ project_id: req.params.projectId })
      .populate('submitted_by_id', 'full_name email')
      .sort('-createdAt');

    res.json(bids);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/bids - Create a new bid submission
router.post('/', async (req, res) => {
  try {
    const {
      project_id,
      submitted_by_id,
      customer_request,
      bid_value
    } = req.body;

    if (!project_id || !submitted_by_id || !bid_value) {
      return res.status(400).json({
        error: 'Missing required fields: project_id, submitted_by_id, bid_value'
      });
    }

    const bidUser = await User.findById(submitted_by_id);
    if (!bidUser) {
      return res.status(404).json({ error: 'Bid user not found' });
    }

    const bid = new Bid({
      project_id,
      submitted_by_id,
      bidder_name: bidUser.full_name,
      bidder_email: bidUser.email,
      customer_request: customer_request || '',
      bid_value,
      notes: '',
      status: 'pending'
    });

    await bid.save();

    // Update project status
    const project = await Project.findById(project_id);
    if (project) {
      if (project.status === 'open_bids') {
        project.status = 'bid_submitted';
      }
      await project.save();
    }

    await bid.populate('project_id', 'project_name project_number');
    await bid.populate('submitted_by_id', 'full_name email');

    res.status(201).json(bid);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// PATCH /api/bids/:id/accept - Accept a bid
router.patch('/:id/accept', async (req, res) => {
  try {
    const { reviewed_by } = req.body;

    const bid = await Bid.findById(req.params.id)
      .populate('project_id', 'project_name project_number')
      .populate('submitted_by_id', 'full_name email');

    if (!bid) {
      return res.status(404).json({ error: 'Bid not found' });
    }

    bid.status = 'accepted';
    bid.reviewed_by = reviewed_by;
    bid.reviewed_at = new Date();
    await bid.save();

    const project = await Project.findById(bid.project_id._id);
    const creator = await getProjectCreator(project);

    if (project) {
      project.status = 'awarded';
      await project.save();
    }

    const projectWithCustomer = await Project.findById(project._id)
      .populate('customer_ids', 'email contact_name');

    await awardProject(projectWithCustomer, bid);

    await Bid.updateMany(
      {
        project_id: bid.project_id._id,
        _id: { $ne: bid._id },
        status: 'pending'
      },
      {
        status: 'rejected',
        reviewed_by: reviewed_by,
        reviewed_at: new Date(),
        rejection_reason: 'Another bid was accepted'
      }
    );

    const html = `
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f9fc; padding:40px 0;">
  <tr>
    <td align="center" style="padding:30px;">
      <img src="${process.env.APP_URL}${creator?.logo || ''}" width="200" alt="Company Logo" />
    </td>
  </tr>
  <tr>
    <td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:10px;">
        <tr>
          <td style="padding:30px; font-family:Arial, sans-serif;">
            <h2 style="color:#0074c2; text-align:center;">Congratulations! Your Bid Has Been Accepted</h2>
            <p>Dear <strong>${bid.bidder_name}</strong>,</p>
            <p>Your bid has been accepted for:</p>
            <ul style="list-style:none; padding:0;">
              <li><strong>Project:</strong> ${bid.project_id.project_name}</li>
              <li><strong>Project Number:</strong> ${bid.project_id.project_number}</li>
              <li><strong>Bid Value:</strong> $${bid.bid_value.toLocaleString()}</li>
            </ul>
            <p>We’ll contact you soon for next steps.</p>
            <p>Best regards,<br><strong>${creator?.companyName || creator?.full_name}</strong></p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
`;

    try {
      await sendMail({
        to: bid.bidder_email,
        subject: `Bid Accepted - ${bid.project_id.project_name}`,
        html,
        replyTo: creator?.email
      });
    } catch (mailErr) {
      console.error('Accept email failed:', mailErr.message);
    }

    res.json({
      success: true,
      bid,
      emailSent: true
    });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message });
  }
});


// PATCH /api/bids/:id/reject - Reject a bid
router.patch('/:id/reject', async (req, res) => {
  try {
    const { reviewed_by, rejection_reason } = req.body;

    const bid = await Bid.findById(req.params.id)
      .populate('project_id', 'project_name project_number')
      .populate('submitted_by_id', 'full_name email');

    if (!bid) {
      return res.status(404).json({ error: 'Bid not found' });
    }

    bid.status = 'rejected';
    bid.reviewed_by = reviewed_by;
    bid.reviewed_at = new Date();
    bid.rejection_reason = rejection_reason || '';
    await bid.save();

    const project = await Project.findById(bid.project_id._id);
    const creator = await getProjectCreator(project);

    const html = `
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f9fc; padding:40px 0;">
  <tr>
    <td align="center" style="padding:30px;">
      <img src="${process.env.APP_URL}${creator?.logo || ''}" width="200" alt="Company Logo" />
    </td>
  </tr>
  <tr>
    <td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:10px;">
        <tr>
          <td style="padding:30px; font-family:Arial, sans-serif;">
            <h2 style="color:#d9534f; text-align:center;">Bid Status Update</h2>
            <p>Dear <strong>${bid.bidder_name}</strong>,</p>
            <p>Thank you for your bid on:</p>
            <ul style="list-style:none; padding:0;">
              <li><strong>Project:</strong> ${bid.project_id.project_name}</li>
              <li><strong>Project Number:</strong> ${bid.project_id.project_number}</li>
              <li><strong>Bid Value:</strong> $${bid.bid_value.toLocaleString()}</li>
            </ul>
            <p>We’ve selected another bid for this project.</p>
            ${
              rejection_reason
                ? `<p><strong>Reason:</strong> ${rejection_reason}</p>`
                : ''
            }
            <p>We appreciate your interest and hope to work with you in the future.</p>
            <p>Best regards,<br><strong>${creator?.companyName || creator?.full_name}</strong></p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
`;

    let emailSent = true;
    try {
      await sendMail({
        to: bid.bidder_email,
        subject: `Bid Update - ${bid.project_id.project_name}`,
        html,
        replyTo: creator?.email
      });
    } catch (mailErr) {
      emailSent = false;
      console.error('Reject email failed:', mailErr.message);
    }

    res.json({
      success: true,
      bid,
      emailSent
    });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message });
  }
});

// DELETE /api/bids/:id - Delete a bid
router.delete('/:id', async (req, res) => {
  try {
    const bid = await Bid.findByIdAndDelete(req.params.id);
    if (!bid) {
      return res.status(404).json({ error: 'Bid not found' });
    }
    res.json({ message: 'Bid deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;