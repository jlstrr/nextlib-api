import mongoose from "mongoose";

const laboratorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "maintenance"],
      default: "active",
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

// Index for better query performance
laboratorySchema.index({ status: 1 });

// Virtual for id field (MongoDB uses _id by default)
laboratorySchema.virtual('id').get(function() {
  return this._id.toHexString();
});

// Ensure virtual fields are serialized
laboratorySchema.set('toJSON', {
  virtuals: true,
  transform: function(doc, ret) {
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

export default mongoose.model("Laboratory", laboratorySchema);