const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['deposit', 'withdrawal', 'bet', 'winning'], required: true },
  amount: { type: Number, required: true },
  status: { type: String, enum: ['pending', 'success', 'failed'], default: 'success' },
  reference_id: { type: String },
  description: { type: String }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: false }
});

const Transaction = mongoose.model('Transaction', transactionSchema);
module.exports = Transaction;
