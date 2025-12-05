import mongoose from "mongoose";

const SubjectSchedulerSchema = new mongoose.Schema({
  subjectName: {
    type: String,
    required: true
  },
  instructorName: {
    type: String,
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  timeslot: {
    type: String,
    required: true
  },
  isRepeat: {
    type: Boolean,
    default: false
  },
  repeatInterval: {
    type: String,
    enum: ['daily', 'weekly', 'monthly', null],
    default: null
  },
  repeatEndDate: {
    type: Date,
    default: null
  }
});

export default mongoose.model('SubjectScheduler', SubjectSchedulerSchema);