import mongoose from 'mongoose';

const CourseSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true
        },
        description: {
            type: String,
            required: true,
            trim: true
        }
    }, { timestamps: true }
);

const Course = mongoose.model('Course', CourseSchema);

export default Course;