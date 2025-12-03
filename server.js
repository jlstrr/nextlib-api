import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import cors from "cors";
import apiRoutes from "./routes/index.js";
import AcademicConfig from "./models/AcademicConfig.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL is not defined in .env file");
  process.exit(1);
}

mongoose
  .connect(process.env.DATABASE_URL)
  .then(() => {
    console.log("✅ MongoDB connected");
    const startAcademicScheduler = () => {
      const tz = process.env.ACADEMIC_CRON_TZ || "UTC";
      const parseOffset = (s) => {
        const m = (s || "").match(/^\s*(?:UTC|GMT)\s*([+-]\d{1,2})(?::(\d{2}))?\s*$/i);
        if (!m) return null;
        const sign = m[1].startsWith("-") ? -1 : 1;
        const hours = Math.abs(parseInt(m[1], 10));
        const minutes = m[2] ? parseInt(m[2], 10) : 0;
        return sign * (hours * 60 + minutes) * 60 * 1000;
      };
      const formatLocalNow = () => {
        const offset = parseOffset(tz);
        if (offset !== null) {
          const d = new Date(Date.now() + offset);
          const y = d.getUTCFullYear();
          const m = String(d.getUTCMonth() + 1).padStart(2, "0");
          const day = String(d.getUTCDate()).padStart(2, "0");
          const hh = String(d.getUTCHours()).padStart(2, "0");
          const mm = String(d.getUTCMinutes()).padStart(2, "0");
          const ss = String(d.getUTCSeconds()).padStart(2, "0");
          return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
        }
        return new Intl.DateTimeFormat("en-CA", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
      };
      const getCurrentOffsetMs = () => {
        const fixed = parseOffset(tz);
        if (fixed !== null) return fixed;
        const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short", hour12: false, hour: "2-digit", minute: "2-digit" }).formatToParts(new Date());
        const name = parts.find((p) => p.type === "timeZoneName")?.value || "UTC";
        const m = name.match(/GMT([+-]\d{1,2})(?::(\d{2}))?|UTC([+-]\d{1,2})(?::(\d{2}))?/);
        let sign = 1, hours = 0, minutes = 0;
        if (m) {
          const s = m[1] || m[3];
          sign = s && s.startsWith("-") ? -1 : 1;
          const h = Math.abs(parseInt(s || "0", 10));
          const mm = m[2] || m[4] || "0";
          hours = h;
          minutes = parseInt(mm, 10);
        }
        return sign * (hours * 60 + minutes) * 60 * 1000;
      };
      const scheduleNextMidnight = () => {
        const offset = getCurrentOffsetMs();
        const nowUTC = Date.now();
        const localNow = new Date(nowUTC + offset);
        const nextLocalMidnightUTC = Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate() + 1, 0, 0, 0);
        const nextUtcTs = nextLocalMidnightUTC - offset;
        const delay = Math.max(0, nextUtcTs - nowUTC);
        setTimeout(() => {
          run();
          scheduleNextMidnight();
        }, delay);
      };
      const run = () => {
        console.log(`[Scheduler] updateActiveSemester TZ=${tz} local ${formatLocalNow()}`);
        AcademicConfig.updateActiveSemesterForActiveConfig().catch((err) => {
          console.error("Scheduler error:", err?.message || err);
        });
      };
      if (process.env.ACADEMIC_CRON_TEST === "true") {
        run();
        setInterval(run, 60 * 1000);
      } else {
        scheduleNextMidnight();
      }
    };
    startAcademicScheduler();
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err.message);
    process.exit(1);
  });

app.use(express.json());
app.use(cookieParser());

// CORS configuration
const defaultOrigins = [
  'https://www.nextlib-system.online',
  'http://localhost:5173',
  'http://192.168.100.46:5173'
];

const allowedOrigins = process.env.FRONTEND_URL
  ? [process.env.FRONTEND_URL, ...defaultOrigins]
  : defaultOrigins;

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use("/api", apiRoutes);

app.use("/", (req, res) => {
  res.json({ message: "NextLib API is running" });
});

app.listen(port, () =>
  console.log(`🚀 Server running on http://localhost:${port}`)
);
