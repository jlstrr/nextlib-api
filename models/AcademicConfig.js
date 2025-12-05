import mongoose from "mongoose";
import SystemDefaults from "./SystemDefaults.js";
import User from "./User.js";

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
    last_promotion_school_year: { type: String, default: null },
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
      const previous = updated.active_semester;
      const current = updated.computeActiveSemester();
      if (previous !== current) {
        updated.active_semester = current;
        await updated.save();
        if (previous === null && current !== null) {
          const defaults = await SystemDefaults.getCurrent();
          if (defaults && defaults.default_allotted_time) {
            await User.updateMany(
              { user_type: "student", isDeleted: false },
              { $set: { remaining_time: defaults.default_allotted_time } }
            );
          }
        }
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
  const previous = config.active_semester;
  const current = config.computeActiveSemester();
  if (previous !== current) {
    config.active_semester = current;
    await config.save();
    if (previous === null && current !== null) {
      const defaults = await SystemDefaults.getCurrent();
      if (defaults && defaults.default_allotted_time) {
        const res = await User.updateMany(
          { user_type: "student", isDeleted: false },
          { $set: { remaining_time: defaults.default_allotted_time } }
        );
        return { config, semester_changed: true, reset: { updatedCount: res?.modifiedCount ?? res?.nModified ?? 0, default_allotted_time: defaults.default_allotted_time } };
      }
      return { config, semester_changed: true, reset: { updatedCount: 0, default_allotted_time: null } };
    }
    return { config, semester_changed: true, reset: null };
  }
  return { config, semester_changed: false };
};

academicConfigSchema.statics.promoteStudentYearLevelsIfYearEnded = async function (date = new Date()) {
  const config = await this.findOne({ is_active: true });
  if (!config) return null;
  let lastEnd = null;
  for (const s of config.semesters) {
    const e = new Date(s.end_date);
    if (!lastEnd || e > lastEnd) lastEnd = e;
  }
  if (!lastEnd) return { config, promoted: false, reason: "no_semester_dates" };
  const now = new Date(date);
  if (now <= lastEnd) return { config, promoted: false, reason: "year_not_ended" };
  if (config.last_promotion_school_year === config.school_year) {
    return { config, promoted: false, reason: "already_promoted" };
  }
  const r1 = await User.updateMany(
    { user_type: "student", isDeleted: false, yearLevel: "1st year" },
    { $set: { yearLevel: "2nd year" } }
  );
  const r2 = await User.updateMany(
    { user_type: "student", isDeleted: false, yearLevel: "2nd year" },
    { $set: { yearLevel: "3rd year" } }
  );
  const r3 = await User.updateMany(
    { user_type: "student", isDeleted: false, yearLevel: "3rd year" },
    { $set: { yearLevel: "4th year" } }
  );
  const r4 = await User.updateMany(
    { user_type: "student", isDeleted: false, yearLevel: "4th year" },
    { $set: { status: "suspended" } }
  );
  config.last_promotion_school_year = config.school_year;
  await config.save();
  return {
    config,
    promoted: true,
    counts: {
      first_to_second: r1?.modifiedCount ?? r1?.nModified ?? 0,
      second_to_third: r2?.modifiedCount ?? r2?.nModified ?? 0,
      third_to_fourth: r3?.modifiedCount ?? r3?.nModified ?? 0,
      fourth_to_suspended: r4?.modifiedCount ?? r4?.nModified ?? 0
    }
  };
};

export default mongoose.model("AcademicConfig", academicConfigSchema);

