import { Router } from "express";
import UsageHistory from "../../../models/UsageHistory.js";
import Reservation from "../../../models/Reservation.js";
import User from "../../../models/User.js";
import { adminAuthMiddleware, authMiddleware } from "../../../middleware/auth.js";

const router = Router();

// ==========================
// 📊 USAGE HISTORY ROUTES
// ==========================

// Get all usage history (Admin only)
router.get("/", adminAuthMiddleware, async (req, res) => {
  try {
    const { 
      status, 
      user_id,
      date_from,
      date_to,
      page = 1, 
      limit = 10 
    } = req.query;
    
    // Build filter
    const filter = { isDeleted: false };
    if (status) filter.status = status;
    if (user_id) filter.user_id = user_id;
    
    // Date range filter
    if (date_from || date_to) {
      filter.date = {};
      if (date_from) filter.date.$gte = new Date(date_from);
      if (date_to) filter.date.$lte = new Date(date_to);
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const usageHistories = await UsageHistory.find(filter)
      .populate('reservation_id', 'reservation_type status')
      .populate('user_id', 'firstname lastname email id_number')
      .populate('approved_by', 'firstname lastname username')
      .sort({ date: -1, time_in: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await UsageHistory.countDocuments(filter);

    res.status(200).json({
      status: 200,
      message: "Usage history retrieved successfully",
      data: {
        usageHistories,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalItems: total,
          itemsPerPage: parseInt(limit),
        },
      },
    });
  } catch (error) {
    console.error("Get usage history error:", error);
    res.status(500).json({ 
      status: 500, 
      message: "Failed to retrieve usage history", 
      error: error.message 
    });
  }
});

// Get user's own usage history
router.get("/my-history", authMiddleware, async (req, res) => {
  try {
    const { status, page = 1, limit = 10, date_from, date_to } = req.query;
    
    // Ensure this is a user, not admin
    if (req.userType === "admin") {
      return res.status(403).json({ 
        status: 403, 
        message: "Admin users should use the admin usage history endpoint" 
      });
    }

    // Build filter
    const filter = { user_id: req.user._id, isDeleted: false };
    if (status) filter.status = status;
    
    // Date range filter
    if (date_from || date_to) {
      filter.date = {};
      if (date_from) filter.date.$gte = new Date(date_from);
      if (date_to) filter.date.$lte = new Date(date_to);
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const usageHistories = await UsageHistory.find(filter)
      .populate('reservation_id', 'reservation_type status reservation_number')
      .populate('approved_by', 'firstname lastname username')
      .sort({ date: -1, time_in: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await UsageHistory.countDocuments(filter);

    res.status(200).json({
      status: 200,
      message: "Your usage history retrieved successfully",
      data: {
        usageHistories,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalItems: total,
          itemsPerPage: parseInt(limit),
        },
      },
    });
  } catch (error) {
    console.error("Get user usage history error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to retrieve your usage history",
      error: error.message,
    });
  }
});

// Get usage history by ID
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const usageHistory = await UsageHistory.findOne({ 
      _id: id, 
      isDeleted: false 
    })
      .populate('reservation_id', 'reservation_type status purpose notes')
      .populate('user_id', 'firstname lastname email id_number')
      .populate('approved_by', 'firstname lastname username');

    if (!usageHistory) {
      return res.status(404).json({
        status: 404,
        message: "Usage history not found",
      });
    }

    // Check if user can access this usage history
    if (req.userType === "user" && usageHistory.user_id._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        status: 403,
        message: "You can only access your own usage history",
      });
    }

    res.status(200).json({
      status: 200,
      message: "Usage history retrieved successfully",
      data: usageHistory,
    });
  } catch (error) {
    console.error("Get usage history error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to retrieve usage history",
      error: error.message,
    });
  }
});

// Start usage session from reservation (Admin only)
router.post("/start-session", authMiddleware, async (req, res) => {
  try {
    const { reservation_id, time_in, notes } = req.body;

    if (!reservation_id) {
      return res.status(400).json({
        status: 400,
        message: "Reservation ID is required",
      });
    }

    // Validate time_in format if provided
    if (time_in && !/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time_in)) {
      return res.status(400).json({
        status: 400,
        message: "Time in must be in 24-hour format (HH:MM), e.g., 08:30",
      });
    }

    // Verify reservation exists and is approved
    const reservation = await Reservation.findOne({ 
      _id: reservation_id, 
      isDeleted: false 
    });

    if (!reservation) {
      return res.status(404).json({
        status: 404,
        message: "Reservation not found",
      });
    }

    if (reservation.status !== "approved") {
      return res.status(400).json({
        status: 400,
        message: "Only approved reservations can start usage sessions",
      });
    }

    if (reservation.reservation_type !== "computer") {
      return res.status(400).json({
        status: 400,
        message: "Usage sessions can only be started for computer reservations",
      });
    }

    // Check if usage session already exists for this reservation
    const existingSession = await UsageHistory.findOne({
      reservation_id,
      isDeleted: false
    });

    if (existingSession) {
      return res.status(400).json({
        status: 400,
        message: "Usage session already exists for this reservation",
      });
    }

    // Create usage history using the static method
    const usageHistory = await UsageHistory.createFromReservation(
      reservation, 
      req.user._id, 
      time_in // Pass the time_in string directly (should be in HH:MM format)
    );

    if (notes) {
      usageHistory.notes = notes.trim();
      await usageHistory.save();
    }

    // Update reservation status to active
    reservation.status = "active";
    await reservation.save();

    // Populate fields for response
    await usageHistory.populate([
      { path: 'reservation_id', select: 'reservation_type status purpose' },
      { path: 'user_id', select: 'firstname lastname email id_number' },
      { path: 'approved_by', select: 'firstname lastname username' }
    ]);

    res.status(201).json({
      status: 201,
      message: "Usage session started successfully",
      data: usageHistory,
    });
  } catch (error) {
    console.error("Start usage session error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to start usage session",
      error: error.message,
    });
  }
});

// End usage session (Admin only)
router.patch("/:id/end-session", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      time_out, 
      notes,
      status = "completed" 
    } = req.body;

    const usageHistory = await UsageHistory.findOne({ 
      _id: id, 
      isDeleted: false 
    });

    if (!usageHistory) {
      return res.status(404).json({
        status: 404,
        message: "Usage history not found",
      });
    }

    if (usageHistory.status !== "active") {
      return res.status(400).json({
        status: 400,
        message: "Can only end active usage sessions",
      });
    }

    // Set end time and calculate duration
    if (time_out) {
      // If time_out is provided, validate it's in HH:MM format
      if (!/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time_out)) {
        return res.status(400).json({
          status: 400,
          message: "Time out must be in 24-hour format (HH:MM), e.g., 14:30",
        });
      }
      usageHistory.time_out = time_out;
    } else {
      // Use current time in HH:MM format
      const now = new Date();
      usageHistory.time_out = now.toTimeString().slice(0, 5);
    }
    
    usageHistory.status = status;
    
    if (notes) usageHistory.notes = notes.trim();

    await usageHistory.save();

    // Subtract duration from user's remaining time
    const user = await User.findById(usageHistory.user_id);
    if (user && user.remaining_time && usageHistory.duration > 0) {
      // Parse current remaining time (HH:MM:SS format)
      const parseTimeToMinutes = (timeString) => {
        if (!timeString) return 0;
        const [hours, minutes, seconds] = timeString.split(':').map(Number);
        return (hours * 60) + minutes + Math.round(seconds / 60);
      };

      // Convert minutes back to HH:MM:SS format
      const minutesToTimeString = (totalMinutes) => {
        const hours = Math.floor(Math.abs(totalMinutes) / 60);
        const minutes = Math.floor(Math.abs(totalMinutes) % 60);
        const seconds = Math.round((Math.abs(totalMinutes) % 1) * 60);
        
        // If totalMinutes is negative, we'll still show positive time but could add a flag
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      };

      // Calculate new remaining time
      const currentRemainingMinutes = parseTimeToMinutes(user.remaining_time);
      const newRemainingMinutes = Math.max(0, currentRemainingMinutes - usageHistory.duration);
      const newRemainingTime = minutesToTimeString(newRemainingMinutes);

      // Update user's remaining time
      await User.findByIdAndUpdate(usageHistory.user_id, {
        remaining_time: newRemainingTime
      });

      // Log if user exceeded their remaining time
      if (currentRemainingMinutes < usageHistory.duration) {
        console.log(`User ${user.id_number} exceeded remaining time by ${usageHistory.duration - currentRemainingMinutes} minutes`);
      }
    }

    // Update related reservation to completed
    await Reservation.findByIdAndUpdate(usageHistory.reservation_id, { 
      status: "completed" 
    });

    // Populate fields for response
    await usageHistory.populate([
      { path: 'reservation_id', select: 'reservation_type status purpose' },
      { path: 'user_id', select: 'firstname lastname email id_number remaining_time' },
      { path: 'approved_by', select: 'firstname lastname username' }
    ]);

    res.status(200).json({
      status: 200,
      message: "Usage session ended successfully",
      data: {
        usageHistory,
        duration_minutes: usageHistory.duration,
        user_remaining_time: usageHistory.user_id.remaining_time
      },
    });
  } catch (error) {
    console.error("End usage session error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to end usage session",
      error: error.message,
    });
  }
});

// Get usage statistics (Admin only)
router.get("/statistics/overview", adminAuthMiddleware, async (req, res) => {
  try {
    const { 
      date_from, 
      date_to
    } = req.query;

    // Build match filter
    const matchFilter = { isDeleted: false };
    
    // Date range filter
    if (date_from || date_to) {
      matchFilter.date = {};
      if (date_from) matchFilter.date.$gte = new Date(date_from);
      if (date_to) matchFilter.date.$lte = new Date(date_to);
    }

    // Get statistics by status
    const statusStats = await UsageHistory.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalDuration: { $sum: "$duration" }
        }
      }
    ]);

    // Get daily usage statistics
    const dailyStats = await UsageHistory.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: {
            year: { $year: "$date" },
            month: { $month: "$date" },
            day: { $dayOfMonth: "$date" }
          },
          sessions: { $sum: 1 },
          totalDuration: { $sum: "$duration" },
          averageDuration: { $avg: "$duration" }
        }
      },
      { $sort: { "_id.year": -1, "_id.month": -1, "_id.day": -1 } },
      { $limit: 30 } // Last 30 days
    ]);

    const total = await UsageHistory.countDocuments(matchFilter);
    const totalDuration = await UsageHistory.aggregate([
      { $match: matchFilter },
      { $group: { _id: null, total: { $sum: "$duration" } } }
    ]);

    // Format statistics
    const formattedStats = {
      total_sessions: total,
      total_duration_minutes: totalDuration[0]?.total || 0,
      average_session_duration: total > 0 ? Math.round((totalDuration[0]?.total || 0) / total) : 0,
      by_status: {
        active: 0,
        completed: 0,
        interrupted: 0,
        overtime: 0
      },
      daily_usage: dailyStats
    };

    statusStats.forEach(stat => {
      formattedStats.by_status[stat._id] = {
        count: stat.count,
        total_duration: stat.totalDuration
      };
    });

    res.status(200).json({
      status: 200,
      message: "Usage statistics retrieved successfully",
      data: formattedStats,
    });
  } catch (error) {
    console.error("Get usage statistics error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to retrieve usage statistics",
      error: error.message,
    });
  }
});

// ==========================
// 📊 USAGE REPORTS ROUTE (Admin only)
// ==========================

router.get("/reports/:type", authMiddleware, async (req, res) => {
  try {
    const { type } = req.params;
    const { user_id, user_type, program, date_from, date_to } = req.query;


    // Build filter
    const matchFilter = { isDeleted: false };
    if (user_id) matchFilter.user_id = user_id;
    if (user_type) matchFilter.user_type = user_type;
    if (program) matchFilter.program_course = program;
    if (date_from || date_to) {
      matchFilter.date = {};
      if (date_from) matchFilter.date.$gte = new Date(date_from);
      if (date_to) matchFilter.date.$lte = new Date(date_to);
    }

    let report = [];
    let columns = [];
    if (type === 'daily') {
      // Group by day, then list users for each day
      const days = await UsageHistory.aggregate([
        { $match: matchFilter },
        {
          $group: {
            _id: {
              year: { $year: "$date" },
              month: { $month: "$date" },
              day: { $dayOfMonth: "$date" },
              user_id: "$user_id"
            },
            usage_count: { $sum: 1 },
            total_usage_time: { $sum: "$duration" }
          }
        },
        { $sort: { "_id.year": -1, "_id.month": -1, "_id.day": -1 } },
        {
          $group: {
            _id: { year: "$_id.year", month: "$_id.month", day: "$_id.day" },
            users: {
              $push: {
                user_id: "$_id.user_id",
                usage_count: "$usage_count",
                total_usage_time: "$total_usage_time"
              }
            }
          }
        },
        { $sort: { "_id.year": -1, "_id.month": -1, "_id.day": -1 } }
      ]);
      // Populate user details
      report = [];
      for (const d of days) {
        const populatedUsers = await User.find({ _id: { $in: d.users.map(u => u.user_id) } })
          .select('firstname lastname id_number user_type program_course');
        const userMap = {};
        populatedUsers.forEach(u => { userMap[u._id.toString()] = u; });
        report.push({
          date: `${d._id.year}-${String(d._id.month).padStart(2, '0')}-${String(d._id.day).padStart(2, '0')}`,
          users: d.users.map(u => ({
            name: userMap[u.user_id.toString()] ? `${userMap[u.user_id.toString()].firstname} ${userMap[u.user_id.toString()].lastname}` : '',
            id_number: userMap[u.user_id.toString()]?.id_number || '',
            user_type: userMap[u.user_id.toString()]?.user_type || '',
            program_course: userMap[u.user_id.toString()]?.program_course || '',
            usage_count: u.usage_count,
            total_usage_time: u.total_usage_time
          }))
        });
      }
      columns = ["Date", "Name", "ID Number", "User Type", "Program/Course", "Usage Count", "Total Usage Time (min)"];
    } else if (type === 'weekly') {
      // Group by week, then list users for each week
      const weeks = await UsageHistory.aggregate([
        { $match: matchFilter },
        {
          $group: {
            _id: {
              year: { $year: "$date" },
              week: { $isoWeek: "$date" },
              user_id: "$user_id"
            },
            usage_count: { $sum: 1 },
            total_usage_time: { $sum: "$duration" }
          }
        },
        { $sort: { "_id.year": -1, "_id.week": -1 } },
        {
          $group: {
            _id: { year: "$_id.year", week: "$_id.week" },
            users: {
              $push: {
                user_id: "$_id.user_id",
                usage_count: "$usage_count",
                total_usage_time: "$total_usage_time"
              }
            }
          }
        },
        { $sort: { "_id.year": -1, "_id.week": -1 } }
      ]);
      // Populate user details
      report = [];
      for (const w of weeks) {
        const populatedUsers = await User.find({ _id: { $in: w.users.map(u => u.user_id) } })
          .select('firstname lastname id_number user_type program_course');
        const userMap = {};
        populatedUsers.forEach(u => { userMap[u._id.toString()] = u; });
        report.push({
          year: w._id.year,
          week: w._id.week,
          users: w.users.map(u => ({
            name: userMap[u.user_id.toString()] ? `${userMap[u.user_id.toString()].firstname} ${userMap[u.user_id.toString()].lastname}` : '',
            id_number: userMap[u.user_id.toString()]?.id_number || '',
            user_type: userMap[u.user_id.toString()]?.user_type || '',
            program_course: userMap[u.user_id.toString()]?.program_course || '',
            usage_count: u.usage_count,
            total_usage_time: u.total_usage_time
          }))
        });
      }
      columns = ["Year", "Week", "Name", "ID Number", "User Type", "Program/Course", "Usage Count", "Total Usage Time (min)"];
    } else if (type === 'monthly') {
      // Group by month
      const monthly = await UsageHistory.aggregate([
        { $match: matchFilter },
        {
          $group: {
            _id: {
              year: { $year: "$date" },
              month: { $month: "$date" }
            },
            total_sessions: { $sum: 1 },
            total_usage_time: { $sum: "$duration" },
            unique_users: { $addToSet: "$user_id" },
            students: {
              $addToSet: {
                $cond: [ { $eq: [ "$user_type", "student" ] }, "$user_id", null ]
              }
            },
            faculty_staff: {
              $addToSet: {
                $cond: [ { $eq: [ "$user_type", "faculty" ] }, "$user_id", null ]
              }
            }
          }
        },
        { $sort: { "_id.year": -1, "_id.month": -1 } }
      ]);

      // For each month, find peak and lowest usage day
      report = [];
      for (const m of monthly) {
        // Find all days in this month
        const days = await UsageHistory.aggregate([
          { $match: {
              ...matchFilter,
              date: {
                $gte: new Date(m._id.year, m._id.month - 1, 1),
                $lt: new Date(m._id.year, m._id.month, 1)
              }
            }
          },
          {
            $group: {
              _id: { day: { $dayOfMonth: "$date" } },
              sessions: { $sum: 1 }
            }
          },
          { $sort: { sessions: -1 } }
        ]);
        let peakDay = null, lowestDay = null;
        if (days.length > 0) {
          peakDay = days[0]._id.day;
          lowestDay = days[days.length - 1]._id.day;
        }
        report.push({
          month: `${m._id.year}-${String(m._id.month).padStart(2, '0')}`,
          total_unique_users: m.unique_users.length,
          total_sessions: m.total_sessions,
          total_usage_time: m.total_usage_time,
          total_students: m.students.filter(s => s !== null).length,
          total_faculty_staff: m.faculty_staff.filter(f => f !== null).length,
          peak_usage_day: peakDay,
          lowest_usage_day: lowestDay
        });
      }
      columns = ["Month", "Total Unique Users", "Total Sessions Logged", "Total Usage Time (min)", "Total Students", "Total Faculty/Staff", "Peak Usage Day", "Lowest Usage Day"];
    } else {
      return res.status(400).json({
        status: 400,
        message: "Invalid report type. Use daily, weekly, or monthly."
      });
    }

    res.status(200).json({
      status: 200,
      message: `${type.charAt(0).toUpperCase() + type.slice(1)} usage report retrieved successfully`,
      filters_used: { user_id, user_type, program, date_from, date_to },
      columns,
      data: report
    });

  } catch (error) {
    console.error("Get usage report error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to retrieve usage report",
      error: error.message
    });
  }
});

// Get active sessions (Admin only)
router.get("/sessions/active", adminAuthMiddleware, async (req, res) => {
  try {
    // Build filter
    const filter = { status: "active", isDeleted: false };

    const activeSessions = await UsageHistory.find(filter)
      .populate('reservation_id', 'reservation_type status')
      .populate('user_id', 'firstname lastname email id_number')
      .populate('approved_by', 'firstname lastname username')
      .sort({ time_in: 1 });

    res.status(200).json({
      status: 200,
      message: "Active sessions retrieved successfully",
      data: {
        active_sessions: activeSessions,
        total_active: activeSessions.length,
      },
    });
  } catch (error) {
    console.error("Get active sessions error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to retrieve active sessions",
      error: error.message,
    });
  }
});

export default router;