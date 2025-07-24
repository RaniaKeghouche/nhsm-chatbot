// src/models/Wellness.js
const mongoose = require('mongoose');

const wellnessSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true
  },
  question: {
    type: String,
    required: true
  },
  answer: {
    type: String,
    required: true
  },
  category: String,
  sub_category: String,
  tags: [String],
  difficulty: String,
  target_audience: [String],
  related_tips: [String],
  source: String,
  visibility: {
    type: String,
    default: 'public'
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  updated_at: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Wellness', wellnessSchema);