import dotenv from "dotenv";
import mongoose from "mongoose";
import AcademicConfig from "../models/AcademicConfig.js";

dotenv.config();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not defined");
  process.exit(1);
}

const run = async () => {
  try {
    await mongoose.connect(url);
    const result = await AcademicConfig.updateActiveSemesterForActiveConfig();
    if (!result) {
      console.log("No active academic config found");
    } else {
      console.log(
        JSON.stringify(
          {
            school_year: result.school_year,
            active_semester: result.active_semester,
            updated_at: new Date().toISOString()
          },
          null,
          2
        )
      );
    }
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error("updateActiveSemester failed:", err?.message || err);
    try { await mongoose.disconnect(); } catch {}
    process.exit(1);
  }
};

run();

