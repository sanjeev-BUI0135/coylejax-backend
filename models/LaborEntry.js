const mongoose = require('mongoose');

const laborEntrySchema = new mongoose.Schema(
  {
    project_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },

    project_name: {
      type: String,
    },

    employee_id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "employee_model",
    },

    employee_model: {
      type: String,
      required: true,
      enum: ["User", "Client"], 
    },

    date: {
      type: Date,
      required: true,
    },

    start_time: {
      type: String,
      required: true,
    },

    end_time: {
      type: String,
      required: true,
    },

    total_hours: {
      type: Number,
      required: true,
    },

    rate_per_hour: {
      type: Number,
    },

    total_cost: {
      type: Number,
    },

    description: {
      type: String,
    },
    change_history: [
      {
        changed_by: {
          type: mongoose.Schema.Types.ObjectId,
          refPath: "change_history.changed_by_model",
        },

        changed_by_model: {
          type: String,
          enum: ["User", "Client"],
          required: true,
        },

        changed_by_name: {
          type: String,
        },

        changedAt: {
          type: Date,
          default: Date.now,
        },

        changes: [
          {
            field: String,
            from: mongoose.Schema.Types.Mixed,
            to: mongoose.Schema.Types.Mixed,
          }
        ]
      }
    ],
    // Also dynamic reference (optional)
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "created_by_model",
    },

    created_by_model: {
      type: String,
      enum: ["User", "Client", "Admin"],
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("LaborEntry", laborEntrySchema);