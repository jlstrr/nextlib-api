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
    computer_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Computer",
      default: null,
      required: function() {
        return this.reservation_type === 'computer';
      }
    },
    laboratory_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Laboratory", 
      default: null,
      required: function() {
        return this.reservation_type === 'laboratory';
      }
    },
    reservation_date: {
      type: Date,
      required: true,
    },
    start_time: {
      type: String,
      required: true,
      validate: {
        validator: function(v) {
          // Validate military time format (HH:MM)
          return /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(v);
        },
        message: 'Start time must be in military time format (HH:MM, e.g., 14:30)'
      }
    },
    end_time: {
      type: String,
      required: true,
      validate: {
        validator: function(v) {
          // Validate military time format (HH:MM)
          return /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(v);
        },
        message: 'End time must be in military time format (HH:MM, e.g., 16:45)'
      }
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
reservationSchema.index({ user_id: 1 });
reservationSchema.index({ status: 1 });
reservationSchema.index({ reservation_type: 1 });
reservationSchema.index({ computer_id: 1 });
reservationSchema.index({ laboratory_id: 1 });
reservationSchema.index({ reservation_date: 1 });
reservationSchema.index({ start_time: 1 });
reservationSchema.index({ end_time: 1 });
reservationSchema.index({ reservation_date: 1, reservation_type: 1 });
reservationSchema.index({ reservation_date: 1, computer_id: 1 });
reservationSchema.index({ reservation_date: 1, laboratory_id: 1 });
reservationSchema.index({ start_time: 1, end_time: 1 });
reservationSchema.index({ user_id: 1, status: 1 });
reservationSchema.index({ approved_by: 1 });

// Virtual for id field (MongoDB uses _id by default)
reservationSchema.virtual('id').get(function() {
  return this._id.toHexString();
});

// Helper function to convert military time to minutes since midnight
const timeToMinutes = (timeString) => {
  const [hours, minutes] = timeString.split(':').map(Number);
  return hours * 60 + minutes;
};

// Helper function to convert minutes since midnight to military time
const minutesToTime = (minutes) => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
};

// Helper function to combine date and military time into a full DateTime
const combineDateAndTime = (date, timeString) => {
  const [hours, minutes] = timeString.split(':').map(Number);
  const combinedDate = new Date(date);
  combinedDate.setHours(hours, minutes, 0, 0);
  return combinedDate;
};

// Virtual for calculated end time (for backward compatibility)
// reservationSchema.virtual('calculated_end_time').get(function() {
//   if (this.end_time && this.reservation_date) {
//     return combineDateAndTime(this.reservation_date, this.end_time);
//   }
//   if (this.reservation_date && this.duration) {
//     return new Date(this.reservation_date.getTime() + (this.duration * 60 * 1000));
//   }
//   return null;
// });

// // Virtual for calculated start time (for backward compatibility)
// reservationSchema.virtual('calculated_start_time').get(function() {
//   if (this.start_time && this.reservation_date) {
//     return combineDateAndTime(this.reservation_date, this.start_time);
//   }
//   return this.reservation_date;
// });

// // Virtual for calculated duration (for backward compatibility)
// reservationSchema.virtual('calculated_duration').get(function() {
//   if (this.duration) {
//     return this.duration;
//   }
//   if (this.start_time && this.end_time) {
//     const startMinutes = timeToMinutes(this.start_time);
//     const endMinutes = timeToMinutes(this.end_time);
    
//     // Handle cases where end time is next day (e.g., start: 23:30, end: 01:30)
//     if (endMinutes < startMinutes) {
//       return (24 * 60 - startMinutes) + endMinutes;
//     }
//     return endMinutes - startMinutes;
//   }
//   return null;
// });

// Pre-save middleware to validate reservation constraints
reservationSchema.pre('save', async function(next) {
  // Skip validation if document is being deleted
  if (this.isDeleted) return next();

  try {
    // Validate that reservation is not in the past (only for new reservations)
    if (this.isNew && this.start_time && this.reservation_date) {
      const startDateTime = combineDateAndTime(this.reservation_date, this.start_time);
      const now = new Date();
      
      if (startDateTime < now) {
        const error = new Error('Cannot create reservation in the past');
        error.name = 'ValidationError';
        return next(error);
      }
    }

    // Validate that end_time is after start_time
    if (this.start_time && this.end_time) {
      const startMinutes = timeToMinutes(this.start_time);
      const endMinutes = timeToMinutes(this.end_time);
      
      // For same-day reservations, end time must be after start time
      if (endMinutes <= startMinutes) {
        const error = new Error('End time must be after start time on the same day');
        error.name = 'ValidationError';
        return next(error);
      }

      // Calculate and validate duration consistency
      const calculatedDuration = endMinutes - startMinutes;
      if (this.duration && Math.abs(this.duration - calculatedDuration) > 1) {
        const error = new Error('Duration must match the difference between start_time and end_time');
        error.name = 'ValidationError';
        return next(error);
      }

      // Auto-set duration if not provided
      if (!this.duration) {
        this.duration = calculatedDuration;
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