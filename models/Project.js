const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
  project_number: {
    type: String,
    unique: true,
    required: true
  },
  user_initials: {
    type: String,
    required: false
  },
  project_name: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  customer_ids: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  }],
  project_creation_type: {
    type: String,
    required: false,
    default: 'new_project'
  },
  project_creation_type_name: {
    type: String,
    required: false,
    default: 'New Project'
  },
  project_type: {
    type: String,
    // enum: ['division_10', 'division_32', 'division_8', 'gates'],
    required: false
  },
  project_type_name: {
    type: String,
    required: false
  },
  description: {
    type: String,
  },
  location: String,
  billing_address: String,
  status: {
    type: String,
    enum: ['open', 'bid_submitted', 'awarded', 'processing', 'actively_working', 'completed', 'reopen', 'cancelled', 'lost'],
    default: 'open'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  lost_reason: {
    type: String,
    trim: true
  },
  lost_reason_note: {
    type: String,
    trim: true,
    default: "",
  },
  lost_date: {
    type: Date
  },
  materials_status: {
    type: String,
    enum: ['Not Ordered', 'Pending Delivery', 'Partially Received', 'All Materials In Stock'],
    default: 'Not Ordered'
  },
  estimated_start_date: Date,
  estimated_end_date: Date,
  actual_start_date: Date,
  actual_end_date: Date,

  // Status timeline tracking
  awarded_date: Date,
  processing_start_date: Date,
  completed_date: Date,

  // Status progression tracking - store as JSON string
  status_progression: {
    type: String,
    default: '[]'
  },

  // Store complete status history
  status_history: [{
    status: {
      type: String,
      enum: ['open', 'bid_submitted', 'awarded', 'processing', 'actively_working', 'completed', 'reopen', 'cancelled', 'lost'],
      default: 'open'
    },
    changed_at: {
      type: Date,
      default: Date.now
    },
    changed_by: String
  }],

  requirements: String,
  special_instructions: String,
  estimated_value: Number,
  final_value: Number,
  progress_percentage: {
    type: Number,
    default: 0
  },
  allocated_materials: [{
    inventory_item_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InventoryItem'
    },
    item_name: String,
    description: String,
    quantity: Number,
    unit: String,
    location: String,
    category: String,
    allocated_date: Date,
    last_allocated_date: Date,
    source: String,
    material_order_id: mongoose.Schema.Types.ObjectId
  }],
  file_attachments: [{
    file_name: String,
    file_url: String,
    crew_visible: {
      type: Boolean,
      default: false
    },
    uploaded_by: String,

    uploaded_by_id: {
      type: mongoose.Schema.Types.ObjectId
    },

    uploaded_by_model: {
      type: String,
      enum: ["User", "Client"]
    },

    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  created_by: {
    type: mongoose.Schema.Types.Mixed,
  },
  created_by_user: {
    type: mongoose.Schema.Types.Mixed,
  },
  is_sub_project: {
    type: Boolean,
    default: false
  },
  parent_project_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    default: null
  },
  sub_project_name: {
    type: String,
    default: null
  },
  warranty_reopen_date: {
    type: Date,
    default: null
  },
  warranty_notes: {
    type: String,
    default: ''
  },
  original_completion_date: {
    type: Date,
    default: null
  },
  is_inactive: {
    type: Boolean,
    default: false,
    index: true
  },
  inactive_at: {
    type: Date,
    default: null
  },
  reopened_at: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Method to update status progression
projectSchema.methods.updateStatusProgression = function (newStatus, changedBy = 'system') {
  try {
    // Parse current progression or initialize empty array
    const currentProgression = this.status_progression ?
      JSON.parse(this.status_progression) : [];

    // Add to status history
    this.status_history.push({
      status: newStatus,
      changed_at: new Date(),
      changed_by: changedBy
    });

    // Track specific milestone statuses for timeline
    const milestoneStatuses = ['awarded', 'processing', 'completed'];

    if (milestoneStatuses.includes(newStatus)) {
      // Check if this status already exists in progression
      const existingEntry = currentProgression.find(entry => entry.status === newStatus);

      if (!existingEntry) {
        // Add new milestone status with timestamp
        currentProgression.push({
          status: newStatus,
          date: new Date(),
          timestamp: Date.now()
        });

        // Sort by timestamp to maintain chronological order
        currentProgression.sort((a, b) => a.timestamp - b.timestamp);

        // Update the progression field
        this.status_progression = JSON.stringify(currentProgression);
      }
    }

    return currentProgression;
  } catch (error) {
    console.error('Error updating status progression:', error);
    // Reset to empty array if there's parsing error
    this.status_progression = '[]';
    return [];
  }
};

// Method to get status progression as array
projectSchema.methods.getStatusProgressionArray = function () {
  try {
    if (!this.status_progression || this.status_progression === '[]') {
      return [];
    }
    const progression = JSON.parse(this.status_progression);
    return Array.isArray(progression) ? progression : [];
  } catch (error) {
    console.error('Error parsing status progression:', error);
    return [];
  }
};

// Method to get simple status array (for timeline display)
projectSchema.methods.getSimpleStatusArray = function () {
  const progression = this.getStatusProgressionArray();
  return progression.map(entry => entry.status);
};

projectSchema.set('toJSON', {
  virtuals: true,
  transform: function (doc, ret) {
    // Add virtual field for easy access to status progression array
    ret.status_progression_array = doc.getStatusProgressionArray();
    ret.simple_status_array = doc.getSimpleStatusArray();
    return ret;
  }
});

projectSchema.set('toObject', {
  virtuals: true,
  transform: function (doc, ret) {
    ret.status_progression_array = doc.getStatusProgressionArray();
    ret.simple_status_array = doc.getSimpleStatusArray();
    return ret;
  }
});

module.exports = mongoose.model('Project', projectSchema);