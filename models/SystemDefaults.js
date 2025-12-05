import mongoose from "mongoose";

const systemDefaultsSchema = new mongoose.Schema(
  {
    default_allotted_time: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: function (value) {
          return /^\d{1,2}:[0-5]\d:[0-5]\d$/.test(value);
        },
        message: "default_allotted_time must be in format 'HH:MM:SS'"
      }
    },
  },
  { timestamps: true }
);

systemDefaultsSchema.virtual("default_allotted_hours_label").get(function () {
  if (!this.default_allotted_time) return null;
  const [h, m, s] = this.default_allotted_time.split(":").map(Number);
  const hours = h + m / 60 + s / 3600;
  const rounded = Math.round(hours * 100) / 100;
  return `${rounded}${rounded === 1 ? " hr" : " hrs"}`;
});


systemDefaultsSchema.statics.getCurrent = async function () {
  const defaults = await this.findOne({});
  return defaults;
};

export default mongoose.model("SystemDefaults", systemDefaultsSchema);

