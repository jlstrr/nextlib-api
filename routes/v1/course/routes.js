import { Router } from 'express';
import Course from '../../../models/Course.js';

const router = Router();

// const express = require('express');
// const router = express.Router();
// const Course = require('../../../models/Course');

// Create a new course
router.post('/', async (req, res) => {
  try {
    const { name, description } = req.body;
    const course = new Course({ name, description });
    await course.save();
    res.status(201).json({
      status: 'success',
      message: 'Course created successfully',
      data: course
    });
  } catch (err) {
    res.status(400).json({
      status: 'error',
      message: 'Failed to create course',
      error: err.message
    });
  }
});

// Get all courses
router.get('/', async (req, res) => {
  try {
    const courses = await Course.find();
    res.json({
      status: 'success',
      message: 'Courses fetched successfully',
      data: courses
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch courses',
      error: err.message
    });
  }
});

// Get a single course by ID
router.get('/:id', async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) {
      return res.status(404).json({
        status: 'error',
        message: 'Course not found',
        data: null
      });
    }
    res.json({
      status: 'success',
      message: 'Course fetched successfully',
      data: course
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch course',
      error: err.message
    });
  }
});

// Update a course by ID
router.put('/:id', async (req, res) => {
  try {
    const { name, description } = req.body;
    const course = await Course.findByIdAndUpdate(
      req.params.id,
      { name, description },
      { new: true, runValidators: true }
    );
    if (!course) {
      return res.status(404).json({
        status: 'error',
        message: 'Course not found',
        data: null
      });
    }
    res.json({
      status: 'success',
      message: 'Course updated successfully',
      data: course
    });
  } catch (err) {
    res.status(400).json({
      status: 'error',
      message: 'Failed to update course',
      error: err.message
    });
  }
});

// Delete a course by ID
router.delete('/:id', async (req, res) => {
  try {
    const course = await Course.findByIdAndDelete(req.params.id);
    if (!course) {
      return res.status(404).json({
        status: 'error',
        message: 'Course not found',
        data: null
      });
    }
    res.json({
      status: 'success',
      message: 'Course deleted successfully',
      data: { id: req.params.id }
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to delete course',
      error: err.message
    });
  }
});

export default router;