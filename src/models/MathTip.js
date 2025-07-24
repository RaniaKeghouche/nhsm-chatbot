// src/models/MathTip.js
const mongoose = require('mongoose');

const mathTipSchema = new mongoose.Schema({
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
  category: {
    type: String,
    required: true
  },
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

module.exports = mongoose.model('MathTip', mathTipSchema);