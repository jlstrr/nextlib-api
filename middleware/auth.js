
const JWT_SECRET = process.env.JWT_SECRET || "supersecret";

import jwt from "jsonwebtoken";
import User from "../models/User.js";

// Helper function to clear session cookie with proper options
const clearSessionCookie = (res) => {
  res.clearCookie('session', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    domain: process.env.NODE_ENV === 'production' ? process.env.COOKIE_DOMAIN : undefined
  });
};

// JWT-based session middleware
export const authMiddleware = async (req, res, next) => {
  try {
    // Check if user has JWT token in cookies
    const token = req.cookies.session;
    if (!token) {
      return res.status(401).json({ message: "Authentication required - no session token" });
    }

    // Verify the JWT token from cookie
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Determine if this is a user or admin token and fetch accordingly
    if (decoded.userType === "admin") {
      const Admin = (await import("../models/Admin.js")).default;
      const admin = await Admin.findById(decoded.userId).select("-password");
      if (!admin || admin.status !== "active") {
        clearSessionCookie(res); // Clear invalid cookie
        return res.status(401).json({ message: "Admin not found or inactive" });
      }
      
      // Add admin info to request
      req.user = admin;
      req.userId = admin._id;
      req.userType = "admin";
      req.isSuperAdmin = admin.isSuperAdmin;
    } else {
      // Handle user token
      const user = await User.findById(decoded.userId).select("-password");
      if (!user || user.isDeleted) {
        clearSessionCookie(res); // Clear invalid cookie
        return res.status(401).json({ message: "User not found or deleted" });
      }

      // Check if user account is active
      if (user.status !== "active") {
        clearSessionCookie(res); // Clear invalid cookie
        return res.status(403).json({ message: "User account is not active" });
      }

      // Add user info to request
      req.user = user;
      req.userId = user._id;
      req.userType = user.user_type;
    }

    next();
  } catch (error) {
    // Token is invalid or expired
    clearSessionCookie(res); // Clear invalid cookie
    res.status(401).json({ message: "Invalid or expired token" });
  }
};

// Role-based middleware
export const requireRole = (roles) => {
  return async (req, res, next) => {
    // First run auth middleware
    await authMiddleware(req, res, (err) => {
      if (err) return next(err);
      
      // Check role permissions
      if (!roles.includes(req.userType)) {
        return res.status(403).json({ message: "Insufficient permissions" });
      }
      
      next();
    });
  };
};

// Check if user is authenticated (doesn't require auth)
export const checkAuth = (req, res, next) => {
  if (req.session.token) {
    try {
      const decoded = jwt.verify(req.session.token, process.env.JWT_SECRET);
      req.isAuthenticated = true;
      req.userId = decoded.userId;
      req.userType = decoded.userType;
    } catch (error) {
      req.isAuthenticated = false;
      req.session.destroy();
    }
  } else {
    req.isAuthenticated = false;
  }
  next();
};

// Admin-specific middleware
export const adminAuthMiddleware = async (req, res, next) => {
  try {
    const Admin = (await import("../models/Admin.js")).default;
    
    // Check if admin has JWT token in cookies
    const token = req.cookies.session;
    if (!token) {
      return res.status(401).json({ message: "Admin authentication required - no session token" });
    }

    // Verify the JWT token from cookie
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Explicitly check if this is an admin token
    if (decoded.userType !== "admin") {
      clearSessionCookie(res); // Clear invalid cookie
      return res.status(403).json({ message: "Admin access required - user tokens not allowed" });
    }
    
    // Find the admin
    const admin = await Admin.findById(decoded.userId).select("-password");
    if (!admin || admin.status !== "active") {
      clearSessionCookie(res); // Clear invalid cookie
      return res.status(401).json({ message: "Admin not found or inactive" });
    }

    // Add admin info to request
    req.user = admin;
    req.userId = admin._id;
    req.userType = "admin";
    req.isSuperAdmin = admin.isSuperAdmin;

    next();
  } catch (error) {
    // Token is invalid or expired
    clearSessionCookie(res); // Clear invalid cookie
    res.status(401).json({ message: "Invalid or expired admin token" });
  }
};

// Super admin middleware
export const requireSuperAdmin = async (req, res, next) => {
  // First run admin auth middleware
  await adminAuthMiddleware(req, res, (err) => {
    if (err) return next(err);
    
    // Check super admin permissions
    if (!req.isSuperAdmin) {
      return res.status(403).json({ message: "Super admin access required" });
    }
    
    next();
  });
};

// Export helper function for use in routes
export { clearSessionCookie };
