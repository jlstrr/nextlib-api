import { Router } from "express";
import Admin from "../../../models/Admin.js";
import { adminAuthMiddleware, authMiddleware, requireSuperAdmin } from "../../../middleware/auth.js";

const router = Router();

// ==========================
// 🔐 AUTH ROUTES
// ==========================

// Register
router.post("/register", async (req, res) => {
  try {
    const { profile_picture, firstname, middle_initial, lastname, username, email, password, isSuperAdmin } = req.body;

    const existing = await Admin.findOne({ $or: [{ email }, { username }] });
    if (existing) return res.status(400).json({ message: "Admin already exists" });

    const admin = new Admin({
      profile_picture,
      firstname,
      middle_initial,
      lastname,
      username,
      email,
      password,
      isSuperAdmin,
    });

    await admin.save();
    res.status(201).json({ message: "Admin registered successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const admin = await Admin.findOne({ username });
    if (!admin || !(await admin.comparePassword(password))) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    if (admin.status !== "active") {
      return res.status(403).json({ message: "Admin account is not active" });
    }

    // Generate JWT token
    const token = admin.generateToken();

    // Set JWT token directly as cookie value
    res.cookie('session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    res.json({
      message: "Login successful",
      admin: {
        id: admin._id,
        username: admin.username,
        firstname: admin.firstname,
        lastname: admin.lastname,
        isSuperAdmin: admin.isSuperAdmin,
        status: admin.status
      },
      token // Optionally return token for client storage
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Profile
router.get("/profile", adminAuthMiddleware, async (req, res) => {
  try {
    // Admin is already loaded by adminAuthMiddleware
    res.status(200).json({ status: 200, message: "Admin profile retrieved successfully", data: req.user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Logout
router.post("/logout", adminAuthMiddleware, (req, res) => {
  const userId = req.userId;
  const username = req.user.username;
  const isSuperAdmin = req.isSuperAdmin;

  // Clear the session cookie
  res.clearCookie('session');
  
  res.json({ 
    message: "Admin logged out successfully"
  });
});

// --- Check Authentication Status ---
router.get("/status", (req, res) => {
  const token = req.cookies.session;
  if (token) {
    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      res.json({
        authenticated: true,
        userId: decoded.userId,
        userType: decoded.userType,
        username: decoded.username,
        isSuperAdmin: decoded.isSuperAdmin
      });
    } catch (error) {
      // Token is invalid, clear cookie
      res.clearCookie('session');
      res.json({ authenticated: false });
    }
  } else {
    res.json({ authenticated: false });
  }
});

// ==========================
// 📦 CRUD ROUTES (SuperAdmin only)
// ==========================

// Get All Admins
router.get("/", requireSuperAdmin, async (req, res) => {
  try {
    const admins = await Admin.find({ isSuperAdmin: false }).select("-password");
    res.status(200).json({ status: 200, message: "Admins retrieved successfully", data: admins });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Admin by ID
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const admin = await Admin.findById(req.params.id).select("-password");
    if (!admin) return res.status(404).json({ message: "Admin not found" });
    res.status(200).json({ status: 200, message: "Admin retrieved successfully", data: admin });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Admin
router.put("/:id", requireSuperAdmin, async (req, res) => {
  try {
    const updates = req.body;
    const admin = await Admin.findByIdAndUpdate(req.params.id, updates, { new: true }).select("-password");
    if (!admin) return res.status(404).json({ message: "Admin not found" });

    res.json({ message: "Admin updated successfully", admin });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete (Deactivate) Admin
router.delete("/:id", requireSuperAdmin, async (req, res) => {
  try {
    const admin = await Admin.findByIdAndUpdate(req.params.id, { status: "inactive" }, { new: true });
    if (!admin) return res.status(404).json({ message: "Admin not found" });

    res.json({ message: "Admin deactivated successfully", admin });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
