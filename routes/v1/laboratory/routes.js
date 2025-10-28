import { Router } from "express";
import Laboratory from "../../../models/Laboratory.js";
import { adminAuthMiddleware, authMiddleware } from "../../../middleware/auth.js";

const router = Router();

// ==========================
// 📊 LABORATORY ROUTES
// ==========================

// Get all laboratories
router.get("/", authMiddleware, async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    
    // Build filter
    const filter = { isDeleted: false };
    if (status) filter.status = status;

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const laboratories = await Laboratory.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Laboratory.countDocuments(filter);

    res.status(200).json({
      status: 200,
      message: "Laboratories retrieved successfully",
      data: {
        laboratories,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalItems: total,
          itemsPerPage: parseInt(limit),
        },
      },
    });
  } catch (error) {
    console.error("Get laboratories error:", error);
    res.status(500).json({ 
      status: 500, 
      message: "Failed to retrieve laboratories", 
      error: error.message 
    });
  }
});

// Get laboratory by ID
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const laboratory = await Laboratory.findOne({ 
      _id: id, 
      isDeleted: false 
    });

    if (!laboratory) {
      return res.status(404).json({
        status: 404,
        message: "Laboratory not found",
      });
    }

    res.status(200).json({
      status: 200,
      message: "Laboratory retrieved successfully",
      data: laboratory,
    });
  } catch (error) {
    console.error("Get laboratory error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to retrieve laboratory",
      error: error.message,
    });
  }
});

// Create new laboratory (Admin only)
router.post("/", adminAuthMiddleware, async (req, res) => {
  try {
    const { name, status, notes } = req.body;

    // Validate required fields
    if (!name) {
      return res.status(400).json({
        status: 400,
        message: "Laboratory name is required",
      });
    }

    // Check if laboratory with same name already exists
    const existingLab = await Laboratory.findOne({ 
      name: name.trim(), 
      isDeleted: false 
    });

    if (existingLab) {
      return res.status(400).json({
        status: 400,
        message: "Laboratory with this name already exists",
      });
    }

    const laboratory = new Laboratory({
      name: name.trim(),
      status: status || "active",
      notes: notes?.trim() || null,
    });

    await laboratory.save();

    res.status(201).json({
      status: 201,
      message: "Laboratory created successfully",
      data: laboratory,
    });
  } catch (error) {
    console.error("Create laboratory error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to create laboratory",
      error: error.message,
    });
  }
});

// Update laboratory (Admin only)
router.put("/:id", adminAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, status, notes } = req.body;

    const laboratory = await Laboratory.findOne({ 
      _id: id, 
      isDeleted: false 
    });

    if (!laboratory) {
      return res.status(404).json({
        status: 404,
        message: "Laboratory not found",
      });
    }

    // Check if new name conflicts with existing laboratory
    if (name && name.trim() !== laboratory.name) {
      const existingLab = await Laboratory.findOne({
        name: name.trim(),
        isDeleted: false,
        _id: { $ne: id },
      });

      if (existingLab) {
        return res.status(400).json({
          status: 400,
          message: "Laboratory with this name already exists",
        });
      }
    }

    // Update fields
    if (name) laboratory.name = name.trim();
    if (status) laboratory.status = status;
    if (notes !== undefined) laboratory.notes = notes?.trim() || null;

    await laboratory.save();

    res.status(200).json({
      status: 200,
      message: "Laboratory updated successfully",
      data: laboratory,
    });
  } catch (error) {
    console.error("Update laboratory error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to update laboratory",
      error: error.message,
    });
  }
});

// Delete laboratory (Admin only) - Soft delete
router.delete("/:id", adminAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const laboratory = await Laboratory.findOne({ 
      _id: id, 
      isDeleted: false 
    });

    if (!laboratory) {
      return res.status(404).json({
        status: 404,
        message: "Laboratory not found",
      });
    }

    // Soft delete
    laboratory.isDeleted = true;
    await laboratory.save();

    res.status(200).json({
      status: 200,
      message: "Laboratory deleted successfully",
    });
  } catch (error) {
    console.error("Delete laboratory error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to delete laboratory",
      error: error.message,
    });
  }
});

// Update laboratory status (Admin only)
router.patch("/:id/status", adminAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !["active", "inactive", "maintenance"].includes(status)) {
      return res.status(400).json({
        status: 400,
        message: "Valid status is required (active, inactive, maintenance)",
      });
    }

    const laboratory = await Laboratory.findOne({ 
      _id: id, 
      isDeleted: false 
    });

    if (!laboratory) {
      return res.status(404).json({
        status: 404,
        message: "Laboratory not found",
      });
    }

    laboratory.status = status;
    await laboratory.save();

    res.status(200).json({
      status: 200,
      message: "Laboratory status updated successfully",
      data: laboratory,
    });
  } catch (error) {
    console.error("Update laboratory status error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to update laboratory status",
      error: error.message,
    });
  }
});

export default router;