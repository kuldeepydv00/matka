const { userWalletStore, registeredUsers, memoryDeposits, memoryWithdrawals, saveDiskStore } = require('../store');
const { formatDateKey } = require('../historicalChartStore');

// @desc    Register a new user
// @route   POST /api/user/register
const registerUser = async (req, res) => {
  const { name, mobile, password, referral_code } = req.body;
  if (!mobile) {
    return res.status(400).json({ message: 'Mobile number is required' });
  }

  const cleanMobile = mobile.replace(/[^0-9]/g, '').slice(-10);
  let user = registeredUsers.find(u => u.mobile.replace(/[^0-9]/g, '').slice(-10) === cleanMobile);
  const finalName = (name && name.trim().length > 0 && name !== 'User') ? name.trim() : (user ? user.name : `User ${cleanMobile.slice(-4)}`);

  const ownReferralCode = `REF${cleanMobile}`;

  if (user) {
    user.name = finalName;
    if (!user.referral_code) user.referral_code = ownReferralCode;
  } else {
    user = {
      id: `usr_${Date.now()}`,
      name: finalName,
      mobile: cleanMobile,
      password: password || '123',
      balance: 0.00,
      status: 'Active',
      referral_code: ownReferralCode,
      referred_by: null,
      referralsCount: 0,
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      createdDateKey: formatDateKey(new Date())
    };

    // Check if referral_code was provided
    if (referral_code && referral_code.trim()) {
      const cleanRef = referral_code.trim().toUpperCase().replace('REF', '');
      const cleanRefMobile = cleanRef.slice(-10);
      let referrer = registeredUsers.find(u => 
        u.mobile.slice(-10) === cleanRefMobile || 
        (u.referral_code && u.referral_code.toUpperCase() === referral_code.trim().toUpperCase())
      );

      if (referrer && referrer.mobile !== cleanMobile) {
        user.referred_by = referrer.mobile;
        referrer.referralsCount = (referrer.referralsCount || 0) + 1;
        referrer.balance = (referrer.balance || 0) + 50.00; // ₹50 Referral Bonus!
        console.log(`[Referral Reward] ${referrer.name} (+91 ${referrer.mobile}) earned ₹50 referral bonus for inviting ${user.name}!`);

        // Credit referrer in MongoDB Atlas
        try {
          const mongoose = require('mongoose');
          if (mongoose.connection.readyState === 1) {
            const User = require('../models/User');
            User.updateOne(
              { mobile: referrer.mobile },
              { $inc: { wallet_balance: 50, referrals_count: 1 } }
            ).catch(e => console.error('[MongoDB Referral Error]', e));
          }
        } catch (e) {}
      }
    }

    registeredUsers.push(user);
  }

  userWalletStore.name = user.name;
  userWalletStore.mobile = user.mobile;
  userWalletStore.balance = user.balance;

  const { saveDiskStore } = require('../store');
  saveDiskStore();

  // Save/Update registered user into MongoDB Atlas Database
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      const User = require('../models/User');
      await User.findOneAndUpdate(
        { mobile: cleanMobile },
        {
          $setOnInsert: { wallet_balance: user.balance || 0.00, referral_code: ownReferralCode },
          $set: {
            name: user.name,
            username: user.name,
            mobile: cleanMobile,
            password: user.password || '123',
            referral_code: ownReferralCode,
            referred_by: user.referred_by || null
          }
        },
        { upsert: true, new: true }
      );
      console.log(`[MongoDB] Registered/Synced user in Cloud Database: ${user.name} (+91 ${cleanMobile})`);
    }
  } catch (e) {
    console.error('[MongoDB User Creation Error]', e);
  }

  console.log(`[Registration] User registered/synced: ${user.name} (+91 ${user.mobile}), Referral: ${user.referral_code}`);
  res.status(200).json({ success: true, message: 'Account registered successfully', user });
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

    try {
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState === 1) {
        const User = require('../models/User');
        const dbUser = await User.findOne({ mobile: cleanMobile });
        if (dbUser) {
          if (!targetUser) {
            targetUser = {
              id: dbUser._id,
              name: dbUser.name || dbUser.username || `User ${cleanMobile.slice(-4)}`,
              mobile: cleanMobile,
              balance: dbUser.wallet_balance || 0.00,
              referral_code: dbUser.referral_code || `REF${cleanMobile}`,
              status: 'Active'
            };
            registeredUsers.push(targetUser);
          } else {
            if (dbUser.name && dbUser.name !== 'User') targetUser.name = dbUser.name;
            if (dbUser.wallet_balance !== undefined) targetUser.balance = dbUser.wallet_balance;
            if (!targetUser.referral_code) targetUser.referral_code = dbUser.referral_code || `REF${cleanMobile}`;
          }
        }
      }
    } catch (e) { }
  }

  if (targetUser) {
    if (!targetUser.referral_code && targetUser.mobile) {
      targetUser.referral_code = `REF${targetUser.mobile.slice(-10)}`;
    }
    return res.json(targetUser);
  }
  res.json({ name: 'User', mobile: mobile || '', balance: 0.00, referral_code: 'REF1234567890' });
};

// @desc    Get live wallet balance
// @desc    Get live wallet balance
// @route   GET /api/user/wallet/balance
const getWalletBalance = async (req, res) => {
  const { mobile } = req.query;
  let targetUser = null;
  if (mobile && mobile.trim().length > 0) {
    const cleanMobile = mobile.replace(/[^0-9]/g, '').slice(-10);
    targetUser = registeredUsers.find(u => u.mobile.replace(/[^0-9]/g, '').slice(-10) === cleanMobile);

    try {
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState === 1) {
        const User = require('../models/User');
        const dbUser = await User.findOne({ mobile: cleanMobile });
        if (dbUser) {
          if (!targetUser) {
            targetUser = {
              id: dbUser._id,
              name: dbUser.name || dbUser.username || `User ${cleanMobile.slice(-4)}`,
              mobile: cleanMobile,
              balance: dbUser.wallet_balance || 0.00,
              status: 'Active'
            };
            registeredUsers.push(targetUser);
          } else {
            if (dbUser.name && dbUser.name !== 'User') targetUser.name = dbUser.name;
            if (dbUser.wallet_balance !== undefined) targetUser.balance = dbUser.wallet_balance;
          }
        }
      }
    } catch (e) { }
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
    let cleanMobile = '';
    if (mobile) {
      cleanMobile = mobile.replace(/[^0-9]/g, '').slice(-10);
      targetUser = registeredUsers.find(u => u.mobile.replace(/[^0-9]/g, '').slice(-10) === cleanMobile);
    }
    if (!targetUser && registeredUsers.length > 0) {
      targetUser = registeredUsers[0];
    }

    if (targetUser) {
      targetUser.balance = val;
      cleanMobile = targetUser.mobile.replace(/[^0-9]/g, '').slice(-10);
    }
    userWalletStore.balance = val;

    const { saveDiskStore } = require('../store');
    saveDiskStore();

    // Sync wallet balance to MongoDB Atlas
    try {
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState === 1 && cleanMobile) {
        const User = require('../models/User');
        User.findOneAndUpdate(
          { mobile: cleanMobile },
          { wallet_balance: val, name: targetUser ? targetUser.name : 'User' },
          { upsert: true, new: true }
        ).then(() => console.log(`[MongoDB] Updated wallet balance for ${cleanMobile}: ₹${val}`))
         .catch(e => console.error('[MongoDB Wallet Sync Error]', e));
      }
    } catch (e) { }

    return res.json({ success: true, balance: val });
  }
  res.status(400).json({ message: 'Invalid balance amount' });
};

// @desc    Get transaction history
// @route   GET /api/user/wallet/transactions
const getTransactions = async (req, res) => {
  res.json([]);
};

// @desc    Submit deposit request
// @desc    Submit deposit request
// @route   POST /api/user/deposit OR /api/user/deposit/request
const submitDeposit = async (req, res) => {
  const { user, mobile, amount, method, utr } = req.body;

  const cleanMobile = (mobile || '').replace(/[^0-9]/g, '').slice(-10);
  let targetUser = registeredUsers.find(u => u.mobile.replace(/[^0-9]/g, '').slice(-10) === cleanMobile);

  const numAmount = parseFloat(amount) || 500;
  const utrStr = utr || `UTR${Date.now()}`;
  const userNameStr = targetUser ? targetUser.name : (user || `User (${cleanMobile || 'Mobile'})`);
  const userMobileStr = targetUser ? targetUser.mobile : cleanMobile;

  const newDeposit = {
    _id: `dep_${Date.now()}`,
    user: `${userNameStr} (${userMobileStr || 'N/A'})`,
    username: userNameStr,
    mobile: userMobileStr,
    amount: numAmount,
    method: method || 'UPI / PhonePe',
    utr: utrStr,
    utr_number: utrStr,
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
        user_id: userMobileStr || newDeposit._id,
        username: newDeposit.user,
        amount: numAmount,
        utr_number: utrStr,
        status: 'pending'
      });
    }
  } catch (e) {
    console.error('[MongoDB Deposit Error]', e);
  }

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
    status: 'Pending',
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

// @desc    Get detailed referral statistics & referred users list
// @route   GET /api/user/referral-details
const getReferralDetails = async (req, res) => {
  const { mobile } = req.query;
  if (!mobile) {
    return res.json({ referral_code: '', referralsCount: 0, totalCommission: 0, referredUsers: [] });
  }

  const { memoryBets } = require('../store');
  const cleanMobile = mobile.replace(/[^0-9]/g, '').slice(-10);
  let user = registeredUsers.find(u => u.mobile.replace(/[^0-9]/g, '').slice(-10) === cleanMobile);

  let rawReferred = [];
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      const User = require('../models/User');
      const dbUser = await User.findOne({ mobile: cleanMobile }).lean();
      if (dbUser && !user) user = dbUser;

      const dbReferred = await User.find({ referred_by: cleanMobile }).lean();
      if (dbReferred.length > 0) {
        rawReferred = dbReferred.map(r => ({
          id: String(r._id),
          name: r.name || r.username || `User ${r.mobile.slice(-4)}`,
          mobile: r.mobile,
          date: r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : 'Recently'
        }));
      }
    }
  } catch (e) {}

  if (rawReferred.length === 0) {
    rawReferred = registeredUsers
      .filter(u => u.referred_by && u.referred_by.replace(/[^0-9]/g, '').slice(-10) === cleanMobile)
      .map(r => ({
        id: String(r.id),
        name: r.name,
        mobile: r.mobile,
        date: r.createdDateKey || 'Recently'
      }));
  }

  let grandTotalCommission = 0;
  const processedList = [];

  const { referralConfig } = require('../store');
  const commRate = (referralConfig.commissionPercentage || 4) / 100;
  const signupBonus = referralConfig.signupBonus !== undefined ? referralConfig.signupBonus : 50;

  for (let ref of rawReferred) {
    const refCleanMob = ref.mobile ? ref.mobile.replace(/[^0-9]/g, '').slice(-10) : '';
    let totalBetStaked = 0;

    // Sum memory bets placed by this referred friend
    if (refCleanMob) {
      const userBets = memoryBets.filter(b => b.user && b.user.replace(/[^0-9]/g, '').slice(-10) === refCleanMob);
      totalBetStaked += userBets.reduce((sum, b) => sum + (parseFloat(b.bet_amount) || 0), 0);
    }

    const betCommission = parseFloat((totalBetStaked * commRate).toFixed(2));
    const totalEarnedFromRef = signupBonus + betCommission;
    grandTotalCommission += totalEarnedFromRef;

    processedList.push({
      id: ref.id,
      name: ref.name,
      mobile: ref.mobile ? `${ref.mobile.slice(0, 2)}****${ref.mobile.slice(-4)}` : '****',
      date: ref.date,
      bonus: signupBonus,
      betCommission: betCommission,
      totalEarned: totalEarnedFromRef
    });
  }

  const refCode = user ? (user.referral_code || `REF${cleanMobile}`) : `REF${cleanMobile}`;

  res.json({
    referral_code: refCode,
    referralsCount: processedList.length,
    totalCommission: Math.round(grandTotalCommission),
    referredUsers: processedList
  });
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
  checkUserExists,
  getReferralDetails
};
