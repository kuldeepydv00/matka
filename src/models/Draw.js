const mongoose = require('mongoose');

const drawSchema = new mongoose.Schema({
  draw_time: { type: Date, required: true },
  winning_number: { type: Number, default: null },
  total_bet_volume: { type: Number, default: 0 },
  total_winners: { type: Number, default: 0 },
  total_payout: { type: Number, default: 0 },
  status: { type: String, enum: ['upcoming', 'active', 'closed', 'announced'], default: 'upcoming' },
  declared_at: { type: Date },
  server_seed_hash: { type: String, required: true },
  server_seed: { type: String, default: null } // Revealed after draw
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

const Draw = mongoose.model('Draw', drawSchema);
module.exports = Draw;
