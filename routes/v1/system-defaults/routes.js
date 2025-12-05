import { Router } from "express";
import SystemDefaults from "../../../models/SystemDefaults.js";
import User from "../../../models/User.js";
import { adminAuthMiddleware, authMiddleware, requireSuperAdmin } from "../../../middleware/auth.js";

const router = Router();

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

router.post("/", requireSuperAdmin, async (req, res) => {
  try {
    const { default_allotted_time } = req.body;
    if (!default_allotted_time) {
      return res.status(400).json({ status: 400, message: "default_allotted_time is required" });
    }
    if (!/^\d{1,2}:[0-5]\d:[0-5]\d$/.test(default_allotted_time)) {
      return res.status(400).json({ status: 400, message: "default_allotted_time must be in format 'HH:MM:SS'" });
    }
    const existing = await SystemDefaults.findOne({});
    let defaults;
    if (existing) {
      existing.default_allotted_time = default_allotted_time;
      defaults = await existing.save();
    } else {
      defaults = await SystemDefaults.create({ default_allotted_time });
    }
    res.status(201).json({ status: 201, message: "System defaults saved successfully", data: defaults });
  } catch (error) {
    res.status(500).json({ status: 500, message: "Failed to save system defaults", error: error.message });
  }
});

router.put("/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { default_allotted_time, updateToAllStudents } = req.body;
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
