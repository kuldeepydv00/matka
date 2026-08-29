const mongoose = require('mongoose');

const withdrawalRequestSchema = new mongoose.Schema({
  user_id: { type: String },
  username: { type: String },
  mobile: { type: String },
  amount: { type: Number, required: true },
  payment_method: { type: String, default: 'Bank Transfer' },
  account_number: { type: String },
  ifsc_code: { type: String },
  bank_name: { type: String },
  upi_id: { type: String },
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'Pending', 'Approved', 'Rejected'], default: 'pending' },
  admin_remarks: { type: String }
}, {
  strict: false,
  timestamps: true
});

const WithdrawalRequest = mongoose.models.WithdrawalRequest || mongoose.model('WithdrawalRequest', withdrawalRequestSchema);
module.exports = WithdrawalRequest;
