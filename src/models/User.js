const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true, unique: true },
  password_hash: { type: String, required: true },
  wallet_balance: { type: Number, default: 0 },
  kyc_status: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending' },
  is_active: { type: Boolean, default: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

userSchema.pre('save', async function (next) {
  if (!this.isModified('password_hash')) {
    next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password_hash = await bcrypt.hash(this.password_hash, salt);
});

userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password_hash);
};

const User = mongoose.model('User', userSchema);
module.exports = User;
