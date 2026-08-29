const mongoose = require('mongoose');

const depositRequestSchema = new mongoose.Schema({
  user_id: { type: String },
  username: { type: String },
  mobile: { type: String },
  amount: { type: Number, required: true },
  utr_number: { type: String },
  payment_method: { type: String, default: 'UPI' },
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'Pending', 'Approved', 'Rejected'], default: 'pending' },
  admin_remarks: { type: String }
}, {
  strict: false,
  timestamps: true
});

const DepositRequest = mongoose.models.DepositRequest || mongoose.model('DepositRequest', depositRequestSchema);
module.exports = DepositRequest;
