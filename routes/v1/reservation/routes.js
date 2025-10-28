import { Router } from "express";
import Reservation from "../../../models/Reservation.js";
import User from "../../../models/User.js";
import Admin from "../../../models/Admin.js";
import { adminAuthMiddleware, authMiddleware } from "../../../middleware/auth.js";

const router = Router();

// ==========================
// � UTILITY FUNCTIONS
// ==========================

// Generate unique reservation number
const generateReservationNumber = async () => {
  const currentDate = new Date();
  const year = currentDate.getFullYear();
  const month = String(currentDate.getMonth() + 1).padStart(2, '0');
  const day = String(currentDate.getDate()).padStart(2, '0');
  
  // Format: RES-YYYYMMDD-XXXX (e.g., RES-20251027-0001)
  const datePrefix = `RES-${year}${month}${day}`;
  
  // Find the last reservation number for today
  const lastReservation = await Reservation.findOne({
    reservation_number: { $regex: `^${datePrefix}` }
  }).sort({ reservation_number: -1 });
  
  let sequenceNumber = 1;
  if (lastReservation) {
    // Extract sequence number from last reservation
    const lastSequence = parseInt(lastReservation.reservation_number.split('-')[2]);
    sequenceNumber = lastSequence + 1;
  }
  
  // Pad sequence number to 4 digits
  const paddedSequence = String(sequenceNumber).padStart(4, '0');
  
  return `${datePrefix}-${paddedSequence}`;
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

    // Build filter
    const filter = { user_id: req.user._id, isDeleted: false };
    if (status) filter.status = status;

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const reservations = await Reservation.find(filter)
      .populate('approved_by', 'firstname lastname username')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Reservation.countDocuments(filter);

    res.status(200).json({
      status: 200,
      message: "Your reservations retrieved successfully",
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
      reservation_date,
      purpose, 
      notes,
      duration
    } = req.body || {}; // Handle empty body

    // Validate required fields
    if (!reservation_date || !reservation_type || !purpose || !duration) {
      return res.status(400).json({
        status: 400,
        message: "Reservation date, reservation type, purpose, and duration are required",
      });
    }

    // Validate reservation type
    if (!["laboratory", "computer"].includes(reservation_type)) {
      return res.status(400).json({
        status: 400,
        message: "Reservation type must be either 'laboratory' or 'computer'",
      });
    }

    // Validate duration
    if (typeof duration !== 'number' || duration < 1 || duration > 480) {
      return res.status(400).json({
        status: 400,
        message: "Duration must be a number between 1 and 480 minutes (8 hours)",
      });
    }

    // Generate unique reservation number
    const reservationNumber = await generateReservationNumber();

    const reservation = new Reservation({
      user_id: req.user._id,
      reservation_number: reservationNumber,
      reservation_type,
      reservation_date: new Date(reservation_date),
      purpose: purpose.trim(),
      notes: notes?.trim() || null,
      duration,
      status: req.userType === "admin" ? "approved" : "pending", // Admins can auto-approve
      approved_by: req.userType === "admin" ? req.user._id : null,
    });

    await reservation.save();

    // Populate fields for response
    await reservation.populate([
      { path: 'user_id', select: 'firstname lastname email id_number' },
      { path: 'approved_by', select: 'firstname lastname username' }
    ]);

    res.status(201).json({
      status: 201,
      message: "Reservation created successfully",
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

export default router;