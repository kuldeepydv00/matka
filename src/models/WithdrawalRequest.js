const mongoose = require('mongoose');

const withdrawalRequestSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true },
  bank_details: {
    account_number: { type: String, required: true },
    ifsc: { type: String, required: true },
    beneficiary_name: { type: String, required: true }
  },
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'processed'], default: 'pending' },
  admin_remarks: { type: String },
  processed_at: { type: Date }
}, {
  timestamps: { createdAt: 'requested_at', updatedAt: 'updated_at' }
});

const WithdrawalRequest = mongoose.model('WithdrawalRequest', withdrawalRequestSchema);
module.exports = WithdrawalRequest;
