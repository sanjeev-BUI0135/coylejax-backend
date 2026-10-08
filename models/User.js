const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const ProjectNumberSchema = new mongoose.Schema(
  {
    prefix: { type: String },
    year: { type: String },
    start_number: { type: Number },
    current_number: {
      type: Number,
      default: function () {
        return this.start_number;
      }
    },
    project_count: {
      type: Number,
      default: 0
    }
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    full_name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    phone: { type: String },
    text_notifications: { type: Boolean, default: false },
    password: { type: String, required: true },
    roleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Role"
    },
    role_type: {
      type: String,
      default: "field_employee"
    },
    leads_assigned: {
      type: Boolean,
      default: false
    },
    hourly_rate: {
      type: Number,
      default: 0
    },
    project_type: {
      type: [String],
      required: true
    },
    project_type_name: {
      type: [String]
    },
    created_by: mongoose.Schema.Types.Mixed,
    reset_password_token: String,
    reset_password_expires: Date,
    project_number_config: {
      new_project: {
        type: ProjectNumberSchema,
        required: function () {
          return this.role_type !== "Bid User";
        }
      },
      service_project: {
        type: ProjectNumberSchema,
        required: function () {
          return this.role_type !== "Bid User";
        }
      }
    }
  },
  { timestamps: true }
);

userSchema.index(
  {
    "project_number_config.new_project.prefix": 1,
  },
  { unique: true }
);

userSchema.index(
  {
    "project_number_config.service_project.prefix": 1,
  },
  { unique: true }
);

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = async function (password) {
  return bcrypt.compare(password, this.password);
};

module.exports = mongoose.model("User", userSchema);
