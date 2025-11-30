import { Router } from "express";
import User from "../../../models/User.js";
import Reservation from "../../../models/Reservation.js";
import Computer from "../../../models/Computer.js";
import UsageHistory from "../../../models/UsageHistory.js";
import { authMiddleware, adminAuthMiddleware } from "../../../middleware/auth.js";
import { authorizeRoles } from "../../../middleware/authorize.js";

const router = Router();

// Get user profile
router.get(
  "/profile",
  authMiddleware,
  async (req, res) => {
    try {
      // User is already loaded by authMiddleware in req.user
      if (req.userType === "admin") {
        return res.status(403).json({ message: "Admin users should use admin profile endpoint" });
      }
      
      const user = req.user;
      res.status(200).json({ 
        status: 200, 
        message: "User profile retrieved successfully", 
        user: {
          id: user._id,
          id_number: user.id_number,
          firstname: user.firstname,
          middle_initial: user.middle_initial,
          lastname: user.lastname,
          program_course: user.program_course,
          yearLevel: user.yearLevel,
          email: user.email,
          user_type: user.user_type,
          status: user.status,
          remaining_time: user.remaining_time,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// --- Change password for current logged-in user ---
router.post(
  "/change-password",
  authMiddleware,
  async (req, res) => {
    try {
      // Only allow non-admins to use this endpoint for user accounts
      if (req.userType === "admin") {
        return res.status(403).json({ message: "Admins should change their password via admin endpoints" });
      }
      // Note: We no longer require the current password here. The route
      // is protected by authMiddleware so `req.user` is the authenticated user.
      // We will accept only `new_password` and `confirm_password` and rely on
      // the User model's pre-save hook to hash the new password.

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

      // Fetch the full user record (so pre-save hook runs on save)
      const user = await User.findById(req.user._id);
      if (!user || user.isDeleted) return res.status(404).json({ message: "User not found" });

      // Assign new password - the User pre('save') hook will hash it
      user.password = new_password;
      await user.save();

      res.status(200).json({ status: 200, message: "Password changed successfully" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// --- Dashboard Data (Protected) ---
router.get("/dashboard", authMiddleware, async (req, res) => {
  try {
    // Ensure this is a user, not admin
    if (req.userType === "admin") {
      return res.status(403).json({ 
        status: 403, 
        message: "Admin users should use admin dashboard endpoint" 
      });
    }

    const userId = req.user._id;
    const currentDate = new Date();
    const startOfDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    // Get user's reservations count
    const reservationsCount = await Reservation.countDocuments({
      user_id: userId,
      isDeleted: false
    });

    // Get total available computers
    const availableComputersCount = await Computer.countDocuments({
      status: "available",
      isDeleted: false
    });

    // Parse remaining_time format (HH:MM:SS) to minutes - only for students
    const parseTimeToMinutes = (timeString) => {
      if (!timeString) return 0;
      const [hours, minutes, seconds] = timeString.split(':').map(Number);
      return (hours * 60) + minutes + Math.round(seconds / 60);
    };

    // Initialize allotted hours data - only applicable for students
    let allottedHoursData = null;
    
    if (req.user.user_type === "student") {
      // Parse remaining_time to get allotted time info
      const remainingTimeMinutes = parseTimeToMinutes(req.user.remaining_time);
      const remainingTimeHours = Math.round(remainingTimeMinutes / 60 * 100) / 100; // Round to 2 decimal places

      // Calculate used time today from usage history
      const todayUsage = await UsageHistory.aggregate([
        {
          $match: {
            user_id: userId,
            date: {
              $gte: startOfDay,
              $lt: endOfDay
            },
            isDeleted: false
          }
        },
        {
          $group: {
            _id: null,
            totalMinutes: { $sum: "$duration" }
          }
        }
      ]);

      const usedTodayMinutes = todayUsage.length > 0 ? todayUsage[0].totalMinutes : 0;
      const usedTodayHours = Math.round(usedTodayMinutes / 60 * 100) / 100;

      // Calculate average hours per day (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const monthlyUsage = await UsageHistory.aggregate([
        {
          $match: {
            user_id: userId,
            date: {
              $gte: thirtyDaysAgo,
              $lt: currentDate
            },
            isDeleted: false
          }
        },
        {
          $group: {
            _id: {
              year: { $year: "$date" },
              month: { $month: "$date" },
              day: { $dayOfMonth: "$date" }
            },
            dailyMinutes: { $sum: "$duration" }
          }
        },
        {
          $group: {
            _id: null,
            totalMinutes: { $sum: "$dailyMinutes" },
            daysWithUsage: { $sum: 1 }
          }
        }
      ]);

      const averageHoursPerDay = monthlyUsage.length > 0 && monthlyUsage[0].daysWithUsage > 0 
        ? Math.round((monthlyUsage[0].totalMinutes / monthlyUsage[0].daysWithUsage) / 60 * 100) / 100
        : 0;

      allottedHoursData = {
        average_hours_per_day: averageHoursPerDay,
        remaining_hours_left: remainingTimeHours,
        used_hours_today: usedTodayHours,
        total_allotted_time: req.user.remaining_time || "00:00:00"
      };
    }

    // Get monthly usage chart data (all available months with data)
    const chartData = await UsageHistory.aggregate([
      {
        $match: {
          user_id: userId,
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
          sessionCount: { $sum: 1 },
          totalMinutes: { $sum: "$duration" }
        }
      },
      {
        $sort: { "_id.year": 1, "_id.month": 1 }
      },
      {
        $project: {
          _id: 0,
          year: "$_id.year",
          month: "$_id.month",
          monthKey: {
            $concat: [
              { $toString: "$_id.year" },
              "-",
              {
                $cond: {
                  if: { $lt: ["$_id.month", 10] },
                  then: { $concat: ["0", { $toString: "$_id.month" }] },
                  else: { $toString: "$_id.month" }
                }
              }
            ]
          },
          totalHours: { $round: ["$totalHours", 2] },
          totalMinutes: 1,
          sessionCount: 1
        }
      }
    ]);

    // Get the date range for available data
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1;

    // Create a comprehensive monthly chart data array
    let monthlyChartData = [];
    
    if (chartData.length > 0) {
      // Get the earliest and latest months with data
      const earliestData = chartData[0];
      const latestData = chartData[chartData.length - 1];
      
      const startYear = earliestData.year;
      const startMonth = earliestData.month;
      const endYear = Math.max(latestData.year, currentYear);
      const endMonth = latestData.year === currentYear ? Math.max(latestData.month, currentMonth) : 
                      latestData.year < currentYear ? currentMonth : latestData.month;

      // Generate all months from start to current month
      for (let year = startYear; year <= endYear; year++) {
        const monthStart = year === startYear ? startMonth : 1;
        const monthEnd = year === endYear ? endMonth : 12;
        
        for (let month = monthStart; month <= monthEnd; month++) {
          const monthKey = `${year}-${String(month).padStart(2, '0')}`;
          const existingData = chartData.find(item => item.monthKey === monthKey);
          
          monthlyChartData.push({
            month: monthKey,
            year: year,
            monthNumber: month,
            monthName: new Date(year, month - 1).toLocaleDateString('en-US', { month: 'long' }),
            totalHours: existingData ? existingData.totalHours : 0,
            totalMinutes: existingData ? existingData.totalMinutes : 0,
            sessionCount: existingData ? existingData.sessionCount : 0
          });
        }
      }
    } else {
      // If no usage history data exists, return empty array or current month with zero values
      const monthKey = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
      monthlyChartData = [{
        month: monthKey,
        year: currentYear,
        monthNumber: currentMonth,
        monthName: new Date(currentYear, currentMonth - 1).toLocaleDateString('en-US', { month: 'long' }),
        totalHours: 0,
        totalMinutes: 0,
        sessionCount: 0
      }];
    }

    // Prepare response data
    const dashboardData = {
      user: {
        id: req.user._id,
        name: `${req.user.firstname}${req.user.middle_initial ? ' ' + req.user.middle_initial : ''} ${req.user.lastname}`,
        user_type: req.user.user_type,
        status: req.user.status
      },
      statistics: {
        reservations_made: reservationsCount,
        available_computers: availableComputersCount
      },
      monthly_usage_chart: monthlyChartData
    };

    // Only include allotted_hours for students
    if (allottedHoursData) {
      dashboardData.allotted_hours = allottedHoursData;
    }

    res.status(200).json({
      status: 200,
      message: "Dashboard data retrieved successfully",
      data: dashboardData
    });

  } catch (err) {
    console.error("Dashboard error:", err);
    res.status(500).json({ 
      status: 500,
      message: "Failed to retrieve dashboard data",
      error: err.message 
    });
  }
});

// --- Create a new user (admin only) ---
router.post(
  "/",
  adminAuthMiddleware,
  async (req, res) => {
    try {
      const {
        id_number,
        firstname,
        middle_initial,
        lastname,
        program_course,
        yearLevel,
        email,
        password,
        user_type,
        remaining_time
      } = req.body;

      // Validate required fields
      if (!id_number || !firstname || !lastname || !email || !password) {
        return res.status(400).json({ 
          message: "Missing required fields: id_number, firstname, lastname, email, password" 
        });
      }

      // Check if user already exists
      const existingUser = await User.findOne({ 
        $or: [{ id_number }, { email }],
        isDeleted: false 
      });

      if (existingUser) {
        return res.status(409).json({ 
          message: "User with this ID number or email already exists" 
        });
      }

      // Create new user
      const newUser = new User({
        id_number,
        firstname,
        middle_initial: middle_initial || "",
        lastname,
        program_course: program_course,
        yearLevel: yearLevel,
        email,
        password, // Will be hashed by pre-save hook
        user_type: user_type || "student",
        remaining_time: remaining_time,
        status: "active"
      });

      await newUser.save();

      // Return user without password
      const userResponse = newUser.toObject();
      delete userResponse.password;
      delete userResponse.__v;

      res.status(201).json({ 
        status: 201, 
        message: "User created successfully", 
        data: userResponse 
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// --- Get all users (admin only) ---
router.get(
  "/",
  adminAuthMiddleware,
  // authorizeRoles("admin"),
  async (req, res) => {
    try {
      const { status, page = 1, limit = 10 } = req.query;
      const filter = { isDeleted: false };
      
      // Add status filter if provided
      if (status) {
        filter.status = status;
      }
      
      // Convert to numbers and validate
      const pageNum = Math.max(1, parseInt(page));
      const limitNum = Math.max(1, Math.min(100, parseInt(limit))); // Max 100 items per page
      const skip = (pageNum - 1) * limitNum;
      
      // Get total count for pagination metadata
      const totalUsers = await User.countDocuments(filter);
      const totalPages = Math.ceil(totalUsers / limitNum);
      
      // Fetch paginated users
      const users = await User.find(filter)
        .select("-password -__v")
        .skip(skip)
        .limit(limitNum)
        .sort({ createdAt: -1 }); // Sort by newest first
      
      res.status(200).json({ 
        status: 200, 
        message: "Users retrieved successfully", 
        data: users,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalUsers / parseInt(limit)),
          totalItems: totalUsers,
          itemsPerPage: parseInt(limit),
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// --- Get a user by ID (user) ---
router.get(
  "/:id",
  authMiddleware,
  // authorizeRoles("admin"),
  async (req, res) => {
    try {
      const user = await User.findById(req.params.id).select("-password -__v");
      if (!user || user.isDeleted) return res.status(404).json({ message: "User not found" });
      res.status(200).json({ status: 200, message: "User retrieved successfully", data: user });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// --- Update a user by ID (user) ---
router.put(
  "/:id",
  authMiddleware,
  // authorizeRoles("admin"),
  async (req, res) => {
    try {
      // const updateFields = { ...req.body };
      // if (typeof req.body.yearLevel !== "undefined") {
      //   updateFields.yearLevel = req.body.yearLevel;
      // }
      const updatedUser = await User.findByIdAndUpdate(
        req.params.id,
        req.body,
        { new: true, runValidators: true }
      ).select("-password -__v");

      if (!updatedUser) return res.status(404).json({ message: "User not found" });
      res.json(updatedUser);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

// --- Update user status (user) ---
router.patch(
  "/:id/status",
  authMiddleware,
  // authorizeRoles("admin"),
  async (req, res) => {
    try {
      const { status } = req.body;
      
      // Validate status value
      if (!["active", "inactive", "suspended"].includes(status)) {
        return res.status(400).json({ message: "Invalid status value. Must be active, inactive, or suspended" });
      }

      const updatedUser = await User.findByIdAndUpdate(
        req.params.id,
        { status },
        { new: true, runValidators: true }
      ).select("-password -__v");

      if (!updatedUser) return res.status(404).json({ message: "User not found" });
      res.status(200).json({ status: 200, message: `User status updated to ${status}`, user: updatedUser });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// --- Soft delete a user by ID (admin only) ---
router.delete(
  "/:id",
  adminAuthMiddleware,
  async (req, res) => {
    try {
      const deletedUser = await User.findByIdAndUpdate(
        req.params.id,
        { isDeleted: true, status: "inactive" },
        { new: true }
      ).select("-password -__v");

      if (!deletedUser) return res.status(404).json({ message: "User not found" });
      res.json({ message: "User deleted successfully", user: deletedUser });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
