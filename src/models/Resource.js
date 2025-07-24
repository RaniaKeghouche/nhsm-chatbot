// src/models/Resource.js
const mongoose = require('mongoose');

const resourceSchema = new mongoose.Schema({
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
  tags: [String],
  difficulty: String,
  user_role: String,
  related_tips: [String],
  source: String,
  visibility: {
    type: String,
    default: 'public'
  },
  created_at: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Resource', resourceSchema);