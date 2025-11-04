import { Router } from "express";
import { nanoid } from "nanoid";
import Reservation from "../../../models/Reservation.js";
import User from "../../../models/User.js";
import Admin from "../../../models/Admin.js";
import Computer from "../../../models/Computer.js";
import Laboratory from "../../../models/Laboratory.js";
import { adminAuthMiddleware, authMiddleware } from "../../../middleware/auth.js";

const router = Router();

// ==========================
// � UTILITY FUNCTIONS
// ==========================

// Helper function to validate military time format
const isValidMilitaryTime = (timeString) => {
  if (typeof timeString !== 'string') return false;
  return /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(timeString);
};

// Helper function to convert military time to minutes since midnight
const timeToMinutes = (timeString) => {
  const [hours, minutes] = timeString.split(':').map(Number);
  return hours * 60 + minutes;
};

// Helper function to convert minutes since midnight to military time
const minutesToTime = (minutes) => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
};

// Helper function to combine date and military time into a full DateTime
const combineDateAndTime = (date, timeString) => {
  const [hours, minutes] = timeString.split(':').map(Number);
  const combinedDate = new Date(date);
  combinedDate.setHours(hours, minutes, 0, 0);
  return combinedDate;
};

// Generate unique reservation number
const generateReservationNumber = async () => {
  let reservationNumber;
  let isUnique = false;
  
  // Keep generating until we get a unique number
  while (!isUnique) {
    reservationNumber = `RSV-${nanoid(8).toUpperCase()}`;
    
    // Check if this reservation number already exists
    const existingReservation = await Reservation.findOne({
      reservation_number: reservationNumber,
      isDeleted: false
    });
    
    if (!existingReservation) {
      isUnique = true;
    }
  }
  
  return reservationNumber;
};

// Check for reservation conflicts
const checkReservationConflicts = async (reservationDate, startTime, duration, reservationType, excludeReservationId = null) => {
  const requestedDate = new Date(reservationDate);
  
  // Calculate requested time range in minutes
  let requestedStartMinutes, requestedEndMinutes;
  
  if (typeof startTime === 'string' && startTime.includes(':')) {
    // Military time format
    requestedStartMinutes = timeToMinutes(startTime);
    requestedEndMinutes = requestedStartMinutes + duration;
  } else {
    // Legacy DateTime format
    const requestedStartTime = new Date(startTime);
    const requestedEndTime = new Date(requestedStartTime.getTime() + (duration * 60 * 1000));
    
    // Convert to minutes since midnight for comparison
    requestedStartMinutes = requestedStartTime.getHours() * 60 + requestedStartTime.getMinutes();
    requestedEndMinutes = requestedEndTime.getHours() * 60 + requestedEndTime.getMinutes();
  }
  
  // Build query to find conflicting reservations on the same date
  const conflictQuery = {
    reservation_type: reservationType,
    status: { $in: ['approved', 'active'] },
    isDeleted: false,
    // Same date check
    $expr: {
      $and: [
        { $eq: [{ $year: '$reservation_date' }, { $year: requestedDate }] },
        { $eq: [{ $month: '$reservation_date' }, { $month: requestedDate }] },
        { $eq: [{ $dayOfMonth: '$reservation_date' }, { $dayOfMonth: requestedDate }] }
      ]
    }
  };
  
  // Exclude current reservation if updating
  if (excludeReservationId) {
    conflictQuery._id = { $ne: excludeReservationId };
  }
  
  const existingReservations = await Reservation.find(conflictQuery)
    .populate('user_id', 'firstname lastname email id_number')
    .sort({ start_time: 1, reservation_date: 1 });
  
  // Check for time conflicts
  const conflictingReservations = existingReservations.filter(existing => {
    let existingStartMinutes, existingEndMinutes;
    
    if (existing.start_time && typeof existing.start_time === 'string') {
      // New format with military time
      existingStartMinutes = timeToMinutes(existing.start_time);
      existingEndMinutes = timeToMinutes(existing.end_time);
    } else if (existing.reservation_date && existing.duration) {
      // Legacy format
      const existingStart = new Date(existing.reservation_date);
      existingStartMinutes = existingStart.getHours() * 60 + existingStart.getMinutes();
      existingEndMinutes = existingStartMinutes + existing.duration;
    } else {
      return false; // Skip if we can't determine the time
    }
    
    // Check for overlap: (start1 < end2) && (start2 < end1)
    return (requestedStartMinutes < existingEndMinutes) && (existingStartMinutes < requestedEndMinutes);
  });
  
  return conflictingReservations;
};

// ==========================
// �📅 RESERVATION ROUTES
// ==========================

// Get all reservations (Admin only)
router.get("/", adminAuthMiddleware, async (req, res) => {
  try {
    const { 
      status,
      reservation_type, 
      user_id,
      reservation_number,
      date_from,
      date_to,
      page = 1, 
      limit = 10 
    } = req.query;
    
    // Build filter
    const filter = { isDeleted: false };
    if (status) filter.status = status;
    if (reservation_type) filter.reservation_type = reservation_type;
    if (user_id) filter.user_id = user_id;
    if (reservation_number) {
      filter.reservation_number = { $regex: reservation_number, $options: 'i' }; // Case-insensitive partial match
    }
    
    // Date range filter
    if (date_from || date_to) {
      filter.reservation_date = {};
      if (date_from) {
        const fromDate = new Date(date_from);
        fromDate.setHours(0, 0, 0, 0);
        filter.reservation_date.$gte = fromDate;
      }
      if (date_to) {
        const toDate = new Date(date_to);
        toDate.setHours(23, 59, 59, 999);
        filter.reservation_date.$lte = toDate;
      }
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const reservations = await Reservation.find(filter)
      .populate('user_id', 'firstname lastname email id_number')
      .populate('approved_by', 'firstname lastname username')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Reservation.countDocuments(filter);

    res.status(200).json({
      status: 200,
      message: "Reservations retrieved successfully",
      data: {
        reservations,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalItems: total,
          itemsPerPage: parseInt(limit),
        },
      },
    });
  } catch (error) {
    console.error("Get reservations error:", error);
    res.status(500).json({ 
      status: 500, 
      message: "Failed to retrieve reservations", 
      error: error.message 
    });
  }
});

// Get user's own reservations
router.get("/my-reservations", authMiddleware, async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    
    // Ensure this is a user, not admin
    if (req.userType === "admin") {
      return res.status(403).json({ 
        status: 403, 
        message: "Admin users should use the admin reservations endpoint" 
      });
    }

    // Build filter based on user type
    const filter = { user_id: req.user._id, isDeleted: false };
    if (status) filter.status = status;

    // Add reservation type filter based on user type
    if (req.user.user_type === "student") {
      filter.reservation_type = "computer";
    } else if (req.user.user_type === "faculty") {
      filter.reservation_type = "laboratory";
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Build populate array based on user type
    const populateFields = [
      { path: 'approved_by', select: 'firstname lastname username' }
    ];

    if (req.user.user_type === "student") {
      // For students, populate computer data with laboratory info
      populateFields.push({
        path: 'computer_id',
        select: 'pc_number status',
        populate: {
          path: 'laboratory_id',
          select: 'name status'
        }
      });
    } else if (req.user.user_type === "faculty") {
      // For faculty, populate laboratory data
      populateFields.push({
        path: 'laboratory_id',
        select: 'name status description'
      });
    } else {
      // For other user types (if any), populate both
      populateFields.push(
        {
          path: 'computer_id',
          select: 'pc_number status',
          populate: {
            path: 'laboratory_id',
            select: 'name status'
          }
        },
        {
          path: 'laboratory_id',
          select: 'name status description'
        }
      );
    }
    
    const reservations = await Reservation.find(filter)
      .populate(populateFields)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Reservation.countDocuments(filter);

    // Customize message based on user type
    let message = "Your reservations retrieved successfully";
    if (req.user.user_type === "student") {
      message = "Your computer reservations retrieved successfully";
    } else if (req.user.user_type === "faculty") {
      message = "Your laboratory reservations retrieved successfully";
    }

    res.status(200).json({
      status: 200,
      message: message,
      data: {
        reservations,
        user_type: req.user.user_type,
        reservation_type_filter: req.user.user_type === "student" ? "computer" : 
                                req.user.user_type === "faculty" ? "laboratory" : "all",
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalItems: total,
          itemsPerPage: parseInt(limit),
        },
      },
    });
  } catch (error) {
    console.error("Get user reservations error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to retrieve your reservations",
      error: error.message,
    });
  }
});

// Get reservation by ID
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const reservation = await Reservation.findOne({ 
      _id: id, 
      isDeleted: false 
    })
      .populate('user_id', 'firstname lastname email id_number')
      .populate('approved_by', 'firstname lastname username')
      .populate({
        path: 'computer_id',
        select: 'pc_number status',
        populate: {
          path: 'laboratory_id',
          select: 'name status'
        }
      })
      .populate('laboratory_id', 'name status description');

    if (!reservation) {
      return res.status(404).json({
        status: 404,
        message: "Reservation not found",
      });
    }

    // Check if user can access this reservation
    if (req.userType === "user" && reservation.user_id._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        status: 403,
        message: "You can only access your own reservations",
      });
    }

    res.status(200).json({
      status: 200,
      message: "Reservation retrieved successfully",
      data: reservation,
    });
  } catch (error) {
    console.error("Get reservation error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to retrieve reservation",
      error: error.message,
    });
  }
});

// Get reservation by reservation number
router.get("/number/:reservationNumber", authMiddleware, async (req, res) => {
  try {
    const { reservationNumber } = req.params;

    const reservation = await Reservation.findOne({ 
      reservation_number: reservationNumber, 
      isDeleted: false 
    })
      .populate('user_id', 'firstname lastname email id_number')
      .populate('approved_by', 'firstname lastname username');

    if (!reservation) {
      return res.status(404).json({
        status: 404,
        message: "Reservation not found",
      });
    }

    // Check if user can access this reservation
    if (req.userType === "user" && reservation.user_id._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        status: 403,
        message: "You can only access your own reservations",
      });
    }

    res.status(200).json({
      status: 200,
      message: "Reservation retrieved successfully",
      data: reservation,
    });
  } catch (error) {
    console.error("Get reservation by number error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to retrieve reservation",
      error: error.message,
    });
  }
});

// Create new reservation
router.post("/", authMiddleware, async (req, res) => {
  try {
    const { 
      reservation_type, 
      computer_id,
      laboratory_id,
      reservation_date,
      start_time,
      end_time,
      purpose, 
      notes,
      duration
    } = req.body || {}; // Handle empty body

    // Validate required fields
    if (!reservation_type || !purpose || !reservation_date) {
      return res.status(400).json({
        status: 400,
        message: "Reservation type, purpose, and reservation date are required",
      });
    }

    // Validate reservation type and corresponding required fields
    if (reservation_type === "computer" && !computer_id) {
      return res.status(400).json({
        status: 400,
        message: "Computer ID is required for computer reservations",
      });
    }

    if (reservation_type === "laboratory" && !laboratory_id) {
      return res.status(400).json({
        status: 400,
        message: "Laboratory ID is required for laboratory reservations",
      });
    }

    // Validate that we have either start/end times or duration
    const hasStartEndTime = start_time && end_time;
    const hasDuration = duration;

    if (!hasStartEndTime && !hasDuration) {
      return res.status(400).json({
        status: 400,
        message: "Either (start_time and end_time) or duration must be provided",
      });
    }

    // Validate military time format if provided
    if (hasStartEndTime) {
      if (!isValidMilitaryTime(start_time)) {
        return res.status(400).json({
          status: 400,
          message: "Start time must be in military time format (HH:MM, e.g., 14:30)",
        });
      }
      if (!isValidMilitaryTime(end_time)) {
        return res.status(400).json({
          status: 400,
          message: "End time must be in military time format (HH:MM, e.g., 16:45)",
        });
      }
    }

    // Calculate missing fields based on what's provided
    let calculatedStartTime, calculatedEndTime, calculatedDuration, calculatedDate;

    calculatedDate = new Date(reservation_date);

    if (hasStartEndTime) {
      // Using military time format
      calculatedStartTime = start_time;
      calculatedEndTime = end_time;
      
      // Calculate duration from military times
      const startMinutes = timeToMinutes(start_time);
      const endMinutes = timeToMinutes(end_time);
      
      if (endMinutes <= startMinutes) {
        return res.status(400).json({
          status: 400,
          message: "End time must be after start time on the same day",
        });
      }
      
      calculatedDuration = endMinutes - startMinutes;
    } else {
      // Using duration - need to calculate military times
      const parsedDuration = typeof duration === 'string' ? parseInt(duration) : duration;
      
      if (!parsedDuration || typeof parsedDuration !== 'number' || parsedDuration < 1 || parsedDuration > 480) {
        return res.status(400).json({
          status: 400,
          message: "Duration must be a number between 1 and 480 minutes (8 hours)",
        });
      }
      
      // For legacy support, assume start time from reservation_date
      const reservationDateTime = new Date(reservation_date);
      const hours = reservationDateTime.getHours();
      const minutes = reservationDateTime.getMinutes();
      
      calculatedStartTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
      
      const endMinutes = timeToMinutes(calculatedStartTime) + parsedDuration;
      calculatedEndTime = minutesToTime(endMinutes);
      calculatedDuration = parsedDuration;
    }

    // Validate reservation type
    if (!["laboratory", "computer"].includes(reservation_type)) {
      return res.status(400).json({
        status: 400,
        message: "Reservation type must be either 'laboratory' or 'computer'",
      });
    }

    // Validate computer/laboratory existence
    let selectedComputer = null;
    let selectedLaboratory = null;

    if (reservation_type === "computer") {
      selectedComputer = await Computer.findOne({ 
        _id: computer_id, 
        isDeleted: false 
      }).populate('laboratory_id', 'name status');

      if (!selectedComputer) {
        return res.status(404).json({
          status: 404,
          message: "Computer not found or has been deleted",
        });
      }

      if (selectedComputer.status === "out_of_order" || selectedComputer.status === "maintenance") {
        return res.status(400).json({
          status: 400,
          message: `Computer is currently ${selectedComputer.status} and cannot be reserved`,
        });
      }
    }

    if (reservation_type === "laboratory") {
      selectedLaboratory = await Laboratory.findOne({ 
        _id: laboratory_id, 
        isDeleted: false 
      });

      if (!selectedLaboratory) {
        return res.status(404).json({
          status: 404,
          message: "Laboratory not found or has been deleted",
        });
      }

      if (selectedLaboratory.status === "inactive" || selectedLaboratory.status === "maintenance") {
        return res.status(400).json({
          status: 400,
          message: `Laboratory is currently ${selectedLaboratory.status} and cannot be reserved`,
        });
      }
    }

    // Check for conflicts for laboratory reservations when user is faculty
    let conflictingReservations = [];
    if (reservation_type === "laboratory" && req.user.user_type === "faculty") {
      conflictingReservations = await checkReservationConflicts(
        calculatedDate,
        calculatedStartTime, 
        calculatedDuration, 
        reservation_type
      );
      
      if (conflictingReservations.length > 0) {
        return res.status(409).json({
          status: 409,
          message: "Reservation conflict detected",
          conflicts: conflictingReservations.map(conflict => ({
            reservation_number: conflict.reservation_number,
            user: `${conflict.user_id.firstname} ${conflict.user_id.lastname}`,
            reservation_date: conflict.reservation_date,
            duration: conflict.duration,
            status: conflict.status
          }))
        });
      }
    }

    // Generate unique reservation number
    const reservationNumber = await generateReservationNumber();

    // Determine reservation status based on user type and reservation type
    let reservationStatus = "pending";
    let approvedBy = null;

    if (req.userType === "admin") {
      // Admins can auto-approve any reservation
      reservationStatus = "approved";
      approvedBy = req.user._id;
    } else if (req.user.user_type === "faculty" && reservation_type === "laboratory") {
      // Faculty can auto-approve laboratory reservations (after conflict check)
      // Note: approved_by is left null since faculty are not admins in the system
      reservationStatus = "approved";
    }

    const reservation = new Reservation({
      user_id: req.user._id,
      reservation_number: reservationNumber,
      reservation_type,
      computer_id: reservation_type === "computer" ? computer_id : null,
      laboratory_id: reservation_type === "laboratory" ? laboratory_id : null,
      reservation_date: calculatedDate,
      start_time: calculatedStartTime,
      end_time: calculatedEndTime,
      purpose: purpose.trim(),
      notes: req.user.user_type === "faculty" && reservation_type === "laboratory" && reservationStatus === "approved"
        ? `${notes?.trim() || ''} [Auto-approved: Faculty laboratory reservation]`.trim()
        : notes?.trim() || null,
      duration: calculatedDuration,
      status: reservationStatus,
      approved_by: approvedBy,
    });

    await reservation.save();

    // Populate fields for response
    await reservation.populate([
      { path: 'user_id', select: 'firstname lastname email id_number' },
      { path: 'approved_by', select: 'firstname lastname username' },
      { path: 'computer_id', select: 'pc_number status', populate: { path: 'laboratory_id', select: 'name' } },
      { path: 'laboratory_id', select: 'name status' }
    ]);

    res.status(201).json({
      status: 201,
      message: reservationStatus === "approved" 
        ? "Reservation created and approved successfully" 
        : "Reservation created successfully",
      data: reservation,
    });
  } catch (error) {
    console.error("Create reservation error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to create reservation",
      error: error.message,
    });
  }
});

// Update reservation status (Admin only)
router.patch("/:id/status", adminAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body || {}; // Handle empty body

    if (!status || !["pending", "approved", "rejected", "active", "completed", "cancelled"].includes(status)) {
      return res.status(400).json({
        status: 400,
        message: "Valid status is required (pending, approved, rejected, active, completed, cancelled)",
      });
    }

    const reservation = await Reservation.findOne({ 
      _id: id, 
      isDeleted: false 
    });

    if (!reservation) {
      return res.status(404).json({
        status: 404,
        message: "Reservation not found",
      });
    }

    reservation.status = status;
    if (notes !== undefined) reservation.notes = notes?.trim() || null;
    
    // Set approved_by when approving
    if (status === "approved") {
      reservation.approved_by = req.user._id;
      
      // Update user data
      const user = await User.findById(reservation.user_id);
      if (user) {
        if (!user.approved_reservations_count) {
          user.approved_reservations_count = 0;
        }
        user.approved_reservations_count += 1;
        await user.save();
      }
    }
    
    // Handle activation - user starts using the reservation
    if (status === "active") {
      reservation.started_at = new Date();
    }
    
    // Handle rejection
    if (status === "rejected") {
      reservation.approved_by = req.user._id;
      
      // Update user data
      const user = await User.findById(reservation.user_id);
      if (user) {
        if (!user.rejected_reservations_count) {
          user.rejected_reservations_count = 0;
        }
        user.rejected_reservations_count += 1;
        await user.save();
      }
    }
    
    // Handle completion
    if (status === "completed") {
      reservation.completed_at = new Date();
    }

    await reservation.save();

    // Populate fields for response
    await reservation.populate([
      { path: 'user_id', select: 'firstname lastname email id_number' },
      { path: 'approved_by', select: 'firstname lastname username' }
    ]);

    res.status(200).json({
      status: 200,
      message: "Reservation status updated successfully",
      data: reservation,
    });
  } catch (error) {
    console.error("Update reservation status error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to update reservation status",
      error: error.message,
    });
  }
});

// Update reservation (Allow updating purpose, notes, duration, and reservation_date)
router.patch("/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { purpose, notes, duration, reservation_date } = req.body || {};

    const reservation = await Reservation.findOne({ 
      _id: id, 
      isDeleted: false 
    });

    if (!reservation) {
      return res.status(404).json({
        status: 404,
        message: "Reservation not found",
      });
    }

    // Update fields if provided
    if (purpose !== undefined) reservation.purpose = purpose.trim();
    if (notes !== undefined) reservation.notes = notes?.trim() || null;
    if (duration !== undefined) {
      if (typeof duration !== 'number' || duration < 1 || duration > 480) {
        return res.status(400).json({
          status: 400,
          message: "Duration must be a number between 1 and 480 minutes (8 hours)",
        });
      }
      reservation.duration = duration;
    }
    if (reservation_date !== undefined) {
      reservation.reservation_date = new Date(reservation_date);
    }

    await reservation.save();

    res.status(200).json({
      status: 200,
      message: "Reservation updated successfully",
      data: reservation,
    });
  } catch (error) {
    console.error("Update reservation error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to update reservation",
      error: error.message,
    });
  }
});

// Approve reservation (Admin only)
router.patch("/:id/approve", adminAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body || {}; // Handle empty body

    const reservation = await Reservation.findOne({ 
      _id: id, 
      isDeleted: false 
    });

    if (!reservation) {
      return res.status(404).json({
        status: 404,
        message: "Reservation not found",
      });
    }

    // Check if reservation can be approved
    if (reservation.status !== "pending") {
      return res.status(400).json({
        status: 400,
        message: "Only pending reservations can be approved",
      });
    }

    // Update reservation status
    reservation.status = "approved";
    reservation.approved_by = req.user._id;
    if (notes) reservation.notes = notes.trim();

    await reservation.save();

    // Get user and update their data
    const user = await User.findById(reservation.user_id);
    if (user) {
      // Example: If you want to track approved reservations count
      if (!user.approved_reservations_count) {
        user.approved_reservations_count = 0;
      }
      user.approved_reservations_count += 1;
      
      await user.save();
    }

    // Populate fields for response
    await reservation.populate([
      { path: 'user_id', select: 'firstname lastname email id_number' },
      { path: 'approved_by', select: 'firstname lastname username' }
    ]);

    res.status(200).json({
      status: 200,
      message: "Reservation approved successfully",
      data: reservation,
    });
  } catch (error) {
    console.error("Approve reservation error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to approve reservation",
      error: error.message,
    });
  }
});

// Reject reservation (Admin only)
router.patch("/:id/reject", adminAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { notes, reason } = req.body || {}; // Handle empty body

    const reservation = await Reservation.findOne({ 
      _id: id, 
      isDeleted: false 
    });

    if (!reservation) {
      return res.status(404).json({
        status: 404,
        message: "Reservation not found",
      });
    }

    // Check if reservation can be rejected
    if (reservation.status !== "pending") {
      return res.status(400).json({
        status: 400,
        message: "Only pending reservations can be rejected",
      });
    }

    // Update reservation status
    reservation.status = "rejected";
    reservation.approved_by = req.user._id;
    
    // Combine rejection reason and notes
    let rejectionNotes = "";
    if (reason) rejectionNotes += `Reason: ${reason.trim()}`;
    if (notes) rejectionNotes += rejectionNotes ? `. Notes: ${notes.trim()}` : notes.trim();
    
    reservation.notes = rejectionNotes || null;

    await reservation.save();

    // Get user and update their data
    const user = await User.findById(reservation.user_id);
    if (user) {
      // Example: If you want to track rejected reservations count
      if (!user.rejected_reservations_count) {
        user.rejected_reservations_count = 0;
      }
      user.rejected_reservations_count += 1;
      
      await user.save();
    }

    // Populate fields for response
    await reservation.populate([
      { path: 'user_id', select: 'firstname lastname email id_number' },
      { path: 'approved_by', select: 'firstname lastname username' }
    ]);

    res.status(200).json({
      status: 200,
      message: "Reservation rejected successfully",
      data: reservation,
    });
  } catch (error) {
    console.error("Reject reservation error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to reject reservation",
      error: error.message,
    });
  }
});

// Start using reservation - Mark as active (Admin only)
router.patch("/:id/start", adminAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const reservation = await Reservation.findOne({ 
      _id: id, 
      isDeleted: false 
    });

    if (!reservation) {
      return res.status(404).json({
        status: 404,
        message: "Reservation not found",
      });
    }

    // Check if reservation can be started
    if (reservation.status !== "approved") {
      return res.status(400).json({
        status: 400,
        message: "Only approved reservations can be started",
      });
    }

    // Update reservation status to active and record start time
    reservation.status = "active";
    reservation.started_at = new Date();
    await reservation.save();

    // Populate fields for response
    await reservation.populate([
      { path: 'user_id', select: 'firstname lastname email id_number' },
      { path: 'approved_by', select: 'firstname lastname username' }
    ]);

    res.status(200).json({
      status: 200,
      message: "Reservation started successfully",
      data: reservation,
    });
  } catch (error) {
    console.error("Start reservation error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to start reservation",
      error: error.message,
    });
  }
});

// Complete reservation - Mark as completed (Admin only)
router.patch("/:id/complete", adminAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body || {}; // Handle empty body

    const reservation = await Reservation.findOne({ 
      _id: id, 
      isDeleted: false 
    });

    if (!reservation) {
      return res.status(404).json({
        status: 404,
        message: "Reservation not found",
      });
    }

    // Check if reservation can be completed
    if (!["approved", "active"].includes(reservation.status)) {
      return res.status(400).json({
        status: 400,
        message: "Only approved or active reservations can be completed",
      });
    }

    // Update reservation status to completed and set completion time
    reservation.status = "completed";
    reservation.completed_at = new Date();
    if (notes) reservation.notes = notes.trim();
    await reservation.save();

    // Populate fields for response
    await reservation.populate([
      { path: 'user_id', select: 'firstname lastname email id_number' },
      { path: 'approved_by', select: 'firstname lastname username' }
    ]);

    res.status(200).json({
      status: 200,
      message: "Reservation completed successfully",
      data: reservation,
    });
  } catch (error) {
    console.error("Complete reservation error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to complete reservation",
      error: error.message,
    });
  }
});

// Cancel reservation (User can cancel their own, Admin can cancel any)
router.patch("/:id/cancel", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body || {}; // Handle empty body

    const reservation = await Reservation.findOne({ 
      _id: id, 
      isDeleted: false 
    });

    if (!reservation) {
      return res.status(404).json({
        status: 404,
        message: "Reservation not found",
      });
    }

    // Check if user can cancel this reservation
    if (req.userType === "user" && reservation.user_id.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        status: 403,
        message: "You can only cancel your own reservations",
      });
    }

    // Check if reservation can be cancelled
    if (["completed", "cancelled"].includes(reservation.status)) {
      return res.status(400).json({
        status: 400,
        message: "Cannot cancel a completed or already cancelled reservation",
      });
    }

    reservation.status = "cancelled";
    if (notes) reservation.notes = notes.trim();

    await reservation.save();

    // Populate fields for response
    await reservation.populate([
      { path: 'user_id', select: 'firstname lastname email id_number' },
      { path: 'approved_by', select: 'firstname lastname username' }
    ]);

    res.status(200).json({
      status: 200,
      message: "Reservation cancelled successfully",
      data: reservation,
    });
  } catch (error) {
    console.error("Cancel reservation error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to cancel reservation",
      error: error.message,
    });
  }
});

// Delete reservation (soft delete)
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const reservation = await Reservation.findOne({ 
      _id: id, 
      isDeleted: false 
    });

    if (!reservation) {
      return res.status(404).json({
        status: 404,
        message: "Reservation not found",
      });
    }

    reservation.isDeleted = true;
    await reservation.save();

    res.status(200).json({
      status: 200,
      message: "Reservation deleted successfully",
    });
  } catch (error) {
    console.error("Delete reservation error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to delete reservation",
      error: error.message,
    });
  }
});

// Get reservations statistics (Admin only)
router.get("/statistics/overview", adminAuthMiddleware, async (req, res) => {
  try {
    const { date_from, date_to } = req.query;

    // Build match filter
    const matchFilter = { isDeleted: false };
    
    // Date range filter
    if (date_from || date_to) {
      matchFilter.reservation_date = {};
      if (date_from) {
        const fromDate = new Date(date_from);
        fromDate.setHours(0, 0, 0, 0);
        matchFilter.reservation_date.$gte = fromDate;
      }
      if (date_to) {
        const toDate = new Date(date_to);
        toDate.setHours(23, 59, 59, 999);
        matchFilter.reservation_date.$lte = toDate;
      }
    }

    const statusStatistics = await Reservation.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 }
        }
      }
    ]);

    const typeStatistics = await Reservation.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: "$reservation_type",
          count: { $sum: 1 }
        }
      }
    ]);

    const total = await Reservation.countDocuments(matchFilter);

    // Format statistics
    const formattedStats = {
      total,
      by_status: {
        pending: 0,
        approved: 0,
        rejected: 0,
        active: 0,
        completed: 0,
        cancelled: 0,
      },
      by_type: {
        laboratory: 0,
        computer: 0,
      }
    };

    statusStatistics.forEach(stat => {
      formattedStats.by_status[stat._id] = stat.count;
    });

    typeStatistics.forEach(stat => {
      formattedStats.by_type[stat._id] = stat.count;
    });

    res.status(200).json({
      status: 200,
      message: "Reservation statistics retrieved successfully",
      data: formattedStats,
    });
  } catch (error) {
    console.error("Get reservation statistics error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to retrieve reservation statistics",
      error: error.message,
    });
  }
});

// Check for reservation conflicts (useful for frontend validation)
router.post("/check-conflicts", authMiddleware, async (req, res) => {
  try {
    const { 
      reservation_type, 
      reservation_date,
      start_time,
      end_time,
      duration,
      exclude_reservation_id
    } = req.body || {};

    // Validate required fields
    if (!reservation_type || !reservation_date) {
      return res.status(400).json({
        status: 400,
        message: "Reservation type and reservation date are required",
      });
    }

    // Validate that we have either start/end times or duration
    const hasStartEndTime = start_time && end_time;
    const hasDuration = duration;

    if (!hasStartEndTime && !hasDuration) {
      return res.status(400).json({
        status: 400,
        message: "Either (start_time and end_time) or duration must be provided",
      });
    }

    // Validate military time format if provided
    if (hasStartEndTime) {
      if (!isValidMilitaryTime(start_time)) {
        return res.status(400).json({
          status: 400,
          message: "Start time must be in military time format (HH:MM, e.g., 14:30)",
        });
      }
      if (!isValidMilitaryTime(end_time)) {
        return res.status(400).json({
          status: 400,
          message: "End time must be in military time format (HH:MM, e.g., 16:45)",
        });
      }
    }

    // Calculate missing fields based on what's provided
    let calculatedStartTime, calculatedDuration;

    if (hasStartEndTime) {
      // Using military time format
      calculatedStartTime = start_time;
      
      // Calculate duration from military times
      const startMinutes = timeToMinutes(start_time);
      const endMinutes = timeToMinutes(end_time);
      
      if (endMinutes <= startMinutes) {
        return res.status(400).json({
          status: 400,
          message: "End time must be after start time on the same day",
        });
      }
      
      calculatedDuration = endMinutes - startMinutes;
    } else {
      // Using duration - need to calculate military times
      const parsedDuration = typeof duration === 'string' ? parseInt(duration) : duration;
      
      if (!parsedDuration || typeof parsedDuration !== 'number' || parsedDuration < 1 || parsedDuration > 480) {
        return res.status(400).json({
          status: 400,
          message: "Duration must be a number between 1 and 480 minutes (8 hours)",
        });
      }
      
      // For legacy support, assume start time from reservation_date
      const reservationDateTime = new Date(reservation_date);
      const hours = reservationDateTime.getHours();
      const minutes = reservationDateTime.getMinutes();
      
      calculatedStartTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
      calculatedDuration = parsedDuration;
    }

    // Validate reservation type
    if (!["laboratory", "computer"].includes(reservation_type)) {
      return res.status(400).json({
        status: 400,
        message: "Reservation type must be either 'laboratory' or 'computer'",
      });
    }

    // Validate duration
    if (calculatedDuration < 1 || calculatedDuration > 480) {
      return res.status(400).json({
        status: 400,
        message: "Duration must be between 1 and 480 minutes (8 hours)",
      });
    }

    // Check for conflicts
    const conflictingReservations = await checkReservationConflicts(
      new Date(reservation_date),
      calculatedStartTime, 
      calculatedDuration, 
      reservation_type,
      exclude_reservation_id
    );

    const hasConflicts = conflictingReservations.length > 0;

    res.status(200).json({
      status: 200,
      message: hasConflicts ? "Conflicts detected" : "No conflicts found",
      has_conflicts: hasConflicts,
      conflicts: hasConflicts ? conflictingReservations.map(conflict => ({
        reservation_number: conflict.reservation_number,
        user: `${conflict.user_id.firstname} ${conflict.user_id.lastname}`,
        user_id: conflict.user_id._id,
        reservation_date: conflict.reservation_date,
        start_time: conflict.start_time || (conflict.reservation_date ? 
          `${conflict.reservation_date.getHours().toString().padStart(2, '0')}:${conflict.reservation_date.getMinutes().toString().padStart(2, '0')}` : null),
        end_time: conflict.end_time || (conflict.duration ? 
          minutesToTime(timeToMinutes(conflict.start_time || '00:00') + conflict.duration) : null),
        duration: conflict.duration,
        status: conflict.status
      })) : []
    });
  } catch (error) {
    console.error("Check conflicts error:", error);
    res.status(500).json({
      status: 500,
      message: "Failed to check for conflicts",
      error: error.message,
    });
  }
});

export default router;