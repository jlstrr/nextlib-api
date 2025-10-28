import { Router } from "express";
import SystemConfig from "../../../models/SystemConfig.js";
import { adminAuthMiddleware, authMiddleware, requireSuperAdmin } from "../../../middleware/auth.js";

const router = Router();

// ==========================
// ⚙️ SYSTEM CONFIG ROUTES
// ==========================

// Get current active system configuration (All authenticated users)
router.get("/current", authMiddleware, async (req, res) => {
  try {
    const config = await SystemConfig.getCurrentConfig();
    
    if (!config) {
      return res.status(404).json({
        status: 404,
        message: "No active system configuration found",
      });
    }

    res.status(200).json({
      status: 200,
      message: "Current system configuration retrieved successfully",
      data: config,
    });
  } catch (error) {
    console.error("Get current config error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to retrieve current system configuration",
      error: error.message,
    });
  }
});

// Get all system configurations (Admin only)
router.get("/", adminAuthMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 10, school_year, semester } = req.query;
    
    // Build filter
    const filter = {};
    if (school_year) filter.school_year = school_year;
    if (semester) filter.semester = semester;

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const configs = await SystemConfig.find(filter)
      .populate('created_by', 'firstname lastname username')
      .populate('last_modified_by', 'firstname lastname username')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await SystemConfig.countDocuments(filter);

    res.status(200).json({
      status: 200,
      message: "System configurations retrieved successfully",
      data: {
        configs,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalItems: total,
          itemsPerPage: parseInt(limit),
        },
      },
    });
  } catch (error) {
    console.error("Get configs error:", error);
    res.status(500).json({ 
      status: 500, 
      message: "Failed to retrieve system configurations", 
      error: error.message 
    });
  }
});

// Get system configuration by ID (Admin only)
router.get("/:id", adminAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const config = await SystemConfig.findById(id)
      .populate('created_by', 'firstname lastname username')
      .populate('last_modified_by', 'firstname lastname username');

    if (!config) {
      return res.status(404).json({
        status: 404,
        message: "System configuration not found",
      });
    }

    res.status(200).json({
      status: 200,
      message: "System configuration retrieved successfully",
      data: config,
    });
  } catch (error) {
    console.error("Get config error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to retrieve system configuration",
      error: error.message,
    });
  }
});

// Create new system configuration (SuperAdmin only)
router.post("/", requireSuperAdmin, async (req, res) => {
  try {
    const { 
      default_hours, 
      school_year, 
      semester, 
      notes,
      make_active = false 
    } = req.body;

    // Validate required fields
    if (!default_hours || !school_year || !semester) {
      return res.status(400).json({
        status: 400,
        message: "Default hours, school year, and semester are required",
      });
    }

    // Validate default_hours range
    if (default_hours < 1 || default_hours > 24) {
      return res.status(400).json({
        status: 400,
        message: "Default hours must be between 1 and 24",
      });
    }

    // Validate school year format
    if (!/^\d{4}-\d{4}$/.test(school_year)) {
      return res.status(400).json({
        status: 400,
        message: "School year must be in format 'YYYY-YYYY' (e.g., '2024-2025')",
      });
    }

    // Validate semester
    if (!["1st", "2nd", "summer"].includes(semester)) {
      return res.status(400).json({
        status: 400,
        message: "Semester must be '1st', '2nd', or 'summer'",
      });
    }

    // Check if configuration with same school year and semester already exists
    const existingConfig = await SystemConfig.findOne({
      school_year,
      semester
    });

    if (existingConfig) {
      return res.status(400).json({
        status: 400,
        message: "Configuration for this school year and semester already exists",
      });
    }

    const config = new SystemConfig({
      default_hours,
      school_year,
      semester,
      notes: notes?.trim() || null,
      is_active: make_active,
      created_by: req.user._id,
    });

    await config.save();

    // Populate fields for response
    await config.populate([
      { path: 'created_by', select: 'firstname lastname username' },
      { path: 'last_modified_by', select: 'firstname lastname username' }
    ]);

    res.status(201).json({
      status: 201,
      message: "System configuration created successfully",
      data: config,
    });
  } catch (error) {
    console.error("Create config error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to create system configuration",
      error: error.message,
    });
  }
});

// Update system configuration (SuperAdmin only)
router.put("/:id", requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      default_hours, 
      school_year, 
      semester, 
      notes 
    } = req.body;

    const config = await SystemConfig.findById(id);

    if (!config) {
      return res.status(404).json({
        status: 404,
        message: "System configuration not found",
      });
    }

    // Validate default_hours if provided
    if (default_hours && (default_hours < 1 || default_hours > 24)) {
      return res.status(400).json({
        status: 400,
        message: "Default hours must be between 1 and 24",
      });
    }

    // Validate school year format if provided
    if (school_year && !/^\d{4}-\d{4}$/.test(school_year)) {
      return res.status(400).json({
        status: 400,
        message: "School year must be in format 'YYYY-YYYY' (e.g., '2024-2025')",
      });
    }

    // Validate semester if provided
    if (semester && !["1st", "2nd", "summer"].includes(semester)) {
      return res.status(400).json({
        status: 400,
        message: "Semester must be '1st', '2nd', or 'summer'",
      });
    }

    // Check for duplicate school year and semester combination
    if (school_year || semester) {
      const targetSchoolYear = school_year || config.school_year;
      const targetSemester = semester || config.semester;
      
      const existingConfig = await SystemConfig.findOne({
        school_year: targetSchoolYear,
        semester: targetSemester,
        _id: { $ne: id }
      });

      if (existingConfig) {
        return res.status(400).json({
          status: 400,
          message: "Configuration for this school year and semester already exists",
        });
      }
    }

    // Update fields
    if (default_hours) config.default_hours = default_hours;
    if (school_year) config.school_year = school_year;
    if (semester) config.semester = semester;
    if (notes !== undefined) config.notes = notes?.trim() || null;
    config.last_modified_by = req.user._id;

    await config.save();

    // Populate fields for response
    await config.populate([
      { path: 'created_by', select: 'firstname lastname username' },
      { path: 'last_modified_by', select: 'firstname lastname username' }
    ]);

    res.status(200).json({
      status: 200,
      message: "System configuration updated successfully",
      data: config,
    });
  } catch (error) {
    console.error("Update config error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to update system configuration",
      error: error.message,
    });
  }
});

// Activate system configuration (SuperAdmin only)
router.patch("/:id/activate", requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const config = await SystemConfig.findById(id);

    if (!config) {
      return res.status(404).json({
        status: 404,
        message: "System configuration not found",
      });
    }

    if (config.is_active) {
      return res.status(400).json({
        status: 400,
        message: "Configuration is already active",
      });
    }

    // Use the static method to safely activate configuration
    const activeConfig = await SystemConfig.setActiveConfig(id, req.user._id);

    res.status(200).json({
      status: 200,
      message: "System configuration activated successfully",
      data: activeConfig,
    });
  } catch (error) {
    console.error("Activate config error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to activate system configuration",
      error: error.message,
    });
  }
});

// Delete system configuration (SuperAdmin only)
router.delete("/:id", requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const config = await SystemConfig.findById(id);

    if (!config) {
      return res.status(404).json({
        status: 404,
        message: "System configuration not found",
      });
    }

    // Prevent deletion of active configuration
    if (config.is_active) {
      return res.status(400).json({
        status: 400,
        message: "Cannot delete active configuration. Please activate another configuration first.",
      });
    }

    await SystemConfig.findByIdAndDelete(id);

    res.status(200).json({
      status: 200,
      message: "System configuration deleted successfully",
    });
  } catch (error) {
    console.error("Delete config error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to delete system configuration",
      error: error.message,
    });
  }
});

// Get system configuration history (Admin only)
router.get("/history/all", adminAuthMiddleware, async (req, res) => {
  try {
    const { limit = 20 } = req.query;

    const history = await SystemConfig.find({})
      .populate('created_by', 'firstname lastname username')
      .populate('last_modified_by', 'firstname lastname username')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    res.status(200).json({
      status: 200,
      message: "System configuration history retrieved successfully",
      data: {
        configurations: history,
        total_shown: history.length,
      },
    });
  } catch (error) {
    console.error("Get config history error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to retrieve system configuration history",
      error: error.message,
    });
  }
});

export default router;