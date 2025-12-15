import { Router } from "express";
import SubjectScheduler from "../../../models/SubjectScheduler.js";
import { getStartEndOfDay, getTZMinutesSinceMidnight, getTZCurrentTimeString } from "../../../utils/timezone.js";
// No auth middleware for computer-usage validation endpoints

const router = Router();

const rateStore = new Map();
function rateLimit(key, limit = 5, windowMs = 60000) {
  const now = Date.now();
  const record = rateStore.get(key) || { count: 0, reset: now + windowMs };
  if (now > record.reset) {
    rateStore.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  if (record.count >= limit) return false;
  record.count += 1;
  rateStore.set(key, record);
  return true;
}

// Create a new schedule (with recurring support)
router.post('/', async (req, res) => {
    try {
      const { subjectName, subjectCode, instructorName, date, timeslot, isRepeat, repeatInterval, repeatEndDate } = req.body;
      let schedules = [];

      // Helper to parse timeslot string to start/end
      function parseTimeslot(ts) {
        const [start, end] = ts.split('-').map(t => t.trim());
        return {
          start: start,
          end: end
        };
      }

      // Helper to check overlap
      function isOverlap(ts1, ts2) {
        // Convert to minutes
        const toMinutes = t => {
          const [h, m] = t.split(':').map(Number);
          return h * 60 + m;
        };
        const a = parseTimeslot(ts1);
        const b = parseTimeslot(ts2);
        return toMinutes(a.start) < toMinutes(b.end) && toMinutes(b.start) < toMinutes(a.end);
      }

      if (isRepeat && repeatInterval && repeatEndDate) {
        // Create recurring schedules
        let currentDate = new Date(date);
        const endDate = new Date(repeatEndDate);
        let datesToCheck = [];
        while (currentDate <= endDate) {
          datesToCheck.push(new Date(currentDate));
          if (repeatInterval === 'daily') {
            currentDate.setDate(currentDate.getDate() + 1);
          } else if (repeatInterval === 'weekly') {
            currentDate.setDate(currentDate.getDate() + 7);
          } else if (repeatInterval === 'monthly') {
            currentDate.setMonth(currentDate.getMonth() + 1);
          } else {
            break;
          }
        }
        // Check for conflicts (overlapping timeslots)
        for (let d of datesToCheck) {
          const { startOfDay, endOfDay } = getStartEndOfDay(d);
          const existing = await SubjectScheduler.find({ date: { $gte: startOfDay, $lte: endOfDay } });
          for (let ex of existing) {
            if (isOverlap(timeslot, ex.timeslot)) {
              return res.status(400).json({ error: `A schedule already exists for ${d.toISOString().slice(0,10)} with overlapping timeslot.` });
            }
          }
        }
        // No conflict, create schedules
        schedules = datesToCheck.map(d => ({
          subjectName,
          subjectCode,
          instructorName,
          date: d,
          timeslot,
          isRepeat,
          repeatInterval,
          repeatEndDate
        }));
        const created = await SubjectScheduler.insertMany(schedules);
        return res.status(201).json(created);
      } else {
        // Single schedule
        // Check for conflict (overlapping timeslots)
        const { startOfDay, endOfDay } = getStartEndOfDay(date);
        const existing = await SubjectScheduler.find({ date: { $gte: startOfDay, $lte: endOfDay } });
        for (let ex of existing) {
          if (isOverlap(timeslot, ex.timeslot)) {
            return res.status(400).json({ error: 'A schedule already exists for this date with overlapping timeslot.' });
          }
        }
        const schedule = new SubjectScheduler({
          subjectName,
          subjectCode,
          instructorName,
          date,
          timeslot,
          isRepeat,
          repeatInterval: null,
          repeatEndDate: null
        });
        await schedule.save();
        return res.status(201).json(schedule);
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
});

// Get all schedules
router.get('/', async (req, res) => {
  try {
    const schedules = await SubjectScheduler.find();
    res.json(schedules);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get a schedule by ID
router.get('/:id', async (req, res) => {
  try {
    const schedule = await SubjectScheduler.findById(req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Not found' });
    res.json(schedule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a schedule
router.put('/:id', async (req, res) => {
  try {
    const { isRepeat, repeatInterval, repeatEndDate, subjectName, subjectCode, instructorName, date, timeslot } = req.body;
    if (isRepeat && repeatInterval && repeatEndDate) {
      // Delete the original schedule
      await SubjectScheduler.findByIdAndDelete(req.params.id);
      // Create recurring schedules
      let schedules = [];
      let currentDate = new Date(date);
      const endDate = new Date(repeatEndDate);
      while (currentDate <= endDate) {
        schedules.push({
          subjectName,
          subjectCode,
          instructorName,
          date: new Date(currentDate),
          timeslot,
          isRepeat,
          repeatInterval,
          repeatEndDate
        });
        if (repeatInterval === 'daily') {
          currentDate.setDate(currentDate.getDate() + 1);
        } else if (repeatInterval === 'weekly') {
          currentDate.setDate(currentDate.getDate() + 7);
        } else if (repeatInterval === 'monthly') {
          currentDate.setMonth(currentDate.getMonth() + 1);
        } else {
          break;
        }
      }
      const created = await SubjectScheduler.insertMany(schedules);
      return res.status(200).json(created);
    } else {
      // Single update
      const updated = await SubjectScheduler.findByIdAndUpdate(req.params.id, req.body, { new: true });
      if (!updated) return res.status(404).json({ error: 'Not found' });
      res.json(updated);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a schedule
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await SubjectScheduler.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
router.post("/computer-usage/start", async (req, res) => {
  try {
    const key = `start:${req.ip || 'global'}`;
    if (!rateLimit(key)) return res.status(429).json({ status: 429, message: "Too many requests" });
    const { subjectCode } = req.body || {};
    if (!subjectCode || typeof subjectCode !== "string" || !subjectCode.trim()) {
      return res.status(400).json({ status: 400, message: "subjectCode is required" });
    }
    const code = subjectCode.trim();
    const existsAny = await SubjectScheduler.exists({ subjectCode: code });
    if (!existsAny) {
      return res.status(404).json({ status: 404, message: "Subject code not found" });
    }
    const { startOfDay, endOfDay } = getStartEndOfDay();
    const schedule = await SubjectScheduler.findOne({
      subjectCode: code,
      date: { $gte: startOfDay, $lte: endOfDay }
    });
    if (!schedule) {
      return res.status(409).json({ status: 409, message: "No scheduled session today for subjectCode" });
    }
    const [startStr, endStr] = schedule.timeslot.split("-").map(s => s.trim());
    const toMinutes = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
    const startMin = toMinutes(startStr);
    const endMin = toMinutes(endStr);
    const nowMin = getTZMinutesSinceMidnight();
    if (!(nowMin >= startMin && nowMin < endMin)) {
      return res.status(409).json({ status: 409, message: "Current time does not match scheduled timeslot" });
    }
    const timeIn = getTZCurrentTimeString();
    return res.status(200).json({ status: 200, message: "Validation passed. Access granted.", 
      data: { 
        subjectCode: schedule.subjectCode, 
        subjectName: schedule.subjectName, 
        instructorName: schedule.instructorName, 
        date: schedule.date, 
        timeslot: schedule.timeslot, 
        time_in: timeIn 
      } 
    });
  } catch (err) {
    return res.status(500).json({ status: 500, message: "Failed to start usage session", error: err.message });
  }
});

router.post("/computer-usage/end", async (req, res) => {
  try {
    const key = `end:${req.ip || 'global'}`;
    if (!rateLimit(key)) return res.status(429).json({ status: 429, message: "Too many requests" });
    const { subjectCode } = req.body || {};
    if (!subjectCode || typeof subjectCode !== "string" || !subjectCode.trim()) {
      return res.status(400).json({ status: 400, message: "subjectCode is required" });
    }
    const code = subjectCode.trim();
    const existsAny = await SubjectScheduler.exists({ subjectCode: code });
    if (!existsAny) {
      return res.status(404).json({ status: 404, message: "Subject code not found" });
    }
    const { startOfDay, endOfDay } = getStartEndOfDay();
    const schedule = await SubjectScheduler.findOne({
      subjectCode: code,
      date: { $gte: startOfDay, $lte: endOfDay }
    });
    if (!schedule) {
      return res.status(409).json({ status: 409, message: "No scheduled session today for subjectCode" });
    }
    const [startStr, endStr] = schedule.timeslot.split("-").map(s => s.trim());
    const toMinutes = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
    const startMin = toMinutes(startStr);
    const endMin = toMinutes(endStr);
    const nowMin = getTZMinutesSinceMidnight();
    if (nowMin < startMin) {
      return res.status(409).json({ status: 409, message: "Current time is before scheduled start time" });
    }
    const timeOut = getTZCurrentTimeString();
    const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
    const scheduledDuration = toMin(endStr) - toMin(startStr);
    return res.status(200).json({
      status: 200,
      message: "Usage session ended",
      data: {
        subjectCode: schedule.subjectCode,
        timeslot: schedule.timeslot,
        scheduled_duration_minutes: scheduledDuration,
        session_duration_minutes: Math.max(0, nowMin - toMin(startStr))
      }
    });
  } catch (err) {
    return res.status(500).json({ status: 500, message: "Failed to end usage session", error: err.message });
  }
});
