import { Router } from "express";
import Laboratory from "../../../models/Laboratory.js";
import Reservation from "../../../models/Reservation.js";
import SubjectScheduler from "../../../models/SubjectScheduler.js";
import { adminAuthMiddleware, authMiddleware } from "../../../middleware/auth.js";
import { getStartEndOfDay, getTZMinutesSinceMidnight, getTZDateString, getTZParts, isSameTZDay } from "../../../utils/timezone.js";

const router = Router();

const hasEnoughTimeRemaining = (reservationDate, duration) => {
  const now = new Date();
  const reservation = new Date(reservationDate);
  const isToday = isSameTZDay(now, reservation);
  if (!isToday) {
    return { valid: true };
  }
  const currentTimeInMinutes = getTZMinutesSinceMidnight(now);
  const endOfDayInMinutes = 24 * 60;
  const remainingMinutes = endOfDayInMinutes - currentTimeInMinutes;
  if (duration > remainingMinutes) {
    return {
      valid: false,
      message: `Cannot reserve for ${duration} minutes. Only ${remainingMinutes} minutes remaining in the current day.`,
      remainingMinutes,
    };
  }
  return { valid: true };
};

// ==========================
// 📊 LABORATORY ROUTES
// ==========================

// Get all laboratories (no pagination)
router.get("/", authMiddleware, async (req, res) => {
  try {
    const { status } = req.query;

    // Build filter
    const filter = { isDeleted: false };
    if (status) filter.status = status;

    // Return all matching laboratories sorted by creation date
    const laboratories = await Laboratory.find(filter).sort({ createdAt: -1 });

    res.status(200).json({
      status: 200,
      message: "Laboratories retrieved successfully",
      data: {
        laboratories
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

    const { startOfDay, endOfDay, targetDate, tzDateString } = getStartEndOfDay(date);

    // Validate duration (30 minutes, 1 hour, 2 hours, and 9 hours for all-day)
    if (![30, 60, 120, 540].includes(parseInt(duration))) {
      return res.status(400).json({
        status: 400,
        message: "Duration must be either 30, 60, 120, or 540 minutes (all-day)",
      });
    }

    // Check if there's enough time remaining for current day reservations
    const timeCheck = hasEnoughTimeRemaining(targetDate, parseInt(duration));
    if (!timeCheck.valid) {
      return res.status(400).json({
        status: 400,
        message: timeCheck.message,
        remaining_minutes: timeCheck.remainingMinutes
      });
    }

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

    // Get all subject scheduler entries for the same laboratory and day
    const subjectSchedules = await SubjectScheduler.find({
      date: {
        $gte: startOfDay,
        $lte: endOfDay
      },
      isDeleted: { $ne: true }
    });

    const durationMinutes = parseInt(duration);
    
    // Helper function to convert minutes back to time string
    const minutesToTime = (minutes) => {
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
    };

    // Helper function to convert military time to minutes since midnight
    const timeToMinutes = (timeString) => {
      if (!timeString) return 0;
      const [hours, minutes] = timeString.split(":").map(Number);
      return hours * 60 + minutes;
    };

    // Helper to parse timeslot string (e.g. '08:00-10:00' or '16:55 - 17:55')
    const parseTimeslot = (timeslot) => {
      if (!timeslot || typeof timeslot !== 'string') return [0, 0];
      const parts = timeslot.split('-');
      if (parts.length !== 2) return [0, 0];
      const start = parts[0].trim();
      const end = parts[1].trim();
      return [timeToMinutes(start), timeToMinutes(end)];
    };
    
    // Generate time slots for the day
    const timeSlots = [];
    const startMinutes = 8 * 60; // 8:00 AM
    const endMinutes = 17 * 60;  // 5:00 PM
    
    // Special handling for all-day reservations (540 minutes)
    if (durationMinutes === 540) {
      // For all-day, create a single slot from 8:00 AM to 5:00 PM (9 hours = 540 minutes)
      const slotStartTime = minutesToTime(startMinutes);
      const slotEndTime = minutesToTime(endMinutes);

      // Check if slot is in the past (only for today)
      const currentTimeMinutes = getTZMinutesSinceMidnight();
      const isPast = tzDateString === getTZDateString() && startMinutes < currentTimeMinutes;

      // Check for conflicts with existing reservations or subject schedules (any overlap means conflict)
      const hasReservationConflict = reservations.some(reservation => {
        let reservationStartMinutes, reservationEndMinutes;
        if (reservation.start_time && typeof reservation.start_time === 'string') {
          reservationStartMinutes = timeToMinutes(reservation.start_time);
          reservationEndMinutes = timeToMinutes(reservation.end_time);
        } else if (reservation.reservation_date && reservation.duration) {
          const { hour, minute } = getTZParts(new Date(reservation.reservation_date));
          reservationStartMinutes = hour * 60 + minute;
          reservationEndMinutes = reservationStartMinutes + reservation.duration;
        } else {
          return false;
        }
        return (startMinutes < reservationEndMinutes) && (reservationStartMinutes < endMinutes);
      });

      const hasSubjectConflict = subjectSchedules.some(schedule => {
        if (!schedule.timeslot) return false;
        const [schedStart, schedEnd] = parseTimeslot(schedule.timeslot);
        return (startMinutes < schedEnd) && (schedStart < endMinutes);
      });

      const hasConflict = hasReservationConflict || hasSubjectConflict;
      const isAvailable = !isPast && !hasConflict;

      // Get all conflicting reservations for the entire day
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
        return (startMinutes < reservationEndMinutes) && (reservationStartMinutes < endMinutes);
      });

      // Add subject scheduler conflicts as pseudo-reservations
      const conflictingSubjectSchedules = subjectSchedules.filter(schedule => {
        if (!schedule.timeslot) return false;
        const [schedStart, schedEnd] = parseTimeslot(schedule.timeslot);
        return (startMinutes < schedEnd) && (schedStart < endMinutes);
      });

      // Map subject scheduler conflicts to a similar structure for UI
      const subjectConflicts = conflictingSubjectSchedules.map(sched => ({
        id: sched.id,
        reservation_number: null,
        reservation_type: 'subject_schedule',
        user: sched.instructorName || 'Subject Instructor',
        start_time: sched.timeslot ? sched.timeslot.split('-')[0].trim() : '',
        end_time: sched.timeslot ? sched.timeslot.split('-')[1].trim() : '',
        duration: sched.timeslot ? (parseTimeslot(sched.timeslot)[1] - parseTimeslot(sched.timeslot)[0]) : null,
        status: 'scheduled',
        purpose: sched.subjectName || 'Class Schedule'
      }));

      timeSlots.push({
        start_time: slotStartTime,
        end_time: slotEndTime,
        is_available: isAvailable,
        is_past: isPast,
        has_conflict: hasConflict,
        duration_minutes: durationMinutes,
        is_all_day: true,
        conflicting_reservations: [
          ...conflictingReservations.map(res => ({
            id: res.id,
            reservation_number: res.reservation_number,
            user: `${res.user_id.firstname} ${res.user_id.lastname}`,
            start_time: res.start_time || minutesToTime(new Date(res.reservation_date).getHours() * 60 + new Date(res.reservation_date).getMinutes()),
            end_time: res.end_time || minutesToTime((new Date(res.reservation_date).getHours() * 60 + new Date(res.reservation_date).getMinutes()) + res.duration),
            duration: res.duration,
            status: res.status
          })),
          ...subjectConflicts
        ]
      });
    } else {
      // Regular time slot generation for non-all-day durations
    
    for (let currentMinutes = startMinutes; currentMinutes < endMinutes; currentMinutes += durationMinutes) {
      const slotEndMinutes = currentMinutes + durationMinutes;

      // Don't add slots that extend beyond 5:00 PM
      if (slotEndMinutes > endMinutes) {
        break;
      }
      
      const slotStartTime = minutesToTime(currentMinutes);
      const slotEndTime = minutesToTime(slotEndMinutes);

      // Check if slot is in the past (only for today)
      const currentTimeMinutes = getTZMinutesSinceMidnight();
      const isPast = tzDateString === getTZDateString() && currentMinutes < currentTimeMinutes;

      // Check for conflicts with existing reservations or subject schedules
      const hasReservationConflict = reservations.some(reservation => {
        let reservationStartMinutes, reservationEndMinutes;
        if (reservation.start_time && typeof reservation.start_time === 'string') {
          reservationStartMinutes = timeToMinutes(reservation.start_time);
          reservationEndMinutes = timeToMinutes(reservation.end_time);
        } else if (reservation.reservation_date && reservation.duration) {
          const { hour, minute } = getTZParts(new Date(reservation.reservation_date));
          reservationStartMinutes = hour * 60 + minute;
          reservationEndMinutes = reservationStartMinutes + reservation.duration;
        } else {
          return false; // Skip if we can't determine the time
        }
        return (currentMinutes < reservationEndMinutes) && (reservationStartMinutes < slotEndMinutes);
      });

      const hasSubjectConflict = subjectSchedules.some(schedule => {
        if (!schedule.timeslot) return false;
        const [schedStart, schedEnd] = parseTimeslot(schedule.timeslot);
        return (currentMinutes < schedEnd) && (schedStart < slotEndMinutes);
      });

      const hasConflict = hasReservationConflict || hasSubjectConflict;
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

      // Add subject scheduler conflicts as pseudo-reservations
      const conflictingSubjectSchedules = subjectSchedules.filter(schedule => {
        if (!schedule.timeslot) return false;
        const [schedStart, schedEnd] = parseTimeslot(schedule.timeslot);
        return (currentMinutes < schedEnd) && (schedStart < slotEndMinutes);
      });

      // Map subject scheduler conflicts to a similar structure for UI
      const subjectConflicts = conflictingSubjectSchedules.map(sched => ({
        id: sched.id,
        reservation_number: null,
        reservation_type: 'subject_schedule',
        user: sched.instructorName || 'Subject Instructor',
        start_time: sched.timeslot ? sched.timeslot.split('-')[0].trim() : '',
        end_time: sched.timeslot ? sched.timeslot.split('-')[1].trim() : '',
        duration: sched.timeslot ? (parseTimeslot(sched.timeslot)[1] - parseTimeslot(sched.timeslot)[0]) : null,
        status: 'scheduled',
        purpose: sched.subjectName || 'Class Schedule'
      }));

      timeSlots.push({
        start_time: slotStartTime,
        end_time: slotEndTime,
        start_time_formatted: slotStartTime,
        end_time_formatted: slotEndTime,
        is_available: isAvailable,
        is_past: isPast,
        has_conflict: hasConflict,
        duration_minutes: durationMinutes,
        conflicting_reservations: [
          ...conflictingReservations.map(res => ({
            id: res.id,
            reservation_number: res.reservation_number,
            user: `${res.user_id.firstname} ${res.user_id.lastname}`,
            start_time: res.start_time || minutesToTime(getTZParts(new Date(res.reservation_date)).hour * 60 + getTZParts(new Date(res.reservation_date)).minute),
            end_time: res.end_time || minutesToTime((getTZParts(new Date(res.reservation_date)).hour * 60 + getTZParts(new Date(res.reservation_date)).minute) + res.duration),
            duration: res.duration,
            status: res.status
          })),
          ...subjectConflicts
        ]
      });
    }
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
        date: tzDateString,
        duration_minutes: parseInt(duration),
        is_all_day: parseInt(duration) === 540,
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
