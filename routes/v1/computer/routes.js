import { Router } from "express";
import crypto from "crypto";
import Computer from "../../../models/Computer.js";
import Laboratory from "../../../models/Laboratory.js";
import Reservation from "../../../models/Reservation.js";
import SubjectScheduler from "../../../models/SubjectScheduler.js";
import { adminAuthMiddleware, authMiddleware } from "../../../middleware/auth.js";

const router = Router();

// ==========================
// 💻 COMPUTER ROUTES
// ==========================

// Get all computers (no pagination)
router.get("/", authMiddleware, async (req, res) => {
  try {
    const { laboratory_id, status } = req.query;

    // Build filter
    const filter = { isDeleted: false };
    if (laboratory_id) filter.laboratory_id = laboratory_id;
    if (status) filter.status = status;

    // Return all matching computers sorted by laboratory and pc_number
    const computers = await Computer.find(filter)
      .populate('laboratory_id', 'name status')
      .sort({ laboratory_id: 1, pc_number: 1 });

    res.status(200).json({
      status: 200,
      message: "Computers retrieved successfully",
      data: {
        computers
      },
    });
  } catch (error) {
    console.error("Get computers error:", error);
    res.status(500).json({ 
      status: 500, 
      message: "Failed to retrieve computers", 
      error: error.message 
    });
  }
});

// Get computers by laboratory ID (no pagination)
router.get("/laboratory/:laboratory_id", authMiddleware, async (req, res) => {
  try {
    const { laboratory_id } = req.params;
    const { status } = req.query;

    // Verify laboratory exists
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

    // Build filter
    const filter = { laboratory_id, isDeleted: false };
    if (status) filter.status = status;

    // Return all matching computers for the laboratory
    const computers = await Computer.find(filter)
      .populate('laboratory_id', 'name status')
      .sort({ pc_number: 1 });

    res.status(200).json({
      status: 200,
      message: "Computers retrieved successfully",
      data: {
        laboratory: {
          id: laboratory.id,
          name: laboratory.name,
          status: laboratory.status,
        },
        computers
      },
    });
  } catch (error) {
    console.error("Get computers by laboratory error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to retrieve computers",
      error: error.message,
    });
  }
});

// Get computer by ID
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const computer = await Computer.findOne({ 
      _id: id, 
      isDeleted: false 
    }).populate('laboratory_id', 'name status');

    if (!computer) {
      return res.status(404).json({
        status: 404,
        message: "Computer not found",
      });
    }

    res.status(200).json({
      status: 200,
      message: "Computer retrieved successfully",
      data: computer,
    });
  } catch (error) {
    console.error("Get computer error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to retrieve computer",
      error: error.message,
    });
  }
});

// Create new computer (Admin only)
router.post("/", adminAuthMiddleware, async (req, res) => {
  try {
    const { laboratory_id, pc_number, status, notes } = req.body;

    // Validate required fields
    if (!laboratory_id || !pc_number) {
      return res.status(400).json({
        status: 400,
        message: "Laboratory ID and PC number are required",
      });
    }

    // Verify laboratory exists
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

    // Check if computer with same pc_number already exists in this laboratory
    const existingComputer = await Computer.findOne({ 
      laboratory_id,
      pc_number: pc_number.trim(), 
      isDeleted: false 
    });

    if (existingComputer) {
      return res.status(400).json({
        status: 400,
        message: "Computer with this PC number already exists in this laboratory",
      });
    }

    const computer = new Computer({
      laboratory_id,
      pc_number: pc_number.trim(),
      status: status || "available",
      notes: notes?.trim() || null,
    });

    await computer.save();

    // Populate laboratory data for response
    await computer.populate('laboratory_id', 'name status');

    res.status(201).json({
      status: 201,
      message: "Computer created successfully",
      data: computer,
    });
  } catch (error) {
    console.error("Create computer error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to create computer",
      error: error.message,
    });
  }
});

// Update computer (Admin only)
router.put("/:id", adminAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { laboratory_id, pc_number, status, notes } = req.body;

    const computer = await Computer.findOne({ 
      _id: id, 
      isDeleted: false 
    });

    if (!computer) {
      return res.status(404).json({
        status: 404,
        message: "Computer not found",
      });
    }

    // If laboratory_id is being changed, verify new laboratory exists
    if (laboratory_id && laboratory_id !== computer.laboratory_id.toString()) {
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
    }

    // Check if new pc_number conflicts with existing computer in the same laboratory
    if (pc_number && pc_number.trim() !== computer.pc_number) {
      const targetLabId = laboratory_id || computer.laboratory_id;
      const existingComputer = await Computer.findOne({
        laboratory_id: targetLabId,
        pc_number: pc_number.trim(),
        isDeleted: false,
        _id: { $ne: id },
      });

      if (existingComputer) {
        return res.status(400).json({
          status: 400,
          message: "Computer with this PC number already exists in this laboratory",
        });
      }
    }

    // Update fields
    if (laboratory_id) computer.laboratory_id = laboratory_id;
    if (pc_number) computer.pc_number = pc_number.trim();
    if (status) computer.status = status;
    if (notes !== undefined) computer.notes = notes?.trim() || null;

    await computer.save();

    // Populate laboratory data for response
    await computer.populate('laboratory_id', 'name status');

    res.status(200).json({
      status: 200,
      message: "Computer updated successfully",
      data: computer,
    });
  } catch (error) {
    console.error("Update computer error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to update computer",
      error: error.message,
    });
  }
});

// Delete computer (Admin only)
router.delete("/:id", adminAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const deleted = await Computer.findByIdAndDelete(id);

    if (!deleted) {
      return res.status(404).json({
        status: 404,
        message: "Computer not found",
      });
    }

    res.status(200).json({
      status: 200,
      message: "Computer deleted successfully",
    });
  } catch (error) {
    console.error("Delete computer error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to delete computer",
      error: error.message,
    });
  }
});

// Update computer status (Admin only)
router.patch("/:id/status", adminAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !["available", "occupied", "maintenance", "out_of_order", "reserved", "locked"].includes(status)) {
      return res.status(400).json({
        status: 400,
        message: "Valid status is required (available, occupied, maintenance, out_of_order, reserved, locked)",
      });
    }

    const computer = await Computer.findOne({ 
      _id: id, 
      isDeleted: false 
    });

    if (!computer) {
      return res.status(404).json({
        status: 404,
        message: "Computer not found",
      });
    }

    computer.status = status;
    await computer.save();

    // Populate laboratory data for response
    await computer.populate('laboratory_id', 'name status');

    res.status(200).json({
      status: 200,
      message: "Computer status updated successfully",
      data: computer,
    });
  } catch (error) {
    console.error("Update computer status error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to update computer status",
      error: error.message,
    });
  }
});

// Get computer statistics by laboratory
router.get("/statistics/laboratory/:laboratory_id", authMiddleware, async (req, res) => {
  try {
    const { laboratory_id } = req.params;

    // Verify laboratory exists
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

    const statistics = await Computer.aggregate([
      { $match: { laboratory_id: laboratory._id, isDeleted: false } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 }
        }
      }
    ]);

    const total = await Computer.countDocuments({ 
      laboratory_id, 
      isDeleted: false 
    });

    // Format statistics
    const formattedStats = {
      total,
      available: 0,
      occupied: 0,
      maintenance: 0,
      out_of_order: 0,
    };

    statistics.forEach(stat => {
      formattedStats[stat._id] = stat.count;
    });

    res.status(200).json({
      status: 200,
      message: "Computer statistics retrieved successfully",
      data: {
        laboratory: {
          id: laboratory.id,
          name: laboratory.name,
          status: laboratory.status,
        },
        statistics: formattedStats,
      },
    });
  } catch (error) {
    console.error("Get computer statistics error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to retrieve computer statistics",
      error: error.message,
    });
  }
});

// Check computer availability for time slots
router.get("/availability/:computer_id", authMiddleware, async (req, res) => {
  try {
    const { computer_id } = req.params;
    const { date, duration = 60 } = req.query; // duration in minutes (30 or 60)

    // Validate computer exists
    const computer = await Computer.findOne({ 
      _id: computer_id, 
      isDeleted: false 
    }).populate('laboratory_id', 'name');

    if (!computer) {
      return res.status(404).json({
        status: 404,
        message: "Computer not found",
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

    // Get all computer reservations for the target date and specific computer
    const computerReservations = await Reservation.find({
      isDeleted: false,
      reservation_type: "computer",
      computer_id: computer_id,
      reservation_date: {
        $gte: startOfDay,
        $lte: endOfDay
      },
      status: { $in: ['pending', 'approved', 'active'] } // Include pending, approved and active reservations
    }).populate('user_id', 'firstname lastname email id_number');

    // Get all laboratory reservations for the target date that affect this computer's laboratory
    const laboratoryReservations = await Reservation.find({
      isDeleted: false,
      reservation_type: "laboratory",
      laboratory_id: computer.laboratory_id,
      reservation_date: {
        $gte: startOfDay,
        $lte: endOfDay
      },
      status: { $in: ['pending', 'approved', 'active'] } // Include pending, approved and active reservations
    }).populate('user_id', 'firstname lastname email id_number');

    // Get all subject scheduler entries for the same laboratory and day
    const subjectSchedules = await SubjectScheduler.find({
      date: {
        $gte: startOfDay,
        $lte: endOfDay
      },
      isDeleted: { $ne: true },
    });

    // Combine all reservations for conflict checking
    const allReservations = [...computerReservations, ...laboratoryReservations];

    // Since the new model doesn't have time slots, we'll show basic availability
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

    // Helper to parse timeslot string (e.g. '08:00-10:00')
    // Helper to parse timeslot string (e.g. '08:00-10:00' or '16:55 - 17:55')
    const parseTimeslot = (timeslot) => {
      if (!timeslot || typeof timeslot !== 'string') return [0, 0];
      // Split on dash, allowing spaces around it
      const parts = timeslot.split('-');
      if (parts.length !== 2) return [0, 0];
      const start = parts[0].trim();
      const end = parts[1].trim();
      return [timeToMinutes(start), timeToMinutes(end)];
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

      const now = new Date();
      const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();
      const isPast = targetDate.toDateString() === now.toDateString() && currentMinutes < currentTimeMinutes;

      // Check for conflicts with existing reservations (both computer and laboratory)
      const hasReservationConflict = allReservations.some(reservation => {
        let reservationStartMinutes, reservationEndMinutes;
        if (reservation.start_time && typeof reservation.start_time === 'string') {
          reservationStartMinutes = timeToMinutes(reservation.start_time);
          reservationEndMinutes = timeToMinutes(reservation.end_time);
        } else if (reservation.reservation_date && reservation.duration) {
          const reservationStart = new Date(reservation.reservation_date);
          reservationStartMinutes = reservationStart.getHours() * 60 + reservationStart.getMinutes();
          reservationEndMinutes = reservationStartMinutes + reservation.duration;
        } else {
          return false; // Skip if we can't determine the time
        }
        // Check for overlap: (start1 < end2) && (start2 < end1)
        return (currentMinutes < reservationEndMinutes) && (reservationStartMinutes < slotEndMinutes);
      });

      // Check for conflicts with subject scheduler
      const hasSubjectConflict = subjectSchedules.some(schedule => {
        if (!schedule.timeslot) return false;
        const [schedStart, schedEnd] = parseTimeslot(schedule.timeslot);
        return (currentMinutes < schedEnd) && (schedStart < slotEndMinutes);
      });

      const hasConflict = hasReservationConflict || hasSubjectConflict;
      const isAvailable = !isPast && !hasConflict;

      // Get conflicting reservations for this slot (both computer and laboratory)
      const conflictingReservations = allReservations.filter(reservation => {
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
        start_time: sched.timeslot ? sched.timeslot.split('-')[0] : '',
        end_time: sched.timeslot ? sched.timeslot.split('-')[1] : '',
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
        conflicting_reservations: [
          ...conflictingReservations.map(res => ({
            id: res.id,
            reservation_number: res.reservation_number,
            reservation_type: res.reservation_type,
            user: `${res.user_id.firstname} ${res.user_id.lastname}`,
            start_time: res.start_time || minutesToTime(new Date(res.reservation_date).getHours() * 60 + new Date(res.reservation_date).getMinutes()),
            end_time: res.end_time || minutesToTime((new Date(res.reservation_date).getHours() * 60 + new Date(res.reservation_date).getMinutes()) + res.duration),
            duration: res.duration,
            status: res.status,
            purpose: res.purpose
          })),
          ...subjectConflicts
        ]
      });
    }

    // Get reservation details for the day (both computer and laboratory reservations)
    const dayReservations = allReservations.map(reservation => ({
      id: reservation.id,
      reservation_number: reservation.reservation_number,
      reservation_type: reservation.reservation_type,
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
      message: "Computer availability retrieved successfully (includes laboratory reservation conflicts)",
      data: {
        computer: {
          id: computer.id,
          pc_number: computer.pc_number,
          status: computer.status,
          laboratory: {
            id: computer.laboratory_id.id,
            name: computer.laboratory_id.name
          }
        },
        date: targetDate.toISOString().split('T')[0],
        duration_minutes: parseInt(duration),
        time_slots: timeSlots,
        total_slots: timeSlots.length,
        available_slots: timeSlots.filter(slot => slot.is_available).length,
        past_slots: timeSlots.filter(slot => slot.is_past).length,
        conflicted_slots: timeSlots.filter(slot => slot.has_conflict).length,
        existing_reservations: dayReservations,
        reservation_summary: {
          computer_reservations: computerReservations.length,
          laboratory_reservations: laboratoryReservations.length,
          total_reservations: allReservations.length
        }
      },
    });
  } catch (error) {
    console.error("Get computer availability error:", error);
    res.status(500).json({ 
      status: 500, 
      message: "Failed to retrieve computer availability", 
      error: error.message 
    });
  }
});

// Check availability for all computers in a laboratory
router.get("/laboratory/:laboratory_id/availability", authMiddleware, async (req, res) => {
  try {
    const { laboratory_id } = req.params;
    const { date, duration = 60, time_slot } = req.query; // time_slot in format "HH:MM"

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

    // Get all computers in the laboratory
    const computers = await Computer.find({
      laboratory_id: laboratory_id,
      isDeleted: false,
      status: { $in: ['available', 'occupied'] } // Exclude maintenance and out_of_order
    }).sort({ pc_number: 1 });

    if (computers.length === 0) {
      return res.status(404).json({
        status: 404,
        message: "No computers found in this laboratory",
      });
    }

    // Get all computer reservations for the target date in this laboratory
    const computerIds = computers.map(comp => comp._id);
    const computerReservations = await Reservation.find({
      isDeleted: false,
      reservation_type: "computer",
      computer_id: { $in: computerIds },
      reservation_date: {
        $gte: startOfDay,
        $lte: endOfDay
      },
      status: { $in: ['pending', 'approved', 'active'] } // Include pending, approved and active reservations
    }).populate('user_id', 'firstname lastname email id_number');

    // Get all laboratory reservations for the target date that affect this laboratory
    const laboratoryReservations = await Reservation.find({
      isDeleted: false,
      reservation_type: "laboratory",
      laboratory_id: laboratory_id,
      reservation_date: {
        $gte: startOfDay,
        $lte: endOfDay
      },
      status: { $in: ['pending', 'approved', 'active'] } // Include pending, approved and active reservations
    }).populate('user_id', 'firstname lastname email id_number');

    // Combine all reservations for conflict checking
    const allReservations = [...computerReservations, ...laboratoryReservations];

    // Simplified response - with the new model, we can't do complex time slot checking
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
    
    // Generate basic time slots from 8:00 AM to 5:00 PM
    const timeSlots = [];
    const startMinutes = 8 * 60; // 8:00 AM
    const endMinutes = 17 * 60;  // 5:00 PM

    for (let currentMinutes = startMinutes; currentMinutes < endMinutes; currentMinutes += durationMinutes) {
      const slotEndMinutes = currentMinutes + durationMinutes;
      
      if (slotEndMinutes > endMinutes) break;

      const slotStartTime = minutesToTime(currentMinutes);
      const slotEndTime = minutesToTime(slotEndMinutes);

      const now = new Date();
      const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();
      const isPast = targetDate.toDateString() === now.toDateString() && currentMinutes < currentTimeMinutes;

      // Check for conflicts with existing reservations (both computer and laboratory)
      const hasConflict = allReservations.some(reservation => {
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

      // Calculate available computers considering conflicts
      const availableComputers = computers.filter(computer => 
        computer.status === 'available' && !isPast && !hasConflict
      );

      timeSlots.push({
        start_time: slotStartTime,
        end_time: slotEndTime,
        start_time_formatted: slotStartTime,
        end_time_formatted: slotEndTime,
        available_computers_count: availableComputers.length,
        total_computers: computers.length,
        is_past: isPast,
        has_conflict: hasConflict,
        duration_minutes: durationMinutes
      });
    }

    // Simplified computer list
    const computersSimple = computers.map(computer => ({
      id: computer.id,
      pc_number: computer.pc_number,
      status: computer.status,
      is_available: computer.status === 'available'
    }));

    res.status(200).json({
      status: 200,
      message: "Laboratory computers availability retrieved successfully (includes laboratory reservation conflicts)",
      data: {
        laboratory: {
          id: laboratory.id,
          name: laboratory.name,
          status: laboratory.status
        },
        date: targetDate.toISOString().split('T')[0],
        duration_minutes: durationMinutes,
        time_slots: timeSlots,
        computers: computersSimple,
        total_reservations_today: allReservations.length,
        reservation_summary: {
          computer_reservations: computerReservations.length,
          laboratory_reservations: laboratoryReservations.length,
          total_reservations: allReservations.length
        },
        summary: {
          total_computers: computers.length,
          available_computers: computers.filter(c => c.status === 'available').length,
          occupied_computers: computers.filter(c => c.status === 'occupied').length
        }
      },
    });
  } catch (error) {
    console.error("Get laboratory computers availability error:", error);
    res.status(500).json({ 
      status: 500, 
      message: "Failed to retrieve laboratory computers availability", 
      error: error.message 
    });
  }
});

// Register Client
router.post("/register-client", async (req, res) => {
  try {
    // Get first active laboratory
    const laboratory = await Laboratory.findOne({ isDeleted: false }).sort({ createdAt: 1 });
    if (!laboratory) {
      return res.status(404).json({ status: 404, message: "No laboratory found" });
    }

    // Check if there is already a client PC for this machine (optional: match clientToken if passed)
    // For simplicity, we'll allow one PC per lab incrementally
    const existingComputers = await Computer.find({ laboratory_id: laboratory._id, isDeleted: false }).select("pc_number clientToken");
    
    // Generate next PC number
    let maxNum = 0;
    for (const c of existingComputers) {
      const m = (c.pc_number || "").match(/\d+/g);
      const n = m && m.length ? parseInt(m[m.length - 1], 10) : NaN;
      if (!isNaN(n) && n > maxNum) maxNum = n;
    }
    const nextNumber = maxNum + 1;
    const pc_number = `PC-${String(nextNumber).padStart(2, "0")}`;

    // Generate token
    const clientToken = crypto.randomBytes(32).toString("hex");

    // Create new computer record
    const computer = new Computer({
      laboratory_id: laboratory._id,
      pc_number,
      status: "available",
      notes: `Client Computer No. ${nextNumber}`,
      clientToken
    });

    await computer.save();
    await computer.populate("laboratory_id", "name status");

    return res.status(201).json({
      status: 201,
      message: "Client registered and computer created successfully",
      data: {
        id: computer.id,
        pc_number: computer.pc_number,
        status: computer.status,
        laboratory: computer.laboratory_id,
        clientToken: computer.clientToken
      },
    });
  } catch (error) {
    console.error("Register client token error:", error);

    // Handle duplicate key gracefully
    if (error.code === 11000) {
      const existingComputer = await Computer.findOne({
        laboratory_id: error.keyValue.laboratory_id,
        pc_number: error.keyValue.pc_number,
      }).populate("laboratory_id", "name status");

      return res.status(200).json({
        status: 200,
        message: "Client PC already exists",
        data: {
          id: existingComputer.id,
          pc_number: existingComputer.pc_number,
          status: existingComputer.status,
          laboratory: existingComputer.laboratory_id,
          clientToken: existingComputer.clientToken
        },
      });
    }

    return res.status(500).json({
      status: 500,
      message: "Failed to register client token",
      error: error.message,
    });
  }
});

router.post("/client/status", async (req, res) => {
  try {
    const { clientToken } = req.body;
    if (!clientToken || typeof clientToken !== "string") {
      return res.status(400).json({
        status: 400,
        message: "Client token is required in request body",
      });
    }

    const computer = await Computer.findOne({
      clientToken: clientToken.trim(),
      isDeleted: false,
    }).populate("laboratory_id", "name status");

    if (!computer) {
      return res.status(404).json({
        status: 404,
        message: "Client token not found",
      });
    }

    res.status(200).json({
      status: 200,
      message: "Client status retrieved successfully",
      data: {
        id: computer.id,
        pc_number: computer.pc_number,
        status: computer.status,
        laboratory: computer.laboratory_id
      },
    });
  } catch (error) {
    console.error("Get client status error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to retrieve client status",
      error: error.message,
    });
  }
});

export default router;
