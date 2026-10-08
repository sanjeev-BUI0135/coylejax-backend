const express = require('express');
const router = express.Router();
const LaborEntry = require('../models/LaborEntry');
const User = require('../models/User');
const auth = require('../middleware/auth');
const Project = require('../models/Project');
const mongoose = require('mongoose');
const Client = require('../models/Client');

router.get('/time-entry', auth, async (req, res) => {
  try {
    const userRole = req.user.role_type;
    const userId = req.user._id;
    const createdByAdmin = req.user.created_by;

    // ---------------------------
    // PROJECT ACCESS FILTERING
    // ---------------------------
    let projectQuery;
    let laborQuery;

    if (userRole === "admin") {
      const employeesCreated = await User.find({
        $or: [
          { created_by: userId },
          { created_by: userId.toString() }
        ]
      }).select("_id");

      const employeeIds = employeesCreated.map(emp => emp._id);

      laborQuery = LaborEntry.find({
        $or: [
          { created_by: userId },
          { created_by: userId.toString() },
          { employee_id: { $in: employeeIds } }
        ]
      });

    } else {
      if (req.user.allDataVisible === true) {

        const employeesCreated = await User.find({
          $or: [
            { created_by: createdByAdmin },
            { created_by: createdByAdmin.toString() }
          ]
        }).select("_id");

        const employeeIds = employeesCreated.map(emp => emp._id);

        laborQuery = LaborEntry.find({
          $or: [
            { created_by: createdByAdmin },
            { created_by: createdByAdmin.toString() },
            { employee_id: { $in: employeeIds } }
          ]
        });

      } else {

        // normal user -> own entries only
        laborQuery = LaborEntry.find({
          $or: [
            { created_by: userId },
            { created_by: userId.toString() },
            { employee_id: userId }
          ]
        });

      }
    }

    const laborEntries = await laborQuery
      .populate("employee_id", "full_name firstName lastName companyName created_by")
      .sort({ date: -1 })
      .lean();

    const projectIdsFromEntries = [
      ...new Set(laborEntries.map(e => e.project_id?.toString()))
    ];

    const projects = await Project.find({
      _id: { $in: projectIdsFromEntries }
    })
      .select("project_name project_type _id created_by")
      .lean();

    const projectTypeMap = {};
    const projectNameMap = {};
    const allowedProjectIds = [];

    projects.forEach(project => {
      const id = project._id.toString();
      allowedProjectIds.push(id);
      projectTypeMap[id] = project.project_type;
      projectNameMap[id] =
        project.project_name || `Project ${id.slice(-6)}`;
    });

    // ---------------------------
    // WEEK RANGE
    // ---------------------------
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    const weekEntries = laborEntries.filter(e => {
      if (!e.date) return false;
      const d = new Date(e.date).getTime();
      return d >= startOfWeek.getTime() &&
        d <= endOfWeek.getTime();
    }).length;

    // ---------------------------
    // DASHBOARD CALCULATIONS
    // ---------------------------
    let totalHours = 0;
    const uniqueDates = new Set();
    const projectHoursMap = {};
    const employeeHoursMap = {};

    laborEntries.forEach(entry => {
      const hours = entry.total_hours || 0;
      const cost = entry.total_cost || 0;

      totalHours += hours;

      if (entry.date) {
        uniqueDates.add(
          new Date(entry.date).toISOString().split("T")[0]
        );
      }

      if (entry.project_id) {
        const pid = entry.project_id.toString();

        if (!projectHoursMap[pid]) {
          projectHoursMap[pid] = {
            projectId: pid,
            project_name: projectNameMap[pid] || "Unknown Project",
            totalHours: 0,
            totalCost: 0,
            entryCount: 0
          };
        }

        projectHoursMap[pid].totalHours += hours;
        projectHoursMap[pid].totalCost += cost;
        projectHoursMap[pid].entryCount++;
      }

      // Only admin sees team breakdown
      if (userRole === "admin" && entry.employee_id) {
        const empId = entry.employee_id._id?.toString();
        const empName = entry.employee_id.full_name;

        if (!employeeHoursMap[empId]) {
          employeeHoursMap[empId] = {
            employeeId: empId,
            employeeName: empName,
            totalHours: 0,
            entryCount: 0
          };
        }

        employeeHoursMap[empId].totalHours += hours;
        employeeHoursMap[empId].entryCount++;
      }
    });

    const projectHoursArray = Object.values(projectHoursMap)
      .sort((a, b) => b.totalHours - a.totalHours);

    // ---------------------------
    // DASHBOARD RESPONSE
    // ---------------------------
    const dashboard = {
      totalHours: +totalHours.toFixed(2),
      daysWorked: uniqueDates.size,
      avgHoursDay: uniqueDates.size
        ? +(totalHours / uniqueDates.size).toFixed(2)
        : 0,
      weekEntries,
      assignedProjects: projects.length,
      topProjectHours: projectHoursArray[0] || null,
      lowestProjectHours:
        projectHoursArray[projectHoursArray.length - 1] || null
    };

    if (userRole === "admin") {
      const empArray = Object.values(employeeHoursMap)
        .sort((a, b) => b.totalHours - a.totalHours);

      dashboard.teamStats = {
        totalEmployees: empArray.length,
        topPerformer: empArray[0] || null,
        averageHoursPerEmployee: empArray.length
          ? +(totalHours / empArray.length).toFixed(2)
          : 0,
        employeeBreakdown: empArray
      };
    }

    // ---------------------------
    // FINAL RESPONSE
    // ---------------------------
    res.json({
      dashboard,
      entries: {
        success: true,
        count: laborEntries.length,
        data: laborEntries.map(entry => ({
          ...entry,
          id: entry._id.toString(),
          employee_name: entry.employee_id?.full_name ||
            `${entry.employee_id?.firstName || ""} ${entry.employee_id?.lastName || ""}`.trim() ||
            entry.employee_id?.companyName ||
            "Unknown",
          project_type:
            projectTypeMap[entry.project_id?.toString()] || "Unknown",
          project_name:
            projectNameMap[entry.project_id?.toString()] ||
            "Unknown Project"
        }))
      },
      projectHours: Object.values(projectHoursMap).map(p => ({
        ...p,
        totalHours: +p.totalHours.toFixed(2),
        totalCost: +p.totalCost.toFixed(2)
      })),
      userContext: {
        role: userRole,
        userId
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Server error",
      details: err.message
    });
  }
});

router.get('/top-projects-hours', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const userRole = req.user.role_type;

    let user = await User.findById(userId).lean();
    if (!user) {
      user = await Client.findById(userId).lean();
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found in User/Client models' });
    }

    let laborEntries;

    if (userRole === 'admin') {

      const employeesCreatedByAdmin = await User.find({
        $or: [
          { created_by: userId },
          { created_by: userId.toString() }
        ]
      }).select('_id');

      const employeeIds = employeesCreatedByAdmin.map(emp => emp._id.toString());

      const allLaborEntries = await LaborEntry.find({})
        .sort({ date: -1 })
        .lean();

      laborEntries = allLaborEntries.filter(entry => {
        const createdBy = entry.created_by?.toString();
        const employeeId = entry.employee_id?._id?.toString() || entry.employee_id?.toString();

        return createdBy === userId.toString() || employeeIds.includes(employeeId);
      });

    } else {
      const allLaborEntries = await LaborEntry.find({})
        .sort({ date: -1 })
        .lean();

      laborEntries = allLaborEntries.filter(entry => {
        const employeeId = entry.employee_id?._id || entry.employee_id;
        const createdById = entry.created_by_id;
        const createdBy = entry.created_by;
        const entryUserId = entry.user_id;

        return (
          (employeeId && employeeId.toString() === userId.toString()) ||
          (createdById && createdById.toString() === userId.toString()) ||
          (createdBy && createdBy.toString() === userId.toString()) ||
          (entryUserId && entryUserId.toString() === userId.toString())
        );
      });
    }

    if (!laborEntries || laborEntries.length === 0) {
      return res.json({ projects: [] });
    }

    const allProjects = await Project.find({})
      .select('_id project_name')
      .lean();

    const projectNameMap = {};
    allProjects.forEach(project => {
      const projectId = project._id.toString();
      const projectName = project.project_name || `Project ${projectId.slice(-6)}`;
      projectNameMap[projectId] = projectName;
    });

    const projectHoursMap = {};

    laborEntries.forEach(entry => {
      if (entry.project_id) {
        let projectId;

        if (typeof entry.project_id === 'object' && entry.project_id._id) {
          projectId = entry.project_id._id.toString();
        } else {
          projectId = entry.project_id.toString();
        }

        let projectName = projectNameMap[projectId];
        if (!projectName) {
          projectName = entry.project_name || `Unknown Project (${projectId.slice(-6)})`;
        }

        if (!projectHoursMap[projectId]) {
          projectHoursMap[projectId] = {
            projectId,
            projectName,
            totalHours: 0
          };
        }

        projectHoursMap[projectId].totalHours += entry.total_hours || 0;
      }
    });


    const topProjects = Object.values(projectHoursMap)
      .filter(project => project.totalHours > 0)
      .sort((a, b) => b.totalHours - a.totalHours)
      .map(project => ({
        projectId: project.projectId,
        projectName: project.projectName,
        totalHours: Math.round(project.totalHours * 100) / 100
      }));

    res.json({
      projects: topProjects,
      totalProjects: topProjects.length
    });

  } catch (err) {
    res.status(500).json({
      error: 'Server error fetching top projects hours',
      details: err.message
    });
  }
});

router.get('/week-entries', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const userRole = req.user.role_type;

    let user = await User.findById(userId).lean();
    if (!user) {
      user = await Client.findById(userId).lean();
    }
    if (!user) {
      return res.status(404).json({ error: 'User not found in User/Client models' });
    }

    let laborEntries;

    if (userRole === 'admin') {
      const employeesCreatedByAdmin = await User.find({
        $or: [
          { created_by: userId },
          { created_by: userId.toString() }
        ]
      }).select('_id');

      const employeeIds = employeesCreatedByAdmin.map(emp => emp._id.toString());

      const allLaborEntries = await LaborEntry.find({})
        .sort({ date: -1 })
        .lean();

      laborEntries = allLaborEntries.filter(entry => {
        const createdBy = entry.created_by?.toString();
        const employeeId = entry.employee_id?._id?.toString() || entry.employee_id?.toString();

        return createdBy === userId.toString() || employeeIds.includes(employeeId);
      });

    } else {
      const allLaborEntries = await LaborEntry.find({})
        .sort({ date: -1 })
        .lean();

      laborEntries = allLaborEntries.filter(entry => {
        const employeeId = entry.employee_id?._id || entry.employee_id;
        const createdById = entry.created_by_id;
        const createdBy = entry.created_by;
        const entryUserId = entry.user_id;

        return (
          (employeeId && employeeId.toString() === userId.toString()) ||
          (createdById && createdById.toString() === userId.toString()) ||
          (createdBy && createdBy.toString() === userId.toString()) ||
          (entryUserId && entryUserId.toString() === userId.toString())
        );
      });
    }

    if (!laborEntries || laborEntries.length === 0) {
      return res.json({
        totalWeekHours: 0,
        weekEntries: [],
        weekRange: { start: null, end: null }
      });
    }

    const allProjects = await Project.find({}).select('_id project_name').lean();
    const projectNameMap = {};

    allProjects.forEach(project => {
      const id = project._id.toString();
      projectNameMap[id] = project.project_name || `Project ${id.slice(-6)}`;
    });

    const now = new Date();
    const currentDay = now.getDay();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - currentDay);
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    const formatTime = (timeString) => {
      if (!timeString?.trim()) return '';
      try {
        let hours, minutes;
        const t = String(timeString).trim();

        if (t.includes('T') || t.includes('Z') || t.length > 10) {
          const d = new Date(t);
          if (isNaN(d)) return '';
          hours = d.getHours(); minutes = d.getMinutes();
        } else if (t.includes(':')) {
          [hours, minutes] = t.split(':').map(n => parseInt(n, 10));
          if (isNaN(hours) || isNaN(minutes)) return '';
        } else {
          hours = parseInt(t, 10); minutes = 0;
          if (isNaN(hours)) return '';
        }

        const period = hours >= 12 ? 'PM' : 'AM';
        const h = (hours % 12) || 12;
        const m = String(minutes).padStart(2, '0');
        return `${h}:${m} ${period}`;
      } catch { return ''; }
    };


    const weekEntries = [];
    let totalWeekHours = 0;

    laborEntries.forEach(entry => {
      if (!entry.date || entry.total_hours == null) return;

      const date = new Date(entry.date);
      if (date >= startOfWeek && date <= endOfWeek) {
        totalWeekHours += entry.total_hours;

        let pid = entry.project_id?._id?.toString() || entry.project_id?.toString();
        let pname = projectNameMap[pid] || entry.project_name || "Unknown Project";

        weekEntries.push({
          id: entry._id?.toString() || "",
          date: date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
          rawDate: entry.date,
          projectId: pid,
          projectName: pname,
          description: entry.description || "",
          hours: +(entry.total_hours.toFixed(2)),
          startTime: formatTime(entry.start_time),
          endTime: formatTime(entry.end_time),
          timeRange: (formatTime(entry.start_time) && formatTime(entry.end_time))
            ? `${formatTime(entry.start_time)} – ${formatTime(entry.end_time)}`
            : formatTime(entry.start_time) || formatTime(entry.end_time),
          cost: entry.total_cost || 0
        });
      }
    });

    weekEntries.sort((a, b) => new Date(b.rawDate) - new Date(a.rawDate));
    totalWeekHours = +totalWeekHours.toFixed(2);

    res.json({
      totalWeekHours,
      weekEntries,
      weekRange: { start: startOfWeek.toISOString(), end: endOfWeek.toISOString() }
    });

  } catch (err) {
    console.err("Week Entry Error:", err);
    res.status(500).json({ error: "Server error fetching week entries", details: err.message });
  }
});


module.exports = router;