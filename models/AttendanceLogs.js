import mongoose from "mongoose";

const attendanceLogsSchema = new mongoose.Schema(
  {
    user_type: {
      type: String,
      enum: ["student", "visitor"],
      required: true,
    },

    // For student only - reference to User model
    id_number: {
      type: String,
      required: function() {
        return this.user_type === "student";
      },
      ref: "User",
    },

    // For visitor only
    name: {
      type: String,
      required: function() {
        return this.user_type === "visitor";
      },
    },

    // For visitor only
    address: {
      type: String,
      required: function() {
        return this.user_type === "visitor";
      },
    },

    purpose: {
      type: String,
      required: true,
    },

    logged_at: {
      type: Date,
      default: Date.now,
    },

    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Index for better query performance
attendanceLogsSchema.index({ user_type: 1, logged_at: -1 });
attendanceLogsSchema.index({ id_number: 1 }, { sparse: true });

// Virtual to populate user data for students
attendanceLogsSchema.virtual('user_data', {
  ref: 'User',
  localField: 'id_number',
  foreignField: 'id_number',
  justOne: true
});

// Ensure virtual fields are serialized
attendanceLogsSchema.set('toJSON', { virtuals: true });

const AttendanceLogs = mongoose.model("AttendanceLogs", attendanceLogsSchema);

export default AttendanceLogs;