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
    const result = await AcademicConfig.promoteStudentYearLevelsIfYearEnded();
    let payload;
    if (!result) {
      payload = { promoted: false, reason: "no_active_config", updated_at: new Date().toISOString() };
    } else {
      const cfg = result.config ?? result;
      payload = {
        school_year: cfg.school_year,
        promoted: !!result.promoted,
        reason: result.reason || null,
        counts: result.counts || null,
        updated_at: new Date().toISOString(),
      };
    }
    console.log(JSON.stringify(payload, null, 2));
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error("promoteYearLevels failed:", err?.message || err);
    try { await mongoose.disconnect(); } catch {}
    process.exit(1);
  }
};

run();
