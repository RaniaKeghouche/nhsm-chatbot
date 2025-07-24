// src/models/TeacherInfoModel.js (ou le nom de votre fichier)
const mongoose = require('mongoose');

const teacherInfoSchema = new mongoose.Schema({
  id: { // Votre ID unique métier (ex: nhs_prof_yahia_djemmada)
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  name: { // Nom complet du professeur pour affichage et recherche facile
    type: String,
    required: true,
    trim: true
  },
  question: { // Souvent le "Qui est Professeur X et ses spécialisations ?"
    type: String,
    required: true,
    trim: true
  },
  answer: { // Description détaillée du professeur
    type: String,
    required: true
  },
  category: {
    type: String,
    trim: true
  },
  tags: [String],
  difficulty: {
    type: String,
    trim: true
  },
  user_role: { // Peut-être 'teacher_profile' ou similaire pour ce type de document
    type: String,
    trim: true
  },
  related_tips: [String],
  source: {
    type: String,
    trim: true
  },
  visibility: {
    type: String,
    default: 'public',
    enum: ['public', 'private', 'admin_only'] // Optionnel: pour restreindre les valeurs
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  updated_at: { // Bonne pratique d'avoir un champ updated_at
    type: Date,
    default: Date.now
  }
});

// Middleware pour mettre à jour 'updated_at' avant chaque sauvegarde
teacherInfoSchema.pre('save', function(next) {
  this.updated_at = Date.now();
  next();
});

module.exports = mongoose.model('TeacherInfo', teacherInfoSchema);