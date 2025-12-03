import mongoose from "mongoose";

const semesterSchema = new mongoose.Schema(
  {
    name: { type: String, enum: ["1st", "2nd", "summer"], required: true },
    start_date: { type: Date, required: true },
    end_date: { type: Date, required: true }
  },
  { _id: false }
);

const academicConfigSchema = new mongoose.Schema(
  {
    school_year: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: function (value) {
          return /^\d{4}-\d{4}$/.test(value);
        },
        message: "School year must be in format 'YYYY-YYYY'"
      }
    },
    semesters: {
      type: [semesterSchema],
      validate: {
        validator: function (value) {
          if (!Array.isArray(value) || value.length === 0) return false;
          const names = new Set();
          for (const s of value) {
            if (names.has(s.name)) return false;
            names.add(s.name);
            if (!(s.start_date instanceof Date) || !(s.end_date instanceof Date)) return false;
            if (s.start_date > s.end_date) return false;
          }
          return true;
        },
        message: "Invalid semesters configuration"
      }
    },
    active_semester: { type: String, enum: ["1st", "2nd", "summer", null], default: null },
    is_active: { type: Boolean, default: true },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", required: true },
    last_modified_by: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
    notes: { type: String, trim: true, default: null }
  },
  { timestamps: true }
);

academicConfigSchema.index({ is_active: 1 }, { unique: true, partialFilterExpression: { is_active: true } });
academicConfigSchema.index({ school_year: 1 });

academicConfigSchema.methods.computeActiveSemester = function (date = new Date()) {
  const d = new Date(date);
  for (const s of this.semesters) {
    const start = new Date(s.start_date);
    const end = new Date(s.end_date);
    if (start <= d && d <= end) return s.name;
  }
  return null;
};

academicConfigSchema.statics.getCurrent = async function () {
  const config = await this.findOne({ is_active: true })
    .populate("created_by", "firstname lastname username")
    .populate("last_modified_by", "firstname lastname username");
  return config;
};

academicConfigSchema.statics.setActiveConfig = async function (configId, adminId) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await this.updateMany({ is_active: true }, { is_active: false, last_modified_by: adminId }, { session });
      await this.updateOne({ _id: configId }, { is_active: true, last_modified_by: adminId }, { session });
    });
    const updated = await this.findById(configId);
    if (updated) {
      const current = updated.computeActiveSemester();
      if (updated.active_semester !== current) {
        updated.active_semester = current;
        await updated.save();
      }
    }
    return await this.getCurrent();
  } finally {
    await session.endSession();
  }
};

academicConfigSchema.statics.updateActiveSemesterForActiveConfig = async function () {
  const config = await this.findOne({ is_active: true });
  if (!config) return null;
  const current = config.computeActiveSemester();
  if (config.active_semester !== current) {
    config.active_semester = current;
    await config.save();
  }
  return config;
};

export default mongoose.model("AcademicConfig", academicConfigSchema);

