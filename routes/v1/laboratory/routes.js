import { Router } from "express";
import Laboratory from "../../../models/Laboratory.js";
import Reservation from "../../../models/Reservation.js";
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

// Check laboratory availability for time slots
router.get("/availability/:laboratory_id", authMiddleware, async (req, res) => {
  try {
    const { laboratory_id } = req.params;
    const { date, duration = 60 } = req.query; // duration in minutes (30 or 60)

    // Validate laboratory exists
    const laboratory = await Laboratory.findOne({ 
      _id: laboratory_id, 
      isDeleted: false 
    });

    if (!laboratory) {
      return res.status(404).json({
        status: 404,
        message: "Laboratory not found",
      });
    }

    // Validate duration (only 30 minutes, 1 hour, and 2 hours allowed)
    if (![30, 60, 120].includes(parseInt(duration))) {
      return res.status(400).json({
        status: 400,
        message: "Duration must be either 30, 60, or 120 minutes",
      });
    }

    // If no date provided, use today
    const targetDate = date ? new Date(date) : new Date();
    
    // Set date to start of day
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    
    // Set date to end of day
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Get all laboratory reservations for the target date and specific laboratory
    const reservations = await Reservation.find({
      isDeleted: false,
      reservation_type: "laboratory",
      laboratory_id: laboratory_id,
      reservation_date: {
        $gte: startOfDay,
        $lte: endOfDay
      },
      status: { $in: ['approved', 'active'] } // Only consider approved and active reservations
    }).populate('user_id', 'firstname lastname email id_number');

    const durationMinutes = parseInt(duration);
    
    // Helper function to convert minutes back to time string
    const minutesToTime = (minutes) => {
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
    };

    // Helper function to convert military time to minutes since midnight
    const timeToMinutes = (timeString) => {
      const [hours, minutes] = timeString.split(':').map(Number);
      return hours * 60 + minutes;
    };
    
    // Generate basic time slots for the day (8:00 AM to 5:00 PM)
    const timeSlots = [];
    const startMinutes = 8 * 60; // 8:00 AM
    const endMinutes = 17 * 60;  // 5:00 PM
    
    for (let currentMinutes = startMinutes; currentMinutes < endMinutes; currentMinutes += durationMinutes) {
      const slotEndMinutes = currentMinutes + durationMinutes;

      // Don't add slots that extend beyond 5:00 PM
      if (slotEndMinutes > endMinutes) {
        break;
      }
      
      const slotStartTime = minutesToTime(currentMinutes);
      const slotEndTime = minutesToTime(slotEndMinutes);

      // Check if slot is in the past (only for today)
      const now = new Date();
      const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();
      const isPast = targetDate.toDateString() === new Date().toDateString() && currentMinutes < currentTimeMinutes;

      // Check for conflicts with existing reservations
      const hasConflict = reservations.some(reservation => {
        let reservationStartMinutes, reservationEndMinutes;
        
        if (reservation.start_time && typeof reservation.start_time === 'string') {
          // New format with military time
          reservationStartMinutes = timeToMinutes(reservation.start_time);
          reservationEndMinutes = timeToMinutes(reservation.end_time);
        } else if (reservation.reservation_date && reservation.duration) {
          // Legacy format
          const reservationStart = new Date(reservation.reservation_date);
          reservationStartMinutes = reservationStart.getHours() * 60 + reservationStart.getMinutes();
          reservationEndMinutes = reservationStartMinutes + reservation.duration;
        } else {
          return false; // Skip if we can't determine the time
        }
        
        // Check for overlap: (start1 < end2) && (start2 < end1)
        return (currentMinutes < reservationEndMinutes) && (reservationStartMinutes < slotEndMinutes);
      });

      const isAvailable = !isPast && !hasConflict;

      // Get conflicting reservations for this slot
      const conflictingReservations = reservations.filter(reservation => {
        let reservationStartMinutes, reservationEndMinutes;
        
        if (reservation.start_time && typeof reservation.start_time === 'string') {
          reservationStartMinutes = timeToMinutes(reservation.start_time);
          reservationEndMinutes = timeToMinutes(reservation.end_time);
        } else if (reservation.reservation_date && reservation.duration) {
          const reservationStart = new Date(reservation.reservation_date);
          reservationStartMinutes = reservationStart.getHours() * 60 + reservationStart.getMinutes();
          reservationEndMinutes = reservationStartMinutes + reservation.duration;
        } else {
          return false;
        }
        
        return (currentMinutes < reservationEndMinutes) && (reservationStartMinutes < slotEndMinutes);
      });

      timeSlots.push({
        start_time: slotStartTime,
        end_time: slotEndTime,
        start_time_formatted: slotStartTime,
        end_time_formatted: slotEndTime,
        is_available: isAvailable,
        is_past: isPast,
        has_conflict: hasConflict,
        duration_minutes: durationMinutes,
        conflicting_reservations: conflictingReservations.map(res => ({
          id: res.id,
          reservation_number: res.reservation_number,
          user: `${res.user_id.firstname} ${res.user_id.lastname}`,
          start_time: res.start_time || minutesToTime(new Date(res.reservation_date).getHours() * 60 + new Date(res.reservation_date).getMinutes()),
          end_time: res.end_time || minutesToTime((new Date(res.reservation_date).getHours() * 60 + new Date(res.reservation_date).getMinutes()) + res.duration),
          duration: res.duration,
          status: res.status
        }))
      });
    }

    // Get reservation details for the day
    const dayReservations = reservations.map(reservation => ({
      id: reservation.id,
      reservation_number: reservation.reservation_number,
      reservation_date: reservation.reservation_date,
      start_time: reservation.start_time,
      end_time: reservation.end_time,
      purpose: reservation.purpose,
      duration: reservation.duration,
      notes: reservation.notes,
      status: reservation.status,
      user: `${reservation.user_id.firstname} ${reservation.user_id.lastname}`
    }));

    res.status(200).json({
      status: 200,
      message: "Laboratory availability retrieved successfully",
      data: {
        laboratory: {
          id: laboratory.id,
          name: laboratory.name,
          status: laboratory.status,
          description: laboratory.description
        },
        date: targetDate.toISOString().split('T')[0],
        duration_minutes: parseInt(duration),
        time_slots: timeSlots,
        total_slots: timeSlots.length,
        available_slots: timeSlots.filter(slot => slot.is_available).length,
        past_slots: timeSlots.filter(slot => slot.is_past).length,
        conflicted_slots: timeSlots.filter(slot => slot.has_conflict).length,
        existing_reservations: dayReservations
      },
    });
  } catch (error) {
    console.error("Get laboratory availability error:", error);
    res.status(500).json({ 
      status: 500, 
      message: "Failed to retrieve laboratory availability", 
      error: error.message 
    });
  }
});

export default router;