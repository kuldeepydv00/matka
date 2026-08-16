const mongoose = require('mongoose');

const betSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  game_name: { type: String, required: true, enum: ['Gali', 'Ghaziabad', 'Faridabad', 'Desawar'] },
  bet_type: { type: String, default: 'JODI' },
  number: { type: Number, required: true },
  bet_amount: { type: Number, required: true },
  potential_payout: { type: Number, required: true },
  win_amount: { type: Number, default: 0 },
  status: { type: String, enum: ['pending', 'won', 'lost'], default: 'pending' }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: false }
});

const Bet = mongoose.model('Bet', betSchema);
module.exports = Bet;
