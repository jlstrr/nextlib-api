import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const adminSchema = new mongoose.Schema(
  {
    profile_picture: {
      type: String, // URL or file path
      default: null,
    },
    firstname: {
      type: String,
      required: true,
      trim: true,
    },
    middle_initial: {
      type: String,
      trim: true,
      maxlength: 1,
    },
    lastname: {
      type: String,
      required: true,
      trim: true,
    },
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
    },
    isSuperAdmin: {
      type: Boolean,
      default: false, // can promote/demote admins
    },
    status: {
      type: String,
      enum: ["active", "inactive", "suspended"],
      default: "active",
    },
    resetPasswordOtpHash: { type: String, default: null },
    resetPasswordOtpExpires: { type: Date, default: null },
    resetPasswordOtpRequestedAt: { type: Date, default: null },
    resetPasswordOtpRequestCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// 🔐 Hash password before saving
adminSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// 🔑 Compare password for login
adminSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// 🎫 Generate JWT token
adminSchema.methods.generateToken = function () {
  return jwt.sign(
    {
      userId: this._id,
      username: this.username,
      userType: "admin",
      isSuperAdmin: this.isSuperAdmin,
    },
    process.env.JWT_SECRET,
    { expiresIn: "24h" }
  );
};

const Admin = mongoose.model("Admin", adminSchema);
export default Admin;
