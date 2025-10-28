import mongoose from "mongoose";

const logSchema = new mongoose.Schema(
  {
    admin_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
    action: {
      type: String,
      required: true,
      trim: true,
    },
    resource: {
      type: String,
      required: true,
      trim: true, // e.g., "user", "laboratory", "computer", "reservation", "usage_history"
    },
    resource_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null, // ID of the affected resource
    },
    method: {
      type: String,
      enum: ["CREATE", "READ", "UPDATE", "DELETE", "APPROVE", "REJECT", "CANCEL"],
      required: true,
    },
    details: {
      type: mongoose.Schema.Types.Mixed, // Store additional details about the action
      default: null,
    },
    ip_address: {
      type: String,
      default: null,
    },
    user_agent: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ["success", "failed", "error"],
      default: "success",
    },
    error_message: {
      type: String,
      default: null,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      required: true,
    },
  },
  { timestamps: true }
);

// Indexes for better query performance
logSchema.index({ admin_id: 1 });
logSchema.index({ action: 1 });
logSchema.index({ resource: 1 });
logSchema.index({ method: 1 });
logSchema.index({ status: 1 });
logSchema.index({ timestamp: -1 });

// Compound indexes for common queries
logSchema.index({ admin_id: 1, timestamp: -1 });
logSchema.index({ resource: 1, timestamp: -1 });
logSchema.index({ action: 1, timestamp: -1 });

// Virtual for id field (MongoDB uses _id by default)
logSchema.virtual('id').get(function() {
  return this._id.toHexString();
});

// Static method to create log entry
logSchema.statics.createLog = async function(adminId, action, resource, method, options = {}) {
  try {
    const log = new this({
      admin_id: adminId,
      action,
      resource,
      method,
      resource_id: options.resource_id || null,
      details: options.details || null,
      ip_address: options.ip_address || null,
      user_agent: options.user_agent || null,
      status: options.status || "success",
      error_message: options.error_message || null,
    });

    return await log.save();
  } catch (error) {
    console.error("Failed to create log entry:", error);
    // Don't throw error to prevent disrupting main operations
    return null;
  }
};

// Static method for bulk log creation
logSchema.statics.createBulkLogs = async function(logs) {
  try {
    return await this.insertMany(logs);
  } catch (error) {
    console.error("Failed to create bulk log entries:", error);
    return null;
  }
};

// Ensure virtual fields are serialized
logSchema.set('toJSON', {
  virtuals: true,
  transform: function(doc, ret) {
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

export default mongoose.model("Log", logSchema);