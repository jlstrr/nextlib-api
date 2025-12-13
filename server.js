import mongoose from "mongoose";
import dotenv from "dotenv";
import app from "./app.js";

dotenv.config();

const port = process.env.PORT || 5000;

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL is not defined in .env file");
  process.exit(1);
}

mongoose
  .connect(process.env.DATABASE_URL)
  .then(() => {
    console.log("✅ MongoDB connected");
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err.message);
    process.exit(1);
  });

app.listen(port, () =>
  console.log(`🚀 Server running on http://localhost:${port}`)
);
