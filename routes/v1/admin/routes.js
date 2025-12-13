import { Router } from "express";
import Admin from "../../../models/Admin.js";
import User from "../../../models/User.js";
import Computer from "../../../models/Computer.js";
import UsageHistory from "../../../models/UsageHistory.js";
import AttendanceLogs from "../../../models/AttendanceLogs.js";
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
      sameSite: "none",
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
        status: admin.status,
        email: admin.email
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

router.post("/change-password", authMiddleware, async (req, res) => {
  try {
    const { new_password, confirm_password } = req.body;

    if (!new_password || !confirm_password) {
      return res.status(400).json({ message: "new_password and confirm_password are required" });
    }

    if (new_password !== confirm_password) {
      return res.status(400).json({ message: "New password and confirmation do not match" });
    }

    if (new_password.length < 8) {
      return res.status(400).json({ message: "New password must be at least 8 characters" });
    }

    const admin = await Admin.findById(req.user._id);
    if (!admin) return res.status(404).json({ message: "Admin not found" });

    admin.password = new_password;
    await admin.save();

    res.status(200).json({ status: 200, message: "Password changed successfully" });
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
// 📊 DASHBOARD
// ==========================

// Get Admin Dashboard Data
router.get("/dashboard", adminAuthMiddleware, async (req, res) => {
  try {
    const currentDate = new Date();
    const startOfDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    // Get total number of admins (excluding super admin)
    const totalAdmins = await Admin.countDocuments({ 
      isSuperAdmin: false,
      status: "active"
    });

    // Get total number of students
    const totalStudents = await User.countDocuments({ 
      isDeleted: false,
      status: "active"
    });

    // Get number of active users (users currently using computers based on usage history)
    const activeUsers = await UsageHistory.countDocuments({
      status: "active",
      isDeleted: false
    });

    // Get number of available computers
    const availableComputers = await Computer.countDocuments({
      status: "available",
      isDeleted: false
    });

    // Get recent activity from attendance logs (last 10)
    const recentActivity = await AttendanceLogs.find({ isDeleted: false })
      .sort({ logged_at: -1 })
      .limit(10)
      .lean();

    // Manually fetch user data for students
    const formattedActivity = await Promise.all(recentActivity.map(async (log) => {
      if (log.user_type === "student" && log.id_number) {
        const user = await User.findOne({ id_number: log.id_number })
          .select('id_number firstname middle_initial lastname program_course yearLevel')
          .lean();
        
        if (user) {
          return {
            id: log._id,
            type: "Scanned Student",
            description: `Scanned Student with ID number: ${user.id_number} for ${log.purpose}`,
            user: {
              id_number: user.id_number,
              name: `${user.firstname}${user.middle_initial ? ' ' + user.middle_initial : ''} ${user.lastname}`,
              program_course: user.program_course,
              yearLevel: user.yearLevel
            },
            timestamp: log.logged_at,
            time_ago: getTimeAgo(log.logged_at)
          };
        } else {
          return {
            id: log._id,
            type: "Scanned Student",
            description: `Scanned Student with ID number: ${log.id_number} for ${log.purpose}`,
            user: {
              id_number: log.id_number,
              name: "Unknown User",
              program_course: null
            },
            timestamp: log.logged_at,
            time_ago: getTimeAgo(log.logged_at)
          };
        }
      } else {
        return {
          id: log._id,
          type: "Scanned Visitor",
          description: `Scanned Visitor: ${log.name} for ${log.purpose}`,
          visitor: {
            name: log.name,
            address: log.address
          },
          timestamp: log.logged_at,
          time_ago: getTimeAgo(log.logged_at)
        };
      }
    }));

    // Get monthly usage data for chart (last 12 months)
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
    twelveMonthsAgo.setDate(1);
    twelveMonthsAgo.setHours(0, 0, 0, 0);

    const monthlyUsage = await UsageHistory.aggregate([
      {
        $match: {
          date: { $gte: twelveMonthsAgo },
          isDeleted: false
        }
      },
      {
        $group: {
          _id: {
            year: { $year: "$date" },
            month: { $month: "$date" }
          },
          totalHours: { $sum: { $divide: ["$duration", 60] } },
          sessionCount: { $sum: 1 }
        }
      },
      {
        $sort: { "_id.year": 1, "_id.month": 1 }
      }
    ]);

    // Create array of all 12 months with data
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthlyChartData = [];
    
    for (let i = 0; i < 12; i++) {
      const date = new Date(twelveMonthsAgo);
      date.setMonth(date.getMonth() + i);
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      
      const existingData = monthlyUsage.find(
        item => item._id.year === year && item._id.month === month
      );
      
      monthlyChartData.push({
        month: monthNames[month - 1],
        year: year,
        totalHours: existingData ? Math.round(existingData.totalHours) : 0,
        sessionCount: existingData ? existingData.sessionCount : 0
      });
    }

    // Prepare dashboard response
    const dashboardData = {
      statistics: {
        total_admins: totalAdmins,
        total_students: totalStudents,
        active_users: activeUsers,
        available_computers: availableComputers
      },
      recent_activity: formattedActivity,
      monthly_usage_chart: monthlyChartData
    };

    res.status(200).json({
      status: 200,
      message: "Admin dashboard data retrieved successfully",
      data: dashboardData
    });

  } catch (err) {
    console.error("Admin dashboard error:", err);
    res.status(500).json({ 
      status: 500,
      message: "Failed to retrieve admin dashboard data",
      error: err.message 
    });
  }
});

// Helper function to calculate time ago
function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  
  let interval = Math.floor(seconds / 31536000);
  if (interval >= 1) return interval + " year" + (interval === 1 ? "" : "s") + " ago";
  
  interval = Math.floor(seconds / 2592000);
  if (interval >= 1) return interval + " month" + (interval === 1 ? "" : "s") + " ago";
  
  interval = Math.floor(seconds / 86400);
  if (interval >= 1) return interval + " day" + (interval === 1 ? "" : "s") + " ago";
  
  interval = Math.floor(seconds / 3600);
  if (interval >= 1) return interval + " hour" + (interval === 1 ? "" : "s") + " ago";
  
  interval = Math.floor(seconds / 60);
  if (interval >= 1) return interval + " min" + (interval === 1 ? "" : "s") + " ago";
  
  return "just now";
}

// ==========================
// 📦 CRUD ROUTES (SuperAdmin only)
// ==========================

// Get All Admins
router.get("/", authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 10, isSuperAdmin } = req.query;
    const filter = {};
    
    // Validate and apply isSuperAdmin filter
    if (typeof isSuperAdmin !== "undefined") {
      const val = String(isSuperAdmin).toLowerCase().trim();
      if (val === "true" || val === "1") {
        filter.isSuperAdmin = true;
      } else if (val === "false" || val === "0") {
        filter.isSuperAdmin = false;
      } else if (val === "") {
        // Empty string treated as omitted: no filter
      } else {
        return res.status(400).json({ 
          status: 400,
          message: "Invalid isSuperAdmin value. Use true or false." 
        });
      }
    }
    
    // Convert to numbers and validate
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit))); // Max 100 items per page
    const skip = (pageNum - 1) * limitNum;
    
    // Get total count for pagination metadata
    const total = await Admin.countDocuments(filter);
    
    // Fetch paginated admins
    const admins = await Admin.find(filter)
      .select("-password")
      .skip(skip)
      .limit(limitNum)
      .sort({ createdAt: -1 }); // Sort by newest first
    
    res.status(200).json({ 
      status: 200, 
      message: "Admins retrieved successfully", 
      data: admins,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalItems: total,
        itemsPerPage: parseInt(limit),
      }
    });
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
router.put("/:id", authMiddleware, async (req, res) => {
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
    const admin = await Admin.findByIdAndDelete(req.params.id);
    if (!admin) return res.status(404).json({ message: "Admin not found" });

    res.json({ message: "Admin deleted successfully", admin });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
