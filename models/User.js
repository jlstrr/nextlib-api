import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const userSchema = new mongoose.Schema(
  {
    id_number: { type: String, required: true, unique: true },

    firstname: { type: String, required: true },
    middle_initial: { type: String },
    lastname: { type: String, required: true },

    program_course: { type: String }, // e.g., BSCS, BSIT, etc.

    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },

    user_type: {
      type: String,
      enum: ["student", "faculty"],
      default: "student",
    },

    status: {
      type: String,
      enum: ["active", "inactive", "suspended"],
      default: "active",
    },

    remaining_time: { type: String, default: null }, // in minutes or hours
    
    // Reservation tracking fields
    // approved_reservations_count: { type: Number, default: 0 },
    // rejected_reservations_count: { type: Number, default: 0 },
    
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// 🔐 Hash password before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// 🔑 Compare password method
userSchema.methods.comparePassword = function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// 🎫 Generate JWT token
userSchema.methods.generateToken = function () {
  return jwt.sign(
    {
      userId: this._id,
      fullName: `${this.firstname}${this.middle_initial ? ' ' + this.middle_initial : ''} ${this.lastname}`,
      idNumber: this.id_number,
      userType: this.user_type,
      status: this.status,
    },
    process.env.JWT_SECRET,
    { expiresIn: "24h" }
  );
};

const User = mongoose.model("User", userSchema);

export default User;
