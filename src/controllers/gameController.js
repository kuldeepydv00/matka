const Bet = require('../models/Bet');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Draw = require('../models/Draw');
const { memoryBets, userWalletStore, registeredUsers, declaredResultsMap } = require('../store');
const { chartRecords, formatDateKey } = require('../historicalChartStore');

// @desc    Place bets (supports single bet object or array of bets)
// @route   POST /api/game/bet
// @access  Public / Private
const placeBet = async (req, res) => {
  const { game_name, bet_type, bets, number, bet_amount, mobile } = req.body;

  let betItems = [];
  if (Array.isArray(bets) && bets.length > 0) {
    betItems = bets;
  } else if (number !== undefined && bet_amount !== undefined) {
    betItems = [{ number, bet_amount }];
  }

  if (betItems.length === 0) {
    return res.status(400).json({ message: 'No bets provided' });
  }

  const validGameNames = [
    'Desawar',
    'Shiv Parwati',
    'Delhi Bazar',
    'Dubai Market',
    'Shree Ganesh',
    'Faridabad',
    'Ghaziabad',
    'Gali'
  ];
  const targetGame = validGameNames.includes(game_name) ? game_name : 'Gali';

  let totalStaked = 0;
  const createdBets = [];

  for (let item of betItems) {
    const num = parseInt(item.number);
    const amount = parseFloat(item.bet_amount);

    if (!isNaN(num) && amount > 0) {
      totalStaked += amount;
      const newBet = {
        _id: 'bet_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
        game_name: targetGame,
        bet_type: bet_type || 'JODI',
        number: num,
        bet_amount: amount,
        potential_payout: amount * 95,
        win_amount: 0,
        status: 'pending',
        user: mobile || 'User',
        created_at: new Date().toISOString()
      };

      memoryBets.unshift(newBet);
      createdBets.push(newBet);
    }
  }

  // Deduct stake from target user balance
  const userMobile = mobile || req.body.userPhone;
  let targetUser = null;
  if (userMobile && userMobile.trim().length >= 10) {
    const cleanMobile = userMobile.replace(/[^0-9]/g, '').slice(-10);
    targetUser = registeredUsers.find(u => u.mobile.replace(/[^0-9]/g, '').slice(-10) === cleanMobile);
  }
  if (!targetUser) {
    targetUser = registeredUsers.find(u => u.mobile.includes('7027709695') || u.name.toLowerCase().includes('yogi')) || registeredUsers[registeredUsers.length - 1];
  }

  if (targetUser) {
    targetUser.balance = Math.max(0, targetUser.balance - totalStaked);
  }

  for (let b of createdBets) {
    b.user = targetUser ? `${targetUser.name} (${targetUser.mobile})` : 'yogibbk (7027709695)';
  }

  const { saveDiskStore } = require('../store');
  saveDiskStore();

  const io = req.app.get('io');
  if (io) {
    io.emit('newBetPlaced', { game_name: targetGame, count: createdBets.length, totalStaked });
  }

  res.status(201).json({
    message: 'Bets placed successfully',
    total_staked: totalStaked,
    bets: createdBets,
    newBalance: targetUser ? targetUser.balance : userWalletStore.balance
  });
};

// @desc    Get user bet history
// @route   GET /api/game/my-bets?mobile=...
// @access  Public / Private
const getMyBets = async (req, res) => {
  const userMobile = req.query.mobile || req.query.user;
  if (userMobile && userMobile.trim().length >= 10) {
    const cleanMobile = userMobile.replace(/[^0-9]/g, '').slice(-10);
    const userBets = memoryBets.filter(b => b.user && b.user.replace(/[^0-9]/g, '').slice(-10) === cleanMobile);
    return res.json(userBets);
  }
  res.json(memoryBets);
};

// @desc    Get game results
// @route   GET /api/game/results
// @access  Public
const getResults = async (req, res) => {
  const sampleResults = [
    { game_name: "Faridabad", winning_number: 12, declared_at: "Today, 06:00 PM" },
    { game_name: "Ghaziabad", winning_number: null, status: "Live", declared_at: "Pending" },
    { game_name: "Gali", winning_number: 87, declared_at: "Yesterday, 11:30 PM" },
    { game_name: "Desawar", winning_number: 45, declared_at: "Yesterday, 05:00 AM" }
  ];
  res.json(sampleResults);
};

// @desc    Get date-wise chart results for all games (Historical & Live from DB)
// @route   GET /api/game/chart-results?date=YYYY-MM-DD
// @access  Public
const getChartResults = async (req, res) => {
  const reqDate = req.query.date || formatDateKey(new Date());

  const todayKey = formatDateKey(new Date());
  const istNow = new Date(new Date().getTime() + (5.5 * 60 * 60 * 1000));
  const istKey = formatDateKey(istNow);

  // Default placeholders
  const baseResults = chartRecords[reqDate] ? { ...chartRecords[reqDate] } : {};

  // Query MongoDB Atlas for cloud records for the requested date
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      const ResultRecord = require('../models/ResultRecord');
      const dbRecords = await ResultRecord.find({ date_key: reqDate });
      dbRecords.forEach(r => {
        if (r.game_name && r.winning_number) {
          baseResults[r.game_name] = r.winning_number;
          if (r.game_name === 'Desawar') baseResults['Disawer'] = r.winning_number;
        }
      });
    }
  } catch (e) {
    console.error('[MongoDB Chart Fetch Error]', e);
  }

  // If date is today, overlay memory declaredResultsMap
  if (reqDate === todayKey || reqDate === istKey) {
    Object.keys(declaredResultsMap).forEach(game => {
      if (declaredResultsMap[game] !== null && declaredResultsMap[game] !== undefined) {
        const valStr = String(declaredResultsMap[game]).padStart(2, '0');
        baseResults[game] = valStr;
        if (game === 'Desawar') baseResults['Disawer'] = valStr;
      }
    });
  }

  res.json({
    date: reqDate,
    results: baseResults
  });
};

module.exports = { placeBet, getMyBets, getResults, getChartResults, memoryBets };
