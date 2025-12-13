import mongoose from "mongoose";

const passwordResetAuditSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    actor_type: { type: String, enum: ["admin", "user", "unknown"], required: true },
    actor_id: { type: mongoose.Schema.Types.ObjectId, default: null },
    method: { type: String, enum: ["link", "otp"], required: true },
    status: { type: String, enum: ["success", "failed", "error"], required: true },
    reason: { type: String, default: null },
    ip_address: { type: String, default: null },
    user_agent: { type: String, default: null },
    timestamp: { type: Date, default: Date.now, required: true },
  },
  { timestamps: true }
);

passwordResetAuditSchema.index({ email: 1, timestamp: -1 });
passwordResetAuditSchema.index({ actor_type: 1, timestamp: -1 });
passwordResetAuditSchema.index({ method: 1, status: 1, timestamp: -1 });

const PasswordResetAudit = mongoose.model("PasswordResetAudit", passwordResetAuditSchema);
export default PasswordResetAudit;

