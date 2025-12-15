import mongoose from "mongoose";
import { getTZCurrentTimeString } from "../utils/timezone.js";

const usageHistorySchema = new mongoose.Schema(
  {
    reservation_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Reservation",
      required: true,
    },
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    date: {
      type: Date,
      required: true,
      default: Date.now,
    },
    time_in: {
      type: String,
      required: true,
      validate: {
        validator: function(value) {
          // Validate 24-hour time format HH:MM
          return /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(value);
        },
        message: "Time in must be in 24-hour format (HH:MM), e.g., 08:30"
      }
    },
    time_out: {
      type: String,
      default: null,
      validate: {
        validator: function(value) {
          // time_out can be null (for ongoing sessions) or must be valid 24-hour format
          if (!value) return true;
          
          // Validate 24-hour time format HH:MM
          if (!/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(value)) {
            return false;
          }
          
          // If time_out is provided, it should be after time_in
          if (this.time_in && value) {
            const timeInMinutes = this.time_in.split(':').reduce((acc, time) => (60 * acc) + +time);
            const timeOutMinutes = value.split(':').reduce((acc, time) => (60 * acc) + +time);
            return timeOutMinutes > timeInMinutes;
          }
          
          return true;
        },
        message: "Time out must be in 24-hour format (HH:MM) and after time in"
      }
    },
    duration: {
      type: Number, // in minutes
      default: 0,
    },
    purpose: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["active", "completed", "interrupted", "overtime"],
      default: "active",
    },
    approved_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
    notes: {
      type: String,
      trim: true,
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
usageHistorySchema.index({ reservation_id: 1 });
usageHistorySchema.index({ user_id: 1 });
usageHistorySchema.index({ date: 1 });
usageHistorySchema.index({ status: 1 });
usageHistorySchema.index({ time_in: 1, time_out: 1 });

// Compound indexes for common queries
usageHistorySchema.index({ user_id: 1, date: 1 });

// Virtual for id field (MongoDB uses _id by default)
usageHistorySchema.virtual('id').get(function() {
  return this._id.toHexString();
});

// Virtual for calculated duration (in case time_out is updated)
usageHistorySchema.virtual('calculated_duration').get(function() {
  if (this.time_in && this.time_out) {
    // Convert time strings to minutes
    const timeInMinutes = this.time_in.split(':').reduce((acc, time) => (60 * acc) + +time);
    const timeOutMinutes = this.time_out.split(':').reduce((acc, time) => (60 * acc) + +time);
    return timeOutMinutes - timeInMinutes;
  }
  return 0;
});

// Pre-save middleware to calculate duration
usageHistorySchema.pre('save', function(next) {
  if (this.time_in && this.time_out) {
    // Convert time strings to minutes and calculate duration
    const timeInMinutes = this.time_in.split(':').reduce((acc, time) => (60 * acc) + +time);
    const timeOutMinutes = this.time_out.split(':').reduce((acc, time) => (60 * acc) + +time);
    this.duration = timeOutMinutes - timeInMinutes;
    
    // Auto-set status based on duration and reservation
    if (this.status === 'active' && this.time_out) {
      this.status = 'completed';
    }
  } else if (this.status === 'completed' && !this.time_out) {
    const now = new Date();
    this.time_out = getTZCurrentTimeString(now);
    
    // Calculate duration
    const timeInMinutes = this.time_in.split(':').reduce((acc, time) => (60 * acc) + +time);
    const timeOutMinutes = this.time_out.split(':').reduce((acc, time) => (60 * acc) + +time);
    this.duration = timeOutMinutes - timeInMinutes;
  }
  
  next();
});

// Static method to create usage history from reservation
usageHistorySchema.statics.createFromReservation = async function(reservation, admin_id, time_in = null) {
  try {
    // Format time_in as HH:MM string
    let formattedTimeIn;
    if (time_in) {
      // If time_in is already in HH:MM format, use it directly
      if (/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time_in)) {
        formattedTimeIn = time_in;
      } else {
        // If it's a Date object or string, convert it
        const timeDate = new Date(time_in);
        formattedTimeIn = getTZCurrentTimeString(timeDate);
      }
    } else {
      const now = new Date();
      formattedTimeIn = getTZCurrentTimeString(now);
    }

    const usageHistory = new this({
      reservation_id: reservation._id,
      user_id: reservation.user_id,
      date: new Date(),
      time_in: formattedTimeIn,
      purpose: reservation.purpose,
      approved_by: admin_id,
      status: 'active'
    });

    return await usageHistory.save();
  } catch (error) {
    throw error;
  }
};

// Ensure virtual fields are serialized
usageHistorySchema.set('toJSON', {
  virtuals: true,
  transform: function(doc, ret) {
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

export default mongoose.model("UsageHistory", usageHistorySchema);
