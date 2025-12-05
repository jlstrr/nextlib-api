import { Router } from "express";
import AcademicConfig from "../../../models/AcademicConfig.js";
import { adminAuthMiddleware, authMiddleware, requireSuperAdmin } from "../../../middleware/auth.js";

const router = Router();

// ==========================
// ⚙️ SYSTEM CONFIG ROUTES
// ==========================

// Get current active system configuration (All authenticated users)
router.get("/current", authMiddleware, async (req, res) => {
  try {
    const config = await AcademicConfig.getCurrent();
    if (config) {
      const current = config.computeActiveSemester();
      if (config.active_semester !== current) {
        config.active_semester = current;
        await config.save();
      }
    }
    
    if (!config) {
      return res.status(404).json({
        status: 404,
      message: "No active academic configuration found",
      });
    }

    res.status(200).json({
      status: 200,
      message: "Current academic configuration retrieved successfully",
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
    const { page = 1, limit = 10, school_year } = req.query;
    
    // Build filter
    const filter = {};
    if (school_year) filter.school_year = school_year;
    

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const configs = await AcademicConfig.find(filter)
      .populate('created_by', 'firstname lastname username')
      .populate('last_modified_by', 'firstname lastname username')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await AcademicConfig.countDocuments(filter);

    res.status(200).json({
      status: 200,
      message: "Academic configurations retrieved successfully",
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

    const config = await AcademicConfig.findById(id)
      .populate('created_by', 'firstname lastname username')
      .populate('last_modified_by', 'firstname lastname username');

    if (!config) {
      return res.status(404).json({
        status: 404,
      message: "Academic configuration not found",
      });
    }

    res.status(200).json({
      status: 200,
      message: "Academic configuration retrieved successfully",
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
router.post("/", authMiddleware, async (req, res) => {
  try {
    const { school_year, notes, make_active = false } = req.body;
    const { first_semester_start, first_semester_end, second_semester_start, second_semester_end, summer_start, summer_end } = req.body;

    // Validate required fields
    if (!school_year || !first_semester_start || !first_semester_end || !second_semester_start || !second_semester_end) {
      return res.status(400).json({
        status: 400,
        message: "School year and both semesters' start and end dates are required",
      });
    }

    // Validate default_hours range
    const fsStart = new Date(first_semester_start);
    const fsEnd = new Date(first_semester_end);
    const ssStart = new Date(second_semester_start);
    const ssEnd = new Date(second_semester_end);
    if (isNaN(fsStart.getTime()) || isNaN(fsEnd.getTime()) || isNaN(ssStart.getTime()) || isNaN(ssEnd.getTime())) {
      return res.status(400).json({ status: 400, message: "Invalid semester dates" });
    }
    if (fsStart > fsEnd || ssStart > ssEnd) {
      return res.status(400).json({ status: 400, message: "Semester start date must be before end date" });
    }

    // Validate school year format
    if (!/^\d{4}-\d{4}$/.test(school_year)) {
      return res.status(400).json({
        status: 400,
        message: "School year must be in format 'YYYY-YYYY' (e.g., '2024-2025')",
      });
    }

    const semesters = [
      { name: "1st", start_date: fsStart, end_date: fsEnd },
      { name: "2nd", start_date: ssStart, end_date: ssEnd }
    ];
    if (summer_start && summer_end) {
      const suStart = new Date(summer_start);
      const suEnd = new Date(summer_end);
      if (isNaN(suStart.getTime()) || isNaN(suEnd.getTime()) || suStart > suEnd) {
        return res.status(400).json({ status: 400, message: "Invalid summer semester dates" });
      }
      semesters.push({ name: "summer", start_date: suStart, end_date: suEnd });
    }

    const existingConfig = await AcademicConfig.findOne({ school_year });

    if (existingConfig) {
      return res.status(400).json({
        status: 400,
      message: "Configuration for this school year already exists",
      });
    }

    const config = new AcademicConfig({
      school_year,
      semesters,
      notes: notes?.trim() || null,
      is_active: make_active,
      created_by: req.user._id
    });

    await config.save();
    const current = config.computeActiveSemester();
    if (config.active_semester !== current) {
      config.active_semester = current;
      await config.save();
    }

    // Populate fields for response
    await config.populate([
      { path: 'created_by', select: 'firstname lastname username' },
      { path: 'last_modified_by', select: 'firstname lastname username' }
    ]);

    res.status(201).json({
      status: 201,
      message: "Academic configuration created successfully",
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
router.put("/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { school_year, notes } = req.body;
    const { first_semester_start, first_semester_end, second_semester_start, second_semester_end, summer_start, summer_end } = req.body;

    const config = await AcademicConfig.findById(id);

    if (!config) {
      return res.status(404).json({
        status: 404,
      message: "Academic configuration not found",
      });
    }

    // Validate school year format if provided
    if (school_year && !/^\d{4}-\d{4}$/.test(school_year)) {
      return res.status(400).json({
        status: 400,
        message: "School year must be in format 'YYYY-YYYY' (e.g., '2024-2025')",
      });
    }
    const updates = {};
    if (school_year) updates.school_year = school_year;
    if (notes !== undefined) updates.notes = notes?.trim() || null;

    const semesterUpdates = [];
    if (first_semester_start && first_semester_end)
      semesterUpdates.push({ name: "1st", start_date: new Date(first_semester_start), end_date: new Date(first_semester_end) });
    if (second_semester_start && second_semester_end)
      semesterUpdates.push({ name: "2nd", start_date: new Date(second_semester_start), end_date: new Date(second_semester_end) });
    if (summer_start && summer_end)
      semesterUpdates.push({ name: "summer", start_date: new Date(summer_start), end_date: new Date(summer_end) });

    if (semesterUpdates.length > 0) {
      const names = new Set();
      for (const s of semesterUpdates) {
        if (isNaN(new Date(s.start_date).getTime()) || isNaN(new Date(s.end_date).getTime())) {
          return res.status(400).json({ status: 400, message: "Invalid semester dates" });
        }
        if (new Date(s.start_date) > new Date(s.end_date)) {
          return res.status(400).json({ status: 400, message: "Semester start date must be before end date" });
        }
        if (names.has(s.name)) {
          return res.status(400).json({ status: 400, message: "Duplicate semester name in updates" });
        }
        names.add(s.name);
      }
      const existing = config.semesters.filter(s => !names.has(s.name));
      config.semesters = [...existing, ...semesterUpdates];
    }

    Object.assign(config, updates);
    config.last_modified_by = req.user._id;

    await config.save();

    const current = config.computeActiveSemester();
    if (config.active_semester !== current) {
      config.active_semester = current;
      await config.save();
    }

    // Populate fields for response
    await config.populate([
      { path: 'created_by', select: 'firstname lastname username' },
      { path: 'last_modified_by', select: 'firstname lastname username' }
    ]);

    res.status(200).json({
      status: 200,
      message: "Academic configuration updated successfully",
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
router.patch("/:id/activate", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const config = await AcademicConfig.findById(id);

    if (!config) {
      return res.status(404).json({
        status: 404,
      message: "Academic configuration not found",
      });
    }

    if (config.is_active) {
      return res.status(400).json({
        status: 400,
        message: "Configuration is already active",
      });
    }

    // Use the static method to safely activate configuration
    const activeConfig = await AcademicConfig.setActiveConfig(id, req.user._id);

    res.status(200).json({
      status: 200,
      message: "Academic configuration activated successfully",
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

    const config = await AcademicConfig.findById(id);

    if (!config) {
      return res.status(404).json({
        status: 404,
      message: "Academic configuration not found",
      });
    }

    // Prevent deletion of active configuration
    if (config.is_active) {
      return res.status(400).json({
        status: 400,
      message: "Cannot delete active configuration. Please activate another configuration first.",
      });
    }

    await AcademicConfig.findByIdAndDelete(id);

    res.status(200).json({
      status: 200,
      message: "Academic configuration deleted successfully",
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

    const history = await AcademicConfig.find({})
      .populate('created_by', 'firstname lastname username')
      .populate('last_modified_by', 'firstname lastname username')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    res.status(200).json({
      status: 200,
      message: "Academic configuration history retrieved successfully",
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
