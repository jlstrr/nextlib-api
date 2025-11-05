import { Router } from "express";
import User from "../../../models/User.js";
import { authMiddleware, clearSessionCookie } from "../../../middleware/auth.js";
import crypto from "crypto";
import sendMail from "../../../utils/mailer.js";

const router = Router();

// --- Register ---
router.post("/register", async (req, res) => {
  try {
    const {
      id_number,
      firstname,
      middle_initial,
      lastname,
      program_course,
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
      middle_initial,
      lastname,
      program_course,
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

// --- Forgot Password ---
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const user = await User.findOne({ email, isDeleted: false });

    // Always respond with success to avoid leaking which emails exist
    const successResponse = { message: "If an account with that email exists, a password reset link has been sent." };

    if (!user) return res.status(200).json(successResponse);

    // Generate token and expiry (1 hour)
    const token = crypto.randomBytes(20).toString("hex");
    const expires = Date.now() + 60 * 60 * 1000; // 1 hour

    user.resetPasswordToken = token;
    user.resetPasswordExpires = new Date(expires);
    await user.save();

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const resetUrl = `${frontendUrl.replace(/\/$/, "")}/reset-password?token=${token}&email=${encodeURIComponent(
      email
    )}`;

    const subject = "NextLib - Password reset request";
    const html = `
      <p>Hello ${user.firstname || ''},</p>
      <p>You requested a password reset. Click the link below to reset your password. This link will expire in 1 hour.</p>
      <p><a href="${resetUrl}">Reset your password</a></p>
      <p>If you didn't request this, you can ignore this email.</p>
    `;

    // Send email (may throw)
    await sendMail(email, subject, html);

    return res.status(200).json(successResponse);
  } catch (err) {
    console.error('Forgot password error:', err);
    // Do not leak errors to client; return generic message
    return res.status(500).json({ message: "Failed to process password reset request" });
  }
});

// --- Reset Password ---
router.post("/reset-password", async (req, res) => {
  try {
    const { email, token, password } = req.body;
    
    if (!email || !token || !password) {
      return res.status(400).json({ message: "Email, token and password are required" });
    }

    // Basic password validation
    if (typeof password !== "string" || password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters long" });
    }

    // Find user with matching token that hasn't expired
    const user = await User.findOne({
      email,
      isDeleted: false,
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired token" });
    }

    // Set new password (User model will hash it automatically on save)
    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    // Clear any existing session cookie for security
    clearSessionCookie(res);

    // Send confirmation email (non-blocking)
    try {
      const subject = "NextLib - Your password has been changed";
      const html = `
        <p>Hello ${user.firstname || ''},</p>
        <p>Your password has been successfully changed. If you did not perform this action, please contact support immediately.</p>
        <p>For your security, you will need to log in again with your new password.</p>
      `;
      await sendMail(user.email, subject, html);
    } catch (mailErr) {
      // Log error but don't fail the reset because confirmation email failed
      console.error("Failed to send password change confirmation email:", mailErr);
    }

    // Build user data to return (excluding sensitive fields)
    const middle = user.middleInitial ?? user.middle_initial ?? '';
    const fullName = middle ? `${user.firstname} ${middle} ${user.lastname}` : `${user.firstname} ${user.lastname}`;

    return res.json({ 
      message: "Password has been reset successfully",
      user: {
        id: user._id,
        id_number: user.id_number,
        name: fullName,
        firstname: user.firstname,
        middle_initial: user.middle_initial,
        lastname: user.lastname,
        email: user.email,
        user_type: user.user_type,
        status: user.status,
        program_course: user.program_course,
        remaining_time: user.remaining_time
      }
    });
  } catch (err) {
    console.error("Reset password error:", err);
    return res.status(500).json({ message: "Failed to reset password" });
  }
});

export default router;
