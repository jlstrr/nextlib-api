import mongoose from "mongoose";

const systemConfigSchema = new mongoose.Schema(
  {
    default_hours: {
      type: Number,
      required: true,
      min: 1,
      max: 24,
      default: 1, // Default reservation duration in hours
    },
    school_year: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: function(value) {
          // Validate format like "2024-2025" or "2025-2026"
          return /^\d{4}-\d{4}$/.test(value);
        },
        message: "School year must be in format 'YYYY-YYYY' (e.g., '2024-2025')"
      }
    },
    semester: {
      type: String,
      enum: ["1st", "2nd", "summer"],
      required: true,
    },
    is_active: {
      type: Boolean,
      default: true,
    },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
    last_modified_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      default: null,
    },
  },
  { timestamps: true }
);

// Ensure only one active configuration at a time
systemConfigSchema.index({ is_active: 1 }, { 
  unique: true, 
  partialFilterExpression: { is_active: true } 
});

// Index for better query performance
systemConfigSchema.index({ school_year: 1, semester: 1 });
systemConfigSchema.index({ created_by: 1 });

// Virtual for id field (MongoDB uses _id by default)
systemConfigSchema.virtual('id').get(function() {
  return this._id.toHexString();
});

// Virtual for formatted school year and semester
systemConfigSchema.virtual('academic_period').get(function() {
  return `${this.school_year} ${this.semester} Semester`;
});

// Static method to get current active configuration
systemConfigSchema.statics.getCurrentConfig = async function() {
  try {
    const config = await this.findOne({ is_active: true })
      .populate('created_by', 'firstname lastname username')
      .populate('last_modified_by', 'firstname lastname username');
    
    return config;
  } catch (error) {
    throw error;
  }
};

// Static method to set new active configuration
systemConfigSchema.statics.setActiveConfig = async function(configId, adminId) {
  const session = await mongoose.startSession();
  
  try {
    await session.withTransaction(async () => {
      // Deactivate all existing configurations
      await this.updateMany(
        { is_active: true },
        { 
          is_active: false,
          last_modified_by: adminId 
        },
        { session }
      );
      
      // Activate the new configuration
      await this.updateOne(
        { _id: configId },
        { 
          is_active: true,
          last_modified_by: adminId 
        },
        { session }
      );
    });
    
    return await this.getCurrentConfig();
  } catch (error) {
    throw error;
  } finally {
    await session.endSession();
  }
};

// Pre-save middleware to ensure only one active config
systemConfigSchema.pre('save', async function(next) {
  if (this.is_active && this.isNew) {
    try {
      // Deactivate all existing active configurations
      await this.constructor.updateMany(
        { is_active: true },
        { is_active: false }
      );
    } catch (error) {
      return next(error);
    }
  }
  next();
});

// Ensure virtual fields are serialized
systemConfigSchema.set('toJSON', {
  virtuals: true,
  transform: function(doc, ret) {
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

export default mongoose.model("SystemConfig", systemConfigSchema);