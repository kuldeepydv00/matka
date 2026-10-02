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
  mobile: { type: String },
  number_str: { type: String },
  multiplier: { type: Number },
  date_key: { type: String },
  createdDateKey: { type: String },
  bonus_deducted: { type: Number },
  wallet_deducted: { type: Number },
  main_wallet_amount: { type: Number }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: false }
});

// TTL Index: automatically delete bet history older than 60 days (60 * 24 * 60 * 60 = 5184000 seconds)
betSchema.index({ created_at: 1 }, { expireAfterSeconds: 5184000 });

const Bet = mongoose.model('Bet', betSchema);
module.exports = Bet;

