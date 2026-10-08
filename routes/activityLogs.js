const express = require('express');
const router = express.Router();
const ActivityLog = require('../models/ActivityLog');
const auth = require('../middleware/auth');

router.get('/project/:projectId', auth, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { module, user, action, startDate, endDate } = req.query;

    const query = { project_id: projectId };

    if (module) query.module = module;
    if (user) query.user_name = { $regex: user, $options: 'i' };
    if (action) query.action = action;

    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = new Date(startDate);
      if (endDate) query.timestamp.$lte = new Date(endDate);
    }

    const logs = await ActivityLog.find(query)
      .sort({ timestamp: -1 })
      .populate('user_id', 'full_name firstName lastName email');
    res.json({ success: true, count: logs.length, data: logs });

  } catch (error) {
    console.error('Error fetching activity logs:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

router.get('/entity/:entityId', auth, async (req, res) => {
  try {
    const { entityId } = req.params;
    const { module, user, action, startDate, endDate } = req.query;

    const query = { entity_id: entityId };

    if (module) query.module = module;
    if (user) query.user_name = { $regex: user, $options: 'i' };
    if (action) query.action = action;

    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = new Date(startDate);
      if (endDate) query.timestamp.$lte = new Date(endDate);
    }

    const logs = await ActivityLog.find(query)
      .sort({ timestamp: -1 })
      .populate('user_id', 'full_name firstName lastName email');
    res.json({ success: true, count: logs.length, data: logs });

  } catch (error) {
    console.error('Error fetching activity logs by entity:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

module.exports = router;
