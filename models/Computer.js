import mongoose from "mongoose";

const computerSchema = new mongoose.Schema(
  {
    laboratory_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Laboratory",
      required: true,
    },
    pc_number: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["available", "occupied", "maintenance", "out_of_order", "reserved", "locked"],
      default: "available",
    },
    notes: {
      type: String,
      trim: true,
      default: null,
    },
    clientToken: {
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

// Compound unique index to ensure pc_number is unique within each laboratory
computerSchema.index({ laboratory_id: 1, pc_number: 1 }, { unique: true });

// Index for better query performance
computerSchema.index({ laboratory_id: 1 });
computerSchema.index({ status: 1 });

// Virtual for id field (MongoDB uses _id by default)
computerSchema.virtual('id').get(function() {
  return this._id.toHexString();
});

// Ensure virtual fields are serialized
computerSchema.set('toJSON', {
  virtuals: true,
  transform: function(doc, ret) {
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

export default mongoose.model("Computer", computerSchema);