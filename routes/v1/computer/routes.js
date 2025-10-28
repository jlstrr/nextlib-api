import { Router } from "express";
import Computer from "../../../models/Computer.js";
import Laboratory from "../../../models/Laboratory.js";
import Reservation from "../../../models/Reservation.js";
import { adminAuthMiddleware, authMiddleware } from "../../../middleware/auth.js";

const router = Router();

// ==========================
// 💻 COMPUTER ROUTES
// ==========================

// Get all computers
router.get("/", authMiddleware, async (req, res) => {
  try {
    const { laboratory_id, status, page = 1, limit = 10 } = req.query;
    
    // Build filter
    const filter = { isDeleted: false };
    if (laboratory_id) filter.laboratory_id = laboratory_id;
    if (status) filter.status = status;

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const computers = await Computer.find(filter)
      .populate('laboratory_id', 'name status')
      .sort({ laboratory_id: 1, pc_number: 1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Computer.countDocuments(filter);

    res.status(200).json({
      status: 200,
      message: "Computers retrieved successfully",
      data: {
        computers,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalItems: total,
          itemsPerPage: parseInt(limit),
        },
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

// Get computers by laboratory ID
router.get("/laboratory/:laboratory_id", authMiddleware, async (req, res) => {
  try {
    const { laboratory_id } = req.params;
    const { status, page = 1, limit = 50 } = req.query;

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

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const computers = await Computer.find(filter)
      .populate('laboratory_id', 'name status')
      .sort({ pc_number: 1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Computer.countDocuments(filter);

    res.status(200).json({
      status: 200,
      message: "Computers retrieved successfully",
      data: {
        laboratory: {
          id: laboratory.id,
          name: laboratory.name,
          status: laboratory.status,
        },
        computers,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalItems: total,
          itemsPerPage: parseInt(limit),
        },
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

// Delete computer (Admin only) - Soft delete
router.delete("/:id", adminAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

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

    // Soft delete
    computer.isDeleted = true;
    await computer.save();

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

    if (!status || !["available", "occupied", "maintenance", "out_of_order"].includes(status)) {
      return res.status(400).json({
        status: 400,
        message: "Valid status is required (available, occupied, maintenance, out_of_order)",
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

    // Validate duration (only 30 minutes and 1 hour allowed)
    if (![30, 60].includes(parseInt(duration))) {
      return res.status(400).json({
        status: 400,
        message: "Duration must be either 30 or 60 minutes",
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

    // Get all reservations for the target date (simplified - no computer-specific reservations)
    const reservations = await Reservation.find({
      isDeleted: false,
      reservation_date: {
        $gte: startOfDay,
        $lte: endOfDay
      }
    });

    // Since the new model doesn't have time slots, we'll show basic availability
    const durationMinutes = parseInt(duration);
    
    // Helper function to convert minutes back to time string
    const minutesToTime = (minutes) => {
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
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

      // With simplified model, we can't check specific time conflicts, so assume available if not past
      const isAvailable = !isPast;

      timeSlots.push({
        start_time: slotStartTime,
        end_time: slotEndTime,
        start_time_formatted: slotStartTime,
        end_time_formatted: slotEndTime,
        is_available: isAvailable,
        is_past: isPast,
        duration_minutes: durationMinutes
      });
    }

    // Get reservation details for the day (simplified)
    const dayReservations = reservations.map(reservation => ({
      id: reservation.id,
      reservation_date: reservation.reservation_date,
      purpose: reservation.purpose,
      duration: reservation.duration,
      notes: reservation.notes,
      reservation_type: reservation.reservation_type
    }));

    res.status(200).json({
      status: 200,
      message: "Computer availability retrieved successfully",
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
        existing_reservations: dayReservations
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

    // Validate duration (only 30 minutes and 1 hour allowed)
    if (![30, 60].includes(parseInt(duration))) {
      return res.status(400).json({
        status: 400,
        message: "Duration must be either 30 or 60 minutes",
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

    // Get all reservations for the target date (simplified)
    const reservations = await Reservation.find({
      isDeleted: false,
      reservation_date: {
        $gte: startOfDay,
        $lte: endOfDay
      }
    });

    // Simplified response - with the new model, we can't do complex time slot checking
    const durationMinutes = parseInt(duration);
    
    // Helper function to convert minutes back to time string
    const minutesToTime = (minutes) => {
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
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

      // Check if slot is in the past
      const now = new Date();
      const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();
      const isPast = targetDate.toDateString() === new Date().toDateString() && currentMinutes < currentTimeMinutes;

      // Simplified availability - assume all computers are available if not past
      const availableComputers = computers.filter(computer => 
        computer.status === 'available' && !isPast
      );

      timeSlots.push({
        start_time: slotStartTime,
        end_time: slotEndTime,
        start_time_formatted: slotStartTime,
        end_time_formatted: slotEndTime,
        available_computers_count: availableComputers.length,
        total_computers: computers.length,
        is_past: isPast,
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
      message: "Laboratory computers availability retrieved successfully",
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
        total_reservations_today: reservations.length,
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

export default router;