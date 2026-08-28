const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String },
  username: { type: String },
  email: { type: String },
  phone: { type: String },
  mobile: { type: String },
  password: { type: String },
  password_hash: { type: String },
  wallet_balance: { type: Number, default: 0 },
  deposit_balance: { type: Number, default: 0 },
  winning_balance: { type: Number, default: 0 },
  bonus_balance: { type: Number, default: 200 },
  commission_balance: { type: Number, default: 0 },
  referral_code: { type: String },
  referred_by: { type: String },
  referrals_count: { type: Number, default: 0 },
  kyc_status: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending' },
  is_active: { type: Boolean, default: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' }
}, {
  strict: false,
  timestamps: true
});

const User = mongoose.models.User || mongoose.model('User', userSchema);
module.exports = User;
