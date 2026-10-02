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
  custom_referral_commission: { type: Number, default: null },
  referral_enabled: { type: Boolean, default: true },
  custom_jodi_rate: { type: Number, default: null },
  custom_haroof_rate: { type: Number, default: null },
  custom_crossing_rate: { type: Number, default: null },
  self_bet_commission: { type: Number, default: null },
  referral_code: { type: String },
  referred_by: { type: String },
  referrals_count: { type: Number, default: 0 },
  kyc_status: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending' },
  is_active: { type: Boolean, default: true },
  account_holder_name: { type: String, default: null },
  account_number: { type: String, default: null },
  ifsc_code: { type: String, default: null },
  bank_name: { type: String, default: null },
  upi_id: { type: String, default: null },
  role: { type: String, enum: ['user', 'admin'], default: 'user' }
}, {
  strict: false,
  timestamps: true
});

const User = mongoose.models.User || mongoose.model('User', userSchema);
module.exports = User;
