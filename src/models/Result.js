const mongoose = require('mongoose');

const resultSchema = new mongoose.Schema({
  game: {
    type: String,
    required: true,
    trim: true
  },
  date: {
    type: String,
    required: true,
    trim: true,
    // YYYY-MM-DD in IST
    index: true
  },
  number: {
    type: Number,
    required: true
  },
  declaredAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Unique index on { game, date } so only one result exists per game per day
resultSchema.index({ game: 1, date: 1 }, { unique: true });

module.exports = mongoose.models.Result || mongoose.model('Result', resultSchema);
