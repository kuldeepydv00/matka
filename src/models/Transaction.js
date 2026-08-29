const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  user_id: { type: String },
  username: { type: String },
  mobile: { type: String },
  type: { type: String, required: true },
  amount: { type: Number, required: true },
  status: { type: String, default: 'success' },
  reference_id: { type: String },
  description: { type: String }
}, {
  strict: false,
  timestamps: true
});

const Transaction = mongoose.models.Transaction || mongoose.model('Transaction', transactionSchema);
module.exports = Transaction;
