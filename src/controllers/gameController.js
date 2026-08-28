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

    // Process Dynamic Referral Bet Commission
    const { referralConfig } = require('../store');
    if (referralConfig.enabled !== false && targetUser.referred_by && totalStaked > 0) {
      const refMobile = targetUser.referred_by.replace(/[^0-9]/g, '').slice(-10);
      const userCleanMob = targetUser.mobile.replace(/[^0-9]/g, '').slice(-10);

      if (refMobile && refMobile !== userCleanMob) {
        const commRate = (referralConfig.commissionPercentage || 4) / 100;
        const commission = parseFloat((totalStaked * commRate).toFixed(2));
        if (commission > 0) {
          let referrer = registeredUsers.find(u => u.mobile.replace(/[^0-9]/g, '').slice(-10) === refMobile);
          if (referrer) {
            referrer.balance = (referrer.balance || 0) + commission;
            referrer.totalCommission = (referrer.totalCommission || 0) + commission;
            console.log(`[Referral Commission] Referrer ${referrer.name} (+91 ${referrer.mobile}) earned ₹${commission} (${referralConfig.commissionPercentage}% of ₹${totalStaked}) from bet by ${targetUser.name}!`);
          }

          // Credit referrer balance in MongoDB Atlas
          try {
            const mongoose = require('mongoose');
            if (mongoose.connection.readyState === 1) {
              const User = require('../models/User');
              User.updateOne(
                { mobile: refMobile },
                { $inc: { wallet_balance: commission, total_commission: commission } }
              ).catch(e => console.error('[MongoDB 4% Commission Error]', e));
            }
          } catch (e) {}
        }
      }
    }
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
    let userBets = memoryBets.filter(b => b.user && b.user.replace(/[^0-9]/g, '').slice(-10) === cleanMobile);

    // Query MongoDB Atlas for cloud-stored bets
    try {
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState === 1) {
        const Bet = require('../models/Bet');
        const dbBets = await Bet.find({ $or: [{ mobile: cleanMobile }, { user: { $regex: cleanMobile } }] });
        dbBets.forEach(dbb => {
          const exists = userBets.some(b => b._id === String(dbb._id) || b.id === String(dbb._id));
          if (!exists) {
            userBets.unshift({
              _id: String(dbb._id),
              game_name: dbb.game_name,
              bet_type: dbb.bet_type || 'JODI',
              number: dbb.number,
              bet_amount: dbb.bet_amount,
              potential_payout: dbb.potential_payout || (dbb.bet_amount * 95),
              win_amount: dbb.win_amount || 0,
              status: dbb.status || 'pending',
              user: dbb.user || cleanMobile,
              created_at: dbb.created_at || dbb.createdAt || new Date().toISOString()
            });
          }
        });
      }
    } catch (e) { }

    return res.json(userBets);
  }
  res.json(memoryBets);
};

// @desc    Get game results
// @route   GET /api/game/results
// @access  Public
// @desc    Get live declared game results map
// @route   GET /api/game/results
// @access  Public
const getResults = async (req, res) => {
  res.json(declaredResultsMap);
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

  // If date is today, overlay memory declaredResultsMap (Strict Admin Control)
  if (reqDate === todayKey || reqDate === istKey) {
    const validGames = ['Desawar', 'Shiv Parwati', 'Delhi Bazar', 'Dubai Market', 'Shree Ganesh', 'Faridabad', 'Ghaziabad', 'Gali'];
    validGames.forEach(game => {
      if (declaredResultsMap[game] !== null && declaredResultsMap[game] !== undefined) {
        const valStr = String(declaredResultsMap[game]).padStart(2, '0');
        baseResults[game] = valStr;
        if (game === 'Desawar') baseResults['Disawer'] = valStr;
      } else {
        baseResults[game] = '--';
        if (game === 'Desawar') baseResults['Disawer'] = '--';
      }
    });
  }

  res.json({
    date: reqDate,
    results: baseResults
  });
};

module.exports = { placeBet, getMyBets, getResults, getChartResults, memoryBets };
