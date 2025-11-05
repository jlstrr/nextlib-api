import { Router } from "express";
import AttendanceLogs from "../../../models/AttendanceLogs.js";
import User from "../../../models/User.js";
import { authMiddleware, adminAuthMiddleware } from "../../../middleware/auth.js";
import { authorizeRoles } from "../../../middleware/authorize.js";

const router = Router();

// Check if ID number exists
router.get(
  "/check-id/:id_number",
  async (req, res) => {
    try {
      const { id_number } = req.params;

      if (!id_number) {
        return res.status(400).json({
          status: 400,
          message: "ID number is required"
        });
      }

      // Check if user exists
      const user = await User.findOne({ 
        id_number, 
        user_type: "student", 
        isDeleted: false 
      }).select('id_number firstname lastname middle_initial program_course email status');

      if (!user) {
        return res.status(404).json({
          status: 404,
          message: "Student ID number not found",
          exists: false
        });
      }

      res.status(200).json({
        status: 200,
        message: "Student ID number found",
        exists: true
      });
    } catch (error) {
      console.error("Error checking ID number:", error);
      res.status(500).json({
        status: 500,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Create new attendance log
router.post(
  "/",
  async (req, res) => {
    try {
      const {
        user_type,
        id_number,
        name,
        address,
        purpose
      } = req.body;

      // Validation based on user_type
      if (user_type === "student") {
        if (!id_number) {
          return res.status(400).json({
            status: 400,
            message: "ID number is required for students"
          });
        }

        // Verify student exists
        const student = await User.findOne({ id_number, user_type: "student", isDeleted: false });
        if (!student) {
          return res.status(404).json({
            status: 404,
            message: "Student not found"
          });
        }
      } else if (user_type === "visitor") {
        if (!name || !address) {
          return res.status(400).json({
            status: 400,
            message: "Name and address are required for visitors"
          });
        }
      }

      if (!purpose) {
        return res.status(400).json({
          status: 400,
          message: "Purpose is required"
        });
      }

      const attendanceLog = new AttendanceLogs({
        user_type,
        ...(user_type === "student" && { id_number }),
        ...(user_type === "visitor" && { name, address }),
        purpose
      });

      await attendanceLog.save();

      // Populate user data if it's a student
      if (user_type === "student") {
        await attendanceLog.populate('user_data', 'firstname lastname middle_initial program_course email');
      }

      res.status(201).json({
        status: 201,
        message: "Attendance log created successfully",
        data: attendanceLog
      });
    } catch (error) {
      console.error("Error creating attendance log:", error);
      res.status(500).json({
        status: 500,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Get all attendance logs (Admin only)
router.get(
  "/",
  adminAuthMiddleware,
  authorizeRoles("admin", "super_admin"),
  async (req, res) => {
    try {
      const {
        page = 1,
        limit = 10,
        user_type,
        purpose,
        start_date,
        end_date,
        search
      } = req.query;

      const query = { isDeleted: false };

      // Filter by user_type
      if (user_type && ["student", "visitor"].includes(user_type)) {
        query.user_type = user_type;
      }

      // Filter by purpose
      if (purpose) {
        query.purpose = { $regex: purpose, $options: "i" };
      }

      // Date range filter
      if (start_date || end_date) {
        query.logged_at = {};
        if (start_date) {
          query.logged_at.$gte = new Date(start_date);
        }
        if (end_date) {
          query.logged_at.$lte = new Date(end_date);
        }
      }

      // Search filter (for visitor name or student id_number)
      if (search) {
        query.$or = [
          { name: { $regex: search, $options: "i" } },
          { id_number: { $regex: search, $options: "i" } }
        ];
      }

      const skip = (parseInt(page) - 1) * parseInt(limit);

      const attendanceLogs = await AttendanceLogs.find(query)
        .populate('user_data', 'firstname lastname middle_initial program_course email')
        .sort({ logged_at: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      const total = await AttendanceLogs.countDocuments(query);

      res.status(200).json({
        status: 200,
        message: "Attendance logs retrieved successfully",
        data: {
          logs: attendanceLogs,
          pagination: {
            current_page: parseInt(page),
            total_pages: Math.ceil(total / parseInt(limit)),
            total_logs: total,
            per_page: parseInt(limit)
          }
        }
      });
    } catch (error) {
      console.error("Error fetching attendance logs:", error);
      res.status(500).json({
        status: 500,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Get attendance log by ID
router.get(
  "/:id",
  adminAuthMiddleware,
  authorizeRoles("admin", "super_admin"),
  async (req, res) => {
    try {
      const { id } = req.params;

      const attendanceLog = await AttendanceLogs.findOne({
        _id: id,
        isDeleted: false
      }).populate('user_data', 'firstname lastname middle_initial program_course email');

      if (!attendanceLog) {
        return res.status(404).json({
          status: 404,
          message: "Attendance log not found"
        });
      }

      res.status(200).json({
        status: 200,
        message: "Attendance log retrieved successfully",
        data: attendanceLog
      });
    } catch (error) {
      console.error("Error fetching attendance log:", error);
      res.status(500).json({
        status: 500,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Get user's own attendance logs (for students)
router.get(
  "/my-logs",
  authMiddleware,
  async (req, res) => {
    try {
      const { page = 1, limit = 10 } = req.query;
      
      if (req.userType === "admin") {
        return res.status(403).json({
          status: 403,
          message: "Access denied. Use admin endpoints for admin users."
        });
      }

      const user = req.user;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      const attendanceLogs = await AttendanceLogs.find({
        id_number: user.id_number,
        user_type: "student",
        isDeleted: false
      })
        .sort({ logged_at: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      const total = await AttendanceLogs.countDocuments({
        id_number: user.id_number,
        user_type: "student",
        isDeleted: false
      });

      res.status(200).json({
        status: 200,
        message: "Your attendance logs retrieved successfully",
        data: {
          logs: attendanceLogs,
          pagination: {
            current_page: parseInt(page),
            total_pages: Math.ceil(total / parseInt(limit)),
            total_logs: total,
            per_page: parseInt(limit)
          }
        }
      });
    } catch (error) {
      console.error("Error fetching user attendance logs:", error);
      res.status(500).json({
        status: 500,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Update attendance log (Admin only)
router.put(
  "/:id",
  adminAuthMiddleware,
  authorizeRoles("admin", "super_admin"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const {
        user_type,
        id_number,
        name,
        address,
        purpose
      } = req.body;

      const attendanceLog = await AttendanceLogs.findOne({
        _id: id,
        isDeleted: false
      });

      if (!attendanceLog) {
        return res.status(404).json({
          status: 404,
          message: "Attendance log not found"
        });
      }

      // Validation based on user_type
      if (user_type === "student" && id_number) {
        const student = await User.findOne({ id_number, user_type: "student", isDeleted: false });
        if (!student) {
          return res.status(404).json({
            status: 404,
            message: "Student not found"
          });
        }
      }

      // Update fields
      if (user_type) attendanceLog.user_type = user_type;
      if (user_type === "student" && id_number) {
        attendanceLog.id_number = id_number;
        attendanceLog.name = undefined;
        attendanceLog.address = undefined;
      }
      if (user_type === "visitor") {
        if (name) attendanceLog.name = name;
        if (address) attendanceLog.address = address;
        attendanceLog.id_number = undefined;
      }
      if (purpose) attendanceLog.purpose = purpose;

      await attendanceLog.save();

      // Populate user data if it's a student
      if (attendanceLog.user_type === "student") {
        await attendanceLog.populate('user_data', 'firstname lastname middle_initial program_course email');
      }

      res.status(200).json({
        status: 200,
        message: "Attendance log updated successfully",
        data: attendanceLog
      });
    } catch (error) {
      console.error("Error updating attendance log:", error);
      res.status(500).json({
        status: 500,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Delete attendance log (soft delete - Admin only)
router.delete(
  "/:id",
  adminAuthMiddleware,
  authorizeRoles("admin", "super_admin"),
  async (req, res) => {
    try {
      const { id } = req.params;

      const attendanceLog = await AttendanceLogs.findOne({
        _id: id,
        isDeleted: false
      });

      if (!attendanceLog) {
        return res.status(404).json({
          status: 404,
          message: "Attendance log not found"
        });
      }

      attendanceLog.isDeleted = true;
      await attendanceLog.save();

      res.status(200).json({
        status: 200,
        message: "Attendance log deleted successfully"
      });
    } catch (error) {
      console.error("Error deleting attendance log:", error);
      res.status(500).json({
        status: 500,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

// Get attendance statistics (Admin only)
router.get(
  "/stats/summary",
  adminAuthMiddleware,
  authorizeRoles("admin", "super_admin"),
  async (req, res) => {
    try {
      const { start_date, end_date } = req.query;

      const dateFilter = { isDeleted: false };
      if (start_date || end_date) {
        dateFilter.logged_at = {};
        if (start_date) {
          dateFilter.logged_at.$gte = new Date(start_date);
        }
        if (end_date) {
          dateFilter.logged_at.$lte = new Date(end_date);
        }
      }

      const [totalLogs, studentLogs, visitorLogs, todayLogs] = await Promise.all([
        AttendanceLogs.countDocuments(dateFilter),
        AttendanceLogs.countDocuments({ ...dateFilter, user_type: "student" }),
        AttendanceLogs.countDocuments({ ...dateFilter, user_type: "visitor" }),
        AttendanceLogs.countDocuments({
          isDeleted: false,
          logged_at: {
            $gte: new Date(new Date().setHours(0, 0, 0, 0)),
            $lt: new Date(new Date().setHours(24, 0, 0, 0))
          }
        })
      ]);

      res.status(200).json({
        status: 200,
        message: "Attendance statistics retrieved successfully",
        data: {
          total_logs: totalLogs,
          student_logs: studentLogs,
          visitor_logs: visitorLogs,
          today_logs: todayLogs
        }
      });
    } catch (error) {
      console.error("Error fetching attendance statistics:", error);
      res.status(500).json({
        status: 500,
        message: "Internal server error",
        error: error.message
      });
    }
  }
);

export default router;