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
    let num = parseInt(item.number);
    const bType = item.bet_type || item.type || bet_type || 'JODI';
    const isHaroof = bType.toUpperCase().includes('HAR') || bType.toUpperCase().includes('ANDER') || bType.toUpperCase().includes('BAHAR');
    if (isHaroof) {
      num = isNaN(num) ? 0 : Math.abs(num) % 10;
    } else {
      if (num === 100) num = 0; // Fix Android App sending 100 for 00
    }
    const amount = parseFloat(item.bet_amount);

    if (!isNaN(num) && amount > 0) {
      totalStaked += amount;
      const payout = amount * (isHaroof ? 9.5 : 95);

      const newBet = {
        _id: 'bet_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
        game_name: targetGame,
        bet_type: bType,
        number: num,
        bet_amount: amount,
        potential_payout: payout,
        win_amount: 0,
        status: 'pending',
        user: mobile || 'User',
        created_at: new Date().toISOString()
      };

      memoryBets.unshift(newBet);
      createdBets.push(newBet);

      try {
        Bet.create({
          game_name: targetGame,
          bet_type: bType,
          number: num,
          bet_amount: amount,
          potential_payout: payout,
          win_amount: 0,
          status: 'pending',
          user: mobile || 'User',
          mobile: mobile || ''
        }).then(createdDoc => {
          if (createdDoc && createdDoc._id) {
            newBet._id = String(createdDoc._id);
          }
        }).catch(e => console.error('[Bet DB Persist Error]:', e.message));
      } catch (e) { }
    }
  }

  try {
    const { saveDiskStore } = require('../store');
    saveDiskStore();
  } catch (e) { }

  // Deduct stake from target user balance
  const userMobile = mobile || req.body.userPhone;
  let targetUser = null;
  if (userMobile && userMobile.trim().length >= 10) {
    const cleanMobile = userMobile.replace(/[^0-9]/g, '').slice(-10);
    targetUser = registeredUsers.find(u => (u.mobile || '').replace(/[^0-9]/g, '').slice(-10) === cleanMobile);
  }
  if (!targetUser) {
    targetUser = registeredUsers.find(u => u.mobile.includes('7027709695') || u.name.toLowerCase().includes('yogi')) || registeredUsers[registeredUsers.length - 1];
  }

  if (targetUser) {
    // 1. Calculate 10% max bonus deduction
    if (targetUser.bonus_balance === undefined) targetUser.bonus_balance = 200.00;
    if (targetUser.deposit_balance === undefined) targetUser.deposit_balance = targetUser.balance || 0.00;
    if (targetUser.winning_balance === undefined) targetUser.winning_balance = 0.00;
    if (targetUser.commission_balance === undefined) targetUser.commission_balance = 0.00;

    const maxBonusUsable = totalStaked * 0.10;
    const bonusUsed = Math.min(maxBonusUsable, targetUser.bonus_balance);
    targetUser.bonus_balance = parseFloat((targetUser.bonus_balance - bonusUsed).toFixed(2));

    let remainingRequired = totalStaked - bonusUsed;

    // 2. Deduct from Deposit & Winning balance first
    if (remainingRequired > 0) {
      if (targetUser.deposit_balance >= remainingRequired) {
        targetUser.deposit_balance = parseFloat((targetUser.deposit_balance - remainingRequired).toFixed(2));
        remainingRequired = 0;
      } else {
        remainingRequired -= targetUser.deposit_balance;
        targetUser.deposit_balance = 0.00;

        if (targetUser.winning_balance >= remainingRequired) {
          targetUser.winning_balance = parseFloat((targetUser.winning_balance - remainingRequired).toFixed(2));
          remainingRequired = 0;
        } else {
          remainingRequired -= targetUser.winning_balance;
          targetUser.winning_balance = 0.00;
        }
      }
    }

    // 3. If Available balance is 0/insufficient, deduct remaining from Commission balance
    if (remainingRequired > 0 && targetUser.commission_balance > 0) {
      const commDeduct = Math.min(remainingRequired, targetUser.commission_balance);
      targetUser.commission_balance = parseFloat((targetUser.commission_balance - commDeduct).toFixed(2));
      remainingRequired -= commDeduct;
    }

    // Update aggregate main balance
    targetUser.balance = parseFloat((targetUser.deposit_balance + targetUser.winning_balance + targetUser.commission_balance).toFixed(2));

    // Sync multi-wallet state in MongoDB Atlas
    try {
      const User = require('../models/User');
      const cleanUserMob = targetUser.mobile.replace(/[^0-9]/g, '').slice(-10);
      User.updateOne(
        { mobile: cleanUserMob },
        {
          $set: {
            deposit_balance: targetUser.deposit_balance,
            winning_balance: targetUser.winning_balance,
            bonus_balance: targetUser.bonus_balance,
            commission_balance: targetUser.commission_balance,
            wallet_balance: targetUser.balance
          }
        }
      ).catch(e => console.error('[MongoDB Wallet Sync Error]', e));
    } catch (e) {}

    // Process Dynamic Referral Bet Commission
    const { referralConfig } = require('../store');
    if (referralConfig.enabled !== false && targetUser.referred_by && totalStaked > 0) {
      const refMobile = targetUser.referred_by.replace(/[^0-9]/g, '').slice(-10);
      const userCleanMob = targetUser.mobile.replace(/[^0-9]/g, '').slice(-10);

      if (refMobile && refMobile !== userCleanMob) {
        const commRate = (referralConfig.commissionPercentage || 4) / 100;
        const commission = parseFloat((totalStaked * commRate).toFixed(2));
        if (commission > 0) {
          let referrer = registeredUsers.find(u => (u.mobile || '').replace(/[^0-9]/g, '').slice(-10) === refMobile);
          if (referrer) {
            referrer.commission_balance = parseFloat(((referrer.commission_balance || 0) + commission).toFixed(2));
            referrer.balance = parseFloat(((referrer.deposit_balance || 0) + (referrer.winning_balance || 0) + referrer.commission_balance).toFixed(2));
            referrer.totalCommission = (referrer.totalCommission || 0) + commission;
            console.log(`[Referral Commission] Referrer ${referrer.name} (+91 ${referrer.mobile}) earned ₹${commission} (${referralConfig.commissionPercentage}% of ₹${totalStaked}) from bet by ${targetUser.name}!`);
          }

          // Credit referrer commission balance in MongoDB Atlas
          try {
            const User = require('../models/User');
            User.updateOne(
              { mobile: refMobile },
              { 
                $inc: { commission_balance: commission, wallet_balance: commission, total_commission: commission } 
              }
            ).catch(e => console.error('[MongoDB 4% Commission Error]', e));
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
  let userBets = [];

  if (userMobile && userMobile.trim().length >= 10) {
    const cleanMobile = userMobile.replace(/[^0-9]/g, '').slice(-10);
    const inMemoryUserBets = memoryBets.filter(b => b.user && b.user.replace(/[^0-9]/g, '').slice(-10) === cleanMobile);

    // Deduplicate in-memory bets first
    const seenSet = new Set();
    inMemoryUserBets.forEach(b => {
      const key = `${b.game_name}_${b.number}_${b.bet_amount}_${b.created_at || ''}`;
      if (!seenSet.has(key)) {
        seenSet.add(key);
        userBets.push(b);
      }
    });

    // Query MongoDB Atlas for cloud-stored bets
    try {
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState === 1) {
        const Bet = require('../models/Bet');
        const dbBets = await Bet.find({ $or: [{ mobile: cleanMobile }, { user: cleanMobile }] }).lean();
        dbBets.forEach(dbb => {
          const dbId = String(dbb._id);
          const exists = userBets.some(b => 
            String(b._id || b.id) === dbId ||
            (b.game_name === dbb.game_name && b.number === dbb.number && Math.abs(b.bet_amount - dbb.bet_amount) < 0.01 &&
             Math.abs(new Date(b.created_at || Date.now()).getTime() - new Date(dbb.created_at || dbb.createdAt || Date.now()).getTime()) < 20000)
          );
          if (!exists) {
            userBets.unshift({
              _id: dbId,
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
  }

  return res.json(userBets);
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
  let baseResults = chartRecords[reqDate] ? { ...chartRecords[reqDate] } : {};

  // Ensure all 8 available markets are present for any requested date
  const validGames = ['Desawar', 'Shiv Parwati', 'Delhi Bazar', 'Dubai Market', 'Shree Ganesh', 'Faridabad', 'Ghaziabad', 'Gali'];
  if (Object.keys(baseResults).length === 0) {
    let seed = 0;
    for (let i = 0; i < reqDate.length; i++) seed += reqDate.charCodeAt(i);
    const dswrVal = String((seed * 41 + 83) % 100).padStart(2, '0');
    const shriVal = String((seed * 53 + 29) % 100).padStart(2, '0');
    baseResults = {
      "Desawar": dswrVal,
      "Disawer": dswrVal,
      "Shiv Parwati": String((seed * 11 + 17) % 100).padStart(2, '0'),
      "Delhi Bazar": String((seed * 13 + 29) % 100).padStart(2, '0'),
      "Dubai Market": String((seed * 19 + 37) % 100).padStart(2, '0'),
      "Shree Ganesh": shriVal,
      "Shri Ganesh": shriVal,
      "Faridabad": String((seed * 31 + 19) % 100).padStart(2, '0'),
      "Ghaziabad": String((seed * 23 + 47) % 100).padStart(2, '0'),
      "Gali": String((seed * 17 + 13) % 100).padStart(2, '0')
    };
  }

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
