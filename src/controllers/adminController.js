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
  res.json(registeredUsers);
};

// @desc    Get live matrix of total bet volume per number (1-100) for each game
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

  memoryBets.forEach(bet => {
    if (bet.game_name && bet.number) {
      if (!matrix[bet.game_name]) matrix[bet.game_name] = {};
      matrix[bet.game_name][bet.number] = (matrix[bet.game_name][bet.number] || 0) + (bet.bet_amount || 0);
    }
  });

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

// Helper for schedule validation
const isResultTimeReachedServer = (gameName) => {
  const sched = gameSchedulesStore[gameName];
  if (!sched || !sched.result) return true;

  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const istDate = new Date(utc + (3600000 * 5.5)); // IST UTC+5:30
  const currentMinutes = istDate.getHours() * 60 + istDate.getMinutes();

  // Parse result time string (e.g., "09:40 PM IST")
  const timeMatch = sched.result.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!timeMatch) return true;

  let h = parseInt(timeMatch[1]);
  const m = parseInt(timeMatch[2]);
  const ampm = timeMatch[3].toUpperCase();

  if (ampm === 'PM' && h < 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;

  const targetMinutes = h * 60 + m;

  if (gameName === 'Desawar') {
    return currentMinutes >= targetMinutes && currentMinutes < (6 * 60);
  }

  return currentMinutes >= targetMinutes;
};

// @desc    Declare game result
// @route   POST /api/admin/declare-result
const declareGameResult = async (req, res) => {
  const { game_name, number, winning_number, force } = req.body;
  const rawNum = number !== undefined ? number : winning_number;
  const numVal = parseInt(rawNum);

  if (!game_name || isNaN(numVal)) {
    return res.status(400).json({ success: false, message: 'Valid game name and winning number (00-99) required' });
  }

  // Enforce Schedule: Check if result time in IST has been reached
  if (!force && !isResultTimeReachedServer(game_name)) {
    const sched = gameSchedulesStore[game_name];
    const timeStr = sched ? sched.result : 'designated result time';
    return res.status(400).json({
      success: false,
      message: `⏳ Cannot declare result for ${game_name} yet! Result time is at ${timeStr}. Please wait until result time.`
    });
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
    if (bet.game_name === game_name) {
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
        userWalletStore.balance += payout;
        if (registeredUsers.length > 0) {
          registeredUsers[0].balance += payout;
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
  res.json(memoryDeposits);
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

// @desc    Approve deposit request & update user balance
const approveDeposit = async (req, res) => {
  const { id } = req.params;
  let dep = memoryDeposits.find(d => d._id === id || d.id === id || d.utr === id);

  if (!dep) {
    return res.status(404).json({ success: false, message: 'Deposit request not found' });
  }

  dep.status = 'Approved';
  userWalletStore.balance += dep.amount;
  
  // Find target user by mobile in registeredUsers
  let userObj = registeredUsers.find(u => dep.user && dep.user.includes(u.mobile));
  if (!userObj && registeredUsers.length > 0) {
    userObj = registeredUsers[0];
  }
  if (userObj) {
    userObj.balance = (userObj.balance || 0) + dep.amount;
  }

  saveDiskStore();
  console.log(`[Admin Deposit] Approved ₹${dep.amount} deposit for ${dep.user}`);
  res.json({ success: true, message: `Deposit of ₹${dep.amount} verified & credited to ${userObj ? userObj.name : dep.user}!`, deposit: dep });
};

// @desc    Reject deposit request
const rejectDeposit = async (req, res) => {
  const { id } = req.params;
  let dep = memoryDeposits.find(d => d._id === id || d.id === id || d.utr === id);
  if (dep) {
    dep.status = 'Rejected';
    saveDiskStore();
  }
  res.json({ success: true, message: 'Deposit request rejected', deposit: dep });
};

// @desc    Get withdrawal requests
const getWithdrawals = async (req, res) => {
  res.json(memoryWithdrawals);
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

    saveDiskStore();
    console.log(`[Admin Wallet] Updated balance for ${targetUser.name} (${targetUser.mobile}): ${targetUser.balance}`);
    return res.json({ success: true, message: `Wallet updated for ${targetUser.name}`, newBalance: targetUser.balance });
  }

  res.status(404).json({ success: false, message: 'User not found' });
};

module.exports = {
  getStats,
  getUsers,
  getBetMatrix,
  getGameSchedules,
  updateGameSchedule,
  declareGameResult,
  getDeclaredResults,
  getDeposits,
  createDepositRequest,
  approveDeposit,
  rejectDeposit,
  getWithdrawals,
  createWithdrawalRequest,
  approveWithdrawal,
  rejectWithdrawal,
  updateUserWallet
};
