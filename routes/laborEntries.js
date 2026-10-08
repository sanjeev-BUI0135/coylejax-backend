const express = require('express');
const router = express.Router();
const LaborEntry = require('../models/LaborEntry');
const auth = require('../middleware/auth');
const { logActivity } = require('../utils/activityLogger');
const { createIdQuery, createForeignKeyQuery } = require('../utils/idHelper');
const Project = require('../models/Project');
const User = require("../models/User");
const Client =require("../models/Client")

router.get('/', auth, async (req, res) => {
  try {
    const laborEntries = await LaborEntry.find({ employee_id: req.user._id }).sort({ date: -1 });
    const responseData = laborEntries.map(laborEntry => ({
      ...laborEntry.toObject(),
      id: laborEntry.id || laborEntry._id.toString(),
      _id: laborEntry._id
    }));
    res.json(responseData);
  } catch (err) {
    console.error('Error fetching labor entries:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/all', auth, async (req, res) => {
  try {
    const laborEntries = await LaborEntry.find().populate('employee_id', 'full_name created_by')
      .sort({ date: -1 });

    const projects = await Project.find({}, 'project_type');
    const projectTypeMap = {};
    projects.forEach(project => {
      projectTypeMap[project._id.toString()] = project.project_type;
    });

    const users = await User.find({}, 'full_name');
    const clients = await Client.find({}, 'firstName lastName');

    const userMap = {};
    users.forEach(u => {
      userMap[u._id.toString()] = u.full_name;
    });

    const clientMap = {};
    clients.forEach(c => {
      clientMap[c._id.toString()] = `${c.firstName} ${c.lastName}`
    });

    const responseData = laborEntries.map(entry => {
      const empId = entry.employee_id?._id?.toString();

      let employeeName = 'Unknown Employee';

      if (userMap[empId]) {
        employeeName = userMap[empId];
      } else if (clientMap[empId]) {
        employeeName = clientMap[empId];
      }

      return {
        ...entry.toObject(),
        id: entry._id.toString(),
        employee_name: employeeName,
        project_type: projectTypeMap[entry.project_id] || 'Unknown'
      };
    });

    res.json({
      success: true,
      count: responseData.length,
      data: responseData
    });

  } catch (err) {
    console.error('Error fetching all labor entries:', err);
    res.status(500).json({
      success: false,
      error: 'Server error while fetching labor entries'
    });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const searchId = req.params.id;
    const query = createIdQuery(searchId);
    const laborEntry = await LaborEntry.findOne(query);

    if (!laborEntry) {
      return res.status(404).json({ error: 'Labor entry not found' });
    }
    const responseData = {
      ...laborEntry.toObject(),
      id: laborEntry.id || laborEntry._id.toString(),
      _id: laborEntry._id
    };

    res.json(responseData);
  } catch (err) {
    console.error('Error fetching labor entry:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { start_time, end_time, date } = req.body;
    
    const calculateTotalHours = (start, end, baseDate) => {
      const [startHours, startMins] = start.split(':').map(Number);
      const [endHours, endMins] = end.split(':').map(Number);
      const startDate = new Date(baseDate);
      const endDate = new Date(baseDate);
      startDate.setHours(startHours, startMins, 0, 0);
      endDate.setHours(endHours, endMins, 0, 0);
      if (endDate <= startDate) {
        endDate.setDate(endDate.getDate() + 1);
      }
      const diffMs = endDate - startDate;
      const totalHours = diffMs / (1000 * 60 * 60);
      return Math.round(totalHours * 100) / 100;
    };
    
    const totalHours = calculateTotalHours(start_time, end_time, date);

    let employeeModel = 'User';
    let createdByModel = 'User';
    let employee_name = 'Unknown Employee';

    const userRecord = await User.findById(req.user._id);
    if (userRecord) {
      employeeModel = 'User';
      createdByModel = 'User';
      employee_name = userRecord.full_name || 'Unknown Employee';
    } else {
      
      const clientRecord = await Client.findById(req.user._id);
      if (clientRecord) {
        employeeModel = 'Client';
        createdByModel = 'Client';
        employee_name = `${clientRecord.firstName} ${clientRecord.lastName}`;
      }
    }

    const laborEntry = new LaborEntry({
      ...req.body,
      total_hours: totalHours,
      employee_id: req.user._id,
      employee_model: employeeModel,  
      employee_name: employee_name,   
      created_by: req.user._id,
      created_by_model: createdByModel,
    });
    
    await laborEntry.save();
    res.status(201).json(laborEntry);

    // Activity Logging
    await logActivity(
      laborEntry.project_id,
      req.user,
      'Labor Entry',
      'Create',
      `Labor entry for "${employee_name}" recorded (${totalHours} hours).`,
      { employee_name, total_hours: totalHours, date }
    );
  } catch (err) {
    console.error('Error creating labor entry:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// router.put('/:id', auth, async (req, res) => {
//   try {
//     const laborEntry = await LaborEntry.findByIdAndUpdate(
//       req.params.id,
//       req.body,
//       {
//         new: true,
//         runValidators: true
//       }
//     );
//     if (!laborEntry) {
      
//       return res.status(404).json({ error: 'Labor entry not found' });
//     }
   
//     res.json(laborEntry);

//     // Activity Logging
//     await logActivity(
//       laborEntry.project_id,
//       req.user,
//       'Labor Entry',
//       'Update',
//       `Labor entry for "${laborEntry.employee_name}" updated.`,
//       { employee_name: laborEntry.employee_name, total_hours: laborEntry.total_hours }
//     );
//   } catch (err) {
//     console.error('Error updating labor entry:', err);
//     if (err.name === 'CastError') {
//       return res.status(400).json({ error: 'Invalid labor entry ID' });
//     }
//     if (err.name === 'ValidationError') {
//       return res.status(400).json({ error: err.message });
//     }
//     res.status(500).json({ error: 'Server error' });
//   }
// });

router.put('/:id', auth, async (req, res) => {
  try {

    const existingEntry = await LaborEntry.findById(req.params.id);

    if (!existingEntry) {
      return res.status(404).json({
        error: 'Labor entry not found'
      });
    }

    const changes = [];

    // project
    if ( req.body.project_id && req.body.project_id.toString() !==
      existingEntry.project_id?.toString()
    ) {
      changes.push({
        field: "project_id",
        from: existingEntry.project_id,
        to: req.body.project_id,
      });
    }

    // date
    if (
      req.body.date &&
      new Date(req.body.date).toISOString() !==
      new Date(existingEntry.date).toISOString()
    ) {
      changes.push({
        field: "date",
        from: existingEntry.date,
        to: req.body.date,
      });
    }

    // start time
    if (
      req.body.start_time &&
      req.body.start_time !== existingEntry.start_time
    ) {
      changes.push({
        field: "start_time",
        from: existingEntry.start_time,
        to: req.body.start_time,
      });
    }

    // end time
    if (
      req.body.end_time &&
      req.body.end_time !== existingEntry.end_time
    ) {
      changes.push({
        field: "end_time",
        from: existingEntry.end_time,
        to: req.body.end_time,
      });
    }

    // description
    if (
      req.body.description !== undefined &&
      req.body.description !== existingEntry.description
    ) {
      changes.push({
        field: "description",
        from: existingEntry.description,
        to: req.body.description,
      });
    }

    // detect model
    let changedByModel = "User";
    let changedByName = "Unknown User";

    const userRecord = await User.findById(req.user._id);

    if (userRecord) {
      changedByModel = "User";
      changedByName = userRecord.full_name;
    } else {

      const clientRecord = await Client.findById(req.user._id);

      if (clientRecord) {
        changedByModel = "Client";
        changedByName =
          `${clientRecord.firstName} ${clientRecord.lastName}`;
      }
    }

    const updateData = {
      ...req.body,
    };

    // add history
    if (changes.length > 0) {

      updateData.$push = {
        change_history: {
          changed_by: req.user._id,
          changed_by_model: changedByModel,
          changed_by_name: changedByName,
          changed_at: new Date(),
          changes,
        }
      };
    }

    const laborEntry = await LaborEntry.findByIdAndUpdate(
      req.params.id,
      updateData,
      {
        new: true,
        runValidators: true
      }
    );

    res.json(laborEntry);

    // Activity Logging
    await logActivity(
      laborEntry.project_id,
      req.user,
      'Labor Entry',
      'Update',
      `Labor entry for "${laborEntry.employee_name}" updated.`,
      {
        employee_name: laborEntry.employee_name,
        total_hours: laborEntry.total_hours
      }
    );

  } catch (err) {

    console.error('Error updating labor entry:', err);

    if (err.name === 'CastError') {
      return res.status(400).json({
        error: 'Invalid labor entry ID'
      });
    }

    if (err.name === 'ValidationError') {
      return res.status(400).json({
        error: err.message
      });
    }

    res.status(500).json({
      error: 'Server error'
    });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    
    const laborEntry = await LaborEntry.findByIdAndDelete(req.params.id);
    if (!laborEntry) {
      return res.status(404).json({ error: 'Labor entry not found' });
    }
    res.json({ message: 'Labor entry deleted successfully' });

    // Activity Logging
    await logActivity(
      laborEntry.project_id,
      req.user,
      'Labor Entry',
      'Delete',
      `Labor entry for "${laborEntry.employee_name}" deleted.`,
      { employee_name: laborEntry.employee_name }
    );
  } catch (err) {
    console.error('Error deleting labor entry:', err);
    if (err.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid labor entry ID' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;