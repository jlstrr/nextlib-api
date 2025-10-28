import { Router } from "express";
import User from "../../../models/User.js";
import { authMiddleware, clearSessionCookie } from "../../../middleware/auth.js";

const router = Router();

// --- Register ---
router.post("/register", async (req, res) => {
  try {
    const {
      id_number,
      firstname,
      middleInitial,
      lastname,
      program,
      email,
      user_type,
      password,
      remaining_time,
      status = "active", // Default to active if not provided
    } = req.body;

    const existing = await User.findOne({ id_number });
    if (existing) return res.status(400).json({ message: "User already exists" });

    if (user_type === "student" && (remaining_time === null || remaining_time === undefined)) {
      return res.status(400).json({ message: "Students must have remaining_time" });
    }

    const user = new User({
      id_number,
      firstname,
      middleInitial,
      lastname,
      program,
      email,
      user_type,
      password,
      remaining_time: user_type === "student" ? remaining_time : undefined,
      status,
    });

    await user.save();
    res.status(201).json({ message: "User registered successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Login (using id_number) ---
router.post("/login", async (req, res) => {
  try {
    const { id_number, password } = req.body;

    const user = await User.findOne({ id_number, isDeleted: false });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Check if user account is active
    if (user.status !== "active") {
      return res.status(403).json({ message: "User account is not active" });
    }

    // Generate JWT token
    const token = user.generateToken();

    // Set JWT token directly as cookie value with proper CORS settings
    res.cookie('session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // Allow cross-origin in dev
      domain: process.env.NODE_ENV === 'production' ? process.env.COOKIE_DOMAIN : undefined // No domain restriction in dev
    });

    const middle = user.middleInitial ?? user.middle_initial ?? '';
    const fullName = middle ? `${user.firstname} ${middle} ${user.lastname}` : `${user.firstname} ${user.lastname}`;

    res.json({
      message: "Login successful",
      user: {
        id: user._id,
        id_number: user.id_number,
        name: fullName,
        email: user.email,
        user_type: user.user_type,
        status: user.status
      },
      token // Optionally return token for client storage
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Profile (Protected) ---
router.get("/profile", authMiddleware, async (req, res) => {
  try {
    // User is already loaded by authMiddleware
    res.json(req.user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Check Authentication Status ---
router.get("/status", (req, res) => {
  const token = req.cookies.session;
  if (token) {
    try {
      // Verify the token without requiring full auth middleware
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      res.json({
        authenticated: true,
        userId: decoded.userId,
        userType: decoded.userType,
        idNumber: decoded.idNumber,
        status: decoded.status
      });
    } catch (error) {
      // Token is invalid, clear cookie with proper options
      clearSessionCookie(res);
      res.json({ authenticated: false });
    }
  } else {
    res.json({ authenticated: false });
  }
});

// --- Logout ---
router.post("/logout", authMiddleware, (req, res) => {
  const userId = req.userId;
  const userType = req.userType;

  // Clear the session cookie with proper options
  clearSessionCookie(res);
  
  res.json({ 
    message: "User logged out successfully"
  });
});

export default router;
