const Bet = require('../models/Bet');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Draw = require('../models/Draw');
const { memoryBets, userWalletStore, registeredUsers, declaredResultsMap, declaredResultsDateMap, gameSchedulesStore } = require('../store');
const { chartRecords, formatDateKey } = require('../historicalChartStore');
const { getMarketCycleDate } = require('../utils/dateCycle');

// Helper to get consistent IST Date Key (YYYY-MM-DD)
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

function getGameBetDateKey(gameName, d) {
  const sched = gameSchedulesStore[gameName] || 
    (gameName === 'Desawar' ? gameSchedulesStore['Disawer'] : 
    (gameName === 'Disawer' ? gameSchedulesStore['Desawar'] : 
    (gameName === 'Shree Ganesh' ? gameSchedulesStore['Shri Ganesh'] : 
    (gameName === 'Shri Ganesh' ? gameSchedulesStore['Shree Ganesh'] : null))));
  return getMarketCycleDate(gameName, sched, d);
}

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
    'Shiv Parwati',
    'Delhi Bazar',
    'Dubai Market',
    'Shree Ganesh',
    'Faridabad',
    'Ghaziabad',
    'Gali',
    'Desawar'
  ];
  const targetGame = validGameNames.includes(game_name) ? game_name : 'Gali';

  // Check if market betting is enabled by Admin
  const sched = gameSchedulesStore[targetGame] || 
    (targetGame === 'Desawar' ? gameSchedulesStore['Disawer'] : 
    (targetGame === 'Disawer' ? gameSchedulesStore['Desawar'] : 
    (targetGame === 'Shree Ganesh' ? gameSchedulesStore['Shri Ganesh'] : 
    (targetGame === 'Shri Ganesh' ? gameSchedulesStore['Shree Ganesh'] : null))));

  if (sched && sched.enabled === false) {
    return res.status(400).json({ 
      success: false, 
      message: `⚠️ Betting is closed for ${targetGame} today.` 
    });
  }

  // Check if current IST time is within betting window
  if (sched && sched.open && sched.close) {
    const parseMins = (timeStr) => {
      const match = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(timeStr);
      if (!match) return 0;
      let h = parseInt(match[1]);
      const m = parseInt(match[2]);
      const ampm = match[3].toUpperCase();
      if (ampm === 'PM' && h < 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
      return h * 60 + m;
    };

    const istNow = new Date(Date.now() + (5.5 * 60 * 60 * 1000));
    const curMins = istNow.getUTCHours() * 60 + istNow.getUTCMinutes();
    const openMins = parseMins(sched.open);
    const closeMins = parseMins(sched.close);

    let isWindowOpen = false;
    if (closeMins < openMins || targetGame === 'Desawar' || targetGame === 'Disawer') {
      isWindowOpen = (curMins >= openMins || curMins < closeMins);
    } else {
      isWindowOpen = (curMins >= openMins && curMins < closeMins);
    }

    if (!isWindowOpen) {
      return res.status(400).json({
        success: false,
        message: `⚠️ Betting is currently CLOSED for ${targetGame}. Open: ${sched.open}, Close: ${sched.close}.`
      });
    }
  }

  // Universal cycle resolution for this bet
  const targetCycleDate = getGameBetDateKey(targetGame, new Date());
  const istTodayStr = getISTDateStr(new Date());

  // Check if result was already declared specifically FOR THIS CYCLE DATE
  // If targetCycleDate is tomorrow and tomorrow's result hasn't been declared, betting is open.
  // If targetCycleDate is today, check if today's result was already declared:
  const altKey = targetGame === 'Desawar' ? 'Disawer' : (targetGame === 'Disawer' ? 'Desawar' : (targetGame === 'Shree Ganesh' ? 'Shri Ganesh' : (targetGame === 'Shri Ganesh' ? 'Shree Ganesh' : targetGame)));
  const declaredDate = declaredResultsDateMap ? (declaredResultsDateMap[targetGame] || declaredResultsDateMap[altKey]) : null;
  const isResultDeclaredForCycle = (
    (targetCycleDate === istTodayStr && declaredDate === istTodayStr && (
      (declaredResultsMap[targetGame] !== null && declaredResultsMap[targetGame] !== undefined) ||
      (declaredResultsMap[altKey] !== null && declaredResultsMap[altKey] !== undefined)
    )) ||
    (chartRecords[targetCycleDate] && (
      (chartRecords[targetCycleDate][targetGame] && chartRecords[targetCycleDate][targetGame] !== '--') ||
      (chartRecords[targetCycleDate][altKey] && chartRecords[targetCycleDate][altKey] !== '--')
    ))
  );

  if (isResultDeclaredForCycle) {
    return res.status(400).json({
      success: false,
      message: `⚠️ Result already declared for ${targetGame} (${targetCycleDate}). Betting is closed for this round.`
    });
  }

  let totalStaked = 0;
  for (let item of betItems) {
    const amount = parseFloat(item.bet_amount);
    if (!isNaN(amount) && amount > 0) {
      totalStaked += amount;
    }
  }

  // Find target user
  const userMobile = mobile || req.body.userPhone || req.body.phone;
  let targetUser = null;
  let cleanMobile = '';
  if (userMobile && String(userMobile).trim().length >= 10) {
    cleanMobile = String(userMobile).replace(/[^0-9]/g, '').slice(-10);
    targetUser = registeredUsers.find(u => (u.mobile || '').replace(/[^0-9]/g, '').slice(-10) === cleanMobile);
  }

  if (!targetUser && cleanMobile) {
    try {
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState === 1) {
        const User = require('../models/User');
        const dbUser = await User.findOne({ mobile: { $regex: new RegExp(cleanMobile + '$') } }).lean();
        if (dbUser) {
          targetUser = {
            id: dbUser._id.toString(),
            name: dbUser.name || dbUser.username || `User ${cleanMobile.slice(-4)}`,
            mobile: cleanMobile,
            balance: dbUser.wallet_balance || 0.00,
            deposit_balance: dbUser.deposit_balance !== undefined ? dbUser.deposit_balance : (dbUser.wallet_balance || 0.00),
            winning_balance: dbUser.winning_balance !== undefined ? dbUser.winning_balance : 0.00,
            bonus_balance: dbUser.bonus_balance !== undefined ? dbUser.bonus_balance : 200.00,
            commission_balance: dbUser.commission_balance !== undefined ? dbUser.commission_balance : 0.00,
            referral_code: cleanMobile,
            status: 'Active'
          };
          registeredUsers.push(targetUser);
        }
      }
    } catch (e) { }
  }

  if (!targetUser) {
    return res.status(401).json({ 
      success: false, 
      is_deleted: true,
      isDeleted: true,
      message: 'No Authentication' 
    });
  }

  if (targetUser.is_blocked) {
    return res.status(403).json({
      success: false,
      is_blocked: true,
      isBlocked: true,
      error: 'NO_INTERNET',
      message: 'No Internet Connection'
    });
  }

  if (targetUser) {
    if (targetUser.bonus_balance === undefined) targetUser.bonus_balance = 200.00;
    if (targetUser.deposit_balance === undefined) targetUser.deposit_balance = targetUser.balance || 0.00;
    if (targetUser.winning_balance === undefined) targetUser.winning_balance = 0.00;
    if (targetUser.commission_balance === undefined) targetUser.commission_balance = 0.00;

    const maxBonusUsable = Math.min(totalStaked * 0.10, targetUser.bonus_balance || 0);
    const mainWalletBalance = (targetUser.deposit_balance || 0) + (targetUser.winning_balance || 0);
    const totalUsable = maxBonusUsable + mainWalletBalance;

    if (totalUsable < totalStaked) {
      return res.status(400).json({ 
        success: false, 
        message: `Insufficient wallet balance (Need ₹${totalStaked.toFixed(2)}, Total Available: ₹${totalUsable.toFixed(2)}). Please add cash to place bets.` 
      });
    }
  }

  const createdBets = [];
  const batchCreatedAt = new Date().toISOString();

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
      const { settingsConfig } = require('../store');
      let activeMultiplier = 95;
      if (isHaroof) {
        if (targetUser && targetUser.custom_haroof_rate !== undefined && targetUser.custom_haroof_rate !== null && String(targetUser.custom_haroof_rate).trim() !== '' && !isNaN(parseFloat(targetUser.custom_haroof_rate))) {
          activeMultiplier = parseFloat(targetUser.custom_haroof_rate);
        } else {
          activeMultiplier = parseFloat(settingsConfig.haroof_rate || settingsConfig.haroof_multiplier || 9.5);
        }
      } else if (bType.toUpperCase().includes('CROSS')) {
        if (targetUser && targetUser.custom_crossing_rate !== undefined && targetUser.custom_crossing_rate !== null && String(targetUser.custom_crossing_rate).trim() !== '' && !isNaN(parseFloat(targetUser.custom_crossing_rate))) {
          activeMultiplier = parseFloat(targetUser.custom_crossing_rate);
        } else {
          activeMultiplier = parseFloat(settingsConfig.crossing_rate || settingsConfig.crossing_multiplier || 95);
        }
      } else {
        if (targetUser && targetUser.custom_jodi_rate !== undefined && targetUser.custom_jodi_rate !== null && String(targetUser.custom_jodi_rate).trim() !== '' && !isNaN(parseFloat(targetUser.custom_jodi_rate))) {
          activeMultiplier = parseFloat(targetUser.custom_jodi_rate);
        } else {
          activeMultiplier = parseFloat(settingsConfig.jodi_rate || settingsConfig.jodi_multiplier || 95);
        }
      }
      if (isNaN(activeMultiplier) || activeMultiplier <= 0) {
        activeMultiplier = isHaroof ? 9.5 : 95;
      }
      const payout = amount * activeMultiplier;
      const rawNumStr = item.number !== undefined && item.number !== null ? String(item.number).trim() : String(num);
      const formattedNumStr = isHaroof 
        ? String(isNaN(num) ? 0 : Math.abs(num) % 10)
        : (rawNumStr === '00' || num === 100 || num === 0 ? '00' : String(num).padStart(2, '0'));

      const newBet = {
        _id: 'bet_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
        game_name: targetGame,
        bet_type: bType,
        number: num,
        number_str: formattedNumStr,
        bet_amount: amount,
        multiplier: activeMultiplier,
        potential_payout: payout,
        win_amount: 0,
        status: 'pending',
        user: targetUser.name || mobile || 'User',
        mobile: cleanMobile,
        date_key: targetCycleDate,
        createdDateKey: targetCycleDate,
        created_at: batchCreatedAt
      };

      memoryBets.unshift(newBet);
      createdBets.push(newBet);

      try {
        Bet.create({
          game_name: targetGame,
          bet_type: bType,
          number: num,
          bet_amount: amount,
          multiplier: activeMultiplier,
          potential_payout: payout,
          win_amount: 0,
          status: 'pending',
          user: targetUser.name || mobile || 'User',
          mobile: cleanMobile || mobile || '',
          date_key: targetCycleDate,
          createdDateKey: targetCycleDate
        }).then(createdDoc => {
          if (createdDoc && createdDoc._id) {
            newBet._id = String(createdDoc._id);
            newBet.id = String(createdDoc._id);
          }
        }).catch(e => console.error('[Bet DB Persist Error]:', e.message));
      } catch (e) { }
    }
  }

  if (targetUser) {
    // 1. Calculate bonus balance deduction (max 10% usable per bet)
    if (targetUser.bonus_balance === undefined) targetUser.bonus_balance = 200.00;
    if (targetUser.deposit_balance === undefined) targetUser.deposit_balance = targetUser.balance || 0.00;
    if (targetUser.winning_balance === undefined) targetUser.winning_balance = 0.00;
    if (targetUser.commission_balance === undefined) targetUser.commission_balance = 0.00;

    const maxBonusUsable = Math.min(totalStaked * 0.10, targetUser.bonus_balance || 0);
    if (maxBonusUsable > 0) {
      targetUser.bonus_balance = parseFloat(Math.max(0, targetUser.bonus_balance - maxBonusUsable).toFixed(2));
    }

    let remainingRequired = totalStaked - maxBonusUsable;
    const mainWalletStaked = parseFloat(Math.max(0, totalStaked - maxBonusUsable).toFixed(2));

    const bonusRatio = totalStaked > 0 ? (maxBonusUsable / totalStaked) : 0;
    for (let b of createdBets) {
      const bBonus = parseFloat(((b.bet_amount || 0) * bonusRatio).toFixed(2));
      b.bonus_deducted = bBonus;
      b.wallet_deducted = parseFloat(((b.bet_amount || 0) - bBonus).toFixed(2));
      b.main_wallet_amount = b.wallet_deducted;
    }

    // 2. Deduct from Deposit & Winning balance next
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

    // Update aggregate main balance
    targetUser.balance = parseFloat((targetUser.deposit_balance + targetUser.winning_balance).toFixed(2));

    // Process Self-Bet Commission (if Admin set custom self_bet_commission for targetUser) - calculated on real main wallet cash staked
    if (targetUser.self_bet_commission !== undefined && targetUser.self_bet_commission !== null && String(targetUser.self_bet_commission).trim() !== '' && mainWalletStaked > 0) {
      const selfCommPct = parseFloat(targetUser.self_bet_commission);
      if (!isNaN(selfCommPct) && selfCommPct > 0) {
        const selfCommAmount = parseFloat((mainWalletStaked * (selfCommPct / 100)).toFixed(2));
        if (selfCommAmount > 0) {
          targetUser.commission_balance = parseFloat(((targetUser.commission_balance || 0) + selfCommAmount).toFixed(2));
          targetUser.totalCommission = parseFloat(((targetUser.totalCommission || 0) + selfCommAmount).toFixed(2));

          const cleanUserMob = targetUser.mobile.replace(/[^0-9]/g, '').slice(-10);
          try {
            const Transaction = require('../models/Transaction');
            const todayDateKey = getISTDateStr();
            Transaction.create({
              mobile: cleanUserMob,
              type: 'SELF_COMMISSION',
              amount: selfCommAmount,
              status: 'success',
              description: `Self-bet commission (${selfCommPct}%) credited on ₹${mainWalletStaked} main wallet bet`,
              bet_amount: mainWalletStaked,
              commission_rate: selfCommPct,
              date_key: todayDateKey,
              created_at: new Date()
            }).catch(e => console.error('[Self Commission Transaction Error]', e));
          } catch (e) {}
          console.log(`[Self-Bet Commission] User ${targetUser.name} (+91 ${targetUser.mobile}) earned ₹${selfCommAmount} (${selfCommPct}% self-bet commission on ₹${mainWalletStaked} main wallet bet)`);
        }
      }
    }

    // Sync multi-wallet state in MongoDB Atlas
    try {
      const User = require('../models/User');
      const cleanUserMob = targetUser.mobile.replace(/[^0-9]/g, '').slice(-10);
      User.updateOne(
        { mobile: { $regex: new RegExp(cleanUserMob + '$') } },
        {
          $set: {
            deposit_balance: targetUser.deposit_balance,
            winning_balance: targetUser.winning_balance,
            bonus_balance: targetUser.bonus_balance,
            commission_balance: targetUser.commission_balance,
            total_commission: targetUser.totalCommission || targetUser.commission_balance,
            wallet_balance: targetUser.balance
          }
        }
      ).catch(e => console.error('[MongoDB Wallet Sync Error]', e));
    } catch (e) {}

    try {
      const { saveDiskStore } = require('../store');
      saveDiskStore();
    } catch (e) { }

    // Process Dynamic Referral Bet Commission - calculated on real main wallet cash staked
    const { referralConfig } = require('../store');
    if (referralConfig.enabled !== false && targetUser.referred_by && mainWalletStaked > 0) {
      const refMobile = targetUser.referred_by.replace(/[^0-9]/g, '').slice(-10);
      const userCleanMob = targetUser.mobile.replace(/[^0-9]/g, '').slice(-10);

      if (refMobile && refMobile !== userCleanMob) {
        let referrer = registeredUsers.find(u => (u.mobile || '').replace(/[^0-9]/g, '').slice(-10) === refMobile);

        if (!referrer) {
          try {
            const mongoose = require('mongoose');
            if (mongoose.connection.readyState === 1) {
              const User = require('../models/User');
              const dbRef = await User.findOne({ mobile: { $regex: new RegExp(refMobile + '$') } }).lean();
              if (dbRef) {
                referrer = {
                  id: dbRef._id.toString(),
                  name: dbRef.name || dbRef.username || `User ${refMobile.slice(-4)}`,
                  mobile: refMobile,
                  balance: dbRef.wallet_balance || 0.00,
                  deposit_balance: dbRef.deposit_balance !== undefined ? dbRef.deposit_balance : (dbRef.wallet_balance || 0.00),
                  winning_balance: dbRef.winning_balance !== undefined ? dbRef.winning_balance : 0.00,
                  bonus_balance: dbRef.bonus_balance !== undefined ? dbRef.bonus_balance : 200.00,
                  commission_balance: dbRef.commission_balance !== undefined ? dbRef.commission_balance : 0.00,
                  custom_referral_commission: dbRef.custom_referral_commission !== undefined ? dbRef.custom_referral_commission : null,
                  referral_code: refMobile,
                  status: 'Active'
                };
                registeredUsers.push(referrer);
              }
            }
          } catch (e) {}
        }

        let commPercentage = (referralConfig.commissionPercentage || 4);
        if (referrer && referrer.custom_referral_commission !== undefined && referrer.custom_referral_commission !== null && String(referrer.custom_referral_commission).trim() !== '') {
          const customVal = parseFloat(referrer.custom_referral_commission);
          if (!isNaN(customVal) && customVal >= 0) {
            commPercentage = customVal;
          }
        }

        const commRate = commPercentage / 100;
        const commission = parseFloat((mainWalletStaked * commRate).toFixed(2));

        if (commission > 0) {
          const todayDateKey = getISTDateStr();
          if (referrer) {
            referrer.commission_balance = parseFloat(((referrer.commission_balance || 0) + commission).toFixed(2));
            referrer.totalCommission = parseFloat(((referrer.totalCommission || 0) + commission).toFixed(2));
            console.log(`[Referral Commission] Referrer ${referrer.name} (+91 ${referrer.mobile}) earned ₹${commission} (${commPercentage}% rate on ₹${totalStaked} bet) from bet by ${targetUser.name}!`);
          }

          // Credit referrer commission balance in MongoDB Atlas and record Transaction log
          try {
            const User = require('../models/User');
            User.updateOne(
              { mobile: { $regex: new RegExp(refMobile + '$') } },
              { 
                $inc: { commission_balance: commission, total_commission: commission } 
              }
            ).catch(e => console.error('[MongoDB Commission Error]', e));

            const Transaction = require('../models/Transaction');
            Transaction.create({
              mobile: refMobile,
              type: 'COMMISSION',
              amount: commission,
              status: 'success',
              description: `Referral commission (${commPercentage}%) from ${targetUser.name || userCleanMob} on ₹${totalStaked} bet`,
              from_mobile: userCleanMob,
              from_name: targetUser.name || `User ${userCleanMob.slice(-4)}`,
              bet_amount: totalStaked,
              commission_rate: commPercentage,
              date_key: todayDateKey,
              created_at: new Date()
            }).catch(e => console.error('[MongoDB Commission Transaction Error]', e));
          } catch (e) {}

          // Stamp commission metadata onto bets
          for (let b of createdBets) {
            b.referral_commission = commission / createdBets.length;
            b.commission_rate = referralConfig.commissionPercentage || 4;
            b.referrer_mobile = refMobile;
            b.createdDateKey = todayDateKey;
          }
        }
      }
    }
  }

  for (let b of createdBets) {
    b.user = targetUser ? `${targetUser.name} (${targetUser.mobile})` : 'yogibbk (7206561420)';
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
    const cutoff40Days = Date.now() - (40 * 24 * 60 * 60 * 1000);

    const inMemoryUserBets = memoryBets.filter(b => {
      const bMob = b.mobile || b.user;
      if (!bMob) return false;
      const cleanB = String(bMob).replace(/[^0-9]/g, '').slice(-10);
      if (cleanB !== cleanMobile) return false;
      const bTime = b.created_at || b.createdAt ? new Date(b.created_at || b.createdAt).getTime() : Date.now();
      return !isNaN(bTime) && bTime >= cutoff40Days;
    });

    // Deduplicate in-memory bets first
    const seenSet = new Set();
    inMemoryUserBets.forEach(b => {
      const isHar = String(b.bet_type || '').toUpperCase().includes('HAR') || String(b.bet_type || '').toUpperCase().includes('ANDER') || String(b.bet_type || '').toUpperCase().includes('BAHAR');
      const numStr = b.number_str || (isHar ? String(b.number) : (b.number === 0 || b.number === 100 ? '00' : String(b.number)));
      const key = `${b._id || b.id || ''}_${b.game_name}_${b.bet_type || ''}_${numStr}_${b.bet_amount}_${b.created_at || ''}`;
      if (!seenSet.has(key)) {
        seenSet.add(key);
        userBets.push({
          ...b,
          number_str: numStr
        });
      }
    });

    // Query MongoDB Atlas for cloud-stored bets up to 40 days
    try {
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState === 1) {
        const Bet = require('../models/Bet');
        const dbBets = await Bet.find({
          $or: [{ mobile: cleanMobile }, { user: cleanMobile }],
          createdAt: { $gte: new Date(cutoff40Days) }
        }).sort({ createdAt: -1 }).lean();

        dbBets.forEach(dbb => {
          const dbId = String(dbb._id);
          const dbBType = String(dbb.bet_type || 'JODI').toUpperCase();
          const exists = userBets.some(b => 
            String(b._id || b.id) === dbId ||
            (b.game_name === dbb.game_name && 
             String(b.bet_type || 'JODI').toUpperCase() === dbBType && 
             String(b.number) === String(dbb.number) && 
             Math.abs(b.bet_amount - dbb.bet_amount) < 0.01 &&
             Math.abs(new Date(b.created_at || Date.now()).getTime() - new Date(dbb.created_at || dbb.createdAt || Date.now()).getTime()) < 20000)
          );
          if (!exists) {
            const isHar = String(dbb.bet_type || '').toUpperCase().includes('HAR') || String(dbb.bet_type || '').toUpperCase().includes('ANDER') || String(dbb.bet_type || '').toUpperCase().includes('BAHAR');
            const formattedStr = isHar ? String(dbb.number) : (String(dbb.number) === '0' || String(dbb.number) === '100' ? '00' : String(dbb.number).padStart(2, '0'));
            userBets.push({
              _id: dbId,
              game_name: dbb.game_name,
              bet_type: dbb.bet_type || 'JODI',
              number: dbb.number,
              number_str: dbb.number_str || formattedStr,
              bet_amount: dbb.bet_amount,
              potential_payout: dbb.potential_payout || (dbb.bet_amount * 95),
              win_amount: dbb.win_amount || 0,
              status: dbb.status || 'pending',
              user: dbb.user || cleanMobile,
              mobile: dbb.mobile || cleanMobile,
              ...(dbb.created_at || dbb.createdAt ? { created_at: dbb.created_at || dbb.createdAt } : {})
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
  const activeResults = {};
  const { isGameInOpenWindow } = require('../utils/dateCycle');

  // Get today and yesterday date keys in IST
  const istNow = new Date(new Date().getTime() + (5.5 * 60 * 60 * 1000));
  const todayKey = `${istNow.getUTCFullYear()}-${String(istNow.getUTCMonth() + 1).padStart(2, '0')}-${String(istNow.getUTCDate()).padStart(2, '0')}`;
  const yesterdayIST = new Date(istNow.getTime() - (24 * 60 * 60 * 1000));
  const yesterdayKey = `${yesterdayIST.getUTCFullYear()}-${String(yesterdayIST.getUTCMonth() + 1).padStart(2, '0')}-${String(yesterdayIST.getUTCDate()).padStart(2, '0')}`;

  Object.keys(declaredResultsMap).forEach(game => {
    const numVal = declaredResultsMap[game];
    if (numVal !== null && numVal !== undefined) {
      const declaredDate = declaredResultsDateMap ? declaredResultsDateMap[game] : null;
      // Block results that are 2+ days old (not today, not yesterday)
      if (declaredDate && declaredDate !== todayKey && declaredDate !== yesterdayKey) {
        return;
      }
      // Results remain active while betting window is closed
      // When game opens next day, isGameInOpenWindow returns true → result hidden → auto-clear deletes it
      if (!isGameInOpenWindow(game)) {
        activeResults[game] = numVal;
      }
    }
  });
  res.json(activeResults);
};

// @desc    Get date-wise chart results for all games (Historical & Live from DB)
// @route   GET /api/game/chart-results?date=YYYY-MM-DD
// @access  Public
const getChartResults = async (req, res) => {
  const reqDate = req.query.date || formatDateKey(new Date());

  const todayKey = formatDateKey(new Date());
  const istNow = new Date(new Date().getTime() + (5.5 * 60 * 60 * 1000));
  const istKey = formatDateKey(istNow);

  const validGames = ['Shiv Parwati', 'Delhi Bazar', 'Dubai Market', 'Shree Ganesh', 'Faridabad', 'Ghaziabad', 'Gali', 'Desawar'];

  // 1. Start with chartRecords from memory
  let baseResults = chartRecords[reqDate] ? { ...chartRecords[reqDate] } : {};

  // 2. Query MongoDB Atlas for cloud records for the requested date (Persistent Truth)
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      const ResultRecord = require('../models/ResultRecord');
      const dbRecords = await ResultRecord.find({ date_key: reqDate });
      dbRecords.forEach(r => {
        if (r.game_name && r.winning_number && r.winning_number !== '--') {
          const valStr = String(r.winning_number).padStart(2, '0');
          baseResults[r.game_name] = valStr;
          if (r.game_name === 'Desawar') baseResults['Disawer'] = valStr;
          if (r.game_name === 'Disawer') baseResults['Desawar'] = valStr;
          if (r.game_name === 'Shree Ganesh') baseResults['Shri Ganesh'] = valStr;
          if (r.game_name === 'Shri Ganesh') baseResults['Shree Ganesh'] = valStr;
        }
      });
    }
  } catch (e) {
    console.error('[MongoDB Chart Fetch Error]', e);
  }

  // 3. Query memoryResultsHistory for the requested date
  try {
    const { memoryResultsHistory } = require('../store');
    if (Array.isArray(memoryResultsHistory)) {
      memoryResultsHistory.forEach(r => {
        if (r.date === reqDate && r.number !== undefined && r.number !== null && r.number !== '--') {
          const gName = r.game_name || r.category;
          if (gName) {
            const valStr = String(r.number).padStart(2, '0');
            baseResults[gName] = valStr;
            if (gName === 'Desawar') baseResults['Disawer'] = valStr;
            if (gName === 'Disawer') baseResults['Desawar'] = valStr;
            if (gName === 'Shree Ganesh') baseResults['Shri Ganesh'] = valStr;
            if (gName === 'Shri Ganesh') baseResults['Shree Ganesh'] = valStr;
          }
        }
      });
    }
  } catch (e) {}

  // 4. If date is today, overlay active declaredResultsMap ONLY IF a result was declared for reqDate
  if (reqDate === todayKey || reqDate === istKey) {
    validGames.forEach(game => {
      const declaredNum = declaredResultsMap[game];
      const declaredDate = declaredResultsDateMap ? declaredResultsDateMap[game] : null;
      if (declaredNum !== null && declaredNum !== undefined && (!declaredDate || declaredDate === reqDate)) {
        const valStr = String(declaredNum).padStart(2, '0');
        baseResults[game] = valStr;
        if (game === 'Desawar') baseResults['Disawer'] = valStr;
        if (game === 'Disawer') baseResults['Desawar'] = valStr;
        if (game === 'Shree Ganesh') baseResults['Shri Ganesh'] = valStr;
        if (game === 'Shri Ganesh') baseResults['Shree Ganesh'] = valStr;
      }
    });
  }

  // 5. Fill any unannounced game with '--' (NEVER overwrite declared results and NEVER generate fake seed numbers!)
  validGames.forEach(game => {
    if (!baseResults[game] || baseResults[game] === '') {
      baseResults[game] = '--';
      if (game === 'Desawar') baseResults['Disawer'] = '--';
      if (game === 'Disawer') baseResults['Desawar'] = '--';
      if (game === 'Shree Ganesh') baseResults['Shri Ganesh'] = '--';
      if (game === 'Shri Ganesh') baseResults['Shree Ganesh'] = '--';
    }
  });

  res.json({
    date: reqDate,
    results: baseResults
  });
};

module.exports = { placeBet, getMyBets, getResults, getChartResults, memoryBets };
