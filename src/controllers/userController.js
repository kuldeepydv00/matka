const { userWalletStore, registeredUsers, memoryDeposits, memoryWithdrawals, memoryBets, saveDiskStore } = require('../store');
const { formatDateKey } = require('../historicalChartStore');
const msg91 = require('../utils/msg91');

function getISTDateStr(d) {
  if (!d) d = new Date();
  if (typeof d === 'string') {
    d = d.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    d = new Date(d);
  } else if (typeof d === 'number') {
    d = new Date(d);
  }
  if (isNaN(d.getTime())) d = new Date();
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
}

// @desc    Register a new user
// @route   POST /api/user/register
const registerUser = async (req, res) => {
  const { name, mobile, password, referral_code } = req.body;
  if (!mobile) {
    return res.status(400).json({ message: 'Mobile number is required' });
  }

  const cleanMobile = mobile.replace(/[^0-9]/g, '').slice(-10);
  const { blockedMobiles, deletedMobiles } = require('../store');
  if (blockedMobiles.includes(cleanMobile)) {
    return res.status(403).json({ success: false, message: 'This mobile number has been permanently blocked. Contact support.' });
  }

  if (cleanMobile && deletedMobiles && deletedMobiles.includes(cleanMobile)) {
    return res.status(403).json({ success: false, message: 'This account has been deleted. Please contact support.' });
  }
  let user = registeredUsers.find(u => (u.mobile || '').replace(/[^0-9]/g, '').slice(-10) === cleanMobile);
  const finalName = (name && name.trim().length > 0 && name !== 'User') ? name.trim() : (user ? user.name : `User ${cleanMobile.slice(-4)}`);

  const ownReferralCode = cleanMobile;

  if (user) {
    user.name = finalName;
    user.referral_code = cleanMobile;
    if (user.bonus_balance === undefined) user.bonus_balance = 200.00;
    if (user.deposit_balance === undefined) user.deposit_balance = user.balance || 0.00;
    if (user.winning_balance === undefined) user.winning_balance = 0.00;
    if (user.commission_balance === undefined) user.commission_balance = 0.00;
  } else {
    user = {
      id: `usr_${Date.now()}`,
      name: finalName,
      mobile: cleanMobile,
      password: password || '123',
      balance: 0.00,
      deposit_balance: 0.00,
      winning_balance: 0.00,
      bonus_balance: 200.00,
      commission_balance: 0.00,
      is_khaiwal: false,
      referral_enabled: true,
      referral_status: 'ON',
      status: 'Active',
      referral_code: ownReferralCode,
      referred_by: null,
      referralsCount: 0,
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      createdDateKey: formatDateKey(new Date())
    };
    registeredUsers.push(user);
    const { khaiwalPlayersStore, khaiwalPlayerBetsStore } = require('../store');
    if (khaiwalPlayersStore && khaiwalPlayersStore[cleanMobile]) delete khaiwalPlayersStore[cleanMobile];
    if (khaiwalPlayerBetsStore && khaiwalPlayerBetsStore[cleanMobile]) delete khaiwalPlayerBetsStore[cleanMobile];
  }

  // Check if referral_code was provided & user is not yet referred
  if (!user.referred_by && referral_code && referral_code.trim()) {
    const cleanRef = referral_code.trim().toUpperCase().replace(/^REF/i, '').replace(/[^0-9]/g, '');
    const cleanRefMobile = cleanRef.slice(-10);
    let referrerMobile = null;
    let referrerName = 'Referrer';

    let referrer = registeredUsers.find(u => 
      u.mobile.slice(-10) === cleanRefMobile || 
      (u.referral_code && u.referral_code.replace(/^REF/i, '') === cleanRefMobile)
    );

    if (referrer && referrer.mobile.slice(-10) !== cleanMobile) {
      if (referrer.referral_enabled === false || referrer.referral_status === 'OFF') {
        console.log(`[Referral Linking Blocked] Referrer ${referrer.name} (+91 ${referrer.mobile}) has referral status OFF. Linking skipped.`);
      } else {
        referrerMobile = referrer.mobile.slice(-10);
        referrerName = referrer.name;
        referrer.referralsCount = (referrer.referralsCount || 0) + 1;
      }
    } else {
      // Search MongoDB Atlas for referrer
      try {
        const User = require('../models/User');
        const dbRef = await User.findOne({
          $or: [
            { mobile: cleanRefMobile },
            { mobile: `+91${cleanRefMobile}` },
            { referral_code: cleanRefMobile },
            { referral_code: `REF${cleanRefMobile}` }
          ]
        }).lean();

        if (dbRef && dbRef.mobile.slice(-10) !== cleanMobile) {
          if (dbRef.referral_enabled === false || dbRef.referral_status === 'OFF') {
            console.log(`[Referral Linking Blocked] Referrer ${dbRef.name} (+91 ${cleanRefMobile}) has referral status OFF in DB. Linking skipped.`);
          } else {
            referrerMobile = dbRef.mobile.slice(-10);
            referrerName = dbRef.name || dbRef.username || 'Referrer';
          }
        }
      } catch (e) {}
    }

    if (referrerMobile) {
      user.referred_by = referrerMobile;
      console.log(`[Referral Binding] ${user.name} linked to referrer ${referrerName} (+91 ${referrerMobile}). Referrer will earn lifetime bet commission!`);

      // Increment referrer count in MongoDB Atlas
      try {
        const User = require('../models/User');
        await User.updateOne(
          { mobile: { $regex: new RegExp(referrerMobile + '$') } },
          { $inc: { referrals_count: 1 } }
        );
      } catch (e) {}
    }
  }

  // Sync to MongoDB Atlas User collection
  try {
    const User = require('../models/User');
    const existing = await User.findOne({ mobile: cleanMobile });
    if (!existing) {
      await User.create({
        username: user.name,
        name: user.name,
        mobile: cleanMobile,
        password: password || '123',
        wallet_balance: user.balance,
        deposit_balance: user.deposit_balance,
        winning_balance: user.winning_balance,
        bonus_balance: user.bonus_balance,
        commission_balance: user.commission_balance,
        referral_code: cleanMobile,
        referred_by: user.referred_by || null,
        referrals_count: 0
      });
    } else {
      await User.updateOne(
        { mobile: { $regex: new RegExp(cleanMobile + '$') } },
        { 
          $set: { 
            name: user.name,
            username: user.name,
            referral_code: cleanMobile,
            ...(user.referred_by ? { referred_by: user.referred_by } : {})
          } 
        }
      );
    }
  } catch (e) {
    console.error('[MongoDB Register Error]', e);
  }

  const { saveDiskStore } = require('../store');
  saveDiskStore();
  console.log(`[Register] User ${user.name} (+91 ${user.mobile}) saved to Admin Directory.`);
  res.status(201).json({ success: true, message: 'User registered successfully', user });
};

// @desc    User Login (Auto-creates user if not registered yet)
// @route   POST /api/user/login
const loginUser = async (req, res) => {
  const { mobile, password } = req.body;

  if (!mobile) {
    return res.status(400).json({ message: 'Mobile number is required' });
  }

  const cleanMobile = mobile.replace(/[^0-9]/g, '').slice(-10);

  const { blockedMobiles } = require('../store');
  if (blockedMobiles.includes(cleanMobile)) {
    return res.status(403).json({ success: false, message: 'This mobile number has been permanently blocked. Contact support.' });
  }

  let user = registeredUsers.find(u => (u.mobile || '').replace(/[^0-9]/g, '').slice(-10) === cleanMobile);

  if (!user) {
    // User not found — must go through signup flow (fill name, referral code)
    return res.json({ success: false, needsRegistration: true, message: 'Please complete registration first.' });
  } else {
    user.referral_code = cleanMobile;
  }

  res.json({ success: true, message: 'Login successful', user });
};

// @desc    Get user profile
// @route   GET /api/user/profile
const getUserProfile = async (req, res) => {
  const { mobile } = req.query;
  let targetUser = null;
  const cleanMob = (mobile || '').replace(/[^0-9]/g, '').slice(-10);
  const { blockedMobiles, deletedMobiles } = require('../store');

  if (cleanMob && cleanMob.length >= 10 && deletedMobiles && deletedMobiles.includes(cleanMob)) {
    return res.json({
      success: false,
      is_deleted: true,
      isDeleted: true,
      message: 'No Authentication',
      name: 'User', mobile: mobile || '', balance: 0.00, deposit_balance: 0.00, winning_balance: 0.00, bonus_balance: 0.00, commission_balance: 0.00, withdrawable_balance: 0.00, referral_code: cleanMob
    });
  }

  if (mobile && mobile.trim().length > 0) {
    const cleanMobile = mobile.replace(/[^0-9]/g, '').slice(-10);
    targetUser = registeredUsers.find(u => (u.mobile || '').replace(/[^0-9]/g, '').slice(-10) === cleanMobile);

    try {
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState === 1) {
        const User = require('../models/User');
        const dbUser = await User.findOne({ mobile: { $regex: new RegExp(cleanMobile + '$') } }).lean();
        if (dbUser) {
          if (!targetUser) {
            targetUser = {
              id: dbUser._id,
              name: dbUser.name || dbUser.username || `User ${cleanMobile.slice(-4)}`,
              mobile: cleanMobile,
              balance: dbUser.wallet_balance || 0.00,
              deposit_balance: dbUser.deposit_balance !== undefined ? dbUser.deposit_balance : (dbUser.wallet_balance || 0.00),
              winning_balance: dbUser.winning_balance !== undefined ? dbUser.winning_balance : 0.00,
              bonus_balance: dbUser.bonus_balance !== undefined ? dbUser.bonus_balance : 200.00,
              commission_balance: dbUser.commission_balance !== undefined ? dbUser.commission_balance : 0.00,
              is_khaiwal: dbUser.is_khaiwal === true || dbUser.referral_enabled === false || dbUser.referral_status === 'OFF',
              referral_enabled: dbUser.referral_enabled !== undefined ? dbUser.referral_enabled : true,
              referral_code: cleanMobile,
              status: 'Active'
            };
            registeredUsers.push(targetUser);
          } else {
            if (dbUser.name && dbUser.name !== 'User') targetUser.name = dbUser.name;
            if (dbUser.wallet_balance !== undefined) targetUser.balance = dbUser.wallet_balance;
            if (dbUser.deposit_balance !== undefined) targetUser.deposit_balance = dbUser.deposit_balance;
            if (dbUser.winning_balance !== undefined) targetUser.winning_balance = dbUser.winning_balance;
            if (dbUser.bonus_balance !== undefined) targetUser.bonus_balance = dbUser.bonus_balance;
            if (dbUser.commission_balance !== undefined) targetUser.commission_balance = dbUser.commission_balance;
            targetUser.is_khaiwal = dbUser.is_khaiwal === true || dbUser.referral_enabled === false || dbUser.referral_status === 'OFF';
            targetUser.referral_enabled = dbUser.referral_enabled !== undefined ? dbUser.referral_enabled : true;
            targetUser.referral_code = cleanMobile;
          }
        }
      }
    } catch (e) { }
  }

  if (targetUser) {
    if (targetUser.is_blocked || (cleanMob && blockedMobiles && blockedMobiles.includes(cleanMob))) {
      return res.status(403).json({
        success: false,
        is_blocked: true,
        isBlocked: true,
        error: 'NO_INTERNET',
        message: 'No Internet Connection'
      });
    }
    targetUser.referral_code = targetUser.mobile ? targetUser.mobile.slice(-10) : '7206561420';
    if (targetUser.bonus_balance === undefined) targetUser.bonus_balance = 200.00;
    if (targetUser.deposit_balance === undefined) targetUser.deposit_balance = targetUser.balance || 0.00;
    if (targetUser.winning_balance === undefined) targetUser.winning_balance = 0.00;
    if (targetUser.commission_balance === undefined) targetUser.commission_balance = 0.00;
    targetUser.withdrawable_balance = targetUser.winning_balance;
    targetUser.is_khaiwal = targetUser.is_khaiwal === true || targetUser.referral_enabled === false;

    return res.json(targetUser);
  }

  // If no user exists for this mobile number (e.g. account deleted), return No Authentication
  if (cleanMob && cleanMob.length >= 10) {
    return res.json({
      success: false,
      is_deleted: true,
      isDeleted: true,
      message: 'No Authentication',
      name: 'User', mobile: mobile || '', balance: 0.00, deposit_balance: 0.00, winning_balance: 0.00, bonus_balance: 0.00, commission_balance: 0.00, withdrawable_balance: 0.00, referral_code: cleanMob
    });
  }

  res.json({ name: 'User', mobile: mobile || '', balance: 0.00, deposit_balance: 0.00, winning_balance: 0.00, bonus_balance: 200.00, commission_balance: 0.00, withdrawable_balance: 0.00, referral_code: cleanMob });
};

// @desc    Get live wallet balance
// @route   GET /api/user/wallet/balance
const getWalletBalance = async (req, res) => {
  const { mobile } = req.query;
  let targetUser = null;
  const cleanMob = (mobile || '').replace(/[^0-9]/g, '').slice(-10);
  const { blockedMobiles, deletedMobiles } = require('../store');

  if (cleanMob && cleanMob.length >= 10 && deletedMobiles && deletedMobiles.includes(cleanMob)) {
    return res.json({
      success: false,
      is_deleted: true,
      isDeleted: true,
      message: 'No Authentication',
      balance: 0.00, deposit_balance: 0.00, winning_balance: 0.00, bonus_balance: 0.00, commission_balance: 0.00
    });
  }

  if (mobile && mobile.trim().length > 0) {
    const cleanMobile = mobile.replace(/[^0-9]/g, '').slice(-10);
    targetUser = registeredUsers.find(u => (u.mobile || '').replace(/[^0-9]/g, '').slice(-10) === cleanMobile);

    try {
      const User = require('../models/User');
      const dbUser = await User.findOne({ mobile: { $regex: new RegExp(cleanMobile + '$') } }).lean();
      if (dbUser) {
        if (!targetUser) {
          targetUser = {
            id: dbUser._id,
            name: dbUser.name || dbUser.username || `User ${cleanMobile.slice(-4)}`,
            mobile: cleanMobile,
            balance: dbUser.wallet_balance || 0.00,
            deposit_balance: dbUser.deposit_balance || 0.00,
            winning_balance: dbUser.winning_balance || 0.00,
            bonus_balance: dbUser.bonus_balance !== undefined ? dbUser.bonus_balance : 200.00,
            commission_balance: dbUser.commission_balance || 0.00,
            is_khaiwal: dbUser.is_khaiwal === true || dbUser.referral_enabled === false || dbUser.referral_status === 'OFF',
            referral_enabled: dbUser.referral_enabled !== undefined ? dbUser.referral_enabled : true,
            is_blocked: dbUser.is_blocked || false,
            status: dbUser.is_blocked ? 'Blocked' : 'Active'
          };
          registeredUsers.push(targetUser);
        } else {
          if (dbUser.name && dbUser.name !== 'User') targetUser.name = dbUser.name;
          if (dbUser.wallet_balance !== undefined) targetUser.balance = dbUser.wallet_balance;
          if (dbUser.deposit_balance !== undefined) targetUser.deposit_balance = dbUser.deposit_balance;
          if (dbUser.winning_balance !== undefined) targetUser.winning_balance = dbUser.winning_balance;
          if (dbUser.bonus_balance !== undefined) targetUser.bonus_balance = dbUser.bonus_balance;
          if (dbUser.commission_balance !== undefined) targetUser.commission_balance = dbUser.commission_balance;
          if (dbUser.is_blocked !== undefined) targetUser.is_blocked = dbUser.is_blocked;
          targetUser.is_khaiwal = dbUser.is_khaiwal === true || dbUser.referral_enabled === false || dbUser.referral_status === 'OFF';
          targetUser.referral_enabled = dbUser.referral_enabled !== undefined ? dbUser.referral_enabled : true;
        }
      }
    } catch (e) { }
  }

  if (targetUser && (targetUser.is_blocked || (cleanMob && blockedMobiles && blockedMobiles.includes(cleanMob)))) {
    return res.json({
      success: false,
      is_blocked: true,
      isBlocked: true,
      error: 'NO_INTERNET',
      message: 'No Internet Connection',
      balance: 0.00, deposit_balance: 0.00, winning_balance: 0.00, bonus_balance: 0.00, commission_balance: 0.00
    });
  }

  if (!targetUser && cleanMob && cleanMob.length >= 10) {
    return res.json({
      success: false,
      is_deleted: true,
      isDeleted: true,
      message: 'No Authentication',
      balance: 0.00, deposit_balance: 0.00, winning_balance: 0.00, bonus_balance: 0.00, commission_balance: 0.00
    });
  }

  if (targetUser) {
    if (targetUser.winning_balance !== undefined && targetUser.winning_balance < 0) targetUser.winning_balance = 0.00;
    if (targetUser.deposit_balance !== undefined && targetUser.deposit_balance < 0) targetUser.deposit_balance = 0.00;
    if (targetUser.commission_balance !== undefined && targetUser.commission_balance < 0) targetUser.commission_balance = 0.00;
    if (targetUser.bonus_balance !== undefined && targetUser.bonus_balance < 0) targetUser.bonus_balance = 0.00;
    targetUser.balance = parseFloat(((targetUser.deposit_balance || 0) + (targetUser.winning_balance || 0)).toFixed(2));
    
    // Sync sanitized non-negative balances to MongoDB
    try {
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState === 1) {
        const User = require('../models/User');
        User.updateOne(
          { mobile: targetUser.mobile.replace(/[^0-9]/g, '').slice(-10) },
          { $set: { deposit_balance: targetUser.deposit_balance, winning_balance: targetUser.winning_balance, wallet_balance: targetUser.balance } }
        ).catch(() => {});
      }
    } catch (e) {}
  }

  const currentBal = targetUser ? (targetUser.balance || 0.00) : 0.00;
  const currentName = targetUser ? targetUser.name : null;

  const accNo = targetUser ? (targetUser.account_number || targetUser.accountNumber || null) : null;
  const accName = targetUser ? (targetUser.account_holder_name || targetUser.account_name || targetUser.accountName || targetUser.name || null) : null;
  const ifsc = targetUser ? (targetUser.ifsc_code || targetUser.ifscCode || null) : null;
  const bName = targetUser ? (targetUser.bank_name || targetUser.bankName || null) : null;
  const upi = targetUser ? (targetUser.upi_id || targetUser.upiId || null) : null;

  const maskedAcc = accNo && accNo.length >= 4 ? `•••• •••• ${accNo.slice(-4)}` : null;

  const bankDetailsObj = (accNo && ifsc && accName) ? {
    account_holder_name: accName,
    account_number: accNo,
    ifsc_code: ifsc,
    bank_name: bName || 'Bank Account',
    upi_id: upi,
    masked_account_number: maskedAcc,
    is_saved: true
  } : null;

  res.json({
    success: true,
    is_blocked: false,
    is_deleted: false,
    balance: currentBal,
    deposit_balance: targetUser ? (targetUser.deposit_balance || 0.00) : 0.00,
    winning_balance: targetUser ? (targetUser.winning_balance || 0.00) : 0.00,
    bonus_balance: targetUser ? (targetUser.bonus_balance !== undefined ? targetUser.bonus_balance : 200.00) : 200.00,
    commission_balance: targetUser ? (targetUser.commission_balance || 0.00) : 0.00,
    withdrawable_balance: targetUser ? (targetUser.winning_balance || 0.00) : 0.00,
    is_khaiwal: targetUser ? (targetUser.is_khaiwal === true || targetUser.referral_enabled === false) : false,
    referral_enabled: targetUser ? (targetUser.referral_enabled !== undefined ? targetUser.referral_enabled : true) : true,
    name: currentName,
    bank_details: bankDetailsObj,
    has_saved_bank_details: !!bankDetailsObj
  });
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
      targetUser = registeredUsers.find(u => (u.mobile || '').replace(/[^0-9]/g, '').slice(-10) === cleanMobile);
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
          { mobile: { $regex: new RegExp(cleanMobile + '$') } },
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

function formatISTDateTime(d, fallbackTs) {
  let ts = 0;
  if (typeof d === 'number' && d > 10000000000) ts = d;
  else if (typeof d === 'number' && d > 0) ts = d * 1000;
  else if (typeof d === 'string' && /^[0-9a-fA-F]{24}$/.test(d)) ts = parseInt(d.substring(0, 8), 16) * 1000;
  else if (d && !isNaN(new Date(d).getTime())) ts = new Date(d).getTime();
  else if (fallbackTs && fallbackTs > 10000000000) ts = fallbackTs;

  if (!ts || ts <= 10000000000) {
    return 'N/A';
  }

  try {
    const dt = new Date(ts);
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(dt.getTime() + istOffsetMs);
    const day = String(istDate.getUTCDate()).padStart(2, '0');
    const month = String(istDate.getUTCMonth() + 1).padStart(2, '0');
    const year = istDate.getUTCFullYear();
    let hours = istDate.getUTCHours();
    const minutes = String(istDate.getUTCMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    const hrStr = String(hours).padStart(2, '0');
    return `${day}/${month}/${year} ${hrStr}:${minutes} ${ampm}`;
  } catch (e) {
    return 'N/A';
  }
}

// @desc    Get transaction history
// @route   GET /api/user/wallet/transactions
const getTransactions = async (req, res) => {
  try {
    const { mobile } = req.query;
    const cleanMobile = (mobile || '').replace(/[^0-9]/g, '').slice(-10);
    if (!cleanMobile || cleanMobile.length < 10) return res.json([]);

    const targetUser = registeredUsers.find(u => (u.mobile || u.phone || '').replace(/[^0-9]/g, '').slice(-10) === cleanMobile);
    const targetUserId = targetUser ? String(targetUser.id || targetUser._id || '') : '';

    const matchesUser = (item) => {
      if (!item) return false;
      
      // 1. Exact phone / mobile match (10 digits)
      const rawPhone = String(item.mobile || item.phone || item.userPhone || '').replace(/[^0-9]/g, '');
      if (rawPhone.length >= 10 && rawPhone.slice(-10) === cleanMobile) return true;

      // 2. Embedded phone in user string e.g. "Karan (9876543210)"
      const userField = String(item.user || item.username || item.userName || '');
      const userPhoneDigits = userField.replace(/[^0-9]/g, '');
      if (userPhoneDigits.length >= 10 && userPhoneDigits.slice(-10) === cleanMobile) return true;

      // 3. Exact userId match (if present and user is known)
      if (targetUserId) {
        const itemUserId = String(item.userId || item.user_id || '');
        if (itemUserId && itemUserId === targetUserId) return true;
      }

      return false;
    };

    const txns = [];

    const getEpoch = (obj) => {
      if (!obj) return 0;
      if (obj.timestamp && typeof obj.timestamp === 'number' && obj.timestamp > 100000000000) return obj.timestamp;
      if (obj.created_at) {
        const t = new Date(obj.created_at).getTime();
        if (!isNaN(t) && t > 100000000000) return t;
      }
      if (obj.createdAt) {
        const t = new Date(obj.createdAt).getTime();
        if (!isNaN(t) && t > 100000000000) return t;
      }
      if (obj.date) {
        const t = new Date(obj.date).getTime();
        if (!isNaN(t) && t > 100000000000) return t;
      }
      const rawId = String(obj._id || obj.id || '');
      const match = rawId.match(/\d{12,14}/);
      if (match) {
        const num = parseInt(match[0]);
        if (!isNaN(num) && num > 100000000000) return num;
      }
      // MongoDB Hex ID timestamp extraction
      if (/^[0-9a-fA-F]{24}$/.test(rawId)) {
        const hexTimestamp = parseInt(rawId.substring(0, 8), 16) * 1000;
        if (!isNaN(hexTimestamp) && hexTimestamp > 100000000000) return hexTimestamp;
      }
      return 0;
    };

    // 1. Deposits (Deduplicated with Approved Priority)
    const depositMap = new Map();
    memoryDeposits.filter(matchesUser).forEach((d) => {
      const ep = getEpoch(d);
      const rawStatus = (d.status || 'Pending').toUpperCase();
      const utrVal = (d.utr && d.utr !== 'N/A') ? d.utr : (d.utr_number && d.utr_number !== 'N/A' ? d.utr_number : (d.client_txn_id || ''));
      const timeBucket = Math.floor(ep / 300000); // 5-minute time window bucket
      const key = utrVal || `${d.amount}_${timeBucket}`;
      
      const existing = depositMap.get(key);
      if (!existing) {
        depositMap.set(key, {
          id: String(d._id || d.id || `dep_${ep}`),
          type: 'DEPOSIT',
          title: 'Cash Deposited',
          subtitle: d.method || d.payment_method || 'EKQR Automatic UPI',
          amount: parseFloat(d.amount) || 0,
          isCredit: true,
          status: rawStatus,
          date: formatISTDateTime(d.created_at || d.createdAt || d.timestamp || ep, ep),
          timestamp: ep
        });
      } else {
        if (rawStatus === 'APPROVED' && existing.status !== 'APPROVED') {
          depositMap.set(key, {
            id: String(d._id || d.id || `dep_${ep}`),
            type: 'DEPOSIT',
            title: 'Cash Deposited',
            subtitle: d.method || d.payment_method || 'EKQR Automatic UPI',
            amount: parseFloat(d.amount) || 0,
            isCredit: true,
            status: 'APPROVED',
            date: formatISTDateTime(d.created_at || d.createdAt || d.timestamp || ep, ep),
            timestamp: Math.max(ep, existing.timestamp)
          });
        }
      }
    });

    depositMap.forEach(dTx => txns.push(dTx));

    // 2. Withdrawals
    memoryWithdrawals.filter(matchesUser).forEach((w, idx) => {
      const ep = getEpoch(w);
      const rawSt = (w.status || 'Pending').toUpperCase();
      const isRefunded = rawSt === 'REJECTED' || rawSt === 'REFUNDED';
      const displayStatus = isRefunded ? 'REFUNDED' : rawSt;
      txns.push({
        id: String(w._id || w.id || `wth_${ep}_${idx}`),
        type: 'WITHDRAW',
        title: 'Withdrawal',
        subtitle: w.bank_name || w.bankName || w.method || 'Bank / UPI',
        amount: parseFloat(w.amount) || 0,
        isCredit: isRefunded,
        status: displayStatus,
        date: formatISTDateTime(w.created_at || w.createdAt || w.timestamp || ep, ep),
        timestamp: ep
      });
    });

    // 3. Bets (placed & results) - Deduplicate identical bet records
    const userBets = [];
    const seenBetKeys = new Set();
    memoryBets.filter(matchesUser).forEach((b) => {
      const cleanMob = String(b.user || b.mobile || '').replace(/[^0-9]/g, '').slice(-10);
      const num = b.number !== undefined ? b.number : '';
      const amt = parseFloat(b.bet_amount || b.amount || 0);
      const game = b.game_name || '';
      const bTypeStr = String(b.bet_type || '');
      const ep = getEpoch(b);
      const timeBucket = Math.floor(ep / 15000); // 15-second window bucket
      
      const key = `${cleanMob}_${game}_${bTypeStr}_${num}_${amt}_${timeBucket}`;
      const idKey = String(b._id || b.id || '');
      if ((idKey && seenBetKeys.has(idKey)) || seenBetKeys.has(key)) {
        return;
      }
      if (idKey) seenBetKeys.add(idKey);
      seenBetKeys.add(key);
      userBets.push(b);
    });

    userBets.forEach((b, idx) => {
      const status = (b.status || 'pending').toLowerCase();
      const winAmt = parseFloat(b.win_amount || b.winAmount || 0);
      const ep = getEpoch(b);
      const bTypeStr = (b.bet_type || '').toUpperCase();
      const isHaroof = bTypeStr.includes('HAR') || bTypeStr.includes('ANDER') || bTypeStr.includes('ANDAR') || bTypeStr.includes('BAHAR');
      const formattedNum = isHaroof ? String(b.number !== undefined ? b.number : 0) : String(b.number || 0).padStart(2, '0');
      const displayBetType = isHaroof ? (bTypeStr.includes('BAHAR') ? 'Haroof Bahar' : 'Haroof Ander') : (b.bet_type || 'Jodi');
      
      // Bet placed (debit)
      txns.push({
        id: String(b._id || b.id || `bet_${ep}_${idx}`),
        type: 'BET',
        title: `Bet Placed - ${b.game_name || 'Game'}`,
        subtitle: `Number: ${formattedNum} • ${displayBetType}`,
        amount: parseFloat(b.bet_amount || b.amount) || 0,
        isCredit: false,
        status: status === 'pending' ? 'PENDING' : (status === 'won' ? 'WON' : 'LOST'),
        date: formatISTDateTime(b.created_at || b.createdAt || b.timestamp || ep, ep),
        timestamp: ep
      });

      // Winning credit (if won)
      if (status === 'won' && winAmt > 0) {
        txns.push({
          id: String((b._id || b.id || `win_${ep}`) + '_win'),
          type: 'WINNING',
          title: `Winning - ${b.game_name || 'Game'}`,
          subtitle: `Number: ${formattedNum} won! 🎉`,
          amount: winAmt,
          isCredit: true,
          status: 'CREDITED',
          date: formatISTDateTime(b.created_at || b.createdAt || b.timestamp || ep, ep),
          timestamp: ep + 100
        });
      }
    });

    // 4. Joining Bonus (always placed at user registration time)
    let userSignupTime = 0;
    if (targetUser && targetUser.createdAt) {
      const st = new Date(targetUser.createdAt).getTime();
      if (!isNaN(st)) userSignupTime = st;
    }
    txns.push({
      id: `bonus_signup_${cleanMobile}`,
      type: 'BONUS',
      title: 'Joining Bonus',
      subtitle: 'Welcome Signup Reward',
      amount: 200,
      isCredit: true,
      status: 'CREDITED',
      date: formatISTDateTime(targetUser && (targetUser.createdAt || targetUser._id), userSignupTime || 1),
      timestamp: userSignupTime || 1
    });

    // Sort by timestamp descending (newest on top)
    txns.sort((a, b) => b.timestamp - a.timestamp);

    res.json(txns);
  } catch (e) {
    res.json([]);
  }
};

// @desc    Submit deposit request
// @desc    Submit deposit request
// @route   POST /api/user/deposit OR /api/user/deposit/request
const submitDeposit = async (req, res) => {
  const { user, mobile, amount, method, utr } = req.body;

  const cleanMobile = (mobile || '').replace(/[^0-9]/g, '').slice(-10);
  let targetUser = registeredUsers.find(u => (u.mobile || '').replace(/[^0-9]/g, '').slice(-10) === cleanMobile);

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
  const { 
    amount, 
    mobile, 
    method, 
    details, 
    holder_name, 
    account_number, 
    accountNumber, 
    ifsc_code, 
    ifsc, 
    ifscCode, 
    bank_name, 
    bankName, 
    upi_id, 
    upiId 
  } = req.body;
  const numAmt = parseFloat(amount);

  if (!numAmt || numAmt < 200) {
    return res.status(400).json({ success: false, message: 'Minimum withdrawal amount is ₹200' });
  }

  const cleanMobile = (mobile || '').replace(/[^0-9]/g, '').slice(-10);
  let targetUser = registeredUsers.find(u => (u.mobile || '').replace(/[^0-9]/g, '').slice(-10) === cleanMobile);

  const { memoryWithdrawals } = require('../store');
  const now = Date.now();
  const duplicateReq = memoryWithdrawals.find(w => {
    const wMob = String(w.mobile || w.phone || w.user || '').replace(/[^0-9]/g, '').slice(-10);
    const wAmt = parseFloat(w.amount || 0);
    const wTime = w.timestamp || (w.createdAt ? new Date(w.createdAt).getTime() : 0);
    return wMob === cleanMobile && (w.status === 'Pending' || w.status === 'pending' || (wTime > 0 && now - wTime < 60000));
  });

  if (duplicateReq) {
    return res.status(400).json({ 
      success: false, 
      message: 'A withdrawal request is already pending or was submitted recently. Please wait before requesting again.' 
    });
  }

  const withdrawable = targetUser ? parseFloat(((targetUser.deposit_balance || 0) + (targetUser.winning_balance || 0)).toFixed(2)) : 0.00;

  if (numAmt > withdrawable) {
    return res.status(400).json({ 
      success: false, 
      message: `Insufficient balance. Withdrawable balance: ₹${withdrawable.toFixed(2)}` 
    });
  }

  // Deduct withdrawal amount from user balances (winning first, then deposit)
  if (targetUser) {
    let remaining = numAmt;
    const winBal = targetUser.winning_balance || 0;
    if (remaining <= winBal) {
      targetUser.winning_balance = parseFloat((winBal - remaining).toFixed(2));
    } else {
      targetUser.winning_balance = 0;
      remaining = parseFloat((remaining - winBal).toFixed(2));
      targetUser.deposit_balance = parseFloat(((targetUser.deposit_balance || 0) - remaining).toFixed(2));
    }
    targetUser.balance = parseFloat(((targetUser.deposit_balance || 0) + targetUser.winning_balance).toFixed(2));
    userWalletStore.balance = targetUser.balance;

    // Sync to MongoDB Atlas
    try {
      const User = require('../models/User');
      User.updateOne(
        { mobile: targetUser.mobile }, 
        { $set: { winning_balance: targetUser.winning_balance, wallet_balance: targetUser.balance } }
      ).catch(e => console.error('[MongoDB Withdraw Sync Error]', e));
    } catch (e) {}
  }

  const finalIfsc = ifsc_code || ifsc || ifscCode || (targetUser ? targetUser.ifsc_code : null) || 'N/A';
  const finalAccNo = account_number || accountNumber || details || (targetUser ? targetUser.account_number : null) || 'N/A';
  const finalBankName = bank_name || bankName || (targetUser ? targetUser.bank_name : null) || (finalAccNo !== 'N/A' ? 'Bank Transfer' : 'UPI Transfer');
  const finalUpi = upi_id || upiId || (targetUser ? targetUser.upi_id : null) || (method === 'UPI' ? details : 'N/A');

  const newWithdrawal = {
    id: `wth_${Date.now()}`,
    _id: `wth_${Date.now()}`,
    user: targetUser ? targetUser.mobile : (cleanMobile || '1234567890'),
    mobile: targetUser ? targetUser.mobile : (cleanMobile || '1234567890'),
    phone: targetUser ? targetUser.mobile : (cleanMobile || '1234567890'),
    name: holder_name || (targetUser ? targetUser.name : 'User'),
    account_name: holder_name || (targetUser ? targetUser.name : 'User'),
    amount: numAmt,
    status: 'Pending',
    balanceDeducted: true,
    payment_method: method || 'Bank Transfer',
    payment_details: details || finalAccNo,
    account_number: finalAccNo,
    ifsc_code: finalIfsc,
    upi_id: finalUpi,
    bank_name: finalBankName,
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
        account_details: finalAccNo,
        ifsc_code: finalIfsc,
        bank_name: finalBankName,
        upi_id: finalUpi,
        status: 'pending'
      });
    }
  } catch (e) {
    console.error('[MongoDB WithdrawalRequest Create Error]', e);
  }

  const { saveDiskStore } = require('../store');
  saveDiskStore();

  res.json({
    success: true,
    message: `Withdrawal request of ₹${numAmt} submitted successfully! Settle within 15 minutes.`,
    newBalance: targetUser ? targetUser.balance : 0,
    withdrawal: newWithdrawal
  });
};

// @desc    Save/Update bank details for user
// @route   POST /api/user/bank-details/save
const saveBankDetails = async (req, res) => {
  const { mobile, account_name, account_number, ifsc_code, bank_name, upi_id } = req.body;
  const cleanMobile = (mobile || '').replace(/[^0-9]/g, '').slice(-10);
  let targetUser = registeredUsers.find(u => (u.mobile || '').replace(/[^0-9]/g, '').slice(-10) === cleanMobile);

  const accName = (account_name || '').trim();
  const accNum = (account_number || '').trim();
  const ifsc = (ifsc_code || '').trim().toUpperCase();

  if (!accName) {
    return res.status(400).json({ success: false, message: 'Account Holder Name is required' });
  }
  if (!accNum || accNum.length < 8) {
    return res.status(400).json({ success: false, message: 'Please enter a valid Bank Account Number (minimum 8 digits)' });
  }
  if (!ifsc || ifsc.length !== 11) {
    return res.status(400).json({ success: false, message: 'Please enter a valid 11-character IFSC Code' });
  }

  if (targetUser) {
    targetUser.account_holder_name = accName;
    targetUser.account_name = accName;
    targetUser.account_number = accNum;
    targetUser.ifsc_code = ifsc;
    targetUser.bank_name = bank_name || 'Bank Account';
    if (upi_id) targetUser.upi_id = upi_id;
  }

  const { saveDiskStore } = require('../store');
  saveDiskStore();

  // Sync to MongoDB Atlas
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1 && cleanMobile) {
      const User = require('../models/User');
      await User.findOneAndUpdate(
        { mobile: { $regex: new RegExp(cleanMobile + '$') } },
        { 
          account_holder_name: accName, 
          account_number: accNum, 
          ifsc_code: ifsc, 
          bank_name: bank_name || 'Bank Account',
          ...(upi_id ? { upi_id } : {})
        },
        { upsert: true, new: true }
      ).catch(e => console.error('[MongoDB Bank Details Sync Error]', e));
    }
  } catch (e) {}

  const maskedAcc = `•••• •••• ${accNum.slice(-4)}`;
  const bankDetailsObj = {
    account_holder_name: accName,
    account_number: accNum,
    ifsc_code: ifsc,
    bank_name: bank_name || 'Bank Account',
    upi_id: upi_id || (targetUser ? targetUser.upi_id : null),
    masked_account_number: maskedAcc,
    is_saved: true
  };

  res.json({
    success: true,
    message: 'Bank details saved successfully.',
    bank_details: bankDetailsObj,
    has_saved_bank_details: true
  });
};

// @desc    Get saved bank details for user
// @route   GET /api/user/bank-details
const getBankDetails = async (req, res) => {
  const cleanMobile = (req.query.mobile || '').replace(/[^0-9]/g, '').slice(-10);
  let targetUser = registeredUsers.find(u => (u.mobile || '').replace(/[^0-9]/g, '').slice(-10) === cleanMobile);

  let accNo = targetUser ? (targetUser.account_number || targetUser.accountNumber || null) : null;
  let accName = targetUser ? (targetUser.account_holder_name || targetUser.account_name || targetUser.accountName || null) : null;
  let ifsc = targetUser ? (targetUser.ifsc_code || targetUser.ifscCode || null) : null;
  let bName = targetUser ? (targetUser.bank_name || targetUser.bankName || null) : null;
  let upi = targetUser ? (targetUser.upi_id || targetUser.upiId || null) : null;

  // Fallback 1: Search memoryWithdrawals for last recorded bank details of this mobile
  if ((!accNo || !ifsc || !accName) && Array.isArray(memoryWithdrawals) && cleanMobile) {
    const lastW = memoryWithdrawals.find(w => {
      const wMob = (w.mobile || w.phone || w.user || '').replace(/[^0-9]/g, '').slice(-10);
      const wAcc = w.account_number || w.accountNumber || w.account_details || w.payment_details;
      return wMob === cleanMobile && wAcc && String(wAcc).trim() !== '' && String(wAcc).trim() !== 'N/A';
    });
    if (lastW) {
      if (!accNo) accNo = lastW.account_number || lastW.accountNumber || lastW.account_details || lastW.payment_details;
      if (!accName) accName = lastW.account_name || lastW.name || lastW.holder_name;
      if (!ifsc) ifsc = lastW.ifsc_code || lastW.ifsc || lastW.ifscCode;
      if (!bName) bName = lastW.bank_name || lastW.bankName || 'Bank Account';
      if (!upi) upi = lastW.upi_id || lastW.upiId;

      if (targetUser && accNo) {
        targetUser.account_number = accNo;
        targetUser.account_holder_name = accName;
        targetUser.account_name = accName;
        targetUser.ifsc_code = ifsc;
        targetUser.bank_name = bName;
        if (upi) targetUser.upi_id = upi;
        const { saveDiskStore } = require('../store');
        saveDiskStore();
      }
    }
  }

  // Fallback 2: Query MongoDB Atlas User model
  if ((!accNo || !ifsc || !accName) && cleanMobile) {
    try {
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState === 1) {
        const User = require('../models/User');
        const dbUser = await User.findOne({ mobile: { $regex: new RegExp(cleanMobile + '$') } }).lean().catch(() => null);
        if (dbUser) {
          if (!accNo && dbUser.account_number) accNo = dbUser.account_number;
          if (!accName && (dbUser.account_holder_name || dbUser.name)) accName = dbUser.account_holder_name || dbUser.name;
          if (!ifsc && dbUser.ifsc_code) ifsc = dbUser.ifsc_code;
          if (!bName && dbUser.bank_name) bName = dbUser.bank_name;
          if (!upi && dbUser.upi_id) upi = dbUser.upi_id;

          if (targetUser && accNo) {
            targetUser.account_number = accNo;
            targetUser.account_holder_name = accName;
            targetUser.account_name = accName;
            targetUser.ifsc_code = ifsc;
            targetUser.bank_name = bName;
            if (upi) targetUser.upi_id = upi;
            const { saveDiskStore } = require('../store');
            saveDiskStore();
          }
        }
      }
    } catch (_) {}
  }

  if (accNo && String(accNo).trim() !== '' && String(accNo).trim() !== 'N/A') {
    const cleanNo = String(accNo).trim();
    const maskedAcc = cleanNo.length >= 4 ? `•••• •••• ${cleanNo.slice(-4)}` : cleanNo;
    return res.json({
      success: true,
      has_saved_bank_details: true,
      bank_details: {
        account_holder_name: accName || (targetUser ? targetUser.name : 'User'),
        account_number: cleanNo,
        ifsc_code: ifsc || 'N/A',
        bank_name: bName || 'Bank Account',
        upi_id: upi,
        masked_account_number: maskedAcc,
        is_saved: true
      }
    });
  }

  res.json({
    success: true,
    has_saved_bank_details: false,
    bank_details: null
  });
};

// @desc    Send SMS OTP via MSG91
// @route   POST /api/user/send-otp
const sendSmsOtp = async (req, res) => {
  const { mobile } = req.body;
  if (!mobile) {
    return res.status(400).json({ success: false, message: 'Mobile number is required' });
  }

  const cleanMobile = mobile.replace(/[^0-9]/g, '').slice(-10);
  if (cleanMobile.length < 10) {
    return res.status(400).json({ success: false, message: 'Valid 10-digit mobile number required' });
  }

  const result = await msg91.sendOtp(cleanMobile);
  if (result.success) {
    return res.json({
      success: true,
      message: result.message || `OTP sent successfully to +91 ${cleanMobile}`,
      mobile: cleanMobile,
      otp_length: 4
    });
  } else {
    return res.status(400).json({
      success: false,
      message: result.message || 'Failed to send OTP. Please try again.',
      details: result.details
    });
  }
};

// @desc    Verify SMS OTP via MSG91
// @route   POST /api/user/verify-otp
const verifySmsOtp = async (req, res) => {
  const { mobile, otp } = req.body;
  if (!mobile || !otp) {
    return res.status(400).json({ success: false, message: 'Mobile number and OTP code are required' });
  }

  const cleanMobile = mobile.replace(/[^0-9]/g, '').slice(-10);
  const cleanOtp = String(otp).trim();

  const verifyResult = await msg91.verifyOtp(cleanMobile, cleanOtp);

  if (verifyResult.success) {
    const { registeredUsers, deletedMobiles } = require('../store');
    if (cleanMobile && deletedMobiles && deletedMobiles.includes(cleanMobile)) {
      return res.status(403).json({ success: false, message: 'This account has been deleted. Please contact support.' });
    }
    // Ensure user is added to registeredUsers store / MongoDB
    let user = registeredUsers.find(u => (u.mobile || '').replace(/[^0-9]/g, '').slice(-10) === cleanMobile);
    if (!user) {
      user = {
        id: `usr_${Date.now()}`,
        name: req.body.name || `User ${cleanMobile.slice(-4)}`,
        mobile: cleanMobile,
        password: '123',
        balance: 0.00,
        deposit_balance: 0.00,
        winning_balance: 0.00,
        bonus_balance: 200.00,
        commission_balance: 0.00,
        is_khaiwal: false,
        referral_enabled: true,
        referral_status: 'ON',
        referral_code: cleanMobile,
        status: 'Active',
        createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      registeredUsers.push(user);
      const { khaiwalPlayersStore, khaiwalPlayerBetsStore } = require('../store');
      if (khaiwalPlayersStore && khaiwalPlayersStore[cleanMobile]) delete khaiwalPlayersStore[cleanMobile];
      if (khaiwalPlayerBetsStore && khaiwalPlayerBetsStore[cleanMobile]) delete khaiwalPlayerBetsStore[cleanMobile];
      console.log(`[OTP Verified] Registered new user to Admin Directory: ${user.name} (+91 ${user.mobile})`);

      try {
        const mongoose = require('mongoose');
        if (mongoose.connection.readyState === 1) {
          const User = require('../models/User');
          User.findOneAndUpdate(
            { mobile: cleanMobile },
            { $setOnInsert: { mobile: cleanMobile, username: user.name, name: user.name, wallet_balance: 0, bonus_balance: 200.00, deposit_balance: 0, winning_balance: 0, commission_balance: 0, is_khaiwal: false, referral_enabled: true, referral_status: 'ON', status: 'Active' } },
            { upsert: true, new: true }
          ).catch(e => console.error('[MongoDB Auto-Register Error]', e));
        }
      } catch (e) {}
    }
    return res.json({ success: true, message: 'OTP verified successfully', user });
  }

  return res.status(400).json({ success: false, message: verifyResult.message || 'Invalid OTP code! Please try again.' });
};

// @desc    Resend / Retry SMS OTP via MSG91
// @route   POST /api/user/resend-otp
const resendSmsOtp = async (req, res) => {
  const { mobile } = req.body;
  if (!mobile) {
    return res.status(400).json({ success: false, message: 'Mobile number is required' });
  }

  const cleanMobile = mobile.replace(/[^0-9]/g, '').slice(-10);
  const result = await msg91.retryOtp(cleanMobile);

  if (result.success) {
    return res.json({ success: true, message: 'OTP resent successfully' });
  } else {
    return res.status(400).json({ success: false, message: result.message || 'Failed to resend OTP' });
  }
};

// @desc    Check if a mobile number is already registered
// @route   GET /api/user/check
const checkUserExists = async (req, res) => {
  const { mobile } = req.query;
  if (!mobile) {
    return res.json({ exists: false });
  }

  const cleanMobile = mobile.replace(/[^0-9]/g, '').slice(-10);
  const { deletedMobiles } = require('../store');
  if (deletedMobiles && deletedMobiles.includes(cleanMobile)) {
    return res.json({ exists: false });
  }

  let user = registeredUsers.find(u => (u.mobile || '').replace(/[^0-9]/g, '').slice(-10) === cleanMobile);

  if (!user) {
    try {
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState === 1) {
        const User = require('../models/User');
        const dbUser = await User.findOne({ mobile: { $regex: new RegExp(cleanMobile + '$') } });
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
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  const { mobile, date } = req.query;
  if (!mobile) {
    return res.json({ referral_code: '', referralsCount: 0, totalCommission: 0, commissionBalance: 0, selectedDate: 'all', referredUsers: [], commissionsByDate: {} });
  }

  const { memoryBets, referralConfig } = require('../store');
  const cleanMobile = mobile.replace(/[^0-9]/g, '').slice(-10);
  let user = registeredUsers.find(u => (u.mobile || '').replace(/[^0-9]/g, '').slice(-10) === cleanMobile);

  let rawReferred = [];
  let dbCommissionTxns = [];

  try {
    const User = require('../models/User');
    const dbUser = await User.findOne({ mobile: { $regex: cleanMobile } }).lean();
    if (dbUser) {
      if (!user) user = dbUser;
      else {
        user.commission_balance = dbUser.commission_balance !== undefined ? dbUser.commission_balance : user.commission_balance;
        user.total_commission = dbUser.total_commission !== undefined ? dbUser.total_commission : user.total_commission;
      }
    }

    const dbReferred = await User.find({
      $or: [
        { referred_by: cleanMobile },
        { referred_by: `+91${cleanMobile}` },
        { referred_by: `REF${cleanMobile}` },
        { referred_by: { $regex: cleanMobile } }
      ]
    }).lean();

    if (dbReferred && dbReferred.length > 0) {
      rawReferred = dbReferred.map(r => ({
        id: String(r._id),
        name: r.name || r.username || `User ${r.mobile.slice(-4)}`,
        mobile: r.mobile,
        date: r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : 'Recently',
        createdDateKey: r.createdAt ? getISTDateStr(r.createdAt) : 'Today'
      }));
    }

    // Fetch actual historical commission transactions for this user (referral + self bet commission)
    const Transaction = require('../models/Transaction');
    dbCommissionTxns = await Transaction.find({
      mobile: { $regex: cleanMobile },
      type: { $regex: /COMMISSION|REFERRAL/i }
    }).lean();

  } catch (e) {
    console.error('[MongoDB Referral Search Error]', e);
  }

  // Merge any memory registered users
  const memoryReferred = registeredUsers
    .filter(u => u.referred_by && u.referred_by.replace(/[^0-9]/g, '').slice(-10) === cleanMobile)
    .map(r => ({
      id: String(r.id),
      name: r.name,
      mobile: r.mobile,
      date: r.createdDateKey || 'Recently',
      createdDateKey: r.createdDateKey || 'Today'
    }));

  for (let mem of memoryReferred) {
    const memClean = mem.mobile ? mem.mobile.replace(/[^0-9]/g, '').slice(-10) : '';
    if (memClean && !rawReferred.some(r => r.mobile && r.mobile.replace(/[^0-9]/g, '').slice(-10) === memClean)) {
      rawReferred.push(mem);
    }
  }

  const signupBonus = referralConfig.signupBonus !== undefined ? referralConfig.signupBonus : 50;
  const filterDateKey = (date && date !== 'all') ? date : null;

  // Build date-wise commission summary map using getISTDateStr for accurate IST date matching
  const commissionsByDate = {};
  for (let tx of dbCommissionTxns) {
    const dKey = tx.date_key || (tx.createdAt ? getISTDateStr(tx.createdAt) : 'Today');
    commissionsByDate[dKey] = parseFloat(((commissionsByDate[dKey] || 0) + (parseFloat(tx.amount) || 0)).toFixed(2));
  }

  // Also inspect memory bets stamped with referral or self commission
  for (let b of memoryBets) {
    const isRef = b.referrer_mobile && b.referrer_mobile.replace(/[^0-9]/g, '').slice(-10) === cleanMobile;
    const betUserClean = (b.user || '').replace(/[^0-9]/g, '').slice(-10);
    const isSelf = betUserClean === cleanMobile;
    const commAmt = parseFloat(b.referral_commission || b.self_commission || 0);

    if ((isRef || (isSelf && b.self_commission)) && commAmt > 0) {
      const dKey = b.createdDateKey || (b.created_at ? getISTDateStr(b.created_at) : getISTDateStr());
      commissionsByDate[dKey] = parseFloat(((commissionsByDate[dKey] || 0) + commAmt).toFixed(2));
    }
  }

  let grandTotalCommission = 0;
  const processedList = [];

  for (let ref of rawReferred) {
    const refCleanMob = ref.mobile ? ref.mobile.replace(/[^0-9]/g, '').slice(-10) : '';
    let friendBetCommission = 0;

    // 1. Calculate from recorded DB Commission transactions for this friend
    const friendTxns = dbCommissionTxns.filter(tx => {
      const fromMob = (tx.from_mobile || '').replace(/[^0-9]/g, '').slice(-10);
      const matchesFriend = fromMob === refCleanMob;
      if (!matchesFriend) return false;
      if (filterDateKey) {
        const txDateKey = tx.date_key || (tx.createdAt ? getISTDateStr(tx.createdAt) : '');
        return txDateKey === filterDateKey;
      }
      return true;
    });

    if (friendTxns.length > 0) {
      friendBetCommission += friendTxns.reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0);
    }

    // 2. Add from memory bets for this friend
    const userBets = memoryBets.filter(b => {
      const betUserClean = (b.user || '').replace(/[^0-9]/g, '').slice(-10);
      if (betUserClean !== refCleanMob) return false;
      if (filterDateKey) {
        const bDateKey = b.createdDateKey || (b.created_at ? getISTDateStr(b.created_at) : '');
        return bDateKey === filterDateKey;
      }
      return true;
    });

    if (userBets.length > 0) {
      friendBetCommission += userBets.reduce((sum, b) => {
        if (b.referral_commission) return sum + parseFloat(b.referral_commission);
        const rate = (b.commission_rate || referralConfig.commissionPercentage || 4) / 100;
        return sum + (parseFloat(b.bet_amount || 0) * rate);
      }, 0);
    }

    friendBetCommission = parseFloat(friendBetCommission.toFixed(2));
    grandTotalCommission += friendBetCommission;

    processedList.push({
      id: ref.id,
      name: ref.name,
      mobile: ref.mobile ? `${ref.mobile.slice(0, 2)}****${ref.mobile.slice(-4)}` : '****',
      date: ref.date,
      bonus: signupBonus,
      betCommission: friendBetCommission,
      totalEarned: friendBetCommission
    });
  }

  // Calculate total commission for the active filter
  let displayCommission = grandTotalCommission;
  if (filterDateKey) {
    const dateTxnsSum = dbCommissionTxns
      .filter(tx => (tx.date_key || (tx.createdAt ? getISTDateStr(tx.createdAt) : '')) === filterDateKey)
      .reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0);

    displayCommission = parseFloat((commissionsByDate[filterDateKey] || dateTxnsSum || grandTotalCommission).toFixed(2));
  } else {
    const allTimeTxnsSum = Object.values(commissionsByDate).reduce((sum, val) => sum + (parseFloat(val) || 0), 0);
    const liveCommBal = user ? parseFloat((user.commission_balance !== undefined ? user.commission_balance : (user.total_commission || 0)).toFixed(2)) : 0;
    displayCommission = parseFloat(Math.max(grandTotalCommission, allTimeTxnsSum, liveCommBal).toFixed(2));
  }

  const refCode = user ? (user.referral_code || cleanMobile).replace(/^REF/i, '') : cleanMobile;
  const liveCommissionBalance = user ? parseFloat((user.commission_balance || 0).toFixed(2)) : 0.00;

  res.json({
    referral_code: refCode,
    referralsCount: processedList.length,
    totalCommission: parseFloat(displayCommission.toFixed(2)),
    commissionBalance: liveCommissionBalance,
    selectedDate: filterDateKey || 'all',
    referredUsers: processedList,
    commissionsByDate
  });
};

// @desc    Apply a referral code to an existing account that has no referrer
// @route   POST /api/user/apply-referral
const applyReferralCode = async (req, res) => {
  const { mobile, referral_code } = req.body;
  if (!mobile || !referral_code || !referral_code.trim()) {
    return res.status(400).json({ success: false, message: 'Mobile and Referral Code are required' });
  }

  const cleanMobile = mobile.replace(/[^0-9]/g, '').slice(-10);
  const cleanRef = referral_code.trim().toUpperCase().replace(/^REF/i, '').replace(/[^0-9]/g, '');
  const cleanRefMobile = cleanRef.slice(-10);

  if (cleanMobile === cleanRefMobile) {
    return res.status(400).json({ success: false, message: 'You cannot refer yourself' });
  }

  let user = registeredUsers.find(u => (u.mobile || '').replace(/[^0-9]/g, '').slice(-10) === cleanMobile);

  try {
    const User = require('../models/User');
    const dbUser = await User.findOne({ mobile: { $regex: cleanMobile } });
    if (dbUser && dbUser.referred_by) {
      return res.status(400).json({ success: false, message: 'Referral code already applied to this account' });
    }
  } catch (e) {}

  if (user && user.referred_by) {
    return res.status(400).json({ success: false, message: 'Referral code already applied to this account' });
  }

  let referrerMobile = null;
  let referrerName = 'Referrer';

  let referrer = registeredUsers.find(u => 
    u.mobile.slice(-10) === cleanRefMobile || 
    (u.referral_code && u.referral_code.replace(/^REF/i, '') === cleanRefMobile)
  );

  if (referrer && referrer.mobile.slice(-10) !== cleanMobile) {
    referrerMobile = referrer.mobile.slice(-10);
    referrerName = referrer.name;
    referrer.referralsCount = (referrer.referralsCount || 0) + 1;
  } else {
    try {
      const User = require('../models/User');
      const dbRef = await User.findOne({
        $or: [
          { mobile: cleanRefMobile },
          { mobile: `+91${cleanRefMobile}` },
          { referral_code: cleanRefMobile },
          { referral_code: `REF${cleanRefMobile}` }
        ]
      });

      if (dbRef && dbRef.mobile.slice(-10) !== cleanMobile) {
        referrerMobile = dbRef.mobile.slice(-10);
        referrerName = dbRef.name || dbRef.username || 'Referrer';
        await User.updateOne(
          { mobile: dbRef.mobile },
          { $inc: { referrals_count: 1 } }
        );
      }
    } catch (e) {}
  }

  if (!referrerMobile) {
    return res.status(404).json({ success: false, message: 'Invalid Referral Code. Referrer not found.' });
  }

  if (user) {
    user.referred_by = referrerMobile;
  }

  try {
    const User = require('../models/User');
    await User.updateOne(
      { mobile: { $regex: new RegExp(cleanMobile + '$') } },
      { $set: { referred_by: referrerMobile } }
    );
  } catch (e) {}

  const { saveDiskStore } = require('../store');
  saveDiskStore();

  return res.json({
    success: true,
    message: `🎉 Referral Code applied successfully! You are now linked to ${referrerName}.`,
    referred_by: referrerMobile
  });
};

// @desc    Transfer commission wallet balance to main (deposit) wallet
// @route   POST /api/user/commission/transfer
const transferCommissionToWallet = async (req, res) => {
  const { mobile } = req.body;
  if (!mobile) return res.status(400).json({ success: false, message: 'Mobile is required' });

  const cleanMobile = mobile.replace(/[^0-9]/g, '').slice(-10);
  let targetUser = registeredUsers.find(u => (u.mobile || '').replace(/[^0-9]/g, '').slice(-10) === cleanMobile);

  if (!targetUser) return res.status(404).json({ success: false, message: 'User not found' });

  // Sync from DB if available
  try {
    const User = require('../models/User');
    const dbUser = await User.findOne({ mobile: { $regex: cleanMobile + '$' } });
    if (dbUser) {
      if (dbUser.commission_balance !== undefined) targetUser.commission_balance = dbUser.commission_balance;
      if (dbUser.deposit_balance !== undefined) targetUser.deposit_balance = dbUser.deposit_balance;
    }
  } catch (e) {}

  const commissionAmt = parseFloat((targetUser.commission_balance || 0).toFixed(2));
  if (commissionAmt <= 0) {
    return res.status(400).json({ success: false, message: 'No commission balance to transfer' });
  }

  // Transfer: zero out commission, add to deposit_balance (main wallet)
  targetUser.commission_balance = 0;
  targetUser.deposit_balance = parseFloat(((targetUser.deposit_balance || 0) + commissionAmt).toFixed(2));
  targetUser.balance = parseFloat(((targetUser.deposit_balance || 0) + (targetUser.winning_balance || 0)).toFixed(2));

  // Save to disk
  saveDiskStore();

  // Sync to MongoDB
  try {
    const User = require('../models/User');
    User.updateOne(
      { mobile: targetUser.mobile },
      { $set: { commission_balance: 0, deposit_balance: targetUser.deposit_balance, wallet_balance: targetUser.balance } }
    ).catch(e => console.error('[Commission Transfer DB Error]', e));
  } catch (e) {}

  return res.json({
    success: true,
    message: `₹${commissionAmt.toFixed(2)} transferred to main wallet successfully!`,
    transferred: commissionAmt,
    newBalance: targetUser.balance,
    newDepositBalance: targetUser.deposit_balance,
    newCommissionBalance: 0
  });
};

// @route   GET /api/user/khaiwal/players
const getKhaiwalPlayers = async (req, res) => {
  const mobile = (req.query.mobile || req.body.mobile || '7206561420').replace(/[^0-9]/g, '').slice(-10);
  const { khaiwalPlayersStore } = require('../store');
  const players = khaiwalPlayersStore[mobile] || [];
  return res.json({ success: true, players });
};

// @route   POST /api/user/khaiwal/players
const addKhaiwalPlayer = async (req, res) => {
  const { mobile, name, jodi_rate, crossing_rate, haroof_rate, commission_pct } = req.body;
  if (!name) return res.status(400).json({ success: false, message: 'Player name is required' });

  const cleanMobile = (mobile || '7206561420').replace(/[^0-9]/g, '').slice(-10);
  const { khaiwalPlayersStore, saveDiskStore } = require('../store');

  if (!khaiwalPlayersStore[cleanMobile]) {
    khaiwalPlayersStore[cleanMobile] = [];
  }

  const jRate = (jodi_rate !== undefined && jodi_rate !== null && !isNaN(parseFloat(jodi_rate))) ? parseFloat(jodi_rate) : 95;
  const cRate = (crossing_rate !== undefined && crossing_rate !== null && !isNaN(parseFloat(crossing_rate))) ? parseFloat(crossing_rate) : 95;
  const hRate = (haroof_rate !== undefined && haroof_rate !== null && !isNaN(parseFloat(haroof_rate))) ? parseFloat(haroof_rate) : 9.5;
  const commPct = (commission_pct !== undefined && commission_pct !== null && !isNaN(parseFloat(commission_pct))) ? parseFloat(commission_pct) : 5;

  const newPlayer = {
    id: 'kp_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    name: name.trim(),
    jodi_rate: jRate,
    crossing_rate: cRate,
    haroof_rate: hRate,
    commission_pct: commPct,
    createdAt: new Date().toISOString()
  };

  khaiwalPlayersStore[cleanMobile].push(newPlayer);
  saveDiskStore();

  return res.json({ success: true, message: 'Player added successfully!', player: newPlayer });
};

// @route   POST /api/user/khaiwal/players/update
const updateKhaiwalPlayer = async (req, res) => {
  const { mobile, playerId, id, name, jodi_rate, crossing_rate, haroof_rate, commission_pct } = { ...req.params, ...req.body, ...req.query };
  const targetId = playerId || id;
  const cleanMobile = (mobile || '7206561420').replace(/[^0-9]/g, '').slice(-10);
  const { khaiwalPlayersStore, saveDiskStore } = require('../store');

  let player = null;
  const playerList = khaiwalPlayersStore[cleanMobile] || [];
  player = playerList.find(p => p.id === targetId);
  if (!player) {
    for (const k of Object.keys(khaiwalPlayersStore)) {
      player = (khaiwalPlayersStore[k] || []).find(p => p.id === targetId);
      if (player) break;
    }
  }

  if (!player) return res.status(404).json({ success: false, message: 'Player not found' });

  if (name && name.trim()) player.name = name.trim();
  if (jodi_rate !== undefined && jodi_rate !== null && !isNaN(parseFloat(jodi_rate))) player.jodi_rate = parseFloat(jodi_rate);
  if (crossing_rate !== undefined && crossing_rate !== null && !isNaN(parseFloat(crossing_rate))) player.crossing_rate = parseFloat(crossing_rate);
  if (haroof_rate !== undefined && haroof_rate !== null && !isNaN(parseFloat(haroof_rate))) player.haroof_rate = parseFloat(haroof_rate);
  if (commission_pct !== undefined && commission_pct !== null && !isNaN(parseFloat(commission_pct))) player.commission_pct = parseFloat(commission_pct);

  saveDiskStore();
  return res.json({ success: true, message: 'Player updated successfully!', player });
};

// @route   POST /api/user/khaiwal/players/delete
const deleteKhaiwalPlayer = async (req, res) => {
  const { mobile, playerId, id } = { ...req.params, ...req.body, ...req.query };
  const targetId = playerId || id;
  const { khaiwalPlayersStore, saveDiskStore } = require('../store');

  let removed = false;
  for (const k of Object.keys(khaiwalPlayersStore)) {
    const idx = (khaiwalPlayersStore[k] || []).findIndex(p => p.id === targetId);
    if (idx !== -1) {
      khaiwalPlayersStore[k].splice(idx, 1);
      removed = true;
    }
  }

  saveDiskStore();
  return res.json({ success: removed, message: removed ? 'Player deleted successfully!' : 'Player not found' });
};

// @route   POST /api/user/khaiwal/log-player-bet
const logKhaiwalPlayerBet = async (req, res) => {
  const { mobile, khaiwalPhone, userPhone, playerId, gameName, betCategory, bets, totalAmount } = req.body;
  const rawMob = mobile || khaiwalPhone || userPhone || req.query.mobile || '7206561420';
  const cleanMobile = rawMob.replace(/[^0-9]/g, '').slice(-10);
  const { khaiwalPlayersStore, khaiwalPlayerBetsStore, saveDiskStore } = require('../store');

  let players = khaiwalPlayersStore[cleanMobile] || [];
  let player = players.find(p => p.id === playerId);

  if (!player) {
    for (const key of Object.keys(khaiwalPlayersStore)) {
      const found = (khaiwalPlayersStore[key] || []).find(p => p.id === playerId);
      if (found) {
        player = found;
        break;
      }
    }
  }

  if (!khaiwalPlayerBetsStore[cleanMobile]) {
    khaiwalPlayerBetsStore[cleanMobile] = [];
  }

  const parsedBets = Array.isArray(bets) ? bets : [];
  const commPct = player ? (player.commission_pct !== undefined && player.commission_pct !== null ? parseFloat(player.commission_pct) : 0) : 0;
  const betsGrouped = {};
  parsedBets.forEach(b => {
    const rawType = String(b.betType || b.bet_type || b.type || betCategory || '').toLowerCase();
    const rawNum = String(b.number !== undefined ? b.number : (b.num !== undefined ? b.num : '')).toUpperCase();
    let c = 'Jodi';
    if (rawType.includes('crossing')) {
      c = 'Crossing';
    } else if (rawType.includes('haruf') || rawType.includes('haroof') || rawType.includes('ander') || rawType.includes('andar') || rawType.includes('bahar') || rawNum.startsWith('A') || rawNum.startsWith('B')) {
      c = 'Haruf';
    } else {
      c = 'Jodi';
    }

    if (!betsGrouped[c]) betsGrouped[c] = [];
    
    // Standardize bet object structure
    let stdType = b.betType || b.bet_type || b.type || c;
    if (String(stdType).toUpperCase() === 'HAROOF_ANDER' || (c === 'Haruf' && (rawType.includes('ander') || rawType.includes('andar') || rawNum.startsWith('A')))) {
      stdType = 'Haroof Ander';
    } else if (String(stdType).toUpperCase() === 'HAROOF_BAHAR' || (c === 'Haruf' && (rawType.includes('bahar') || rawNum.startsWith('B')))) {
      stdType = 'Haroof Bahar';
    } else if (c === 'Crossing' || String(stdType).toUpperCase() === 'CROSSING') {
      stdType = 'Crossing';
    } else if (c === 'Jodi') {
      stdType = 'Jodi';
    }

    const stdItem = {
      ...b,
      number: b.number !== undefined ? b.number : (b.num !== undefined ? b.num : ''),
      amount: parseFloat(b.amount !== undefined ? b.amount : (b.amt !== undefined ? b.amt : (b.bet_amount || 0))) || 0,
      betType: stdType,
      bet_type: stdType
    };

    betsGrouped[c].push(stdItem);
  });

  const createdEntries = [];
  const timeId = Date.now();

  for (const [categoryName, categoryBets] of Object.entries(betsGrouped)) {
    const groupAmt = categoryBets.reduce((sum, item) => sum + (parseFloat(item.amount || item.bet_amount || 0) || 0), 0);
    const groupMainWalletAmt = categoryBets.reduce((sum, item) => {
      const mAmt = item.wallet_deducted !== undefined ? parseFloat(item.wallet_deducted) : (item.mainWalletAmount !== undefined ? parseFloat(item.mainWalletAmount) : (item.bonusAmount !== undefined ? Math.max(0, (parseFloat(item.amount || item.bet_amount || 0) || 0) - (parseFloat(item.bonusAmount) || 0)) : (parseFloat(item.amount || item.bet_amount || 0) || 0)));
      return sum + (isNaN(mAmt) ? 0 : mAmt);
    }, 0);
    const groupComm = parseFloat(((groupMainWalletAmt * commPct) / 100).toFixed(2));

    const betEntry = {
      id: 'kpb_' + timeId + '_' + Math.floor(Math.random() * 10000),
      playerId: playerId || 'general',
      playerName: player ? player.name : 'Player',
      gameName: gameName || 'Gali',
      category: categoryName,
      bets: categoryBets,
      totalAmount: groupAmt,
      mainWalletAmount: groupMainWalletAmt,
      commission: groupComm,
      playerRates: {
        jodi_rate: player ? player.jodi_rate : 95,
        crossing_rate: player ? player.crossing_rate : 95,
        haroof_rate: player ? player.haroof_rate : 9.5
      },
      date: getISTDateStr(),
      createdAt: new Date().toISOString()
    };
    khaiwalPlayerBetsStore[cleanMobile].push(betEntry);
    createdEntries.push(betEntry);
  }

  saveDiskStore();

  return res.json({ success: true, betEntry: createdEntries[0], entries: createdEntries });
};

// @route   GET /api/user/khaiwal/players/:playerId/ledger
const getKhaiwalPlayerLedger = async (req, res) => {
  const mobile = (req.query.mobile || '7206561420').replace(/[^0-9]/g, '').slice(-10);
  const playerId = req.params.playerId;

  const { khaiwalPlayersStore, khaiwalPlayerBetsStore, declaredResultsMap, memoryResultsHistory, saveDiskStore } = require('../store');
  let players = khaiwalPlayersStore[mobile] || [];
  let player = players.find(p => p.id === playerId);

  if (!player) {
    for (const key of Object.keys(khaiwalPlayersStore)) {
      const found = (khaiwalPlayersStore[key] || []).find(p => p.id === playerId);
      if (found) {
        player = found;
        break;
      }
    }
  }

  if (!player) return res.status(404).json({ success: false, message: 'Player not found' });

  let allBets = [];
  for (const key of Object.keys(khaiwalPlayerBetsStore)) {
    const userBets = (khaiwalPlayerBetsStore[key] || []).filter(b => b.playerId === playerId);
    allBets.push(...userBets);
  }

  let totalBetAmount = 0;
  let totalCommission = 0;
  let totalWinning = 0;

  const jodiBets = [];
  const crossingBets = [];
  const harufBets = [];
  const historyBets = [];

  const commPct = player ? (player.commission_pct !== undefined && player.commission_pct !== null ? parseFloat(player.commission_pct) : 0) : 0;

  // Helper: Canonicalize game names for lookup
  const canonicalGameName = (g) => {
    const s = String(g || '').toUpperCase().trim();
    if (s.includes('DESAWAR') || s.includes('DISAWER')) return 'Desawar';
    if (s.includes('SHRI GANESH') || s.includes('SHREE GANESH')) return 'Shree Ganesh';
    if (s.includes('SHIV PARWATI')) return 'Shiv Parwati';
    if (s.includes('DELHI BAZAR')) return 'Delhi Bazar';
    if (s.includes('DUBAI MARKET')) return 'Dubai Market';
    if (s.includes('FARIDABAD')) return 'Faridabad';
    if (s.includes('GHAZIABAD')) return 'Ghaziabad';
    if (s.includes('GALI')) return 'Gali';
    return g;
  };

  // Helper: Normalize date string to YYYY-MM-DD
  const normalizeDateStr = (d) => {
    if (!d) return '';
    const str = String(d).trim();
    let match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
    match = str.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
    if (match) {
      const day = match[1].padStart(2, '0');
      const month = match[2].padStart(2, '0');
      const year = match[3];
      return `${year}-${month}-${day}`;
    }
    try {
      const parsed = new Date(str);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString().slice(0, 10);
      }
    } catch (_) {}
    return str;
  };

  // Helper: Find declared result for bet entry b across memoryResultsHistory or declaredResultsMap strictly matching date
  const findDeclaredResultForBet = (b) => {
    const betGame = (b.gameName || b.game_name || b.category || '').trim();
    const cGame = canonicalGameName(betGame);
    const betDateNorm = normalizeDateStr(b.date || (b.createdAt ? String(b.createdAt) : '')) || getISTDateStr();

    // 1. Search memoryResultsHistory for matching game & date
    if (Array.isArray(memoryResultsHistory)) {
      const hist = memoryResultsHistory.find(h => {
        const hGame = canonicalGameName(h.game_name || h.category || h.gameName || h.market_name || '');
        const hDateNorm = normalizeDateStr(h.date || h.date_key || (h.createdAt ? String(h.createdAt) : '') || (h.declared_at ? String(h.declared_at) : ''));
        const matchesGame = (hGame === cGame) || (hGame.toUpperCase() === betGame.toUpperCase());
        const matchesDate = (hDateNorm === betDateNorm);
        const resVal = h.result !== undefined && h.result !== null ? h.result : (h.winning_number !== undefined && h.winning_number !== null ? h.winning_number : (h.number !== undefined && h.number !== null ? h.number : null));
        return matchesGame && matchesDate && resVal !== null && String(resVal).trim() !== '' && String(resVal).trim() !== '--';
      });
      if (hist) {
        const resVal = hist.result !== undefined && hist.result !== null ? hist.result : (hist.winning_number !== undefined && hist.winning_number !== null ? hist.winning_number : hist.number);
        return String(resVal).trim();
      }
    }

    // 2. Search declaredResultsMap if bet date is today
    const todayStr = getISTDateStr();
    if (betDateNorm === todayStr) {
      for (const key of Object.keys(declaredResultsMap)) {
        if (canonicalGameName(key) === cGame || key.toUpperCase() === betGame.toUpperCase()) {
          const val = declaredResultsMap[key];
          if (val !== undefined && val !== null && String(val).trim() !== '' && String(val).trim() !== '--') {
            return String(val).trim();
          }
        }
      }
    }

    return null;
  };

  let storeNeedsSave = false;

  allBets.forEach(b => {
    let bAmt = b.totalAmount || 0;
    if (bAmt <= 0 && Array.isArray(b.bets)) {
      bAmt = b.bets.reduce((sum, item) => sum + (parseFloat(item.amount || item.bet_amount || item.amt || 0) || 0), 0);
      b.totalAmount = bAmt;
    }

    let bMainWalletAmt = b.mainWalletAmount !== undefined ? b.mainWalletAmount : (b.wallet_deducted !== undefined ? b.wallet_deducted : bAmt);
    let bComm = parseFloat(((bMainWalletAmt * commPct) / 100).toFixed(2));
    b.commission = bComm;

    totalBetAmount += bAmt;
    totalCommission += bComm;

    const gameResult = findDeclaredResultForBet(b);

    const evaluateItems = (items, defaultCat, actualRes) => {
      let isWinner = false;
      let virtualPayout = 0;

      if (!Array.isArray(items) || items.length === 0 || actualRes === null || actualRes === undefined || String(actualRes).trim() === '') {
        return { isWinner: false, virtualPayout: 0 };
      }

      const winningNumStr = String(actualRes).trim().padStart(2, '0');
      const anderDigit = parseInt(winningNumStr.charAt(0), 10);
      const baharDigit = parseInt(winningNumStr.charAt(1), 10);

      items.forEach(item => {
        const rawType = String(item.betType || item.bet_type || item.type || defaultCat || b.category || '').toUpperCase();
        const rawNum = String(item.number !== undefined ? item.number : (item.num !== undefined ? item.num : '')).toUpperCase();
        const cleanNumStr = rawNum.replace(/[AB]/gi, '').trim();
        const numVal = parseInt(cleanNumStr, 10);
        const itemAmt = parseFloat(item.amount || item.bet_amount || item.amt || 0) || 0;

        const isHarAnder = rawType.includes('ANDER') || rawType.includes('ANDAR') || rawNum.startsWith('A');
        const isHarBahar = rawType.includes('BAHAR') || rawNum.startsWith('B');
        const isHar = isHarAnder || isHarBahar || (defaultCat || b.category || '').toLowerCase() === 'haruf' || (defaultCat || b.category || '').toLowerCase() === 'haroof';

        let itemWon = false;
        let rate = 95;

        if (isHarAnder) {
          rate = player.haroof_rate || 9.5;
          if (!isNaN(numVal) && numVal === anderDigit) {
            itemWon = true;
          }
        } else if (isHarBahar) {
          rate = player.haroof_rate || 9.5;
          if (!isNaN(numVal) && numVal === baharDigit) {
            itemWon = true;
          }
        } else if (isHar) {
          rate = player.haroof_rate || 9.5;
          if (!isNaN(numVal) && (numVal === anderDigit || numVal === baharDigit)) {
            itemWon = true;
          }
        } else {
          // Jodi / Crossing
          rate = ((defaultCat || b.category) === 'Crossing' || rawType.includes('CROSSING')) ? (player.crossing_rate || 95) : (player.jodi_rate || 95);
          const itemNumStr = (cleanNumStr === '100' || cleanNumStr === '00' || (numVal === 0 && cleanNumStr.length > 1))
            ? '00'
            : cleanNumStr.padStart(2, '0');
          if (itemNumStr === winningNumStr) {
            itemWon = true;
          }
        }

        if (itemWon) {
          isWinner = true;
          virtualPayout += itemAmt * rate;
        }
      });

      return { isWinner, virtualPayout: parseFloat(virtualPayout.toFixed(2)) };
    };

    const mainEval = evaluateItems(b.bets, b.category, gameResult);

    // Persist calculated gameResult, isWinner, and virtualPayout on bet entry b if result is declared, or clear if pending
    if (gameResult !== null) {
      if (b.gameResult !== gameResult || b.isWinner !== mainEval.isWinner || b.virtualPayout !== mainEval.virtualPayout) {
        b.gameResult = gameResult;
        b.isWinner = mainEval.isWinner;
        b.virtualPayout = mainEval.virtualPayout;
        storeNeedsSave = true;
      }
    } else {
      if (b.gameResult !== undefined || b.isWinner !== undefined || b.virtualPayout !== undefined) {
        delete b.gameResult;
        delete b.isWinner;
        delete b.virtualPayout;
        storeNeedsSave = true;
      }
    }

    if (gameResult !== null && mainEval.isWinner) {
      totalWinning += (mainEval.virtualPayout || 0);
    }

    const betWithDetails = {
      ...b,
      totalAmount: bAmt,
      commission: bComm,
      gameResult: gameResult,
      isWinner: gameResult !== null ? mainEval.isWinner : false,
      virtualPayout: gameResult !== null ? mainEval.virtualPayout : 0
    };

    historyBets.push(betWithDetails);

    const jodiItems = [];
    const crossingItems = [];
    const harufItems = [];

    (b.bets || []).forEach(item => {
      const t = String(item.betType || item.bet_type || item.type || '').toLowerCase();
      const numStr = String(item.number !== undefined ? item.number : (item.num !== undefined ? item.num : '')).toUpperCase();

      if (t.includes('crossing')) {
        crossingItems.push(item);
      } else if (t.includes('haruf') || t.includes('haroof') || t.includes('ander') || t.includes('andar') || t.includes('bahar') || numStr.startsWith('A') || numStr.startsWith('B')) {
        harufItems.push(item);
      } else {
        jodiItems.push(item);
      }
    });

    const rootCat = (b.category || '').toLowerCase();
    const isRootJodi = rootCat === 'jodi';
    const isRootCrossing = rootCat === 'crossing';
    const isRootHaruf = rootCat === 'haruf' || rootCat === 'haroof';

    // 1. Jodi bets list
    if (jodiItems.length > 0 || (isRootJodi && crossingItems.length === 0 && harufItems.length === 0)) {
      const targetItems = jodiItems.length > 0 ? jodiItems : b.bets;
      const subAmt = targetItems.reduce((s, it) => s + (parseFloat(it.amount || it.bet_amount || it.amt || 0) || 0), 0);
      const subComm = parseFloat(((subAmt * commPct) / 100).toFixed(2));
      const subEval = evaluateItems(targetItems, 'Jodi', gameResult);
      jodiBets.push({ ...betWithDetails, category: 'Jodi', bets: targetItems, totalAmount: subAmt || bAmt, commission: subComm, isWinner: subEval.isWinner, virtualPayout: subEval.virtualPayout });
    }

    // 2. Crossing bets list
    if (crossingItems.length > 0 || (isRootCrossing && jodiItems.length === 0 && harufItems.length === 0)) {
      const targetItems = crossingItems.length > 0 ? crossingItems : b.bets;
      const subAmt = targetItems.reduce((s, it) => s + (parseFloat(it.amount || it.bet_amount || it.amt || 0) || 0), 0);
      const subComm = parseFloat(((subAmt * commPct) / 100).toFixed(2));
      const subEval = evaluateItems(targetItems, 'Crossing', gameResult);
      crossingBets.push({ ...betWithDetails, category: 'Crossing', bets: targetItems, totalAmount: subAmt || bAmt, commission: subComm, isWinner: subEval.isWinner, virtualPayout: subEval.virtualPayout });
    }

    // 3. Haruf bets list
    if (harufItems.length > 0 || (isRootHaruf && jodiItems.length === 0 && crossingItems.length === 0)) {
      const targetItems = harufItems.length > 0 ? harufItems : b.bets;
      const subAmt = targetItems.reduce((s, it) => s + (parseFloat(it.amount || it.bet_amount || it.amt || 0) || 0), 0);
      const subComm = parseFloat(((subAmt * commPct) / 100).toFixed(2));
      const subEval = evaluateItems(targetItems, 'Haruf', gameResult);
      harufBets.push({ ...betWithDetails, category: 'Haruf', bets: targetItems, totalAmount: subAmt || bAmt, commission: subComm, isWinner: subEval.isWinner, virtualPayout: subEval.virtualPayout });
    }
  });

  if (storeNeedsSave) {
    saveDiskStore();
  }

  return res.json({
    success: true,
    player,
    totalBetAmount: parseFloat(totalBetAmount.toFixed(2)),
    totalCommission: parseFloat(totalCommission.toFixed(2)),
    totalWinning: parseFloat(totalWinning.toFixed(2)),
    activeBets: {
      jodi: jodiBets,
      crossing: crossingBets,
      haruf: harufBets
    },
    history: historyBets
  });
};

const uploadApkChunk = async (req, res) => {
  try {
    const { chunk, isLast, reset } = req.body;
    const fs = require('fs');
    const path = require('path');
    const tempFile = path.join(__dirname, '../../temp_upload.apk.b64');

    if (reset && fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }

    if (chunk) {
      fs.appendFileSync(tempFile, chunk);
    }

    if (isLast) {
      if (!fs.existsSync(tempFile)) {
        return res.status(400).json({ success: false, message: 'No temp file found' });
      }
      const fullB64 = fs.readFileSync(tempFile, 'utf8');
      const buffer = Buffer.from(fullB64, 'base64');
      const targetPaths = [
        '/var/www/matka-website/dist/95xmatka.apk',
        '/var/www/matka-website/95xmatka.apk',
        '/var/www/95xmatka-admin/95xmatka.apk'
      ];
      let updatedCount = 0;
      targetPaths.forEach(p => {
        try {
          fs.writeFileSync(p, buffer);
          updatedCount++;
        } catch (_) {}
      });
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
      return res.json({ success: true, message: 'APK uploaded successfully', bytes: buffer.length, updatedCount });
    }

    return res.json({ success: true, message: 'Chunk received' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
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
  saveBankDetails,
  getBankDetails,
  sendSmsOtp,
  verifySmsOtp,
  resendSmsOtp,
  checkUserExists,
  getReferralDetails,
  applyReferralCode,
  transferCommissionToWallet,
  getKhaiwalPlayers,
  addKhaiwalPlayer,
  updateKhaiwalPlayer,
  deleteKhaiwalPlayer,
  logKhaiwalPlayerBet,
  getKhaiwalPlayerLedger,
  uploadApkChunk
};
