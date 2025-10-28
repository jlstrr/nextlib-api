import { Router } from "express";
import authV1 from "./v1/auth/routes.js";
import userV1 from "./v1/user/routes.js";
import adminv1 from "./v1/admin/routes.js";
import laboratoryV1 from "./v1/laboratory/routes.js";
import computerV1 from "./v1/computer/routes.js";
import reservationV1 from "./v1/reservation/routes.js";
import usageHistoryV1 from "./v1/usage-history/routes.js";
import logsV1 from "./v1/logs/routes.js";
import systemConfigV1 from "./v1/system-config/routes.js";

const router = Router();

// Versioned routes
router.use("/v1/auth", authV1);
router.use("/v1/users", userV1);
router.use("/v1/admin", adminv1);
router.use("/v1/laboratories", laboratoryV1);
router.use("/v1/computers", computerV1);
router.use("/v1/reservations", reservationV1);
router.use("/v1/usage-history", usageHistoryV1);
router.use("/v1/logs", logsV1);
router.use("/v1/system-config", systemConfigV1);

export default router;
