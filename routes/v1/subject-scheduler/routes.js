import { Router } from "express";
import SubjectScheduler from "../../../models/SubjectScheduler.js";

const router = Router();

// Create a new schedule (with recurring support)
router.post('/', async (req, res) => {
    try {
      const { subjectName, instructorName, date, timeslot, isRepeat, repeatInterval, repeatEndDate } = req.body;
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
          const existing = await SubjectScheduler.find({ date: d });
          for (let ex of existing) {
            if (isOverlap(timeslot, ex.timeslot)) {
              return res.status(400).json({ error: `A schedule already exists for ${d.toISOString().slice(0,10)} with overlapping timeslot.` });
            }
          }
        }
        // No conflict, create schedules
        schedules = datesToCheck.map(d => ({
          subjectName,
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
        const existing = await SubjectScheduler.find({ date: new Date(date) });
        for (let ex of existing) {
          if (isOverlap(timeslot, ex.timeslot)) {
            return res.status(400).json({ error: 'A schedule already exists for this date with overlapping timeslot.' });
          }
        }
        const schedule = new SubjectScheduler({
          subjectName,
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
    const { isRepeat, repeatInterval, repeatEndDate, subjectName, instructorName, date, timeslot } = req.body;
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