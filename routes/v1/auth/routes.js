import { Router } from "express";
import User from "../../../models/User.js";
import Admin from "../../../models/Admin.js";
import { authMiddleware, clearSessionCookie } from "../../../middleware/auth.js";
import crypto from "crypto";
import sendMail from "../../../utils/mailer.js";
import bcrypt from "bcryptjs";
import PasswordResetAudit from "../../../models/PasswordResetAudit.js";

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
    if (user) {
      const now = new Date();
      const minIntervalMs = 2 * 60 * 1000;
      const windowMs = 60 * 60 * 1000;
      if (user.resetPasswordLastRequestAt && now - user.resetPasswordLastRequestAt < minIntervalMs) {
        await PasswordResetAudit.create({
          email,
          actor_type: "user",
          actor_id: user._id,
          method: "link",
          status: "failed",
          reason: "rate_limited_min_interval",
          ip_address: req.ip || null,
          user_agent: req.get("user-agent") || null
        });
        return res.status(429).json({ message: "Too many requests. Please try again later." });
      }
      if (!user.resetPasswordLastRequestAt || now - user.resetPasswordLastRequestAt > windowMs) {
        user.resetPasswordRequestCount = 0;
      }
      if (user.resetPasswordRequestCount >= 5) {
        await PasswordResetAudit.create({
          email,
          actor_type: "user",
          actor_id: user._id,
          method: "link",
          status: "failed",
          reason: "rate_limited_hourly_cap",
          ip_address: req.ip || null,
          user_agent: req.get("user-agent") || null
        });
        return res.status(429).json({ message: "Too many requests. Please try again later." });
      }
      const token = crypto.randomBytes(20).toString("hex");
      const expires = Date.now() + 60 * 60 * 1000;
      user.resetPasswordToken = token;
      user.resetPasswordExpires = new Date(expires);
      user.resetPasswordLastRequestAt = now;
      user.resetPasswordRequestCount = (user.resetPasswordRequestCount || 0) + 1;
      await user.save();
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
      const resetUrl = `${frontendUrl.replace(/\/$/, "")}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;
      const subject = "NextLib - Password reset request";
      const html = `
        <p>Hello ${user.firstname || ''},</p>
        <p>You requested a password reset. Click the link below to reset your password. This link will expire in 1 hour.</p>
        <p><a href="${resetUrl}">Reset your password</a></p>
        <p>If you didn't request this, you can ignore this email.</p>
      `;
      await sendMail(email, subject, html);
      await PasswordResetAudit.create({
        email,
        actor_type: "user",
        actor_id: user._id,
        method: "link",
        status: "success",
        ip_address: req.ip || null,
        user_agent: req.get("user-agent") || null
      });
      return res.status(200).json({ message: "Password reset link sent to your email." });
    }
    const admin = await Admin.findOne({ email });
    if (admin) {
      const now = new Date();
      const minIntervalMs = 2 * 60 * 1000;
      const windowMs = 60 * 60 * 1000;
      if (admin.resetPasswordOtpRequestedAt && now - admin.resetPasswordOtpRequestedAt < minIntervalMs) {
        await PasswordResetAudit.create({
          email,
          actor_type: "admin",
          actor_id: admin._id,
          method: "otp",
          status: "failed",
          reason: "rate_limited_min_interval",
          ip_address: req.ip || null,
          user_agent: req.get("user-agent") || null
        });
        return res.status(429).json({ message: "Too many requests. Please try again later." });
      }
      if (!admin.resetPasswordOtpRequestedAt || now - admin.resetPasswordOtpRequestedAt > windowMs) {
        admin.resetPasswordOtpRequestCount = 0;
      }
      if (admin.resetPasswordOtpRequestCount >= 5) {
        await PasswordResetAudit.create({
          email,
          actor_type: "admin",
          actor_id: admin._id,
          method: "otp",
          status: "failed",
          reason: "rate_limited_hourly_cap",
          ip_address: req.ip || null,
          user_agent: req.get("user-agent") || null
        });
        return res.status(429).json({ message: "Too many requests. Please try again later." });
      }
      const otpNum = crypto.randomInt(0, 1000000);
      const otp = String(otpNum).padStart(6, "0");
      const otpHash = await bcrypt.hash(otp, 10);
      const expires = Date.now() + 10 * 60 * 1000;
      admin.resetPasswordOtpHash = otpHash;
      admin.resetPasswordOtpExpires = new Date(expires);
      admin.resetPasswordOtpRequestedAt = now;
      admin.resetPasswordOtpRequestCount = (admin.resetPasswordOtpRequestCount || 0) + 1;
      await admin.save();
      const subject = "NextLib - Admin password reset OTP";
      const html = `
        <p>Hello ${admin.firstname || ''},</p>
        <p>Your one-time password (OTP) for resetting your admin account is:</p>
        <h2>${otp}</h2>
        <p>This OTP expires in 10 minutes.</p>
        <p>To reset your password, go to the password reset page and enter your email and this OTP.</p>
        <p>If you did not request this, you can ignore this email.</p>
      `;
      await sendMail(email, subject, html);
      await PasswordResetAudit.create({
        email,
        actor_type: "admin",
        actor_id: admin._id,
        method: "otp",
        status: "success",
        ip_address: req.ip || null,
        user_agent: req.get("user-agent") || null
      });
      return res.status(200).json({ message: "OTP sent to your email." });
    }
    await PasswordResetAudit.create({
      email,
      actor_type: "unknown",
      actor_id: null,
      method: "link",
      status: "failed",
      reason: "email_not_found",
      ip_address: req.ip || null,
      user_agent: req.get("user-agent") || null
    });
    return res.status(404).json({ message: "Email not found." });
  } catch (err) {
    console.error('Forgot password error:', err);
    await PasswordResetAudit.create({
      email: req.body?.email || "",
      actor_type: "unknown",
      actor_id: null,
      method: "link",
      status: "error",
      reason: "server_error",
      ip_address: req.ip || null,
      user_agent: req.get("user-agent") || null
    });
    return res.status(500).json({ message: "Failed to process password reset request" });
  }
});

// --- Reset Password ---
router.post("/reset-password", async (req, res) => {
  try {
    const { email, token, otp, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    if (typeof password !== "string" || password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters long" });
    }

    const admin = await Admin.findOne({ email });
    if (admin) {
      if (!otp) {
        return res.status(400).json({ message: "OTP is required for admin password reset" });
      }
      if (!admin.resetPasswordOtpHash || !admin.resetPasswordOtpExpires || admin.resetPasswordOtpExpires <= new Date()) {
        await PasswordResetAudit.create({
          email,
          actor_type: "admin",
          actor_id: admin._id,
          method: "otp",
          status: "failed",
          reason: "otp_expired_or_missing",
          ip_address: req.ip || null,
          user_agent: req.get("user-agent") || null
        });
        return res.status(400).json({ message: "Invalid or expired OTP" });
      }
      const valid = await bcrypt.compare(String(otp), admin.resetPasswordOtpHash);
      if (!valid) {
        await PasswordResetAudit.create({
          email,
          actor_type: "admin",
          actor_id: admin._id,
          method: "otp",
          status: "failed",
          reason: "otp_invalid",
          ip_address: req.ip || null,
          user_agent: req.get("user-agent") || null
        });
        return res.status(400).json({ message: "Invalid or expired OTP" });
      }
      admin.password = password;
      admin.resetPasswordOtpHash = null;
      admin.resetPasswordOtpExpires = null;
      await admin.save();
      clearSessionCookie(res);
      try {
        const subject = "NextLib - Your admin password has been changed";
        const html = `
          <p>Hello ${admin.firstname || ''},</p>
          <p>Your admin password has been successfully changed.</p>
        `;
        await sendMail(admin.email, subject, html);
      } catch {}
      await PasswordResetAudit.create({
        email,
        actor_type: "admin",
        actor_id: admin._id,
        method: "otp",
        status: "success",
        ip_address: req.ip || null,
        user_agent: req.get("user-agent") || null
      });
      return res.json({ message: "Password has been reset successfully" });
    }
    if (!token) {
      return res.status(400).json({ message: "Token is required for user password reset" });
    }
    const user = await User.findOne({
      email,
      isDeleted: false,
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: new Date() },
    });
    if (!user) {
      await PasswordResetAudit.create({
        email,
        actor_type: "user",
        actor_id: null,
        method: "link",
        status: "failed",
        reason: "token_invalid_or_expired",
        ip_address: req.ip || null,
        user_agent: req.get("user-agent") || null
      });
      return res.status(400).json({ message: "Invalid or expired token" });
    }
    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    clearSessionCookie(res);
    try {
      const subject = "NextLib - Your password has been changed";
      const html = `
        <p>Hello ${user.firstname || ''},</p>
        <p>Your password has been successfully changed. If you did not perform this action, please contact support immediately.</p>
        <p>For your security, you will need to log in again with your new password.</p>
      `;
      await sendMail(user.email, subject, html);
    } catch {}
    const middle = user.middleInitial ?? user.middle_initial ?? '';
    const fullName = middle ? `${user.firstname} ${middle} ${user.lastname}` : `${user.firstname} ${user.lastname}`;
    await PasswordResetAudit.create({
      email,
      actor_type: "user",
      actor_id: user._id,
      method: "link",
      status: "success",
      ip_address: req.ip || null,
      user_agent: req.get("user-agent") || null
    });
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
    try {
      await PasswordResetAudit.create({
        email: req.body?.email || "",
        actor_type: "unknown",
        actor_id: null,
        method: req.body?.otp ? "otp" : "link",
        status: "error",
        reason: "server_error",
        ip_address: req.ip || null,
        user_agent: req.get("user-agent") || null
      });
    } catch {}
    return res.status(500).json({ message: "Failed to reset password" });
  }
});

export default router;
