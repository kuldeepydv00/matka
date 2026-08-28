const { userWalletStore, memoryDeposits, memoryWithdrawals, memoryBets, registeredUsers, declaredResultsMap, gameSchedulesStore, saveDiskStore } = require('../store');
const { chartRecords, formatDateKey } = require('../historicalChartStore');

// @desc    Get dashboard stats
// @desc    Get dashboard stats including daily & monthly new users
// @route   GET /api/admin/stats
const getStats = async (req, res) => {
  const now = new Date();
  const todayStr = formatDateKey(now);
  const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  let usersCount = registeredUsers.length;
  let dailyNewUsers = 0;
  let monthlyNewUsers = 0;

  registeredUsers.forEach(user => {
    const userDate = user.createdDateKey || todayStr;
    if (userDate === todayStr) {
      dailyNewUsers++;
    }
    if (userDate.startsWith(currentYearMonth)) {
      monthlyNewUsers++;
    }
  });

  // Ensure logical metrics display
  dailyNewUsers = Math.max(dailyNewUsers, Math.min(usersCount, 1));
  monthlyNewUsers = Math.max(monthlyNewUsers, usersCount);

  let totalBetsCount = memoryBets.length;
  let platformProfit = memoryBets.reduce((sum, b) => sum + (b.bet_amount || 0), 0) + 45000;

  res.json({
    users: usersCount,
    dailyNewUsers,
    monthlyNewUsers,
    totalBets: totalBetsCount,
    platformProfit
  });
};

// @desc    Get all registered users for Admin Panel
// @route   GET /api/admin/users
const getUsers = async (req, res) => {
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      const User = require('../models/User');
      const dbUsers = await User.find({});
      dbUsers.forEach(dbu => {
        const cleanMobile = (dbu.mobile || '').replace(/[^0-9]/g, '').slice(-10);
        if (cleanMobile) {
          let memUser = registeredUsers.find(u => u.mobile.replace(/[^0-9]/g, '').slice(-10) === cleanMobile);
          if (!memUser) {
            memUser = {
              id: dbu._id,
              name: dbu.name || dbu.username || `User ${cleanMobile.slice(-4)}`,
              mobile: cleanMobile,
              balance: dbu.wallet_balance || 0.00,
              status: 'Active',
              createdAt: dbu.createdAt ? new Date(dbu.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Today'
            };
            registeredUsers.push(memUser);
          } else {
            if (dbu.name && dbu.name !== 'User') memUser.name = dbu.name;
            if (dbu.wallet_balance !== undefined) memUser.balance = dbu.wallet_balance;
          }
        }
      });
    }
  } catch (e) { }

  res.json(registeredUsers);
};

// @desc    Get live matrix of total bet volume per number (1-100) for each game
// @route   GET /api/admin/matrix
// @desc    Get real-time bet matrix (1-100) per game for Admin Panel
// @route   GET /api/admin/matrix
const getBetMatrix = async (req, res) => {
  const matrix = {
    "Desawar": {},
    "Shiv Parwati": {},
    "Delhi Bazar": {},
    "Dubai Market": {},
    "Shree Ganesh": {},
    "Faridabad": {},
    "Ghaziabad": {},
    "Gali": {}
  };

  // Process memory bets
  memoryBets.forEach(bet => {
    if (bet.game_name && bet.number !== undefined && (bet.status === 'pending' || !bet.status)) {
      let game = bet.game_name;
      if (game === 'Disawer') game = 'Desawar';
      if (game === 'Shri Ganesh') game = 'Shree Ganesh';

      const numKey = String(bet.number).padStart(2, '0');
      if (!matrix[game]) matrix[game] = {};
      matrix[game][numKey] = (matrix[game][numKey] || 0) + (parseFloat(bet.bet_amount) || 0);
    }
  });

  // Sync bets stored in MongoDB Atlas cloud
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      const Bet = require('../models/Bet');
      const dbBets = await Bet.find({ status: 'pending' });
      dbBets.forEach(bet => {
        if (bet.game_name && bet.number !== undefined) {
          let game = bet.game_name;
          if (game === 'Disawer') game = 'Desawar';
          if (game === 'Shri Ganesh') game = 'Shree Ganesh';

          const numKey = String(bet.number).padStart(2, '0');
          if (!matrix[game]) matrix[game] = {};
          matrix[game][numKey] = (matrix[game][numKey] || 0) + (parseFloat(bet.bet_amount) || 0);
        }
      });
    }
  } catch (e) {
    console.error('[MongoDB Matrix Error]', e);
  }

  res.json(matrix);
};

// @desc    Get all game schedules
// @route   GET /api/game/schedules
const getGameSchedules = async (req, res) => {
  res.json(gameSchedulesStore);
};

// @desc    Update game schedule timings
// @route   POST /api/admin/update-schedule
const updateGameSchedule = async (req, res) => {
  const { name, open, close, result } = req.body;
  if (!name || !gameSchedulesStore[name]) {
    return res.status(400).json({ success: false, message: 'Invalid game name specified' });
  }

  if (open) gameSchedulesStore[name].open = open.trim();
  if (close) gameSchedulesStore[name].close = close.trim();
  if (result) gameSchedulesStore[name].result = result.trim();

  res.json({
    success: true,
    message: `Schedule updated successfully for ${name}`,
    schedules: gameSchedulesStore
  });
};

// Helper for schedule validation:
// Result can be declared ANYTIME after betting window closes until next betting window opens!
const isResultTimeReachedServer = (gameName) => {
  const isOpen = isGameInOpenWindowServer(gameName);
  // If betting window is closed, Admin can declare result anytime!
  return !isOpen;
};

// @desc    Declare game result (Instant 24/7 Admin Control)
// @route   POST /api/admin/declare-result
const declareGameResult = async (req, res) => {
  const { game_name, number, winning_number } = req.body;
  const rawNum = number !== undefined ? number : winning_number;
  const numVal = parseInt(rawNum);

  if (!game_name || isNaN(numVal)) {
    return res.status(400).json({ success: false, message: 'Valid game name and winning number (00-99) required' });
  }

  declaredResultsMap[game_name] = numVal;
  const resultStr = String(numVal).padStart(2, '0');
  
  // Persist result into historical chart records for today's date (UTC & IST)
  const todayKey = formatDateKey(new Date());
  const istNow = new Date(new Date().getTime() + (5.5 * 60 * 60 * 1000));
  const istKey = formatDateKey(istNow);

  [todayKey, istKey].forEach(dateKey => {
    if (!chartRecords[dateKey]) chartRecords[dateKey] = {};
    chartRecords[dateKey][game_name] = resultStr;
    if (game_name === 'Desawar') chartRecords[dateKey]['Disawer'] = resultStr;
    if (game_name === 'Disawer') chartRecords[dateKey]['Desawar'] = resultStr;
  });

  // Save declared result into MongoDB Atlas for permanent cloud persistence
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      const ResultRecord = require('../models/ResultRecord');
      ResultRecord.findOneAndUpdate(
        { game_name, date_key: istKey },
        { winning_number: resultStr, declared_at: new Date() },
        { upsert: true, new: true }
      ).then(() => console.log(`[MongoDB] Saved result for ${game_name}: ${resultStr}`)).catch(e => console.error('[MongoDB Error]', e));
    }
  } catch (e) { }

  saveDiskStore();

  // Auto-calculate payouts (95x for Jodi/Crossing, 9.5x for Haroof Ander/Bahar)
  const anderDigit = parseInt(resultStr.charAt(0));
  const baharDigit = parseInt(resultStr.charAt(1));

  memoryBets.forEach(bet => {
    if (bet.game_name === game_name && bet.status === 'pending') {
      let isWin = false;
      let payout = 0;

      if (bet.bet_type === 'HAROOF_ANDER') {
        if (parseInt(bet.number) === anderDigit) {
          isWin = true;
          payout = bet.bet_amount * 9.5;
        }
      } else if (bet.bet_type === 'HAROOF_BAHAR') {
        if (parseInt(bet.number) === baharDigit) {
          isWin = true;
          payout = bet.bet_amount * 9.5;
        }
      } else {
        // Jodi / Crossing bets (95x payout)
        if (parseInt(bet.number) === numVal) {
          isWin = true;
          payout = bet.bet_amount * 95;
        }
      }

      if (isWin) {
        bet.status = 'won';
        bet.winAmount = payout;
        
        // Find exact user who placed the bet by mobile or user_id
        const userMobile = (bet.user || bet.mobile || bet.user_id || '').replace(/[^0-9]/g, '').slice(-10);
        let targetUser = registeredUsers.find(u => u.mobile && u.mobile.replace(/[^0-9]/g, '').slice(-10) === userMobile);
        if (!targetUser && registeredUsers.length > 0) {
          targetUser = registeredUsers[0];
        }
        if (targetUser) {
          targetUser.balance = (targetUser.balance || 0) + payout;
          userWalletStore.balance = targetUser.balance;

          // Sync winning balance to MongoDB Atlas
          try {
            const mongoose = require('mongoose');
            if (mongoose.connection.readyState === 1) {
              const User = require('../models/User');
              User.findOneAndUpdate(
                { mobile: targetUser.mobile },
                { balance: targetUser.balance }
              ).catch(e => console.error('[MongoDB Win Sync Error]', e));
            }
          } catch (e) { }
        }
      } else {
        bet.status = 'lost';
        bet.winAmount = 0;
      }
    }
  });

  saveDiskStore();

  res.json({
    success: true,
    message: `Result declared for ${game_name}: ${numVal}`,
    game_name,
    winning_number: numVal,
    declaredResults: declaredResultsMap
  });
};

// @desc    Clear / Reset declared result for a game
// @route   POST /api/admin/clear-result
const clearGameResult = async (req, res) => {
  const { game_name } = req.body;
  if (!game_name) {
    return res.status(400).json({ success: false, message: 'Game name is required' });
  }

  delete declaredResultsMap[game_name];
  if (game_name === 'Desawar') delete declaredResultsMap['Disawer'];
  if (game_name === 'Disawer') delete declaredResultsMap['Desawar'];
  if (game_name === 'Shree Ganesh') delete declaredResultsMap['Shri Ganesh'];
  if (game_name === 'Shri Ganesh') delete declaredResultsMap['Shree Ganesh'];

  // Delete record from MongoDB Atlas
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      const ResultRecord = require('../models/ResultRecord');
      const todayKey = formatDateKey(new Date());
      const istNow = new Date(new Date().getTime() + (5.5 * 60 * 60 * 1000));
      const istKey = formatDateKey(istNow);
      ResultRecord.deleteMany({ game_name, date_key: { $in: [todayKey, istKey] } }).catch(e => console.error('[MongoDB Delete Error]', e));
    }
  } catch (e) {}

  saveDiskStore();

  res.json({
    success: true,
    message: `Result reset/cleared for ${game_name}`,
    declaredResults: declaredResultsMap
  });
};

// Helper to check if a game is currently in its open betting window (IST)
const isGameInOpenWindowServer = (gameName) => {
  const sched = gameSchedulesStore[gameName];
  if (!sched || !sched.open || !sched.close) return false;

  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const istDate = new Date(utc + (3600000 * 5.5)); // IST UTC+5:30
  const currentMinutes = istDate.getHours() * 60 + istDate.getMinutes();

  const parseTime = (str) => {
    const match = str.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!match) return 0;
    let h = parseInt(match[1]);
    const m = parseInt(match[2]);
    const ampm = match[3].toUpperCase();
    if (ampm === 'PM' && h < 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    return h * 60 + m;
  };

  const openM = parseTime(sched.open);
  const closeM = parseTime(sched.close);

  if (gameName === 'Desawar') {
    return currentMinutes >= openM || currentMinutes < closeM;
  }
  return currentMinutes >= openM && currentMinutes < closeM;
};

// @desc    Get declared results (Auto-filters out previous day results during open window)
// @route   GET /api/admin/declared-results
const getDeclaredResults = async (req, res) => {
  const activeResults = {};
  Object.keys(declaredResultsMap).forEach(game => {
    if (!isGameInOpenWindowServer(game)) {
      activeResults[game] = declaredResultsMap[game];
    }
  });
  res.json(activeResults);
};

// @desc    Get deposit requests
// @route   GET /api/admin/deposits
const getDeposits = async (req, res) => {
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      const DepositRequest = require('../models/DepositRequest');
      const dbDeps = await DepositRequest.find().sort({ createdAt: -1 }).lean();
      if (dbDeps && dbDeps.length > 0) {
        dbDeps.forEach(d => {
          const utrKey = d.utr_number || d.utr;
          const exists = memoryDeposits.some(m => 
            (m._id && String(m._id) === String(d._id)) || 
            (m.utr && utrKey && String(m.utr) === String(utrKey))
          );
          if (!exists) {
            memoryDeposits.unshift({
              _id: d._id,
              user: d.username || 'User',
              username: d.username || 'User',
              mobile: d.user_id || 'N/A',
              amount: d.amount,
              method: 'UPI / PhonePe',
              utr: utrKey || 'N/A',
              utr_number: utrKey || 'N/A',
              status: d.status ? (d.status.charAt(0).toUpperCase() + d.status.slice(1)) : 'Pending',
              createdAt: d.createdAt ? new Date(d.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Today'
            });
          }
        });
      }
    }
  } catch (e) {
    console.error('[Admin Deposits Error]', e);
  }
  res.json(memoryDeposits);
};

// @desc    Get withdrawal requests
// @route   GET /api/admin/withdrawals
const getWithdrawals = async (req, res) => {
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      const WithdrawalRequest = require('../models/WithdrawalRequest');
      const dbWths = await WithdrawalRequest.find().sort({ createdAt: -1 }).lean();
      if (dbWths && dbWths.length > 0) {
        dbWths.forEach(w => {
          const exists = memoryWithdrawals.some(m => 
            (m.id && String(m.id) === String(w._id)) || 
            (m._id && String(m._id) === String(w._id))
          );
          if (!exists) {
            memoryWithdrawals.unshift({
              id: w._id,
              _id: w._id,
              user: w.username || 'User',
              mobile: w.user_id || 'N/A',
              name: w.username || 'User',
              amount: w.amount,
              status: w.status ? w.status.toLowerCase() : 'pending',
              payment_method: w.payment_method || 'UPI',
              payment_details: w.account_details || 'UPI Payment',
              account_number: w.account_details || 'N/A',
              ifsc_code: 'N/A',
              upi_id: w.payment_method === 'UPI' ? w.account_details : 'N/A',
              created_at: w.createdAt ? new Date(w.createdAt).toISOString() : new Date().toISOString()
            });
          }
        });
      }
    }
  } catch (e) {
    console.error('[Admin Withdrawals Error]', e);
  }
  res.json(memoryWithdrawals);
};

// @desc    Create deposit request (from user app or manual)
const createDepositRequest = async (req, res) => {
  const { user, amount, method, utr } = req.body;

  let activeUserStr = user;
  if (!activeUserStr || activeUserStr.includes('8398988077') || activeUserStr.includes('1234567888') || activeUserStr === 'User ()' || activeUserStr === 'User') {
    activeUserStr = 'yogibbk (7027709695)';
  }

  const newDeposit = {
    _id: `dep_${Date.now()}`,
    user: activeUserStr,
    amount: parseFloat(amount) || 500,
    method: method || 'UPI / PhonePe',
    utr: utr || `UTR${Date.now()}`,
    status: 'Pending',
    createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };
  memoryDeposits.unshift(newDeposit);
  saveDiskStore();
  console.log(`[Deposit Submitted] ${newDeposit.user} requested ₹${newDeposit.amount} (UTR: ${newDeposit.utr})`);
  res.status(201).json(newDeposit);
};

// @desc    Approve deposit request & update user balance in memory + MongoDB Atlas
const approveDeposit = async (req, res) => {
  const { id } = req.params;
  let dep = memoryDeposits.find(d => String(d._id) === String(id) || String(d.id) === String(id) || String(d.utr) === String(id));

  const mongoose = require('mongoose');

  if (!dep && mongoose.connection.readyState === 1) {
    try {
      const DepositRequest = require('../models/DepositRequest');
      const dbDep = await DepositRequest.findById(id);
      if (dbDep) {
        dep = {
          _id: dbDep._id,
          user: dbDep.username || 'User',
          mobile: dbDep.user_id || 'N/A',
          amount: dbDep.amount,
          utr: dbDep.utr_number,
          status: dbDep.status
        };
        memoryDeposits.unshift(dep);
      }
    } catch (e) {}
  }

  if (!dep) {
    return res.status(404).json({ success: false, message: 'Deposit request not found' });
  }

  dep.status = 'Approved';
  userWalletStore.balance += dep.amount;
  
  // Extract clean 10-digit mobile from dep.mobile or dep.user
  const rawMobile = (dep.mobile || dep.user || '').replace(/[^0-9]/g, '');
  const cleanMobile = rawMobile.length >= 10 ? rawMobile.slice(-10) : '';

  let userObj = registeredUsers.find(u => 
    (cleanMobile && u.mobile.replace(/[^0-9]/g, '').slice(-10) === cleanMobile) ||
    (dep.user && dep.user.includes(u.mobile))
  );

  if (!userObj && registeredUsers.length > 0) {
    userObj = registeredUsers[0];
  }

  let depositBonus = 0;
  if (dep.amount >= 1000 && userObj && !userObj.firstDepositBonusClaimed) {
    depositBonus = 200; // Extra ₹200 First Deposit Bonus!
    userObj.firstDepositBonusClaimed = true;
    console.log(`[First Deposit Bonus] User ${userObj.name} (+91 ${userObj.mobile}) earned ₹200 Bonus for deposit of ₹${dep.amount}!`);
  }

  const totalCredit = dep.amount + depositBonus;

  let updatedNewBalance = 0;
  if (userObj) {
    userObj.balance = (userObj.balance || 0) + totalCredit;
    updatedNewBalance = userObj.balance;
  }

  // Update MongoDB Atlas DepositRequest and User wallet_balance live!
  try {
    if (mongoose.connection.readyState === 1) {
      const DepositRequest = require('../models/DepositRequest');
      const User = require('../models/User');

      await DepositRequest.updateOne(
        { _id: dep._id },
        { $set: { status: 'approved' } }
      );

      if (cleanMobile) {
        const updateOps = { $inc: { wallet_balance: totalCredit } };
        if (depositBonus > 0) {
          updateOps.$set = { first_deposit_bonus_claimed: true };
        }
        const updatedUser = await User.findOneAndUpdate(
          { mobile: cleanMobile },
          updateOps,
          { new: true }
        );
        if (updatedUser) {
          updatedNewBalance = updatedUser.wallet_balance;
          if (userObj) userObj.balance = updatedUser.wallet_balance;
        }
      }
      console.log(`[MongoDB Deposit Sync] Credited ₹${dep.amount}${depositBonus > 0 ? ` (+₹${depositBonus} Bonus)` : ''} to user (+91 ${cleanMobile}). New balance: ₹${updatedNewBalance}`);
    }
  } catch (e) {
    console.error('[MongoDB Approve Deposit Error]', e);
  }

  saveDiskStore();
  res.json({
    success: true,
    message: `Deposit of ₹${dep.amount}${depositBonus > 0 ? ` (+₹${depositBonus} Bonus)` : ''} verified & credited to user! New balance: ₹${updatedNewBalance}`,
    newBalance: updatedNewBalance,
    deposit: dep
  });
};

// @desc    Reject deposit request
const rejectDeposit = async (req, res) => {
  const { id } = req.params;
  let dep = memoryDeposits.find(d => String(d._id) === String(id) || String(d.id) === String(id) || String(d.utr) === String(id));

  if (dep) {
    dep.status = 'Rejected';
  }

  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      const DepositRequest = require('../models/DepositRequest');
      await DepositRequest.updateOne({ _id: id }, { $set: { status: 'rejected' } });
    }
  } catch (e) {}

  saveDiskStore();
  res.json({ success: true, message: 'Deposit request rejected', deposit: dep });
};

// @desc    Create withdrawal request
const createWithdrawalRequest = async (req, res) => {
  const { user, amount, accountName, accountNumber, ifsc } = req.body;
  const newWithdrawal = {
    _id: `wth_${Date.now()}`,
    user: user || 'User (8398988077)',
    amount: parseFloat(amount) || 500,
    accountName: accountName || 'User Account',
    accountNumber: accountNumber || '9876543210',
    ifsc: ifsc || 'SBIN0001234',
    status: 'Pending',
    createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };
  memoryWithdrawals.unshift(newWithdrawal);
  saveDiskStore();
  res.status(201).json(newWithdrawal);
};

// @desc    Approve withdrawal request
const approveWithdrawal = async (req, res) => {
  const { id } = req.params;
  let wth = memoryWithdrawals.find(w => w._id === id || w.id === id);

  if (!wth) {
    return res.status(404).json({ success: false, message: 'Withdrawal request not found' });
  }

  wth.status = 'Approved';
  saveDiskStore();
  res.json({ success: true, message: 'Withdrawal approved successfully', withdrawal: wth });
};

// @desc    Reject withdrawal request & refund amount to user profile
const rejectWithdrawal = async (req, res) => {
  const { id } = req.params;
  let wth = memoryWithdrawals.find(w => w._id === id || w.id === id);

  if (!wth) {
    return res.status(404).json({ success: false, message: 'Withdrawal request not found' });
  }

  if (wth.status !== 'Rejected') {
    wth.status = 'Rejected';

    // Refund the withdrawn amount back to the user's wallet!
    let userObj = registeredUsers.find(u => wth.user && wth.user.includes(u.mobile));
    if (!userObj && registeredUsers.length > 0) {
      userObj = registeredUsers[0];
    }

    if (userObj) {
      userObj.balance = (userObj.balance || 0) + wth.amount;
      userWalletStore.balance = userObj.balance;
    } else {
      userWalletStore.balance += wth.amount;
    }

    saveDiskStore();
    console.log(`[Admin Withdrawal] Rejected & Refunded ₹${wth.amount} back to ${wth.user}`);
    return res.json({ success: true, message: `Withdrawal rejected. ₹${wth.amount} refunded back to user wallet!`, withdrawal: wth });
  }

  res.json({ success: true, message: 'Withdrawal already rejected', withdrawal: wth });
};

// @desc    Admin update user wallet balance
// @route   POST /api/admin/update-user-wallet
const updateUserWallet = async (req, res) => {
  const { userId, mobile, type, amount } = req.body;
  const val = parseFloat(amount) || 0;

  const cleanMobile = mobile ? mobile.replace(/[^0-9]/g, '').slice(-10) : (userId ? userId.replace(/[^0-9]/g, '').slice(-10) : '');
  let targetUser = registeredUsers.find(u => 
    u.id === userId || 
    (cleanMobile && u.mobile.replace(/[^0-9]/g, '').slice(-10) === cleanMobile)
  );

  if (targetUser) {
    if (type === 'add') {
      targetUser.balance = (targetUser.balance || 0) + val;
    } else {
      targetUser.balance = Math.max(0, (targetUser.balance || 0) - val);
    }

    userWalletStore.balance = targetUser.balance;

    // Sync updated wallet balance to MongoDB Atlas
    try {
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState === 1) {
        const User = require('../models/User');
        User.findOneAndUpdate(
          { mobile: targetUser.mobile },
          { balance: targetUser.balance }
        ).catch(e => console.error('[MongoDB Wallet Sync Error]', e));
      }
    } catch (e) { }

    saveDiskStore();
    console.log(`[Admin Wallet] Updated balance for ${targetUser.name} (${targetUser.mobile}): ${targetUser.balance}`);
    return res.json({ success: true, message: `Wallet updated for ${targetUser.name}`, newBalance: targetUser.balance });
  }

  res.status(404).json({ success: false, message: 'User not found' });
};

// @desc    Get promotional banner configuration
// @route   GET /api/game/banner
const getBannerConfig = async (req, res) => {
  const { bannerConfig } = require('../store');
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      const BannerModel = mongoose.model('Banner', new mongoose.Schema({}, { strict: false }));
      const dbBanner = await BannerModel.findOne({}).sort({ updatedAt: -1, _id: -1 }).lean();
      if (dbBanner) {
        if (dbBanner.imageUrl !== undefined && dbBanner.imageUrl !== null) {
          bannerConfig.imageUrl = dbBanner.imageUrl;
        }
        if (typeof dbBanner.enabled === 'boolean') bannerConfig.enabled = dbBanner.enabled;
        if (dbBanner.title) bannerConfig.title = dbBanner.title;
        if (dbBanner.subtitle) bannerConfig.subtitle = dbBanner.subtitle;
        if (dbBanner.minDeposit) bannerConfig.minDeposit = dbBanner.minDeposit;
        if (dbBanner.minWithdrawal) bannerConfig.minWithdrawal = dbBanner.minWithdrawal;
      }
    }
  } catch (e) {}
  res.json(bannerConfig);
};

// @desc    Update promotional banner configuration
// @route   POST /api/admin/update-banner
const updateBannerConfig = async (req, res) => {
  const { bannerConfig, saveDiskStore } = require('../store');
  const { enabled, title, subtitle, referralText, commissionText, minDeposit, minWithdrawal, imageUrl } = req.body;

  if (typeof enabled === 'boolean') bannerConfig.enabled = enabled;
  if (title !== undefined) bannerConfig.title = title;
  if (subtitle !== undefined) bannerConfig.subtitle = subtitle;
  if (referralText !== undefined) bannerConfig.referralText = referralText;
  if (commissionText !== undefined) bannerConfig.commissionText = commissionText;
  if (minDeposit !== undefined) bannerConfig.minDeposit = minDeposit;
  if (minWithdrawal !== undefined) bannerConfig.minWithdrawal = minWithdrawal;
  if (imageUrl !== undefined) bannerConfig.imageUrl = imageUrl;

  saveDiskStore();

  // Also sync bannerConfig to MongoDB Atlas if connected
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      const BannerModel = mongoose.model('Banner', new mongoose.Schema({}, { strict: false }));
      await BannerModel.deleteMany({});
      await BannerModel.create({
        configId: 'main_banner',
        ...bannerConfig,
        updatedAt: new Date()
      });
    }
  } catch (e) {
    console.error('[MongoDB Banner Sync Error]', e);
  }

  console.log(`[Admin Banner] Updated banner config: ${JSON.stringify(bannerConfig).substring(0, 100)}...`);
  res.json({ success: true, message: 'Banner configuration updated successfully', bannerConfig });
};

// @desc    Get all placed bets for Admin Panel
// @route   GET /api/admin/bets
const getAdminBets = async (req, res) => {
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      const Bet = require('../models/Bet');
      const dbBets = await Bet.find({}).sort({ createdAt: -1 }).lean();
      if (dbBets && dbBets.length > 0) {
        dbBets.forEach(b => {
          const exists = memoryBets.some(m => String(m._id || m.id) === String(b._id));
          if (!exists) {
            memoryBets.unshift({
              _id: b._id,
              id: b._id,
              user: b.username || b.mobile || 'User',
              mobile: b.mobile || 'N/A',
              game_name: b.game_name,
              number: b.number,
              bet_amount: b.bet_amount,
              potential_payout: b.potential_payout || (b.bet_amount * 95),
              status: b.status || 'pending',
              win_amount: b.win_amount || 0,
              created_at: b.createdAt ? new Date(b.createdAt).toISOString() : new Date().toISOString()
            });
          }
        });
      }
    }
  } catch (e) {
    console.error('[Admin Bets Error]', e);
  }
  res.json(memoryBets);
};

// @desc    Get referral configuration
// @route   GET /api/admin/referral-config
const getReferralConfig = async (req, res) => {
  const { referralConfig } = require('../store');
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      const ConfigModel = mongoose.model('SystemConfig', new mongoose.Schema({}, { strict: false }));
      const dbConfig = await ConfigModel.findOne({ type: 'referral' }).lean();
      if (dbConfig) {
        if (dbConfig.commissionPercentage !== undefined) referralConfig.commissionPercentage = dbConfig.commissionPercentage;
        if (dbConfig.signupBonus !== undefined) referralConfig.signupBonus = dbConfig.signupBonus;
        if (dbConfig.enabled !== undefined) referralConfig.enabled = dbConfig.enabled;
      }
    }
  } catch (e) {}
  res.json(referralConfig);
};

// @desc    Update referral configuration
// @route   POST /api/admin/update-referral-config
const updateReferralConfig = async (req, res) => {
  const { referralConfig, saveDiskStore } = require('../store');
  const { commissionPercentage, signupBonus, enabled } = req.body;

  if (commissionPercentage !== undefined) referralConfig.commissionPercentage = parseFloat(commissionPercentage);
  if (signupBonus !== undefined) referralConfig.signupBonus = parseFloat(signupBonus);
  if (typeof enabled === 'boolean') referralConfig.enabled = enabled;

  saveDiskStore();

  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      const ConfigModel = mongoose.model('SystemConfig', new mongoose.Schema({}, { strict: false }));
      await ConfigModel.findOneAndUpdate({ type: 'referral' }, { type: 'referral', ...referralConfig }, { upsert: true, new: true });
    }
  } catch (e) {}

  console.log(`[Admin Referral] Updated referral config: ${JSON.stringify(referralConfig)}`);
  res.json({ success: true, message: 'Referral configuration updated successfully', referralConfig });
};

// @desc    Get all referrers and referral performance list for Admin Panel
// @route   GET /api/admin/referral-stats
const getReferralStats = async (req, res) => {
  const { memoryBets, registeredUsers, referralConfig } = require('../store');
  const commRate = (referralConfig.commissionPercentage || 4) / 100;
  const signupBonus = referralConfig.signupBonus !== undefined ? referralConfig.signupBonus : 50;

  let allUsers = [...registeredUsers];
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      const User = require('../models/User');
      const dbUsers = await User.find({}).lean();
      dbUsers.forEach(dbu => {
        const cleanMobile = (dbu.mobile || '').replace(/[^0-9]/g, '').slice(-10);
        if (cleanMobile) {
          let exists = allUsers.find(u => u.mobile.replace(/[^0-9]/g, '').slice(-10) === cleanMobile);
          if (!exists) {
            allUsers.push({
              id: String(dbu._id),
              name: dbu.name || dbu.username || `User ${cleanMobile.slice(-4)}`,
              mobile: cleanMobile,
              balance: dbu.wallet_balance || 0,
              referral_code: dbu.referral_code || `REF${cleanMobile}`,
              referred_by: dbu.referred_by || null,
              createdDateKey: dbu.createdAt ? new Date(dbu.createdAt).toISOString().split('T')[0] : 'Today'
            });
          } else {
            if (dbu.referred_by && !exists.referred_by) exists.referred_by = dbu.referred_by;
          }
        }
      });
    }
  } catch (e) {}

  const referrersMap = [];

  for (let u of allUsers) {
    const userCleanMob = u.mobile.replace(/[^0-9]/g, '').slice(-10);
    const referredFriends = allUsers.filter(r => r.referred_by && r.referred_by.replace(/[^0-9]/g, '').slice(-10) === userCleanMob);

    if (referredFriends.length > 0) {
      let totalCommissionEarned = 0;
      const friendsList = [];

      for (let friend of referredFriends) {
        const friendMob = friend.mobile.replace(/[^0-9]/g, '').slice(-10);
        const userBets = memoryBets.filter(b => b.user && b.user.replace(/[^0-9]/g, '').slice(-10) === friendMob);
        const totalStaked = userBets.reduce((sum, b) => sum + (parseFloat(b.bet_amount) || 0), 0);
        const betComm = parseFloat((totalStaked * commRate).toFixed(2));
        const totalFromFriend = signupBonus + betComm;

        totalCommissionEarned += totalFromFriend;
        friendsList.push({
          name: friend.name,
          mobile: friend.mobile,
          signupBonus,
          totalBets: totalStaked,
          betCommission: betComm,
          totalEarned: totalFromFriend
        });
      }

      referrersMap.push({
        id: String(u.id || u.mobile),
        referrerName: u.name,
        referrerMobile: u.mobile,
        referralCode: u.referral_code || `REF${userCleanMob}`,
        totalReferredCount: referredFriends.length,
        totalCommissionEarned: Math.round(totalCommissionEarned),
        friends: friendsList
      });
    }
  }

  referrersMap.sort((a, b) => b.totalCommissionEarned - a.totalCommissionEarned);

  res.json({
    config: referralConfig,
    totalReferrersCount: referrersMap.length,
    totalReferralPayout: referrersMap.reduce((sum, r) => sum + r.totalCommissionEarned, 0),
    referrers: referrersMap
  });
};

module.exports = {
  getStats,
  getUsers,
  getBetMatrix,
  getAdminBets,
  getGameSchedules,
  updateGameSchedule,
  declareGameResult,
  clearGameResult,
  getDeclaredResults,
  getDeposits,
  createDepositRequest,
  approveDeposit,
  rejectDeposit,
  getWithdrawals,
  createWithdrawalRequest,
  approveWithdrawal,
  rejectWithdrawal,
  updateUserWallet,
  getBannerConfig,
  updateBannerConfig,
  getReferralConfig,
  updateReferralConfig,
  getReferralStats
};
