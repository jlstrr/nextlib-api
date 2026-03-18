import { Router } from "express";
import SystemDefaults from "../../../models/SystemDefaults.js";
import User from "../../../models/User.js";
import { adminAuthMiddleware, authMiddleware, requireSuperAdmin } from "../../../middleware/auth.js";

const router = Router();

const normalizeOperationHours = (value) => {
  if (value === undefined) return undefined;
  if (!value || !String(value).trim()) return null;
  const normalized = String(value).trim();
  if (/^24\s*hours$/i.test(normalized)) return "24 hours";
  return normalized;
};

const isValidOperationHours = (value) => {
  if (value === undefined || value === null) return true;
  const normalized = String(value).trim();
  if (!normalized) return true;
  if (/^24\s*hours$/i.test(normalized)) return true;
  return /^([01]?\d|2[0-3]):[0-5]\d\s-\s([01]?\d|2[0-3]):[0-5]\d$/.test(normalized);
};

router.get("/current", authMiddleware, async (req, res) => {
  try {
    const defaults = await SystemDefaults.getCurrent();
    if (!defaults) {
      return res.status(404).json({ status: 404, message: "No system defaults found" });
    }
    res.status(200).json({ status: 200, message: "Current system defaults retrieved successfully", data: defaults });
  } catch (error) {
    res.status(500).json({ status: 500, message: "Failed to retrieve system defaults", error: error.message });
  }
});

router.get("/", adminAuthMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const items = await SystemDefaults.find({}).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit));
    const total = await SystemDefaults.countDocuments({});
    res.status(200).json({
      status: 200,
      message: "System defaults retrieved successfully",
      data: { items, pagination: { currentPage: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)), totalItems: total, itemsPerPage: parseInt(limit) } }
    });
  } catch (error) {
    res.status(500).json({ status: 500, message: "Failed to retrieve system defaults", error: error.message });
  }
});

router.get("/:id", adminAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const defaults = await SystemDefaults.findById(id);
    if (!defaults) {
      return res.status(404).json({ status: 404, message: "System defaults not found" });
    }
    res.status(200).json({ status: 200, message: "System defaults retrieved successfully", data: defaults });
  } catch (error) {
    res.status(500).json({ status: 500, message: "Failed to retrieve system defaults", error: error.message });
  }
});

router.post("/", authMiddleware, async (req, res) => {
  try {
    const { default_allotted_time, operation_hours } = req.body || {};
    if (!default_allotted_time && !operation_hours) {
      return res.status(400).json({ status: 400, message: "default_allotted_time or operation_hours is required" });
    }
    if (default_allotted_time && !/^\d{1,2}:[0-5]\d:[0-5]\d$/.test(default_allotted_time)) {
      return res.status(400).json({ status: 400, message: "default_allotted_time must be in format 'HH:MM:SS'" });
    }
    if (operation_hours && !isValidOperationHours(operation_hours)) {
      return res.status(400).json({ status: 400, message: "operation_hours must be in format 'HH:MM - HH:MM' or '24 hours'" });
    }
    const existing = await SystemDefaults.findOne({});
    let defaults;
    if (existing) {
      if (default_allotted_time) existing.default_allotted_time = default_allotted_time;
      if (operation_hours !== undefined) {
        existing.operation_hours = normalizeOperationHours(operation_hours);
      }
      defaults = await existing.save();
    } else {
      if (!default_allotted_time) {
        return res.status(400).json({ status: 400, message: "default_allotted_time is required when creating system defaults for the first time" });
      }
      defaults = await SystemDefaults.create({ default_allotted_time, operation_hours: normalizeOperationHours(operation_hours) });
    }
    res.status(201).json({ status: 201, message: "System defaults saved successfully", data: defaults });
  } catch (error) {
    res.status(500).json({ status: 500, message: "Failed to save system defaults", error: error.message });
  }
});

router.put("/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { default_allotted_time, operation_hours, updateToAllStudents } = req.body || {};
    const defaults = await SystemDefaults.findById(id);
    if (!defaults) {
      return res.status(404).json({ status: 404, message: "System defaults not found" });
    }
    if (default_allotted_time) {
      if (!/^\d{1,2}:[0-5]\d:[0-5]\d$/.test(default_allotted_time)) {
        return res.status(400).json({ status: 400, message: "default_allotted_time must be in format 'HH:MM:SS'" });
      }
      defaults.default_allotted_time = default_allotted_time;
    }
    if (operation_hours !== undefined) {
      if (operation_hours && !isValidOperationHours(operation_hours)) {
        return res.status(400).json({ status: 400, message: "operation_hours must be in format 'HH:MM - HH:MM' or '24 hours'" });
      }
      defaults.operation_hours = normalizeOperationHours(operation_hours);
    }
    await defaults.save();
    if (updateToAllStudents === true || updateToAllStudents === "true") {
      const timeToSet = default_allotted_time || defaults.default_allotted_time;
      await User.updateMany(
        { user_type: "student", isDeleted: false },
        { remaining_time: timeToSet }
      );
    }
    res.status(200).json({ status: 200, message: "System defaults updated successfully", data: defaults });
  } catch (error) {
    res.status(500).json({ status: 500, message: "Failed to update system defaults", error: error.message });
  }
});

router.delete("/:id", requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const defaults = await SystemDefaults.findById(id);
    if (!defaults) {
      return res.status(404).json({ status: 404, message: "System defaults not found" });
    }
    await SystemDefaults.findByIdAndDelete(id);
    res.status(200).json({ status: 200, message: "System defaults deleted successfully" });
  } catch (error) {
    res.status(500).json({ status: 500, message: "Failed to delete system defaults", error: error.message });
  }
});

export default router;
