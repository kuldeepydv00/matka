const { userWalletStore, registeredUsers, memoryDeposits, memoryWithdrawals, saveDiskStore } = require('../store');
const { formatDateKey } = require('../historicalChartStore');

// @desc    Register a new user
// @route   POST /api/user/register
const registerUser = async (req, res) => {
  const { name, mobile, password } = req.body;
  if (!mobile) {
    return res.status(400).json({ message: 'Mobile number is required' });
  }

  const cleanMobile = mobile.replace(/[^0-9]/g, '').slice(-10);
  let user = registeredUsers.find(u => u.mobile.replace(/[^0-9]/g, '').slice(-10) === cleanMobile);

  if (user) {
    if (name && name.trim().length > 0 && name !== 'User') {
      user.name = name.trim();
    }
    console.log(`[Registration] Existing user logged in: ${user.name} (${user.mobile})`);
    return res.json({ success: true, message: 'User logged in successfully', user });
  }

  const newUser = {
    id: `usr_${Date.now()}`,
    name: (name && name.trim().length > 0) ? name.trim() : `User ${cleanMobile.slice(-4)}`,
    mobile: cleanMobile,
    password: password || '123',
    balance: 0.00,
    status: 'Active',
    createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    createdDateKey: formatDateKey(new Date())
  };

  registeredUsers.push(newUser);
  userWalletStore.name = newUser.name;
  userWalletStore.mobile = newUser.mobile;
  userWalletStore.balance = newUser.balance;

  const { saveDiskStore } = require('../store');
  saveDiskStore();

  // Save new registered user into MongoDB Atlas Database
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      const User = require('../models/User');
      User.findOneAndUpdate(
        { mobile: cleanMobile },
        {
          name: newUser.name,
          username: newUser.name,
          mobile: cleanMobile,
          password: newUser.password,
          wallet_balance: 0.00
        },
        { upsert: true, new: true }
      ).then(() => console.log(`[MongoDB] New user saved to Cloud Database: ${newUser.name} (+91 ${cleanMobile})`))
       .catch(e => console.error('[MongoDB User Creation Error]', e));
    }
  } catch (e) { }

  console.log(`[Registration] New user created & added to Admin Directory: ${newUser.name} (+91 ${newUser.mobile})`);
  res.status(201).json({ success: true, message: 'Account registered successfully', user: newUser });
};

// @desc    Login existing user
// @route   POST /api/user/login
const loginUser = async (req, res) => {
  const { mobile, password } = req.body;
  if (!mobile) {
    return res.status(400).json({ message: 'Mobile number is required' });
  }

  const cleanMobile = mobile.replace(/[^0-9]/g, '').slice(-10);
  let user = registeredUsers.find(u => u.mobile.replace(/[^0-9]/g, '').slice(-10) === cleanMobile);

  if (!user) {
    // Auto-create user if logging in after OTP verification
    user = {
      id: `usr_${Date.now()}`,
      name: `User ${cleanMobile.slice(-4)}`,
      mobile: cleanMobile,
      password: password || '123',
      balance: 0.00,
      status: 'Active',
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    registeredUsers.push(user);
    const { saveDiskStore } = require('../store');
    saveDiskStore();
    console.log(`[Login] Auto-registered new user to Admin Directory: ${user.name} (+91 ${user.mobile})`);
  }

  res.json({ success: true, message: 'Login successful', user });
};

// @desc    Get user profile
// @route   GET /api/user/profile
const getUserProfile = async (req, res) => {
  const { mobile } = req.query;
  let targetUser = null;
  if (mobile && mobile.trim().length > 0) {
    const cleanMobile = mobile.replace(/[^0-9]/g, '').slice(-10);
    targetUser = registeredUsers.find(u => u.mobile.replace(/[^0-9]/g, '').slice(-10) === cleanMobile);
  }
  if (targetUser) return res.json(targetUser);
  res.json({ name: 'User', mobile: mobile || '', balance: 0.00 });
};

// @desc    Get live wallet balance
// @route   GET /api/user/wallet/balance
const getWalletBalance = async (req, res) => {
  const { mobile } = req.query;
  let targetUser = null;
  if (mobile && mobile.trim().length > 0) {
    const cleanMobile = mobile.replace(/[^0-9]/g, '').slice(-10);
    targetUser = registeredUsers.find(u => u.mobile.replace(/[^0-9]/g, '').slice(-10) === cleanMobile);
  }

  const currentBal = targetUser ? (targetUser.balance || 0.00) : 0.00;
  const currentName = targetUser ? targetUser.name : null;
  res.json({ balance: currentBal, name: currentName });
};

// @desc    Update wallet balance
// @route   POST /api/user/wallet/balance
const updateWalletBalance = async (req, res) => {
  const { amount, mobile } = req.body;
  const val = parseFloat(amount);
  if (!isNaN(val)) {
    let targetUser = null;
    if (mobile) {
      const cleanMobile = mobile.replace(/[^0-9]/g, '').slice(-10);
      targetUser = registeredUsers.find(u => u.mobile.replace(/[^0-9]/g, '').slice(-10) === cleanMobile);
    }
    if (!targetUser && registeredUsers.length > 0) {
      targetUser = registeredUsers[0];
    }

    if (targetUser) {
      targetUser.balance = val;
    }
    userWalletStore.balance = val;

    const { saveDiskStore } = require('../store');
    saveDiskStore();
  }
  res.json({ balance: userWalletStore.balance });
};

// @desc    Get transaction history
// @route   GET /api/user/wallet/transactions
const getTransactions = async (req, res) => {
  res.json([]);
};

// @desc    Submit deposit request
// @route   POST /api/user/deposit OR /api/user/deposit/request
const submitDeposit = async (req, res) => {
  const { user, mobile, amount, method, utr } = req.body;

  const cleanMobile = (mobile || '').replace(/[^0-9]/g, '').slice(-10);
  let targetUser = registeredUsers.find(u => u.mobile.replace(/[^0-9]/g, '').slice(-10) === cleanMobile);
  if (!targetUser && registeredUsers.length > 0) {
    targetUser = registeredUsers[0];
  }

  const userLabel = targetUser 
    ? `${targetUser.name} (${targetUser.mobile})` 
    : (user || `User (${cleanMobile || '9999999999'})`);

  const numAmount = parseFloat(amount) || 500;
  const utrStr = utr || `UTR${Date.now()}`;

  const newDeposit = {
    _id: `dep_${Date.now()}`,
    user: userLabel,
    mobile: targetUser ? targetUser.mobile : cleanMobile,
    amount: numAmount,
    method: method || 'UPI / PhonePe',
    utr: utrStr,
    status: 'Pending',
    createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };

  memoryDeposits.unshift(newDeposit);

  // Sync to MongoDB Atlas DepositRequest collection
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      const DepositRequest = require('../models/DepositRequest');
      await DepositRequest.create({
        user_id: targetUser ? targetUser.id : newDeposit._id,
        username: newDeposit.user,
        amount: numAmount,
        utr_number: utrStr,
        status: 'pending'
      });
    }
  } catch (e) {}

  const { saveDiskStore } = require('../store');
  saveDiskStore();
  console.log(`[Deposit Submitted] ${newDeposit.user} requested ₹${newDeposit.amount} (UTR: ${newDeposit.utr})`);
  res.status(201).json({ success: true, message: 'Deposit request submitted successfully! Admin will verify and approve shortly.', deposit: newDeposit });
};

// @desc    Submit withdrawal request
// @route   POST /api/user/withdraw/request
const requestWithdrawal = async (req, res) => {
  const { amount, mobile, method, details, holder_name } = req.body;
  const numAmt = parseFloat(amount);

  if (!numAmt || numAmt < 500) {
    return res.status(400).json({ success: false, message: 'Minimum withdrawal amount is ₹500' });
  }

  const cleanMobile = (mobile || '').replace(/[^0-9]/g, '').slice(-10);
  let targetUser = registeredUsers.find(u => u.mobile.replace(/[^0-9]/g, '').slice(-10) === cleanMobile);
  if (!targetUser && registeredUsers.length > 0) {
    targetUser = registeredUsers[0];
  }

  if (targetUser && (targetUser.balance || 0) < numAmt) {
    return res.status(400).json({ success: false, message: `Insufficient wallet balance. Available balance: ₹${targetUser.balance.toFixed(2)}` });
  }

  // Deduct balance from user wallet
  if (targetUser) {
    targetUser.balance = (targetUser.balance || 0) - numAmt;
    userWalletStore.balance = targetUser.balance;

    // Sync to MongoDB Atlas
    try {
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState === 1) {
        const User = require('../models/User');
        await User.updateOne({ mobile: targetUser.mobile }, { $set: { wallet_balance: targetUser.balance } });
      }
    } catch (e) {}
  }

  const newWithdrawal = {
    id: `wth_${Date.now()}`,
    user: targetUser ? targetUser.mobile : (cleanMobile || '1234567890'),
    mobile: targetUser ? targetUser.mobile : (cleanMobile || '1234567890'),
    name: holder_name || (targetUser ? targetUser.name : 'User'),
    amount: numAmt,
    status: 'pending',
    payment_method: method || 'UPI',
    payment_details: details || 'UPI Payment',
    account_number: details || 'N/A',
    ifsc_code: method === 'Bank' ? 'BANK000123' : 'N/A',
    upi_id: method === 'UPI' ? details : 'N/A',
    created_at: new Date().toISOString()
  };

  memoryWithdrawals.unshift(newWithdrawal);

  // Sync to MongoDB Atlas WithdrawalRequest collection
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      const WithdrawalRequest = require('../models/WithdrawalRequest');
      await WithdrawalRequest.create({
        user_id: targetUser ? targetUser.id : newWithdrawal.id,
        username: newWithdrawal.name,
        amount: numAmt,
        payment_method: newWithdrawal.payment_method,
        account_details: newWithdrawal.payment_details,
        status: 'pending'
      });
    }
  } catch (e) {}

  saveDiskStore();

  res.json({
    success: true,
    message: `Withdrawal request of ₹${numAmt} submitted successfully! Settle within 15 minutes.`,
    newBalance: targetUser ? targetUser.balance : 0,
    withdrawal: newWithdrawal
  });
};

// @desc    Send SMS OTP
// @route   POST /api/user/send-otp
const sendSmsOtp = async (req, res) => {
  const { mobile } = req.body;
  if (!mobile) {
    return res.status(400).json({ message: 'Mobile number is required' });
  }

  const cleanMobile = mobile.replace(/[^0-9]/g, '').slice(-10);
  const generatedOtp = "123456";

  console.log(`[OTP Manager] Set fixed OTP 123456 for +91 ${cleanMobile}`);
  res.json({ success: true, message: 'OTP generated successfully', otp: generatedOtp });
};

// @desc    Verify SMS OTP
// @route   POST /api/user/verify-otp
const verifySmsOtp = async (req, res) => {
  const { mobile, otp } = req.body;
  if (!mobile || !otp) {
    return res.status(400).json({ message: 'Mobile number and OTP code are required' });
  }

  const cleanMobile = mobile.replace(/[^0-9]/g, '').slice(-10);

  if (otp.trim() === '123456') {
    // Ensure user is added to registeredUsers store
    let user = registeredUsers.find(u => u.mobile.replace(/[^0-9]/g, '').slice(-10) === cleanMobile);
    if (!user) {
      user = {
        id: `usr_${Date.now()}`,
        name: `User ${cleanMobile.slice(-4)}`,
        mobile: cleanMobile,
        password: '123',
        balance: 0.00,
        status: 'Active',
        createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      registeredUsers.push(user);
      console.log(`[OTP Verified] Registered new user to Admin Directory: ${user.name} (+91 ${user.mobile})`);
    }
    return res.json({ success: true, message: 'OTP verified successfully', user });
  }

  return res.status(400).json({ message: 'Invalid OTP code! Please enter 123456.' });
};

// @desc    Check if a mobile number is already registered
// @route   GET /api/user/check
const checkUserExists = async (req, res) => {
  const { mobile } = req.query;
  if (!mobile) {
    return res.json({ exists: false });
  }

  const cleanMobile = mobile.replace(/[^0-9]/g, '').slice(-10);
  let user = registeredUsers.find(u => u.mobile.replace(/[^0-9]/g, '').slice(-10) === cleanMobile);

  if (!user) {
    try {
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState === 1) {
        const User = require('../models/User');
        const dbUser = await User.findOne({ mobile: cleanMobile });
        if (dbUser) {
          user = {
            id: dbUser._id,
            name: dbUser.name || dbUser.username || `User ${cleanMobile.slice(-4)}`,
            mobile: dbUser.mobile,
            balance: dbUser.wallet_balance || 0.00
          };
          registeredUsers.push(user);
        }
      }
    } catch (e) { }
  }

  if (user) {
    return res.json({
      exists: true,
      user: {
        name: user.name,
        mobile: user.mobile,
        balance: user.balance || 0.00
      }
    });
  }

  return res.json({ exists: false });
};

module.exports = {
  registerUser,
  loginUser,
  getUserProfile,
  getWalletBalance,
  updateWalletBalance,
  getTransactions,
  submitDeposit,
  requestWithdrawal,
  sendSmsOtp,
  verifySmsOtp,
  checkUserExists
};
