const ActivityLog = require('../models/ActivityLog');

const logActivity = async (
  projectId,
  user,
  module,
  action,
  description,
  changes = {},
  entityId = null,
  entityType = null
) => {
  try {
    const logData = {
      project_id: projectId,
      entity_id: entityId,
      entity_type: entityType,
      module,
      action,
      description,
      changes,
      user_id: user?._id || user?.id,
      user_name: user?.full_name || (user?.firstName ? `${user.firstName} ${user.lastName}` : (user?.name || 'System')),
      user_email: user?.email || '',
      timestamp: new Date()
    };

    const newLog = new ActivityLog(logData);
    await newLog.save();
    return newLog;

  } catch (error) {
    console.error('Failed to log activity:', error);
    return null;
  }
};

const stripHtml = (str) => {
  if (typeof str !== 'string') return str;
  return str
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(div|p|h1|h2|h3|h4|h5|h6|li)>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const getChanges = (oldData, newData, fieldsToTrack) => {
  const changes = [];
  fieldsToTrack.forEach(field => {
    const oldValue = oldData[field];
    const newValue = newData[field];

    if (field === 'line_items') {
      const oldItems = Array.isArray(oldValue) ? oldValue : [];
      const newItems = Array.isArray(newValue) ? newValue : [];

      const isItemMatch = (newItem, oldItem) => {
        if (newItem._id && oldItem._id) {
          return String(newItem._id) === String(oldItem._id);
        }
        return newItem.description === oldItem.description && newItem.category === oldItem.category;
      };

      // Find deleted items
      oldItems.forEach(oldItem => {
        const found = newItems.find(newItem => isItemMatch(newItem, oldItem));
        if (!found) {
          changes.push({
            field: 'Line Item',
            old: oldItem.description || oldItem.category || 'Unknown Item',
            new: '-',
            action: 'Delete'
          });
        }
      });

      // Find added items and updated items
      newItems.forEach(newItem => {
        const found = oldItems.find(oldItem => isItemMatch(newItem, oldItem));
        if (!found) {
          changes.push({
            field: newItem.imported_via_planscan ? 'Line Item (PlanScan AI)' : 'Line Item',
            old: '-',
            new: newItem.description || newItem.category || 'Unknown Item',
            action: 'Create'
          });
        } else {
          // Check for updates
          const fieldsToCheck = ['quantity', 'unit_price', 'total', 'description', 'category', 'unit'];
          fieldsToCheck.forEach(f => {
            if (found[f] !== newItem[f]) {
               let oldVal = found[f];
               let newVal = newItem[f];
               changes.push({
                 field: `Line Item (${found.description || found.category || 'Unknown'}) - ${f.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}`,
                 old: oldVal === undefined || oldVal === null || oldVal === '' ? '-' : oldVal,
                 new: newVal === undefined || newVal === null || newVal === '' ? '-' : newVal,
                 action: 'Update'
               });
            }
          });
        }
      });
      return;
    }

    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      let oldVal = oldValue === undefined || oldValue === null || oldValue === '' ? '-' : oldValue;
      let newVal = newValue === undefined || newValue === null || newValue === '' ? '-' : newValue;

      if (typeof oldVal === 'string') oldVal = stripHtml(oldVal);
      if (typeof newVal === 'string') newVal = stripHtml(newVal);

      if (oldVal !== newVal) {
        changes.push({
          field: field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          old: oldVal,
          new: newVal
        });
      }
    }
  });
  return changes;
};

module.exports = { logActivity, getChanges };
