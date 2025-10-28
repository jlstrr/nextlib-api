import { Router } from "express";
import Log from "../../../models/Log.js";
import { adminAuthMiddleware } from "../../../middleware/auth.js";
import { requireSuperAdmin } from "../../../middleware/auth.js";

const router = Router();

// ==========================
// 📝 LOG ROUTES (Admin/SuperAdmin Only)
// ==========================

// Get all logs (Admin can see their own, SuperAdmin can see all)
router.get("/", adminAuthMiddleware, async (req, res) => {
  try {
    const { 
      admin_id,
      action, 
      resource,
      method,
      status,
      date_from,
      date_to,
      page = 1, 
      limit = 20 
    } = req.query;
    
    // Build filter
    const filter = {};
    
    // Regular admins can only see their own logs, SuperAdmins can see all
    if (!req.user.isSuperAdmin) {
      filter.admin_id = req.user._id;
    } else if (admin_id) {
      filter.admin_id = admin_id;
    }
    
    if (action) filter.action = new RegExp(action, 'i'); // Case-insensitive search
    if (resource) filter.resource = resource;
    if (method) filter.method = method;
    if (status) filter.status = status;
    
    // Date range filter
    if (date_from || date_to) {
      filter.timestamp = {};
      if (date_from) filter.timestamp.$gte = new Date(date_from);
      if (date_to) filter.timestamp.$lte = new Date(date_to);
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const logs = await Log.find(filter)
      .populate('admin_id', 'firstname lastname username email isSuperAdmin')
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Log.countDocuments(filter);

    res.status(200).json({
      status: 200,
      message: "Logs retrieved successfully",
      data: {
        logs,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalItems: total,
          itemsPerPage: parseInt(limit),
        },
      },
    });
  } catch (error) {
    console.error("Get logs error:", error);
    res.status(500).json({ 
      status: 500, 
      message: "Failed to retrieve logs", 
      error: error.message 
    });
  }
});

// Get log by ID (Admin can see their own, SuperAdmin can see all)
router.get("/:id", adminAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const filter = { _id: id };
    
    // Regular admins can only see their own logs
    if (!req.user.isSuperAdmin) {
      filter.admin_id = req.user._id;
    }

    const log = await Log.findOne(filter)
      .populate('admin_id', 'firstname lastname username email isSuperAdmin');

    if (!log) {
      return res.status(404).json({
        status: 404,
        message: "Log not found or access denied",
      });
    }

    res.status(200).json({
      status: 200,
      message: "Log retrieved successfully",
      data: log,
    });
  } catch (error) {
    console.error("Get log error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to retrieve log",
      error: error.message,
    });
  }
});

// Create log entry (Admin/SuperAdmin only)
router.post("/", adminAuthMiddleware, async (req, res) => {
  try {
    const { 
      action, 
      resource, 
      resource_id,
      method, 
      details,
      status = "success",
      error_message 
    } = req.body;

    // Validate required fields
    if (!action || !resource || !method) {
      return res.status(400).json({
        status: 400,
        message: "Action, resource, and method are required",
      });
    }

    // Validate method enum
    const validMethods = ["CREATE", "READ", "UPDATE", "DELETE", "APPROVE", "REJECT", "CANCEL"];
    if (!validMethods.includes(method)) {
      return res.status(400).json({
        status: 400,
        message: `Method must be one of: ${validMethods.join(", ")}`,
      });
    }

    // Extract IP and User Agent from request
    const ip_address = req.ip || req.connection.remoteAddress || null;
    const user_agent = req.get('User-Agent') || null;

    const log = await Log.createLog(
      req.user._id,
      action,
      resource,
      method,
      {
        resource_id,
        details,
        ip_address,
        user_agent,
        status,
        error_message
      }
    );

    if (!log) {
      return res.status(500).json({
        status: 500,
        message: "Failed to create log entry",
      });
    }

    // Populate admin data for response
    await log.populate('admin_id', 'firstname lastname username email isSuperAdmin');

    res.status(201).json({
      status: 201,
      message: "Log entry created successfully",
      data: log,
    });
  } catch (error) {
    console.error("Create log error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to create log entry",
      error: error.message,
    });
  }
});

// Get log statistics (SuperAdmin only)
router.get("/statistics/overview", requireSuperAdmin, async (req, res) => {
  try {
    const { 
      date_from, 
      date_to, 
      admin_id 
    } = req.query;

    // Build match filter
    const matchFilter = {};
    if (admin_id) matchFilter.admin_id = admin_id;
    
    // Date range filter
    if (date_from || date_to) {
      matchFilter.timestamp = {};
      if (date_from) matchFilter.timestamp.$gte = new Date(date_from);
      if (date_to) matchFilter.timestamp.$lte = new Date(date_to);
    }

    // Get statistics by action
    const actionStats = await Log.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: "$action",
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // Get statistics by resource
    const resourceStats = await Log.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: "$resource",
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // Get statistics by method
    const methodStats = await Log.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: "$method",
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // Get statistics by status
    const statusStats = await Log.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 }
        }
      }
    ]);

    // Get daily activity
    const dailyStats = await Log.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: {
            year: { $year: "$timestamp" },
            month: { $month: "$timestamp" },
            day: { $dayOfMonth: "$timestamp" }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { "_id.year": -1, "_id.month": -1, "_id.day": -1 } },
      { $limit: 30 } // Last 30 days
    ]);

    // Get most active admins
    const adminStats = await Log.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: "$admin_id",
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: "admins",
          localField: "_id",
          foreignField: "_id",
          as: "admin"
        }
      },
      {
        $project: {
          admin_id: "$_id",
          count: 1,
          admin_name: { 
            $concat: [
              { $arrayElemAt: ["$admin.firstname", 0] },
              " ",
              { $arrayElemAt: ["$admin.lastname", 0] }
            ]
          },
          username: { $arrayElemAt: ["$admin.username", 0] }
        }
      }
    ]);

    const total = await Log.countDocuments(matchFilter);

    // Format statistics
    const formattedStats = {
      total_logs: total,
      by_action: actionStats,
      by_resource: resourceStats,
      by_method: methodStats,
      by_status: {
        success: 0,
        failed: 0,
        error: 0
      },
      daily_activity: dailyStats,
      most_active_admins: adminStats
    };

    statusStats.forEach(stat => {
      formattedStats.by_status[stat._id] = stat.count;
    });

    res.status(200).json({
      status: 200,
      message: "Log statistics retrieved successfully",
      data: formattedStats,
    });
  } catch (error) {
    console.error("Get log statistics error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to retrieve log statistics",
      error: error.message,
    });
  }
});

// Get logs by resource (Admin can see their own, SuperAdmin can see all)
router.get("/resource/:resource", adminAuthMiddleware, async (req, res) => {
  try {
    const { resource } = req.params;
    const { 
      resource_id,
      method,
      page = 1, 
      limit = 20 
    } = req.query;

    // Build filter
    const filter = { resource };
    if (resource_id) filter.resource_id = resource_id;
    if (method) filter.method = method;
    
    // Regular admins can only see their own logs
    if (!req.user.isSuperAdmin) {
      filter.admin_id = req.user._id;
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const logs = await Log.find(filter)
      .populate('admin_id', 'firstname lastname username email isSuperAdmin')
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Log.countDocuments(filter);

    res.status(200).json({
      status: 200,
      message: `Logs for resource '${resource}' retrieved successfully`,
      data: {
        resource,
        logs,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalItems: total,
          itemsPerPage: parseInt(limit),
        },
      },
    });
  } catch (error) {
    console.error("Get resource logs error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to retrieve resource logs",
      error: error.message,
    });
  }
});

// Get recent activity (Admin can see their own, SuperAdmin can see all)
router.get("/activity/recent", adminAuthMiddleware, async (req, res) => {
  try {
    const { limit = 50 } = req.query;

    // Build filter
    const filter = {};
    
    // Regular admins can only see their own logs
    if (!req.user.isSuperAdmin) {
      filter.admin_id = req.user._id;
    }

    const recentLogs = await Log.find(filter)
      .populate('admin_id', 'firstname lastname username email isSuperAdmin')
      .sort({ timestamp: -1 })
      .limit(parseInt(limit));

    res.status(200).json({
      status: 200,
      message: "Recent activity retrieved successfully",
      data: {
        recent_logs: recentLogs,
        total_shown: recentLogs.length,
      },
    });
  } catch (error) {
    console.error("Get recent activity error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to retrieve recent activity",
      error: error.message,
    });
  }
});

// Delete old logs (SuperAdmin only)
router.delete("/cleanup/:days", requireSuperAdmin, async (req, res) => {
  try {
    const { days } = req.params;
    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - parseInt(days));

    const result = await Log.deleteMany({
      timestamp: { $lt: daysAgo }
    });

    res.status(200).json({
      status: 200,
      message: `Cleaned up logs older than ${days} days`,
      data: {
        deleted_count: result.deletedCount,
        cutoff_date: daysAgo,
      },
    });
  } catch (error) {
    console.error("Cleanup logs error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to cleanup old logs",
      error: error.message,
    });
  }
});

export default router;