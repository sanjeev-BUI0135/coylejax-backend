const mongoose = require("mongoose");
const bcrypt = require('bcryptjs');

const ClientSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    companyName: { type: String, required: true },
    companyPhone: { type: String, required: true },
    text_notifications: { type: Boolean, default: false },
    password: { type: String, required: true },
    address: { type: String },
    role_type: { type: String },
    timezone: { type: String },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
    logo: { type: String },
    companyFax: { tyep: String },
    roleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Role',
      required: false
    },
    created_by: {
      type: mongoose.Schema.Types.Mixed,
    },
    isDeleted: { type: Boolean, default: false },
    reset_password_token: String,
    reset_password_expires: Date,
    project_number_config: {
      new_project: {
        prefix: { type: String, required: true },
        year: { type: String, required: true },
        start_number: { type: Number, required: true },
        current_number: {
          type: Number,
          required: true,
          default: function () {
            return this.start_number;
          }
        },
        project_count: { type: Number, default: 0 }
      },

      service_project: {
        prefix: { type: String, required: true },
        year: { type: String, required: true },
        start_number: { type: Number, required: true },
        current_number: {
          type: Number,
          required: true,
          default: function () {
            return this.start_number;
          }
        },
        project_count: { type: Number, default: 0 }
      }
    }
  },
  { timestamps: true }
);
ClientSchema.index(
  {
    "project_number_config.new_project.prefix": 1,
  },
  { unique: true }
);

ClientSchema.index(
  {
    "project_number_config.service_project.prefix": 1,
  },
  { unique: true }
);

ClientSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

ClientSchema.methods.comparePassword = async function (password) {
  return bcrypt.compare(password, this.password);
};

module.exports = mongoose.model("Client", ClientSchema);
