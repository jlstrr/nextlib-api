import mongoose from "mongoose";

const reservationSchema = new mongoose.Schema(
  {
    reservation_number: {
      type: String,
      unique: true,
      sparse: true, // Allows multiple documents with null values
    },
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    reservation_type: {
      type: String,
      enum: ["laboratory", "computer"],
      required: true,
    },
    reservation_date: {
      type: Date,
      required: true,
    },
    purpose: {
      type: String,
      required: true,
      trim: true,
    },
    notes: {
      type: String,
      trim: true,
      default: null,
    },
    duration: {
      type: Number, // Duration in minutes
      required: true,
      min: [1, "Duration must be at least 1 minute"],
      max: [480, "Duration cannot exceed 8 hours (480 minutes)"]
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "active", "completed", "cancelled"],
      default: "pending",
    },
    approved_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    started_at: {
      type: Date,
      default: null,
    },
    completed_at: {
      type: Date,
      default: null,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Indexes for better query performance
reservationSchema.index({ reservation_number: 1 });
reservationSchema.index({ user_id: 1 });
reservationSchema.index({ status: 1 });
reservationSchema.index({ reservation_type: 1 });
reservationSchema.index({ reservation_date: 1 });
reservationSchema.index({ reservation_date: 1, reservation_type: 1 });
reservationSchema.index({ user_id: 1, status: 1 });
reservationSchema.index({ approved_by: 1 });

// Virtual for id field (MongoDB uses _id by default)
reservationSchema.virtual('id').get(function() {
  return this._id.toHexString();
});

// Pre-save middleware to validate reservation constraints
reservationSchema.pre('save', async function(next) {
  // Skip validation if document is being deleted
  if (this.isDeleted) return next();

  try {
    // Validate that reservation is not in the past (only for new reservations)
    if (this.isNew && this.reservation_date) {
      const reservationDate = new Date(this.reservation_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      if (reservationDate < today) {
        const error = new Error('Cannot create reservation in the past');
        error.name = 'ValidationError';
        return next(error);
      }
    }

    next();
  } catch (error) {
    next(error);
  }
});

// Ensure virtual fields are serialized
reservationSchema.set('toJSON', {
  virtuals: true,
  transform: function(doc, ret) {
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

export default mongoose.model("Reservation", reservationSchema);