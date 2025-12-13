import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import apiRoutes from "./routes/index.js";

const app = express();

app.use(express.json());
app.use(cookieParser());

const defaultOrigins = [
  'https://www.nextlib-system.online',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://192.168.100.46:5173',
  'https://nextlib-desktop-admin.vercel.app',
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

app.get("/", (req, res) => {
  res.json({ message: "NextLib API is running" });
});

export default app;
