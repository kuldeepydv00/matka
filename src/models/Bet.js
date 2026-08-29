const mongoose = require('mongoose');

const betSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  game_name: { type: String, required: true },
  bet_type: { type: String, default: 'JODI' },
  number: { type: Number, required: true },
  bet_amount: { type: Number, required: true },
  potential_payout: { type: Number, required: true },
  win_amount: { type: Number, default: 0 },
  status: { type: String, default: 'pending' },
  user: { type: String },
  mobile: { type: String }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: false }
});

const Bet = mongoose.model('Bet', betSchema);
module.exports = Bet;
