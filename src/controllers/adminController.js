const { userWalletStore, memoryDeposits, memoryWithdrawals, memoryBets, registeredUsers, declaredResultsMap, declaredResultsDateMap, gameSchedulesStore, saveDiskStore, memoryGameLedger, purgeOldLedger } = require('../store');
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
  const utcMs = d.getTime() + (d.getTimezoneOffset() * 60000);
  const istDate = new Date(utcMs + (5.5 * 60 * 60 * 1000));
  const yyyy = istDate.getFullYear();
  const mm = String(istDate.getMonth() + 1).padStart(2, '0');
  const dd = String(istDate.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Canonicalize market names (eliminate Desawar/Disawer and Shree Ganesh/Shri Ganesh duplicate aliases)
function getCanonicalGameName(name) {
  if (!name) return '';
  const n = String(name).trim();
  if (n.toLowerCase() === 'disawer' || n.toLowerCase() === 'desawar') return 'Desawar';
  if (n.toLowerCase() === 'shri ganesh' || n.toLowerCase() === 'shree ganesh') return 'Shree Ganesh';
  return n;
}

function getGameBetDateKey(gameName, d) {
  const sched = gameSchedulesStore[gameName] || 
    (gameName === 'Desawar' ? gameSchedulesStore['Disawer'] : 
    (gameName === 'Disawer' ? gameSchedulesStore['Desawar'] : 
    (gameName === 'Shree Ganesh' ? gameSchedulesStore['Shri Ganesh'] : 
    (gameName === 'Shri Ganesh' ? gameSchedulesStore['Shree Ganesh'] : null))));
  return getMarketCycleDate(gameName, sched, d);
}

// @desc    Get dashboard stats
// @desc    Get dashboard stats including real-time user, bet, deposit, winning, and wallet metrics
// @route   GET /api/admin/stats
const getStats = async (req, res) => {
  try {
    const getISTDateStrings = (targetDateObj) => {
      const d = targetDateObj || new Date();
      const ist = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
      const yyyy = ist.getFullYear();
      const mm = String(ist.getMonth() + 1).padStart(2, '0');
      const dd = String(ist.getDate()).padStart(2, '0');
      return {
        iso: `${yyyy}-${mm}-${dd}`,
        dmy: `${dd}-${mm}-${yyyy}`,
        ymd: `${yyyy}-${mm}-${dd}`,
        display: `${dd}/${mm}/${yyyy}`
      };
    };

    const todayIST = getISTDateStrings(new Date());

    const parseDateToISTStrings = (str, defaultObj) => {
      if (!str) return defaultObj;
      const s = String(str).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const [y, m, d] = s.split('-').map(Number);
        return {
          iso: s,
          dmy: `${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}-${y}`,
          ymd: s,
          display: `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
        };
      } else if (/^\d{2}-\d{2}-\d{4}$/.test(s)) {
        const [d, m, y] = s.split('-').map(Number);
        const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        return {
          iso,
          dmy: s,
          ymd: iso,
          display: `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
        };
      } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
        const [d, m, y] = s.split('/').map(Number);
        const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        return {
          iso,
          dmy: `${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}-${y}`,
          ymd: iso,
          display: s
        };
      }
      return defaultObj;
    };

    // Parse requested start and end dates (?startDate=...&endDate=... or ?date=...)
    const reqStartDateStr = req.query.startDate || req.query.start_date || req.query.date || '';
    const reqEndDateStr = req.query.endDate || req.query.end_date || req.query.date || '';

    const startDatesParsed = parseDateToISTStrings(reqStartDateStr, todayIST);
    const endDatesParsed = parseDateToISTStrings(reqEndDateStr, startDatesParsed);

    const startISO = startDatesParsed.iso <= endDatesParsed.iso ? startDatesParsed.iso : endDatesParsed.iso;
    const endISO = startDatesParsed.iso <= endDatesParsed.iso ? endDatesParsed.iso : startDatesParsed.iso;
    const isSingleDay = (startISO === endISO);
    const isTodaySelected = isSingleDay && (startISO === todayIST.iso);

    const getItemISTDate = (item) => {
      if (!item) return null;
      const mongoose = require('mongoose');
      let mongoId = null;
      let dateVal = '';
      let dateKey = '';

      if (typeof item === 'object' && item !== null) {
        dateKey = item.createdDateKey || item.date_key || item.txn_date || '';
        dateVal = item.createdAt || item.created_at || item.date || item.timestamp || '';
        mongoId = item._id || item.id;
      } else {
        dateVal = String(item);
      }

      // 1. Check if ID contains a 13-digit Unix millisecond timestamp
      if (mongoId) {
        const idStr = String(mongoId);
        const match = idStr.match(/(\d{13})/);
        if (match) {
          try {
            const timestamp = parseInt(match[1], 10);
            if (timestamp > 1600000000000 && timestamp < 2500000000000) {
              const d = new Date(timestamp);
              if (!isNaN(d.getTime())) return d;
            }
          } catch (e) {}
        }

        // 2. Valid MongoDB ObjectId (first 4 bytes = timestamp)
        if (typeof idStr === 'string' && /^[0-9a-fA-F]{24}$/.test(idStr)) {
          try {
            const epochSec = parseInt(idStr.substring(0, 8), 16);
            if (epochSec > 1600000000 && epochSec < 2500000000) {
              return new Date(epochSec * 1000);
            }
          } catch (e) {}
        }
      }

      // 3. Numeric timestamp
      if (typeof dateVal === 'number' && dateVal > 1000000000000) {
        return new Date(dateVal);
      }

      // 4. ISO or standard date string
      if (dateVal) {
        const vStr = String(dateVal).trim();
        if (vStr.includes('-') || vStr.includes('/') || vStr.includes('T') || vStr.includes('Z') || vStr.includes('GMT')) {
          const parsed = new Date(vStr);
          if (!isNaN(parsed.getTime())) return parsed;
          const dmy = vStr.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?\s*(AM|PM)?)?/i);
          if (dmy) {
            let [_, d, m, y, hr, min, sec, ampm] = dmy;
            let h = hr ? parseInt(hr, 10) : 0;
            if (ampm && ampm.toUpperCase() === 'PM' && h < 12) h += 12;
            if (ampm && ampm.toUpperCase() === 'AM' && h === 12) h = 0;
            return new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), h, min ? parseInt(min, 10) : 0, sec ? parseInt(sec, 10) : 0);
          }
        }
      }

      // 5. dateKey (YYYY-MM-DD or DD-MM-YYYY)
      if (dateKey) {
        const kStr = String(dateKey).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(kStr)) {
          return new Date(kStr + 'T12:00:00+05:30');
        }
        const dmy = kStr.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
        if (dmy) {
          return new Date(parseInt(dmy[3], 10), parseInt(dmy[2], 10) - 1, parseInt(dmy[1], 10), 12, 0, 0);
        }
      }

      return null;
    };

    const getItemISODate = (item) => {
      const d = getItemISTDate(item);
      if (!d || isNaN(d.getTime())) return null;
      const itemIST = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
      const yyyy = itemIST.getFullYear();
      const mm = String(itemIST.getMonth() + 1).padStart(2, '0');
      const dd = String(itemIST.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    };

    const isTargetDate = (item) => {
      if (!item) return false;
      const iso = getItemISODate(item);
      if (iso) {
        return iso >= startISO && iso <= endISO;
      }

      // Fallback matching
      let str = '';
      if (typeof item === 'object') {
        str = String(item.createdDateKey || item.date_key || item.txn_date || item.createdAt || item.created_at || item.date || '');
      } else {
        str = String(item);
      }
      const m = str.match(/(\d{4}-\d{2}-\d{2})/);
      if (m) {
        return m[1] >= startISO && m[1] <= endISO;
      }
      const mDmy = str.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
      if (mDmy) {
        const isoFromDmy = `${mDmy[3]}-${String(mDmy[2]).padStart(2, '0')}-${String(mDmy[1]).padStart(2, '0')}`;
        return isoFromDmy >= startISO && isoFromDmy <= endISO;
      }
      if (isTodaySelected && /^\d{1,2}:\d{1,2}/.test(str)) {
        return true;
      }
      return false;
    };

    const getItemHourSlot = (item) => {
      const d = getItemISTDate(item);
      if (!d || isNaN(d.getTime())) return 2;
      const ist = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
      const h = ist.getHours();
      return Math.min(5, Math.max(0, Math.floor(h / 4)));
    };

    const { registeredUsers, memoryDeposits, memoryWithdrawals, memoryBets, deletedMobiles } = require('../store');
    const delMobs = deletedMobiles || [];
    let depositsList = (memoryDeposits || []).filter(d => d && d.type !== 'commission_transfer');
    let withdrawalsList = [...(memoryWithdrawals || [])];
    let betsList = [...(memoryBets || [])];

    // Merge/override from MongoDB Atlas if connected
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      try {
        const User = require('../models/User');
        const Bet = require('../models/Bet');
        const Transaction = require('../models/Transaction');
        const DepositRequest = require('../models/DepositRequest');
        const WithdrawalRequest = require('../models/WithdrawalRequest');

        const dbUsers = await User.find({}).lean().catch(() => []);
        if (dbUsers && dbUsers.length > 0) {
          dbUsers.forEach(dbu => {
            const cleanMobile = (dbu.mobile || '').replace(/[^0-9]/g, '').slice(-10);
            if (cleanMobile && !delMobs.includes(cleanMobile)) {
              let memUser = registeredUsers.find(u => (u.mobile || '').replace(/[^0-9]/g, '').slice(-10) === cleanMobile);
              if (!memUser) {
                registeredUsers.push({
                  id: dbu._id,
                  name: dbu.name || dbu.username || `User ${cleanMobile.slice(-4)}`,
                  mobile: cleanMobile,
                  balance: dbu.wallet_balance || 0.00,
                  deposit_balance: dbu.deposit_balance || 0.00,
                  winning_balance: dbu.winning_balance || 0.00,
                  bonus_balance: dbu.bonus_balance !== undefined ? dbu.bonus_balance : 200.00,
                  commission_balance: dbu.commission_balance || 0.00,
                  status: 'Active',
                  createdAt: dbu.createdAt ? new Date(dbu.createdAt).toISOString() : new Date().toISOString()
                });
              }
            }
          });
        }

        const dbBets = await Bet.find({}).lean().catch(() => []);
        if (dbBets && dbBets.length > 0) {
          betsList = dbBets;
        }

        const dbDeps = await DepositRequest.find({}).lean().catch(() => []);
        const dbTxns = await Transaction.find({ type: 'deposit' }).lean().catch(() => []);

        // Combine memoryDeposits, DepositRequest and Transaction without duplication
        const combinedDeps = [];
        const seenDepIds = new Set();
        const seenDepUtrs = new Set();

        // 1. From DepositRequest (database)
        dbDeps.forEach(d => {
          const id = String(d._id);
          const utr = d.utr_number || d.utr;
          seenDepIds.add(id);
          if (utr && utr !== 'N/A') seenDepUtrs.add(String(utr));
          combinedDeps.push(d);
        });

        // 2. From Transaction (database)
        dbTxns.forEach(t => {
          const id = String(t._id);
          const ref = t.reference_id || t.utr;
          if (seenDepIds.has(id)) return;
          if (ref && seenDepUtrs.has(String(ref))) return;
          seenDepIds.add(id);
          if (ref && ref !== 'N/A') seenDepUtrs.add(String(ref));
          combinedDeps.push(t);
        });

        // 3. From memoryDeposits (in-memory)
        memoryDeposits.filter(m => m && m.type !== 'commission_transfer').forEach(m => {
          const id = String(m._id || m.id);
          const utr = m.utr_number || m.utr || m.client_txn_id;
          if (seenDepIds.has(id)) return;
          if (utr && seenDepUtrs.has(String(utr))) return;
          combinedDeps.push(m);
        });

        depositsList = combinedDeps;

        // Combine memoryWithdrawals, WithdrawalRequest and Transaction without duplication
        const dbWths = await WithdrawalRequest.find({}).lean().catch(() => []);
        const dbWds = await Transaction.find({ type: 'withdrawal' }).lean().catch(() => []);

        const combinedWds = [];
        const seenWdIds = new Set();

        dbWths.forEach(w => {
          seenWdIds.add(String(w._id));
          combinedWds.push(w);
        });

        dbWds.forEach(t => {
          const id = String(t._id);
          const ref = t.reference_id;
          if (seenWdIds.has(id)) return;
          if (ref && seenWdIds.has(String(ref))) return;
          seenWdIds.add(id);
          combinedWds.push(t);
        });

        memoryWithdrawals.forEach(m => {
          const id = String(m._id || m.id);
          if (seenWdIds.has(id)) return;
          combinedWds.push(m);
        });

        withdrawalsList = combinedWds;
      } catch (dbErr) {
        console.error('[getStats DB Sync Error]', dbErr.message);
      }
    }

    // 1. Users metrics
    const usersList = registeredUsers.filter(u => {
      const cleanMob = String(u.mobile || '').replace(/[^0-9]/g, '').slice(-10);
      return cleanMob && !delMobs.includes(cleanMob);
    });
    const usersCount = usersList.length;
    const dailyNewUsers = usersList.filter(u => isTargetDate(u)).length;

    // 2. Deposits metrics
    const approvedDeposits = depositsList.filter(d => d && (d.status === 'Approved' || d.status === 'approved' || d.status === 'success' || d.status === 'completed'));
    const totalDeposite = approvedDeposits.reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0);
    const targetDeposits = approvedDeposits.filter(d => isTargetDate(d));
    const todayDeposite = targetDeposits.reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0);

    // 3. Withdrawals metrics
    const approvedWithdraws = withdrawalsList.filter(w => w && (w.status === 'Approved' || w.status === 'approved' || w.status === 'success' || w.status === 'completed'));
    const totalWithdraws = approvedWithdraws.reduce((sum, w) => sum + (parseFloat(w.amount) || 0), 0);
    const targetWithdraws = approvedWithdraws.filter(w => isTargetDate(w));
    const todayWithdraws = targetWithdraws.reduce((sum, w) => sum + (parseFloat(w.amount) || 0), 0);

    // 4. Betting metrics
    const totalBetting = betsList.reduce((sum, b) => sum + (parseFloat(b.amount || b.bet_amount) || 0), 0);
    const todayBetting = betsList.filter(b => isTargetDate(b)).reduce((sum, b) => sum + (parseFloat(b.amount || b.bet_amount) || 0), 0);

    // 5. Winning metrics
    const winningBets = betsList.filter(b => b.status === 'won' || b.status === 'Won' || (parseFloat(b.win_amount) > 0));
    const totalWinnings = winningBets.reduce((sum, b) => sum + (parseFloat(b.win_amount || (b.amount * 95)) || 0), 0);
    const todayWinnings = winningBets.filter(b => isTargetDate(b)).reduce((sum, b) => sum + (parseFloat(b.win_amount || (b.amount * 95)) || 0), 0);

    // 6. Wallet balance metrics
    const totalBalanceWallet = usersList.reduce((sum, u) => sum + (parseFloat(u.balance !== undefined ? u.balance : (u.wallet_balance || 0)) || 0), 0);
    const totalDepositWallet = usersList.reduce((sum, u) => sum + (parseFloat(u.deposit_balance) || 0), 0);
    const totalWinningWallet = usersList.reduce((sum, u) => sum + (parseFloat(u.winning_balance) || 0), 0);
    const totalBonusWallet = usersList.reduce((sum, u) => sum + (parseFloat(u.bonus_balance !== undefined ? u.bonus_balance : 200) || 0), 0);
    const totalCommissionWallet = (totalBetting * 0.04);

    // 7. Breakdown for charts
    let chartDeposits = [];
    let chartWithdraws = [];
    let chartLabels = [];

    if (isSingleDay) {
      chartDeposits = [0, 0, 0, 0, 0, 0];
      targetDeposits.forEach(d => {
        const slot = getItemHourSlot(d);
        chartDeposits[slot] += (parseFloat(d.amount) || 0);
      });

      chartWithdraws = [0, 0, 0, 0, 0, 0];
      targetWithdraws.forEach(w => {
        const slot = getItemHourSlot(w);
        chartWithdraws[slot] += (parseFloat(w.amount) || 0);
      });

      chartLabels = ["12 AM - 4 AM", "4 AM - 8 AM", "8 AM - 12 PM", "12 PM - 4 PM", "4 PM - 8 PM", "8 PM - 12 AM"];
    } else {
      const sDate = new Date(startISO + 'T12:00:00');
      const eDate = new Date(endISO + 'T12:00:00');
      const diffDays = Math.min(31, Math.max(2, Math.round((eDate.getTime() - sDate.getTime()) / (1000 * 60 * 60 * 24)) + 1));
      
      const dayMap = {};
      for (let i = 0; i < diffDays; i++) {
        const cur = new Date(sDate.getTime() + i * 86400000);
        const y = cur.getFullYear();
        const m = String(cur.getMonth() + 1).padStart(2, '0');
        const d = String(cur.getDate()).padStart(2, '0');
        const iso = `${y}-${m}-${d}`;
        dayMap[iso] = i;
        chartLabels.push(`${d}/${m}`);
        chartDeposits.push(0);
        chartWithdraws.push(0);
      }

      targetDeposits.forEach(d => {
        const iso = getItemISODate(d);
        if (iso && dayMap[iso] !== undefined) {
          chartDeposits[dayMap[iso]] += (parseFloat(d.amount) || 0);
        }
      });

      targetWithdraws.forEach(w => {
        const iso = getItemISODate(w);
        if (iso && dayMap[iso] !== undefined) {
          chartWithdraws[dayMap[iso]] += (parseFloat(w.amount) || 0);
        }
      });
    }

    return res.json({
      success: true,
      users: usersCount,
      dailyNewUsers,
      totalDeposite,
      todayDeposite,
      totalWinnings,
      todayWinnings,
      totalBetting,
      todayBetting,
      totalWithdraws,
      todayWithdraws,
      totalBalanceWallet,
      totalDepositWallet,
      totalWinningWallet,
      totalCommissionWallet,
      totalBonusWallet,
      startDate: startISO,
      endDate: endISO,
      startDateDisplay: startDatesParsed.display,
      endDateDisplay: endDatesParsed.display,
      isSingleDay,
      isToday: isTodaySelected,
      chartDeposits,
      chartWithdraws,
      chartLabels
    });
  } catch (err) {
    console.error('[getStats Error]', err.message);
    res.status(500).json({ success: false, message: 'Server error computing dashboard stats' });
  }
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
          let memUser = registeredUsers.find(u => u.mobile && u.mobile.replace(/[^0-9]/g, '').slice(-10) === cleanMobile);
          const delMobiles = (require('../store').deletedMobiles || []);
          const isDeleted = delMobiles.some(dm => dm === cleanMobile);
          if (!memUser && !isDeleted) {
            memUser = {
              id: dbu._id || `usr_${Date.now()}_${cleanMobile}`,
              name: dbu.name || dbu.username || `User ${cleanMobile.slice(-4)}`,
              mobile: cleanMobile,
              balance: dbu.wallet_balance || 0.00,
              deposit_balance: dbu.deposit_balance || 0.00,
              winning_balance: dbu.winning_balance || 0.00,
              bonus_balance: dbu.bonus_balance !== undefined ? dbu.bonus_balance : 200.00,
              commission_balance: dbu.commission_balance || 0.00,
              custom_referral_commission: dbu.custom_referral_commission !== undefined ? dbu.custom_referral_commission : null,
              referral_enabled: dbu.referral_enabled !== undefined ? dbu.referral_enabled : true,
              custom_jodi_rate: dbu.custom_jodi_rate !== undefined ? dbu.custom_jodi_rate : null,
              custom_haroof_rate: dbu.custom_haroof_rate !== undefined ? dbu.custom_haroof_rate : null,
              custom_crossing_rate: dbu.custom_crossing_rate !== undefined ? dbu.custom_crossing_rate : null,
              self_bet_commission: dbu.self_bet_commission !== undefined ? dbu.self_bet_commission : null,
              referral_code: cleanMobile,
              referred_by: dbu.referred_by ? String(dbu.referred_by).replace(/[^0-9]/g, '').slice(-10) : null,
              status: 'Active',
              createdAt: dbu.createdAt ? new Date(dbu.createdAt).toISOString() : new Date().toISOString()
            };
            registeredUsers.push(memUser);
          } else if (memUser) {
            if (dbu.name && dbu.name !== 'User') memUser.name = dbu.name;
            if (dbu.deposit_balance !== undefined) memUser.deposit_balance = dbu.deposit_balance;
            if (dbu.winning_balance !== undefined) memUser.winning_balance = dbu.winning_balance;
            if (dbu.bonus_balance !== undefined) memUser.bonus_balance = dbu.bonus_balance;
            if (dbu.commission_balance !== undefined) memUser.commission_balance = dbu.commission_balance;
            if (dbu.wallet_balance !== undefined) memUser.balance = dbu.wallet_balance;
            if (dbu.custom_referral_commission !== undefined) memUser.custom_referral_commission = dbu.custom_referral_commission;
            if (dbu.referral_enabled !== undefined) memUser.referral_enabled = dbu.referral_enabled;
            if (dbu.custom_jodi_rate !== undefined) memUser.custom_jodi_rate = dbu.custom_jodi_rate;
            if (dbu.custom_haroof_rate !== undefined) memUser.custom_haroof_rate = dbu.custom_haroof_rate;
            if (dbu.custom_crossing_rate !== undefined) memUser.custom_crossing_rate = dbu.custom_crossing_rate;
            if (dbu.self_bet_commission !== undefined) memUser.self_bet_commission = dbu.self_bet_commission;
            if (dbu.referred_by && !memUser.referred_by) {
              memUser.referred_by = String(dbu.referred_by).replace(/[^0-9]/g, '').slice(-10);
            }
            memUser.referral_code = cleanMobile;
          }
        }
      });
    }
  } catch (e) { }

  // Clean out any users not in MongoDB or explicitly deleted
  const deletedMobiles = (require('../store').deletedMobiles || []);
  for (let i = registeredUsers.length - 1; i >= 0; i--) {
    const uMob = (registeredUsers[i].mobile || '').replace(/[^0-9]/g, '').slice(-10);
    if (deletedMobiles.includes(uMob)) {
      registeredUsers.splice(i, 1);
    }
  }

  // Normalize mobile and referral codes (remove REF prefix everywhere, use 10-digit mobile)
  registeredUsers.forEach(u => {
    const cleanMob = String(u.mobile || '').replace(/[^0-9]/g, '').slice(-10);
    if (cleanMob) {
      u.mobile = cleanMob;
      u.referral_code = cleanMob;
      if (u.referred_by) {
        u.referred_by = String(u.referred_by).replace(/[^0-9]/g, '').slice(-10);
      }
    }
  });

  // Calculate dynamic referral counts and referBy relationships for every user
  registeredUsers.forEach(u => {
    const cleanMob = String(u.mobile || '').replace(/[^0-9]/g, '').slice(-10);
    const count = registeredUsers.filter(other => {
      if (other === u) return false;
      const otherRefBy = String(other.referred_by || other.referBy || '').replace(/[^0-9]/g, '').slice(-10);
      return otherRefBy && otherRefBy === cleanMob;
    }).length;

    u.referrals = count;
    u.referrals_count = count;
    u.total_referrals = count;

    const cleanRefBy = u.referred_by ? String(u.referred_by).replace(/[^0-9]/g, '').slice(-10) : '';
    u.referBy = cleanRefBy;
    u.referred_by = cleanRefBy;
  });

  const nameCounts = {};
  registeredUsers.forEach(u => {
    let rawName = (u.name || u.username || '').trim();
    if (!rawName || rawName.toLowerCase() === 'user' || /^User \d{4}$/i.test(rawName)) {
      const mob = (u.mobile || u.phone || '').replace(/[^0-9]/g, '').slice(-10);
      rawName = mob ? `user${mob}` : 'user';
    }

    const cleanName = rawName.replace(/[^a-zA-Z0-9._\-]/g, '');
    const lowerKey = cleanName.toLowerCase();

    if (nameCounts[lowerKey] === undefined) {
      nameCounts[lowerKey] = 0;
      u.email = `${cleanName}@gmail.com`;
    } else {
      nameCounts[lowerKey]++;
      const count = nameCounts[lowerKey];
      u.email = `${cleanName}${count}@gmail.com`;
    }
  });

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

      const bType = (bet.bet_type || '').toUpperCase();
      const isHaroof = bType.includes('HAR') || bType.includes('ANDER') || bType.includes('BAHAR');
      const numKey = isHaroof ? String(bet.number) : String(bet.number).padStart(2, '0');
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

          const bType = (bet.bet_type || '').toUpperCase();
          const isHaroof = bType.includes('HAR') || bType.includes('ANDER') || bType.includes('BAHAR');
          const numKey = isHaroof ? String(bet.number) : String(bet.number).padStart(2, '0');
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
  for (const k in gameSchedulesStore) {
    if (gameSchedulesStore[k].enabled === undefined) {
      gameSchedulesStore[k].enabled = true;
    }
  }
  res.json(gameSchedulesStore);
};

// @desc    Update game schedule timings & enable/disable market
// @route   POST /api/admin/update-schedule
const updateGameSchedule = async (req, res) => {
  const { name, open, close, result, enabled } = req.body;
  if (!name || !gameSchedulesStore[name]) {
    return res.status(400).json({ success: false, message: 'Invalid game name specified' });
  }

  if (open) gameSchedulesStore[name].open = open.trim();
  if (close) gameSchedulesStore[name].close = close.trim();
  if (result) gameSchedulesStore[name].result = result.trim();
  if (enabled !== undefined) {
    const isEn = Boolean(enabled);
    gameSchedulesStore[name].enabled = isEn;
    if (name === 'Desawar' && gameSchedulesStore['Disawer']) gameSchedulesStore['Disawer'].enabled = isEn;
    if (name === 'Disawer' && gameSchedulesStore['Desawar']) gameSchedulesStore['Desawar'].enabled = isEn;
    if (name === 'Shree Ganesh' && gameSchedulesStore['Shri Ganesh']) gameSchedulesStore['Shri Ganesh'].enabled = isEn;
    if (name === 'Shri Ganesh' && gameSchedulesStore['Shree Ganesh']) gameSchedulesStore['Shree Ganesh'].enabled = isEn;
  }

  saveDiskStore();

  const io = req.app.get('io');
  if (io) {
    io.emit('market_schedule_updated', { name, schedule: gameSchedulesStore[name], schedules: gameSchedulesStore });
  }

  res.json({
    success: true,
    message: `Schedule updated successfully for ${name}`,
    schedules: gameSchedulesStore
  });
};

// @desc    Toggle market betting status ON/OFF
// @route   POST /api/admin/toggle-market-status
const toggleMarketStatus = async (req, res) => {
  const { name, enabled } = req.body;
  if (!name || !gameSchedulesStore[name]) {
    return res.status(400).json({ success: false, message: 'Invalid game name specified' });
  }

  const newStatus = enabled !== undefined ? Boolean(enabled) : !(gameSchedulesStore[name].enabled !== false);
  gameSchedulesStore[name].enabled = newStatus;
  if (name === 'Desawar' && gameSchedulesStore['Disawer']) gameSchedulesStore['Disawer'].enabled = newStatus;
  if (name === 'Disawer' && gameSchedulesStore['Desawar']) gameSchedulesStore['Desawar'].enabled = newStatus;
  if (name === 'Shree Ganesh' && gameSchedulesStore['Shri Ganesh']) gameSchedulesStore['Shri Ganesh'].enabled = newStatus;
  if (name === 'Shri Ganesh' && gameSchedulesStore['Shree Ganesh']) gameSchedulesStore['Shree Ganesh'].enabled = newStatus;

  saveDiskStore();

  const io = req.app.get('io');
  if (io) {
    io.emit('market_schedule_updated', { name, schedule: gameSchedulesStore[name], schedules: gameSchedulesStore });
  }

  res.json({
    success: true,
    message: `Market ${name} betting is now ${newStatus ? 'OPEN (ON)' : 'CLOSED (OFF)'}`,
    enabled: newStatus,
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

// @desc    Declare game result (Instant 24/7 Admin Control with window validation)
// @route   POST /api/admin/declare-result
const declareGameResult = async (req, res) => {
  const { game_name, number, winning_number, bypassWindowCheck, date_key, result_date, date } = req.body;
  const rawNum = number !== undefined ? number : winning_number;
  const numVal = parseInt(rawNum);

  if (!game_name || isNaN(numVal) || numVal < 0 || numVal > 99) {
    return res.status(400).json({ success: false, message: 'Valid game name and winning number (00-99) required' });
  }

  const canonicalGame = getCanonicalGameName(game_name);

  // Window Validation: Admin CANNOT declare result when betting window is OPEN (unless explicitly bypassed)
  if (!bypassWindowCheck && isGameInOpenWindowServer(canonicalGame)) {
    const sched = gameSchedulesStore[canonicalGame] || gameSchedulesStore[game_name];
    const closeTime = sched ? sched.close : 'closing time';
    return res.status(400).json({
      success: false,
      isWindowOpen: true,
      message: `⚠️ Betting window is currently OPEN for ${canonicalGame}! Result can only be declared after window closes at ${closeTime}.`
    });
  }

  const resultStr = String(numVal).padStart(2, '0');
  
  // Strict IST Date Calculation
  const istTodayKey = getISTDateStr(new Date());
  const rawDateInput = date_key || result_date || date;
  const targetDateKey = rawDateInput ? getISTDateStr(rawDateInput) : istTodayKey;

  // Update active declaredResultsMap and declaredResultsDateMap
  declaredResultsMap[canonicalGame] = numVal;
  if (declaredResultsDateMap) declaredResultsDateMap[canonicalGame] = targetDateKey;
  if (canonicalGame === 'Desawar') {
    declaredResultsMap['Disawer'] = numVal;
    declaredResultsMap['Desawar'] = numVal;
    if (declaredResultsDateMap) {
      declaredResultsDateMap['Disawer'] = targetDateKey;
      declaredResultsDateMap['Desawar'] = targetDateKey;
    }
  }
  if (canonicalGame === 'Shree Ganesh') {
    declaredResultsMap['Shri Ganesh'] = numVal;
    declaredResultsMap['Shree Ganesh'] = numVal;
    if (declaredResultsDateMap) {
      declaredResultsDateMap['Shri Ganesh'] = targetDateKey;
      declaredResultsDateMap['Shree Ganesh'] = targetDateKey;
    }
  }
  
  // Persist result into historical chart records for targetDateKey
  if (!chartRecords[targetDateKey]) chartRecords[targetDateKey] = {};
  chartRecords[targetDateKey][canonicalGame] = resultStr;
  chartRecords[targetDateKey][game_name] = resultStr;
  if (canonicalGame === 'Desawar') {
    chartRecords[targetDateKey]['Disawer'] = resultStr;
    chartRecords[targetDateKey]['Desawar'] = resultStr;
  }
  if (canonicalGame === 'Shree Ganesh') {
    chartRecords[targetDateKey]['Shri Ganesh'] = resultStr;
    chartRecords[targetDateKey]['Shree Ganesh'] = resultStr;
  }

  // Save declared result into MongoDB Atlas for permanent cloud persistence
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      const ResultRecord = require('../models/ResultRecord');
      const recordsToUpsert = [
        { game_name: canonicalGame, date_key: targetDateKey }
      ];
      if (canonicalGame === 'Desawar') recordsToUpsert.push({ game_name: 'Disawer', date_key: targetDateKey });
      if (canonicalGame === 'Shree Ganesh') recordsToUpsert.push({ game_name: 'Shri Ganesh', date_key: targetDateKey });

      Promise.all(recordsToUpsert.map(rec => 
        ResultRecord.findOneAndUpdate(
          rec,
          { winning_number: resultStr, declared_at: new Date() },
          { upsert: true, new: true }
        )
      )).then(() => console.log(`[MongoDB] Saved result for ${canonicalGame} (${targetDateKey}): ${resultStr}`))
        .catch(e => console.error('[MongoDB Error]', e));
    }
  } catch (e) { }

  saveDiskStore();

  // Push Notification & WebSocket Broadcast for Result Declaration
  const { memoryNotifications } = require('../store');
  const resultNotif = {
    _id: `notif_${Date.now()}_${Math.floor(Math.random()*1000)}`,
    id: `notif_${Date.now()}_${Math.floor(Math.random()*1000)}`,
    title: `🚀 ${game_name} Result Announced!`,
    body: `Winning Number for ${game_name} is ${resultStr}. Check your wallet & winnings now! 🏆`,
    type: 'RESULT_ANNOUNCED',
    game_name,
    winning_number: resultStr,
    createdAt: new Date().toISOString(),
    createdDateKey: targetDateKey
  };
  memoryNotifications.unshift(resultNotif);

  const io = req.app.get('io');
  if (io) {
    io.emit('push_notification', resultNotif);
    io.emit('game_result_declared', { game_name, number: resultStr, winning_number: resultStr, date_key: targetDateKey });
  }

  // Auto-calculate payouts using each bet's snapshot multiplier (preserving old rates)
  const anderDigit = parseInt(resultStr.charAt(0));
  const baharDigit = parseInt(resultStr.charAt(1));
  const { settingsConfig, logLedgerTransaction } = require('../store');

  const isTargetGame = (bGame) => {
    return getCanonicalGameName(bGame) === canonicalGame;
  };

  memoryBets.forEach(bet => {
    if (isTargetGame(bet.game_name) && bet.status === 'pending') {
      const betDateKey = bet.date_key || bet.createdDateKey || getGameBetDateKey(bet.game_name, bet.created_at || bet.createdAt || bet.date);
      const isDateMatch = (betDateKey === targetDateKey);
      if (isDateMatch) {
        let isWin = false;
        let payout = 0;

        const bTypeStr = (bet.bet_type || '').toUpperCase().replace('_', ' ');
        const isHarAnder = bTypeStr.includes('ANDER') && (bTypeStr.includes('HAROOF') || bTypeStr.includes('HARUF') || bTypeStr.includes('HAR'));
        const isHarBahar = bTypeStr.includes('BAHAR') && (bTypeStr.includes('HAROOF') || bTypeStr.includes('HARUF') || bTypeStr.includes('HAR'));
        const isHaroof = isHarAnder || isHarBahar;

        // Determine the specific bet multiplier:
        let betMultiplier = bet.multiplier;
        if (!betMultiplier && bet.potential_payout && bet.bet_amount) {
          betMultiplier = parseFloat((bet.potential_payout / bet.bet_amount).toFixed(2));
        }
        if (!betMultiplier || isNaN(betMultiplier)) {
          if (isHaroof) {
            betMultiplier = parseFloat(settingsConfig.haroof_rate || settingsConfig.haroof_multiplier || 9.5);
          } else if (bTypeStr.includes('CROSS')) {
            betMultiplier = parseFloat(settingsConfig.crossing_rate || settingsConfig.crossing_multiplier || 95);
          } else {
            betMultiplier = parseFloat(settingsConfig.jodi_rate || settingsConfig.jodi_multiplier || 95);
          }
        }

        if (isHarAnder) {
          if (parseInt(bet.number) === anderDigit) {
            isWin = true;
            payout = parseFloat((bet.bet_amount * betMultiplier).toFixed(2));
          }
        } else if (isHarBahar) {
          if (parseInt(bet.number) === baharDigit) {
            isWin = true;
            payout = parseFloat((bet.bet_amount * betMultiplier).toFixed(2));
          }
        } else {
          // Jodi / Crossing bets
          if (parseInt(bet.number) === numVal) {
            isWin = true;
            payout = parseFloat((bet.bet_amount * betMultiplier).toFixed(2));
          }
        }

        if (isWin) {
          bet.status = 'won';
          bet.winAmount = payout;
          bet.win_amount = payout; // Android app reads win_amount (snake_case)
          
          // Find exact user who placed the bet by mobile or user_id
          const userMobile = (bet.user || bet.mobile || bet.user_id || '').replace(/[^0-9]/g, '').slice(-10);
          let targetUser = userMobile ? registeredUsers.find(u => u.mobile && u.mobile.replace(/[^0-9]/g, '').slice(-10) === userMobile) : null;
          if (targetUser) {
            targetUser.winning_balance = parseFloat(((targetUser.winning_balance || 0) + payout).toFixed(2));
            targetUser.balance = parseFloat(((targetUser.deposit_balance || 0) + targetUser.winning_balance).toFixed(2));
            userWalletStore.balance = targetUser.balance;

            // Sync winning balance & total wallet balance to MongoDB Atlas
            try {
              const User = require('../models/User');
              User.updateOne(
                { mobile: userMobile },
                { $inc: { winning_balance: payout, wallet_balance: payout } }
              ).catch(e => console.error('[MongoDB Win Sync Error]', e));

              const Transaction = require('../models/Transaction');
              Transaction.create({
                mobile: userMobile,
                type: 'WINNING',
                amount: payout,
                status: 'success',
                description: `Won ₹${payout} on ${game_name} (${resultStr})`,
                date_key: targetDateKey,
                created_at: new Date()
              }).catch(e => console.error('[MongoDB Win Txn Error]', e));
            } catch (e) { }

            if (typeof logLedgerTransaction === 'function') {
              logLedgerTransaction(userMobile, 'CREDIT', payout, 'WINNING_PAYOUT', `Won ₹${payout} on ${game_name} (${resultStr})`);
            }
          }
        } else {
          bet.status = 'lost';
          bet.winAmount = 0;
          bet.win_amount = 0;
        }

        // Sync bet status to MongoDB Bet
        try {
          const Bet = require('../models/Bet');
          Bet.updateOne(
            { _id: bet._id },
            { $set: { status: bet.status, win_amount: bet.win_amount, winAmount: bet.winAmount } }
          ).catch(e => console.error('[MongoDB Bet Status Sync Error]', e));
        } catch (e) {}
      }
    }
  });

  // Record in memoryResultsHistory for persistent Results Management table (Strictly Canonicalized)
  const { memoryResultsHistory } = require('../store');
  const resultEntry = {
    id: `res_${Date.now()}_${Math.floor(Math.random()*1000)}`,
    _id: `res_${Date.now()}_${Math.floor(Math.random()*1000)}`,
    date: targetDateKey,
    rawDate: new Date().toISOString(),
    category: canonicalGame,
    game_name: canonicalGame,
    number: resultStr,
    resultNumber: resultStr,
    created_at: new Date().toISOString(),
    createdAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
    declared_by: 'Admin',
    resultBy: 'Admin'
  };

  // Remove any prior duplicate or alias entries for this canonical game on this date
  for (let i = memoryResultsHistory.length - 1; i >= 0; i--) {
    const r = memoryResultsHistory[i];
    if (getCanonicalGameName(r.category || r.game_name) === canonicalGame && r.date === targetDateKey) {
      memoryResultsHistory.splice(i, 1);
    }
  }
  memoryResultsHistory.unshift(resultEntry);

  saveDiskStore();

  res.json({
    success: true,
    message: `Result declared for ${game_name} (${targetDateKey}): ${numVal}`,
    game_name,
    date: targetDateKey,
    winning_number: numVal,
    declaredResults: declaredResultsMap
  });
};

// @desc    Edit declared result number (Retroactive win/loss recalculation & 24hr check)
// @route   POST /api/admin/edit-result
const editGameResult = async (req, res) => {
  const { game_name, new_number, date_key, id } = req.body;
  const numVal = parseInt(new_number);
  if (!game_name || isNaN(numVal) || numVal < 0 || numVal > 99) {
    return res.status(400).json({ success: false, message: 'Valid game name and 2-digit number (0-99) required' });
  }

  const resultStr = String(numVal).padStart(2, '0');
  const istTodayKey = getISTDateStr(new Date());
  const canonicalGame = getCanonicalGameName(game_name);
  const targetDateKey = date_key ? getISTDateStr(date_key) : istTodayKey;

  const { memoryResultsHistory, settingsConfig, logLedgerTransaction } = require('../store');

  // 1. Check 24-Hour Edit Restriction
  const targetRes = memoryResultsHistory.find(r => 
    (getCanonicalGameName(r.category || r.game_name) === canonicalGame) && 
    (r.date === targetDateKey || (id && (r.id === id || r._id === id)))
  );

  if (targetRes) {
    const declaredTime = targetRes.created_at || targetRes.rawDate || targetRes.createdAt;
    if (declaredTime) {
      const diffHours = (Date.now() - new Date(declaredTime).getTime()) / (1000 * 60 * 60);
      if (diffHours > 24) {
        return res.status(400).json({ 
          success: false, 
          message: 'Results can only be edited within 24 hours of declaration.' 
        });
      }
    }
  } else {
    // If no existing result found, verify targetDateKey is within last 24-48 hours
    const targetDateMidnight = new Date(targetDateKey + 'T00:00:00+05:30').getTime();
    const diffHours = (Date.now() - targetDateMidnight) / (1000 * 60 * 60);
    if (diffHours > 48) {
      return res.status(400).json({ 
        success: false, 
        message: 'Results can only be edited within 24 hours.' 
      });
    }
  }

  // 2. Update Single-Date Chart Record ONLY
  if (!chartRecords[targetDateKey]) {
    chartRecords[targetDateKey] = {};
  }
  chartRecords[targetDateKey][canonicalGame] = resultStr;
  if (canonicalGame === 'Desawar') chartRecords[targetDateKey]['Disawer'] = resultStr;
  if (canonicalGame === 'Shree Ganesh') chartRecords[targetDateKey]['Shri Ganesh'] = resultStr;

  // If editing today's result, also update the active declaredResultsMap & declaredResultsDateMap
  if (targetDateKey === istTodayKey) {
    declaredResultsMap[canonicalGame] = numVal;
    if (declaredResultsDateMap) declaredResultsDateMap[canonicalGame] = targetDateKey;
    if (canonicalGame === 'Desawar') {
      declaredResultsMap['Disawer'] = numVal;
      if (declaredResultsDateMap) declaredResultsDateMap['Disawer'] = targetDateKey;
    }
    if (canonicalGame === 'Shree Ganesh') {
      declaredResultsMap['Shri Ganesh'] = numVal;
      if (declaredResultsDateMap) declaredResultsDateMap['Shri Ganesh'] = targetDateKey;
    }
  }

  // 3. Update memoryResultsHistory entry
  if (targetRes) {
    targetRes.category = canonicalGame;
    targetRes.game_name = canonicalGame;
    targetRes.number = resultStr;
    targetRes.resultNumber = resultStr;
    targetRes.updated_at = new Date().toISOString();
    targetRes.edited_at = new Date().toISOString();
    targetRes.edited_by = 'Admin';
  } else {
    memoryResultsHistory.unshift({
      id: `res_${Date.now()}_${Math.floor(Math.random()*1000)}`,
      _id: `res_${Date.now()}_${Math.floor(Math.random()*1000)}`,
      date: targetDateKey,
      rawDate: new Date().toISOString(),
      category: canonicalGame,
      game_name: canonicalGame,
      number: resultStr,
      resultNumber: resultStr,
      created_at: new Date().toISOString(),
      createdAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
      declared_by: 'Admin',
      resultBy: 'Admin'
    });
  }

  // Purge any alias duplicates from memoryResultsHistory for this date
  for (let i = memoryResultsHistory.length - 1; i >= 0; i--) {
    const r = memoryResultsHistory[i];
    if (r !== targetRes && getCanonicalGameName(r.category || r.game_name) === canonicalGame && r.date === targetDateKey) {
      memoryResultsHistory.splice(i, 1);
    }
  }

  // Sync to MongoDB ResultRecord
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      const ResultRecord = require('../models/ResultRecord');
      const aliasNames = [canonicalGame];
      if (canonicalGame === 'Desawar') aliasNames.push('Disawer');
      if (canonicalGame === 'Shree Ganesh') aliasNames.push('Shri Ganesh');
      ResultRecord.deleteMany({ game_name: { $in: aliasNames }, date_key: targetDateKey }).then(() => {
        ResultRecord.create({
          game_name: canonicalGame,
          date_key: targetDateKey,
          winning_number: resultStr,
          declared_at: new Date()
        }).catch(() => {});
      }).catch(e => console.error('[MongoDB Edit Result Error]', e));
    }
  } catch (e) {}

  // 3.5 Auto-reject pending withdrawals & refund wallet when result is edited
  try {
    memoryWithdrawals.forEach(w => {
      if ((w.status === 'Pending' || w.status === 'pending') && !w.refundProcessed) {
        w.status = 'Refunded';
        w.refundProcessed = true;
        const cleanMobile = String(w.mobile || w.phone || w.user || '').replace(/[^0-9]/g, '').slice(-10);
        const userObj = registeredUsers.find(u => (u.mobile || '').replace(/[^0-9]/g, '').slice(-10) === cleanMobile);
        const refundAmt = parseFloat(w.amount) || 0;
        if (userObj && refundAmt > 0) {
          userObj.deposit_balance = parseFloat(((userObj.deposit_balance || 0) + refundAmt).toFixed(2));
          userObj.winning_balance = Math.max(0, parseFloat((userObj.winning_balance || 0).toFixed(2)));
          userObj.balance = parseFloat(((userObj.deposit_balance || 0) + (userObj.winning_balance || 0)).toFixed(2));
          
          try {
            const mongoose = require('mongoose');
            if (mongoose.connection.readyState === 1) {
              const User = require('../models/User');
              User.updateOne(
                { mobile: cleanMobile },
                { $set: { deposit_balance: userObj.deposit_balance, winning_balance: userObj.winning_balance, wallet_balance: userObj.balance } }
              ).catch(() => {});
            }
          } catch (e) {}

          logLedgerTransaction(cleanMobile, 'CREDIT', refundAmt, 'REFUND_WITHDRAWAL', `Refunded ₹${refundAmt} due to Result Change on ${canonicalGame}`);
        }
      }
    });

    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      const WithdrawalRequest = require('../models/WithdrawalRequest');
      WithdrawalRequest.updateMany(
        { status: { $regex: /^pending$/i } },
        { $set: { status: 'Refunded', note: 'Automatic Refunded (Result Changed)' } }
      ).catch(() => {});
    }
  } catch (e) {
    console.error('[Result Edit Withdrawal Refund Error]', e);
  }

  // 4. Retroactively recalculate all bets placed on the same day for this game
  const anderDigit = parseInt(resultStr.charAt(0));
  const baharDigit = parseInt(resultStr.charAt(1));

  let recalculatedCount = 0;
  let wonCount = 0;
  let lostCount = 0;

  memoryBets.forEach(bet => {
    const isSameGame = getCanonicalGameName(bet.game_name) === canonicalGame;
    const betDateKey = getISTDateStr(bet.created_at || bet.createdAt || bet.date || bet.timestamp);

    if (isSameGame && betDateKey === targetDateKey) {
      recalculatedCount++;

      const bTypeStr = (bet.bet_type || '').toUpperCase().replace('_', ' ');
      const isHarAnder = bTypeStr.includes('ANDER') && (bTypeStr.includes('HAROOF') || bTypeStr.includes('HARUF') || bTypeStr.includes('HAR'));
      const isHarBahar = bTypeStr.includes('BAHAR') && (bTypeStr.includes('HAROOF') || bTypeStr.includes('HARUF') || bTypeStr.includes('HAR'));
      const isHaroof = isHarAnder || isHarBahar;

      // Determine snapshot bet multiplier
      let betMultiplier = bet.multiplier;
      if (!betMultiplier && bet.potential_payout && bet.bet_amount) {
        betMultiplier = parseFloat((bet.potential_payout / bet.bet_amount).toFixed(2));
      }
      if (!betMultiplier || isNaN(betMultiplier)) {
        if (isHaroof) {
          betMultiplier = parseFloat(settingsConfig.haroof_rate || settingsConfig.haroof_multiplier || 9.5);
        } else if (bTypeStr.includes('CROSS')) {
          betMultiplier = parseFloat(settingsConfig.crossing_rate || settingsConfig.crossing_multiplier || 95);
        } else {
          betMultiplier = parseFloat(settingsConfig.jodi_rate || settingsConfig.jodi_multiplier || 95);
        }
      }

      // Check win condition under the revised result
      let isNowWin = false;
      let newPayout = 0;

      if (isHarAnder) {
        if (parseInt(bet.number) === anderDigit) {
          isNowWin = true;
          newPayout = parseFloat((bet.bet_amount * betMultiplier).toFixed(2));
        }
      } else if (isHarBahar) {
        if (parseInt(bet.number) === baharDigit) {
          isNowWin = true;
          newPayout = parseFloat((bet.bet_amount * betMultiplier).toFixed(2));
        }
      } else {
        // Jodi / Crossing
        if (parseInt(bet.number) === numVal) {
          isNowWin = true;
          newPayout = parseFloat((bet.bet_amount * betMultiplier).toFixed(2));
        }
      }

      const userMobile = (bet.user || bet.mobile || bet.user_id || '').replace(/[^0-9]/g, '').slice(-10);
      let targetUser = userMobile ? registeredUsers.find(u => u.mobile && u.mobile.replace(/[^0-9]/g, '').slice(-10) === userMobile) : null;

      const previousWinAmount = parseFloat(bet.winAmount || bet.win_amount || 0);
      const wasPreviouslyWon = bet.status === 'won' || previousWinAmount > 0;

      if (isNowWin) {
        wonCount++;
        bet.status = 'won';
        bet.winAmount = newPayout;
        bet.win_amount = newPayout;

        const netCredit = newPayout - previousWinAmount;
        if (targetUser && netCredit !== 0) {
          const oldBalSnapshot = {
            wallet: String(targetUser.balance || '0.00'),
            deposit: String(targetUser.deposit_balance || '0.00'),
            winning: String(targetUser.winning_balance || '0.00'),
            commission: String(targetUser.commission_balance || '0.00'),
            bonus: String(targetUser.bonus_balance || '0.00')
          };

          targetUser.winning_balance = parseFloat(((targetUser.winning_balance || 0) + netCredit).toFixed(2));
          targetUser.balance = parseFloat(((targetUser.deposit_balance || 0) + (targetUser.winning_balance || 0)).toFixed(2));
          userWalletStore.balance = targetUser.balance;

          if (typeof logLedgerTransaction === 'function') {
            logLedgerTransaction({
              user: targetUser.name || 'User',
              email: targetUser.email || 'user@example.com',
              phone: targetUser.mobile,
              amount: netCredit >= 0 ? `+${netCredit}` : `${netCredit}`,
              transactType: 'Result Revision Credit',
              oldBal: oldBalSnapshot,
              newBal: {
                wallet: String(targetUser.balance),
                deposit: String(targetUser.deposit_balance || '0.00'),
                winning: String(targetUser.winning_balance || '0.00'),
                commission: String(targetUser.commission_balance || '0.00'),
                bonus: String(targetUser.bonus_balance || '0.00')
              }
            });
          }

          // Sync winning balance & total wallet balance to MongoDB
          try {
            const User = require('../models/User');
            User.updateOne(
              { mobile: targetUser.mobile.replace(/[^0-9]/g, '').slice(-10) },
              { $inc: { winning_balance: netCredit, wallet_balance: netCredit } }
            ).catch(e => console.error('[MongoDB Revision Win Sync Error]', e));
          } catch (e) { }
        }
      } else {
        lostCount++;
        bet.status = 'lost';
        bet.winAmount = 0;
        bet.win_amount = 0;

        if (targetUser && wasPreviouslyWon && previousWinAmount > 0) {
          let amountToDeduct = previousWinAmount;
          const oldBalSnapshot = {
            wallet: String(targetUser.balance || '0.00'),
            deposit: String(targetUser.deposit_balance || '0.00'),
            winning: String(targetUser.winning_balance || '0.00'),
            commission: String(targetUser.commission_balance || '0.00'),
            bonus: String(targetUser.bonus_balance || '0.00')
          };

          // Step A: Cancel & Reject pending withdrawals for this user
          const userPendingWithdrawals = memoryWithdrawals.filter(w => 
            (w.status === 'Pending' || w.status === 'pending') &&
            (w.user === targetUser.mobile || w.phone === targetUser.mobile || (targetUser.mobile && (w.user || w.phone || '').includes(targetUser.mobile.slice(-10))))
          );

          for (let pw of userPendingWithdrawals) {
            if (amountToDeduct <= 0) break;
            const pwAmt = parseFloat(pw.amount || 0);
            if (pwAmt <= amountToDeduct) {
              pw.status = 'Rejected';
              pw.rejectedReason = `Result revised by Admin for ${game_name} (${resultStr}) - Win reversed`;
              pw.updated_at = new Date().toISOString();
              amountToDeduct -= pwAmt;
            } else {
              pw.status = 'Rejected';
              pw.rejectedReason = `Result revised by Admin for ${game_name} (${resultStr}) - Win reversed`;
              pw.updated_at = new Date().toISOString();
              const remainder = pwAmt - amountToDeduct;
              targetUser.winning_balance = parseFloat(((targetUser.winning_balance || 0) + remainder).toFixed(2));
              amountToDeduct = 0;
            }
          }

          // Step B: Deduct remaining win amount from user's winning_balance (never allow negative balance)
          if (amountToDeduct > 0) {
            targetUser.winning_balance = Math.max(0, parseFloat(((targetUser.winning_balance || 0) - amountToDeduct).toFixed(2)));
          }
          targetUser.deposit_balance = Math.max(0, parseFloat((targetUser.deposit_balance || 0).toFixed(2)));
          targetUser.balance = parseFloat(((targetUser.deposit_balance || 0) + (targetUser.winning_balance || 0)).toFixed(2));
          userWalletStore.balance = targetUser.balance;

          if (typeof logLedgerTransaction === 'function') {
            logLedgerTransaction({
              user: targetUser.name || 'User',
              email: targetUser.email || 'user@example.com',
              phone: targetUser.mobile,
              amount: `-${previousWinAmount}`,
              transactType: 'Result Revision Reversal',
              oldBal: oldBalSnapshot,
              newBal: {
                wallet: String(targetUser.balance),
                deposit: String(targetUser.deposit_balance || '0.00'),
                winning: String(targetUser.winning_balance || '0.00'),
                commission: String(targetUser.commission_balance || '0.00'),
                bonus: String(targetUser.bonus_balance || '0.00')
              }
            });
          }

          // Sync winning balance & total wallet balance to MongoDB
          try {
            const User = require('../models/User');
            User.updateOne(
              { mobile: targetUser.mobile.replace(/[^0-9]/g, '').slice(-10) },
              { $set: { deposit_balance: targetUser.deposit_balance, winning_balance: targetUser.winning_balance, wallet_balance: targetUser.balance } }
            ).catch(e => console.error('[MongoDB Revision Loss Sync Error]', e));
          } catch (e) { }
        }
      }

      // Sync bet status to MongoDB
      try {
        const Bet = require('../models/Bet');
        if (bet._id) {
          Bet.updateOne(
            { _id: bet._id },
            { $set: { status: bet.status, winAmount: bet.winAmount, win_amount: bet.win_amount } }
          ).catch(e => {});
        }
      } catch (e) { }
    }
  });

  saveDiskStore();

  const io = req.app.get('io');
  if (io) {
    io.emit('game_result_updated', { game_name, number: resultStr, winning_number: resultStr, date: targetDateKey });
    io.emit('push_notification', {
      id: `notif_${Date.now()}`,
      title: `Result Revised: ${game_name}`,
      message: `Result for ${game_name} on ${targetDateKey} revised to ${resultStr}. Bets recalculated.`,
      game_name,
      winning_number: resultStr,
      createdAt: new Date().toISOString()
    });
  }

  res.json({
    success: true,
    message: `Result for ${game_name} on ${targetDateKey} revised to ${resultStr}. Recalculated ${recalculatedCount} bets (${wonCount} won, ${lostCount} lost).`,
    game_name,
    winning_number: numVal,
    date_key: targetDateKey,
    declaredResults: declaredResultsMap,
    recalculatedCount,
    wonCount,
    lostCount
  });
};

// @desc    Get all declared results history for Admin Panel
// @route   GET /api/admin/results-history
const getResultsHistory = async (req, res) => {
  try {
    const { memoryResultsHistory, declaredResultsMap } = require('../store');
    const istTodayKey = getISTDateStr(new Date());

    // Merge any cloud-stored results from MongoDB Atlas into memoryResultsHistory
    try {
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState === 1) {
        const ResultRecord = require('../models/ResultRecord');
        const dbRecords = await ResultRecord.find().sort({ date_key: -1, declared_at: -1 }).limit(100).lean();
        dbRecords.forEach(dbr => {
          const dKey = dbr.date_key || getISTDateStr(dbr.declared_at);
          const cGame = getCanonicalGameName(dbr.game_name);
          const exists = memoryResultsHistory.some(r => 
            getCanonicalGameName(r.category || r.game_name) === cGame && 
            (r.date === dKey || String(r._id) === String(dbr._id) || String(r.id) === String(dbr._id))
          );
          if (!exists && cGame && dbr.winning_number) {
            const numStr = String(dbr.winning_number).padStart(2, '0');
            memoryResultsHistory.push({
              id: String(dbr._id),
              _id: String(dbr._id),
              date: dKey,
              rawDate: dbr.declared_at || new Date().toISOString(),
              category: cGame,
              game_name: cGame,
              number: numStr,
              resultNumber: numStr,
              created_at: dbr.declared_at || new Date().toISOString(),
              createdAt: dbr.declared_at ? new Date(dbr.declared_at).toLocaleString() : 'N/A',
              declared_by: 'Admin',
              resultBy: 'Admin'
            });
          }
        });
      }
    } catch (e) {
      console.error('[MongoDB Results History Fetch Error]', e);
    }

    // Deduplicate and canonicalize for the admin response (Never show Desawar/Disawer or Shree Ganesh/Shri Ganesh twice!)
    const seen = new Set();
    const dedupedResults = [];
    memoryResultsHistory.forEach(r => {
      const cGame = getCanonicalGameName(r.game_name || r.category);
      const dKey = r.date || (r.created_at ? getISTDateStr(r.created_at) : '');
      const uniqueKey = `${cGame}_${dKey}`;
      if (!seen.has(uniqueKey) && cGame && dKey) {
        seen.add(uniqueKey);
        r.category = cGame;
        r.game_name = cGame;
        dedupedResults.push(r);
      }
    });

    // Sort descending by date, then by creation time
    dedupedResults.sort((a, b) => {
      const cmp = (b.date || '').localeCompare(a.date || '');
      if (cmp !== 0) return cmp;
      return (b.created_at || '').localeCompare(a.created_at || '');
    });

    res.json(dedupedResults);
  } catch (e) {
    res.json([]);
  }
};

// @desc    Clear / Reset declared result for a game (Revert bets to pending & clawback winnings)
// @route   POST /api/admin/clear-result
const clearGameResult = async (req, res) => {
  const { game_name, date_key, id } = req.body;
  if (!game_name) {
    return res.status(400).json({ success: false, message: 'Game name is required' });
  }

  const canonicalGame = getCanonicalGameName(game_name);
  const istTodayKey = getISTDateStr(new Date());
  const targetDateKey = date_key ? getISTDateStr(date_key) : istTodayKey;

  // Clear live declared result if clearing for today or matching active
  if (targetDateKey === istTodayKey || !date_key) {
    delete declaredResultsMap[canonicalGame];
    if (declaredResultsDateMap) delete declaredResultsDateMap[canonicalGame];
    if (canonicalGame === 'Desawar') {
      delete declaredResultsMap['Disawer'];
      delete declaredResultsMap['Desawar'];
      if (declaredResultsDateMap) {
        delete declaredResultsDateMap['Disawer'];
        delete declaredResultsDateMap['Desawar'];
      }
    } else if (canonicalGame === 'Shree Ganesh') {
      delete declaredResultsMap['Shri Ganesh'];
      delete declaredResultsMap['Shree Ganesh'];
      if (declaredResultsDateMap) {
        delete declaredResultsDateMap['Shri Ganesh'];
        delete declaredResultsDateMap['Shree Ganesh'];
      }
    }
  }

  // Clear from chart records
  if (chartRecords[targetDateKey]) {
    chartRecords[targetDateKey][canonicalGame] = '--';
    if (canonicalGame === 'Desawar') {
      chartRecords[targetDateKey]['Disawer'] = '--';
      chartRecords[targetDateKey]['Desawar'] = '--';
    } else if (canonicalGame === 'Shree Ganesh') {
      chartRecords[targetDateKey]['Shri Ganesh'] = '--';
      chartRecords[targetDateKey]['Shree Ganesh'] = '--';
    }
  }

  const { memoryResultsHistory, memoryBets, registeredUsers, logLedgerTransaction } = require('../store');

  // Remove matching entry from memoryResultsHistory (all alias variations)
  for (let i = memoryResultsHistory.length - 1; i >= 0; i--) {
    const r = memoryResultsHistory[i];
    const rGame = getCanonicalGameName(r.category || r.game_name);
    if (rGame === canonicalGame && (r.date === targetDateKey || (id && (r.id === id || r._id === id)))) {
      memoryResultsHistory.splice(i, 1);
    }
  }

  // Delete record from MongoDB Atlas
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      const ResultRecord = require('../models/ResultRecord');
      const names = [canonicalGame, game_name];
      if (canonicalGame === 'Desawar') names.push('Desawar', 'Disawer');
      if (canonicalGame === 'Shree Ganesh') names.push('Shree Ganesh', 'Shri Ganesh');
      await ResultRecord.deleteMany({
        $or: [
          { game_name: { $in: names }, date_key: targetDateKey },
          ...(id ? [{ _id: id }] : [])
        ]
      });
    }
  } catch (e) {
    console.error('[MongoDB Delete Error]', e);
  }

  // 4. REVERT ALL BETS FOR THIS MARKET/DATE TO PENDING & CLAWBACK WINNING PAYOUTS
  const isTargetGame = (bGame) => {
    return getCanonicalGameName(bGame) === canonicalGame;
  };

  let revertedBetsCount = 0;
  let totalWinningsClawedBack = 0;

  memoryBets.forEach(bet => {
    if (isTargetGame(bet.game_name)) {
      const betDateKey = bet.date_key || bet.createdDateKey || getGameBetDateKey(bet.game_name, bet.created_at || bet.createdAt || bet.date);
      // Revert if matches targetDateKey or if no specific date was passed (i.e. latest/all settled for this game)
      if (betDateKey === targetDateKey || !date_key) {
        if (bet.status === 'won') {
          const payout = parseFloat(bet.winAmount || bet.win_amount || 0);
          if (payout > 0) {
            totalWinningsClawedBack += payout;
            const userMobile = (bet.user || bet.mobile || bet.user_id || '').replace(/[^0-9]/g, '').slice(-10);
            const targetUser = userMobile ? registeredUsers.find(u => u.mobile && u.mobile.replace(/[^0-9]/g, '').slice(-10) === userMobile) : null;
            if (targetUser) {
              targetUser.winning_balance = Math.max(0, parseFloat(((targetUser.winning_balance || 0) - payout).toFixed(2)));
              targetUser.balance = parseFloat(((targetUser.deposit_balance || 0) + targetUser.winning_balance).toFixed(2));
              userWalletStore.balance = targetUser.balance;

              // Sync clawback to MongoDB Atlas
              try {
                const User = require('../models/User');
                User.updateOne(
                  { mobile: userMobile },
                  {
                    $set: {
                      winning_balance: targetUser.winning_balance,
                      wallet_balance: targetUser.balance
                    }
                  }
                ).catch(e => console.error('[MongoDB Balance Clawback Error]', e));

                const Transaction = require('../models/Transaction');
                Transaction.create({
                  mobile: userMobile,
                  type: 'DEBIT',
                  amount: payout,
                  status: 'success',
                  description: `Result reset for ${game_name} (${targetDateKey}) - Winning payout ₹${payout} deducted`,
                  date_key: istTodayKey,
                  created_at: new Date()
                }).catch(e => console.error('[MongoDB Clawback Txn Error]', e));
              } catch (e) {}

              if (typeof logLedgerTransaction === 'function') {
                logLedgerTransaction(userMobile, 'DEBIT', payout, 'RESULT_REVERSED_CLAWBACK', `Winning payout ₹${payout} reversed on result reset for ${game_name}`);
              }
            }
          }
        }

        // Revert bet status back to pending
        if (bet.status === 'won' || bet.status === 'lost') {
          bet.status = 'pending';
          bet.winAmount = 0;
          bet.win_amount = 0;
          revertedBetsCount++;

          try {
            const Bet = require('../models/Bet');
            Bet.updateOne(
              { _id: bet._id },
              { $set: { status: 'pending', win_amount: 0, winAmount: 0 } }
            ).catch(e => console.error('[MongoDB Bet Revert Error]', e));
          } catch (e) {}
        }
      }
    }
  });

  saveDiskStore();

  const io = req.app.get('io');
  if (io) {
    io.emit('game_result_cleared', { game_name, date_key: targetDateKey });
  }

  res.json({
    success: true,
    message: `Result cleared for ${game_name} (${targetDateKey}). ${revertedBetsCount} bets reverted to Pending, ₹${totalWinningsClawedBack.toFixed(2)} winnings reversed from user wallets.`,
    declaredResults: declaredResultsMap,
    revertedBetsCount,
    totalWinningsClawedBack
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

// @desc    Get declared results (Auto-filters out markets whose betting window is currently open)
// @route   GET /api/admin/declared-results
const getDeclaredResults = async (req, res) => {
  const activeResults = {};
  const { isGameInOpenWindow } = require('../utils/dateCycle');

  Object.keys(declaredResultsMap).forEach(game => {
    const numVal = declaredResultsMap[game];
    if (numVal !== null && numVal !== undefined) {
      // Results remain active and visible while the betting window is closed
      // Once the new window opens (e.g. at 4:00 AM for daytime, 12:00 PM for Desawar), the result is cleared for the new cycle
      if (!isGameInOpenWindow(game)) {
        activeResults[game] = numVal;
      }
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
          const cleanMob = String(d.user_id || d.mobile || '').replace(/[^0-9]/g, '').slice(-10);
          const dbAmt = parseFloat(d.amount) || 0;
          const dbTime = d.createdAt ? new Date(d.createdAt).getTime() : 0;

          const exists = memoryDeposits.find(m => {
            if (m._id && String(m._id) === String(d._id)) return true;
            if (utrKey && (String(m.client_txn_id) === String(utrKey) || String(m.utr) === String(utrKey) || String(m.utr_number) === String(utrKey) || String(m.order_id) === String(utrKey))) return true;
            const mMob = String(m.mobile || '').replace(/[^0-9]/g, '').slice(-10);
            const mAmt = parseFloat(m.amount) || 0;
            const mTime = m.timestamp || (m.created_at ? new Date(m.created_at).getTime() : 0);
            if (cleanMob && mMob === cleanMob && Math.abs(mAmt - dbAmt) < 0.01 && Math.abs(mTime - dbTime) < 300000) {
              return true;
            }
            return false;
          });

          const rawU = d.username || d.user || 'User';
          const cleanUsername = rawU.startsWith('null') ? `User (${cleanMob || 'Player'})` : rawU;

          if (exists) {
            const formattedStatus = d.status ? (d.status.charAt(0).toUpperCase() + d.status.slice(1).toLowerCase()) : 'Pending';
            // Only update status if memory status is Pending or if DB has a non-pending status (Approved/Rejected)
            if (exists.status === 'Pending' || exists.status === 'pending') {
              exists.status = formattedStatus;
            } else if (formattedStatus === 'Approved' || formattedStatus === 'Rejected') {
              exists.status = formattedStatus;
            }
            if (utrKey && utrKey !== 'N/A' && (!exists.utr || exists.utr === 'N/A')) {
              exists.utr = utrKey;
              exists.utr_number = utrKey;
            }
            if (!exists.username || exists.username.startsWith('null')) exists.username = cleanUsername;
            if (!exists.user || exists.user.startsWith('null')) exists.user = cleanUsername;
          } else {
            memoryDeposits.unshift({
              _id: d._id,
              client_txn_id: utrKey && utrKey.startsWith('TXN_') ? utrKey : undefined,
              user: cleanUsername,
              username: cleanUsername,
              mobile: cleanMob || 'N/A',
              email: d.email || (cleanMob ? `${cleanMob}@gmail.com` : 'user@95xmatka.com'),
              amount: dbAmt,
              method: 'EKQR Automatic UPI',
              utr: utrKey || 'N/A',
              utr_number: utrKey || 'N/A',
              status: d.status ? (d.status.charAt(0).toUpperCase() + d.status.slice(1).toLowerCase()) : 'Pending',
              createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : new Date().toISOString(),
              created_at: d.createdAt ? new Date(d.createdAt).toISOString() : new Date().toISOString(),
              rawDate: d.createdAt ? new Date(d.createdAt).toISOString() : new Date().toISOString(),
              date: d.createdAt ? new Date(d.createdAt).toISOString() : new Date().toISOString(),
              timestamp: dbTime || Date.now()
            });
          }
        });
      }
    }
  } catch (e) {
    console.error('[Admin Deposits Error]', e);
  }

  // Deduplicate before sending to Admin UI (favor Approved/Rejected over Pending)
  const depositMap = new Map();
  for (const dep of memoryDeposits) {
    const rawMob = String(dep.mobile || '').replace(/[^0-9]/g, '').slice(-10);
    const amt = parseFloat(dep.amount) || 0;
    const utrVal = (dep.utr && dep.utr !== 'N/A') ? dep.utr : (dep.utr_number && dep.utr_number !== 'N/A' ? dep.utr_number : (dep.client_txn_id || ''));
    
    // Create grouping key
    const groupKey = (utrVal && utrVal.length > 3 && utrVal !== 'N/A') ? utrVal : `${rawMob}_${amt}_${dep.createdAt || dep.timestamp || ''}`;
    const currentStatus = (dep.status || 'Pending').toUpperCase();

    // Clean user display
    if (!dep.user || dep.user.startsWith('null')) {
      dep.user = rawMob ? `Player (${rawMob})` : 'User';
      dep.username = rawMob ? `Player (${rawMob})` : 'User';
    }

    if (!dep.utr || dep.utr === 'N/A') {
      if (dep.client_txn_id) dep.utr = dep.client_txn_id;
      if (dep.utr_number && dep.utr_number !== 'N/A') dep.utr = dep.utr_number;
    }

    const existing = depositMap.get(groupKey);
    if (!existing) {
      depositMap.set(groupKey, dep);
    } else {
      const existingStatus = (existing.status || 'Pending').toUpperCase();
      if ((currentStatus === 'APPROVED' || currentStatus === 'REJECTED') && (existingStatus !== 'APPROVED' && existingStatus !== 'REJECTED')) {
        depositMap.set(groupKey, dep);
      }
    }
  }

  const result = Array.from(depositMap.values());
  res.json(result);
};

// @desc    Get withdrawal requests
// @route   GET /api/admin/withdrawals
const getWithdrawals = async (req, res) => {
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      const WithdrawalRequest = require('../models/WithdrawalRequest');
      const User = require('../models/User');
      const dbWths = await WithdrawalRequest.find().sort({ createdAt: -1 }).lean();
      const allUsers = await User.find({}).lean();

      if (dbWths && dbWths.length > 0) {
        dbWths.forEach(w => {
          const rawMobile = (w.mobile || w.phone || w.user_id || w.username || '').replace(/[^0-9]/g, '');
          const cleanMobile = rawMobile.length >= 10 ? rawMobile.slice(-10) : '';
          const uMatch = allUsers.find(u => u.mobile === cleanMobile) || registeredUsers.find(u => u.mobile === cleanMobile);

          const existsIndex = memoryWithdrawals.findIndex(m => 
            (m.id && String(m.id) === String(w._id)) || 
            (m._id && String(m._id) === String(w._id))
          );

          const accNum = w.account_number || w.accountNumber || w.account_details || (uMatch ? uMatch.account_number : null) || 'N/A';
          const ifscVal = w.ifsc_code || w.ifscCode || w.ifsc || (uMatch ? uMatch.ifsc_code : null) || 'N/A';
          const bName = w.bank_name || w.bankName || (uMatch ? uMatch.bank_name : null) || 'Bank Transfer';
          const accName = w.account_name || w.accountName || w.holder_name || (uMatch ? uMatch.name : null) || 'User';
          const upiVal = w.upi_id || w.upiId || w.upi || (uMatch ? uMatch.upi_id : null) || 'N/A';

          const wObj = {
            id: String(w._id),
            _id: String(w._id),
            user: w.username || w.user_name || w.name || (uMatch ? uMatch.name : 'User'),
            mobile: cleanMobile || (uMatch ? uMatch.mobile : 'N/A'),
            phone: cleanMobile || (uMatch ? uMatch.mobile : 'N/A'),
            email: w.email || (uMatch && uMatch.email ? uMatch.email : (cleanMobile ? `${cleanMobile}@gmail.com` : 'user@95xmatka.com')),
            name: w.username || w.name || (uMatch ? uMatch.name : 'User'),
            amount: parseFloat(w.amount) || 0,
            status: w.status ? (w.status.charAt(0).toUpperCase() + w.status.slice(1).toLowerCase()) : 'Pending',
            payment_method: w.payment_method || w.method || 'Bank Transfer',
            payment_details: w.payment_details || accNum || upiVal || 'N/A',
            account_number: accNum,
            accountNumber: accNum,
            ifsc_code: ifscVal,
            ifscCode: ifscVal,
            ifsc: ifscVal,
            upi_id: upiVal,
            bank_name: bName,
            bankName: bName,
            account_name: accName,
            accountName: accName,
            created_at: w.createdAt ? new Date(w.createdAt).toISOString() : new Date().toISOString(),
            createdAt: w.createdAt ? new Date(w.createdAt).toISOString() : new Date().toISOString(),
            rawDate: w.createdAt ? new Date(w.createdAt).toISOString() : new Date().toISOString(),
            date: w.createdAt ? new Date(w.createdAt).toISOString() : new Date().toISOString(),
            timestamp: w.createdAt ? new Date(w.createdAt).getTime() : Date.now()
          };

          if (existsIndex >= 0) {
            const currentMemStatus = memoryWithdrawals[existsIndex].status;
            memoryWithdrawals[existsIndex] = { ...memoryWithdrawals[existsIndex], ...wObj };
            if (currentMemStatus && (currentMemStatus === 'Approved' || currentMemStatus === 'Rejected' || currentMemStatus === 'Refunded')) {
              memoryWithdrawals[existsIndex].status = currentMemStatus;
            }
          } else {
            memoryWithdrawals.unshift(wObj);
          }
        });
      }
    }

    // Enrich in-memory withdrawals
    memoryWithdrawals.forEach(w => {
      const rawMobile = (w.mobile || w.phone || w.user || '').replace(/[^0-9]/g, '');
      const cleanMobile = rawMobile.length >= 10 ? rawMobile.slice(-10) : '';
      const uMatch = registeredUsers.find(u => u.mobile === cleanMobile);

      if (!w.mobile || w.mobile === 'N/A') w.mobile = cleanMobile || (uMatch ? uMatch.mobile : 'N/A');
      if (!w.phone || w.phone === 'N/A') w.phone = cleanMobile || (uMatch ? uMatch.mobile : 'N/A');

      const accNum = w.account_number || w.accountNumber || (uMatch ? uMatch.account_number : null) || 'N/A';
      const ifscVal = w.ifsc_code || w.ifscCode || w.ifsc || (uMatch ? uMatch.ifsc_code : null) || 'N/A';
      const bName = w.bank_name || w.bankName || (uMatch ? uMatch.bank_name : null) || 'Bank Transfer';
      const accName = w.account_name || w.accountName || (uMatch ? uMatch.name : null) || 'User';

      w.account_number = accNum;
      w.accountNumber = accNum;
      w.ifsc_code = ifscVal;
      w.ifscCode = ifscVal;
      w.ifsc = ifscVal;
      w.bank_name = bName;
      w.bankName = bName;
      w.account_name = accName;
      w.accountName = accName;
    });

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
    activeUserStr = 'yogibbk (7206561420)';
  }

  const newDeposit = {
    _id: `dep_${Date.now()}`,
    user: activeUserStr,
    amount: parseFloat(amount) || 300,
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
      if (mongoose.Types.ObjectId.isValid(id)) {
        const dbDep = await DepositRequest.findById(id);
        if (dbDep) {
          dep = {
            _id: dbDep._id,
            user: dbDep.username || 'User',
            mobile: dbDep.user_id || 'N/A',
            amount: parseFloat(dbDep.amount) || 0,
            utr: dbDep.utr_number,
            status: dbDep.status
          };
          memoryDeposits.unshift(dep);
        }
      }
    } catch (e) {}
  }

  if (!dep) {
    return res.status(404).json({ success: false, message: 'Deposit request not found' });
  }

  if (dep.status === 'Approved' || dep.status === 'approved') {
    return res.status(400).json({ success: false, message: 'Deposit request has already been approved' });
  }
  if (dep.status === 'Rejected' || dep.status === 'rejected') {
    return res.status(400).json({ success: false, message: 'Deposit request was already rejected' });
  }

  dep.status = 'Approved';
  const numAmt = parseFloat(dep.amount) || 0;
  userWalletStore.balance += numAmt;
  
  // Extract clean 10-digit mobile from dep.mobile or dep.user
  const rawMobile = String(dep.mobile || dep.user || '').replace(/[^0-9]/g, '');
  const cleanMobile = rawMobile.length >= 10 ? rawMobile.slice(-10) : '';

  let userObj = registeredUsers.find(u => 
    (cleanMobile && String(u.mobile || '').replace(/[^0-9]/g, '').slice(-10) === cleanMobile) ||
    (dep.user && String(dep.user).includes(String(u.mobile || '')))
  );

  const totalCredit = numAmt;

  let updatedNewBalance = 0;
  let oldBalVal = 0;
  if (userObj) {
    oldBalVal = userObj.balance || 0;
    // Automatically settle negative winning balance (debt) upon deposit
    if ((userObj.winning_balance || 0) < 0) {
      const debt = Math.abs(userObj.winning_balance);
      if (totalCredit >= debt) {
        userObj.winning_balance = 0.00;
        userObj.deposit_balance = parseFloat(((userObj.deposit_balance || 0) + (totalCredit - debt)).toFixed(2));
      } else {
        userObj.winning_balance = parseFloat((userObj.winning_balance + totalCredit).toFixed(2));
      }
    } else {
      userObj.deposit_balance = parseFloat(((userObj.deposit_balance || 0) + totalCredit).toFixed(2));
    }
    userObj.balance = parseFloat(((userObj.deposit_balance || 0) + (userObj.winning_balance || 0)).toFixed(2));
    updatedNewBalance = userObj.balance;
  }

  // Update MongoDB Atlas DepositRequest, Transaction and User wallet_balance live!
  try {
    if (mongoose.connection.readyState === 1) {
      const DepositRequest = require('../models/DepositRequest');
      const User = require('../models/User');
      const Transaction = require('../models/Transaction');

      if (mongoose.Types.ObjectId.isValid(dep._id)) {
        await DepositRequest.updateOne(
          { _id: dep._id },
          { $set: { status: 'approved' } }
        ).catch(() => {});
      } else if (dep.utr) {
        await DepositRequest.updateOne(
          { utr_number: dep.utr },
          { $set: { status: 'approved' } }
        ).catch(() => {});
      }

      if (cleanMobile) {
        const updateOps = { $inc: { deposit_balance: totalCredit, wallet_balance: totalCredit } };
        
        const updatedUser = await User.findOneAndUpdate(
          { mobile: cleanMobile },
          updateOps,
          { returnDocument: 'after' }
        );
        if (updatedUser) {
          updatedNewBalance = updatedUser.wallet_balance;
          if (userObj) {
            userObj.balance = updatedUser.wallet_balance;
            userObj.deposit_balance = updatedUser.deposit_balance || userObj.deposit_balance;
          }
        }

        // Write to Transaction collection in MongoDB Atlas
        await Transaction.create({
          user_id: cleanMobile,
          username: userObj ? userObj.name : dep.user,
          type: 'deposit',
          amount: numAmt,
          status: 'success',
          reference_id: dep.utr || String(dep._id),
          description: `Deposit Approved (+₹${numAmt})`
        }).catch(() => {});
      }
      console.log(`[MongoDB Deposit Sync] Credited ₹${numAmt} to user (+91 ${cleanMobile}). New balance: ₹${updatedNewBalance}`);
    }
  } catch (e) {
    console.error('[MongoDB Approve Deposit Error]', e);
  }

  // Log to Game Ledger
  try {
    const { logLedgerTransaction } = require('../store');
    logLedgerTransaction({
      user: userObj ? userObj.name : dep.user,
      email: `${cleanMobile}@gmail.com`,
      phone: cleanMobile,
      amount: `+${dep.amount.toFixed(2)}`,
      transactType: 'Deposit Approved',
      oldBal: { wallet: oldBalVal.toFixed(2), deposit: '0.00', winning: '0.00', commission: '0.00', bonus: '200.00', referral: '0.00' },
      newBal: { wallet: updatedNewBalance.toFixed(2), deposit: (userObj ? userObj.deposit_balance : 0).toFixed(2), winning: '0.00', commission: '0.00', bonus: '200.00', referral: '0.00' },
      gameType: '-'
    });
  } catch (e) {}

  saveDiskStore();
  res.json({
    success: true,
    message: `Deposit of ₹${dep.amount} verified & credited to user! New balance: ₹${updatedNewBalance}`,
    newBalance: updatedNewBalance,
    deposit: dep
  });
};

// @desc    Reject deposit request permanently
const rejectDeposit = async (req, res) => {
  const { id } = req.params;
  const cleanId = String(id || '').trim();

  // 1. Find all matching deposit entries in memory
  const matchingDeps = memoryDeposits.filter(d => 
    (d._id && String(d._id) === cleanId) || 
    (d.id && String(d.id) === cleanId) || 
    (d.utr && String(d.utr) === cleanId) || 
    (d.utr_number && String(d.utr_number) === cleanId) ||
    (d.client_txn_id && String(d.client_txn_id) === cleanId)
  );

  let dep = matchingDeps[0];
  const mongoose = require('mongoose');

  // 2. Fallback search in MongoDB Atlas if not found in memory
  if (!dep && mongoose.connection.readyState === 1) {
    try {
      const DepositRequest = require('../models/DepositRequest');
      let dbDep = null;
      if (mongoose.Types.ObjectId.isValid(cleanId)) {
        dbDep = await DepositRequest.findById(cleanId);
      }
      if (!dbDep) {
        dbDep = await DepositRequest.findOne({
          $or: [
            { utr_number: cleanId },
            { utr: cleanId },
            { client_txn_id: cleanId },
            { order_id: cleanId }
          ]
        });
      }
      if (dbDep) {
        dep = {
          _id: dbDep._id,
          id: String(dbDep._id),
          user: dbDep.username || dbDep.user || 'User',
          mobile: dbDep.user_id || dbDep.mobile || 'N/A',
          amount: parseFloat(dbDep.amount) || 0,
          utr: dbDep.utr_number || dbDep.client_txn_id || cleanId,
          utr_number: dbDep.utr_number || dbDep.client_txn_id || cleanId,
          client_txn_id: dbDep.client_txn_id || cleanId,
          status: 'Rejected'
        };
        memoryDeposits.unshift(dep);
        matchingDeps.push(dep);
      }
    } catch (e) {}
  }

  if (!dep && matchingDeps.length === 0) {
    return res.status(404).json({ success: false, message: 'Deposit request not found' });
  }

  const primaryDep = dep || matchingDeps[0];

  if (primaryDep.status === 'Approved' || primaryDep.status === 'approved') {
    return res.status(400).json({ success: false, message: 'Cannot reject an already approved deposit' });
  }

  // 3. Mark ALL matching memory items as 'Rejected' (including duplicates)
  const utrKey = primaryDep.utr || primaryDep.utr_number || primaryDep.client_txn_id;
  const rawMob = String(primaryDep.mobile || primaryDep.user || '').replace(/[^0-9]/g, '').slice(-10);
  const amt = parseFloat(primaryDep.amount) || 0;

  memoryDeposits.forEach(m => {
    const mMob = String(m.mobile || m.user || '').replace(/[^0-9]/g, '').slice(-10);
    const mAmt = parseFloat(m.amount) || 0;
    const isUtrMatch = utrKey && utrKey !== 'N/A' && (
      String(m.utr) === utrKey ||
      String(m.utr_number) === utrKey ||
      String(m.client_txn_id) === utrKey
    );
    const isIdMatch = (m._id && String(m._id) === cleanId) || (m.id && String(m.id) === cleanId);
    const isMobAmtMatch = rawMob && mMob === rawMob && Math.abs(mAmt - amt) < 0.01;

    if (isUtrMatch || isIdMatch || isMobAmtMatch) {
      m.status = 'Rejected';
    }
  });

  // 4. Update MongoDB Atlas across ALL matching field conditions
  try {
    if (mongoose.connection.readyState === 1) {
      const DepositRequest = require('../models/DepositRequest');
      const orConditions = [
        { utr_number: cleanId },
        { utr: cleanId },
        { client_txn_id: cleanId },
        { order_id: cleanId }
      ];

      if (mongoose.Types.ObjectId.isValid(cleanId)) {
        orConditions.push({ _id: cleanId });
      }
      if (primaryDep._id && mongoose.Types.ObjectId.isValid(String(primaryDep._id))) {
        orConditions.push({ _id: primaryDep._id });
      }
      if (utrKey && utrKey !== 'N/A') {
        orConditions.push(
          { utr_number: utrKey },
          { utr: utrKey },
          { client_txn_id: utrKey },
          { order_id: utrKey }
        );
      }

      await DepositRequest.updateMany(
        { $or: orConditions },
        { $set: { status: 'rejected' } }
      ).catch(() => {});
    }
  } catch (e) {
    console.error('[MongoDB Reject Deposit Error]', e);
  }

  saveDiskStore();
  res.json({ success: true, message: 'Deposit request rejected permanently', deposit: primaryDep });
};

// @desc    Create withdrawal request
const createWithdrawalRequest = async (req, res) => {
  const { user, amount, accountName, account_name, accountNumber, account_number, ifsc, ifscCode, ifsc_code, bankName, bank_name, mobile, upi, upiId, upi_id } = req.body;
  const rawMobile = (mobile || user || '').replace(/[^0-9]/g, '');
  const cleanMobile = rawMobile.length >= 10 ? rawMobile.slice(-10) : '';
  const numAmt = parseFloat(amount) || 300;

  const accNum = accountNumber || account_number || 'N/A';
  const ifscVal = ifsc || ifscCode || ifsc_code || 'N/A';
  const accName = accountName || account_name || 'User Account';
  const bName = bankName || bank_name || (accNum !== 'N/A' ? 'Bank Transfer' : 'UPI Transfer');
  const upiVal = upi || upiId || upi_id || 'N/A';

  let targetUser = registeredUsers.find(u => (cleanMobile && (u.mobile || '').replace(/[^0-9]/g, '').slice(-10) === cleanMobile));

  // Deduct balance on creation
  if (targetUser) {
    if ((targetUser.winning_balance || 0) >= numAmt) {
      targetUser.winning_balance = parseFloat((targetUser.winning_balance - numAmt).toFixed(2));
    } else if ((targetUser.deposit_balance || 0) >= numAmt) {
      targetUser.deposit_balance = parseFloat((targetUser.deposit_balance - numAmt).toFixed(2));
    } else {
      let rem = numAmt;
      if ((targetUser.winning_balance || 0) > 0) {
        rem -= targetUser.winning_balance;
        targetUser.winning_balance = 0.00;
      }
      targetUser.deposit_balance = parseFloat(Math.max(0, (targetUser.deposit_balance || 0) - rem).toFixed(2));
    }
    targetUser.balance = parseFloat(((targetUser.deposit_balance || 0) + (targetUser.winning_balance || 0)).toFixed(2));
    userWalletStore.balance = targetUser.balance;

    // Sync deduction to MongoDB live
    try {
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState === 1) {
        const User = require('../models/User');
        User.updateOne(
          { mobile: cleanMobile },
          { 
            $set: { 
              deposit_balance: targetUser.deposit_balance,
              winning_balance: targetUser.winning_balance,
              wallet_balance: targetUser.balance
            } 
          }
        ).catch(e => {});
      }
    } catch (e) {}
  }

  const newWithdrawal = {
    _id: `wth_${Date.now()}`,
    id: `wth_${Date.now()}`,
    user: user || (cleanMobile ? `User (${cleanMobile})` : 'User'),
    mobile: cleanMobile || (targetUser ? targetUser.mobile : 'N/A'),
    phone: cleanMobile || (targetUser ? targetUser.mobile : 'N/A'),
    amount: numAmt,
    accountName: accName,
    account_name: accName,
    accountNumber: accNum,
    account_number: accNum,
    ifsc: ifscVal,
    ifscCode: ifscVal,
    ifsc_code: ifscVal,
    bankName: bName,
    bank_name: bName,
    upi: upiVal,
    upi_id: upiVal,
    status: 'Pending',
    balanceDeducted: true,
    createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };
  memoryWithdrawals.unshift(newWithdrawal);
  saveDiskStore();
  res.status(201).json(newWithdrawal);
};

// @desc    Approve withdrawal request
const approveWithdrawal = async (req, res) => {
  const { id } = req.params;
  let wth = memoryWithdrawals.find(w => String(w._id) === String(id) || String(w.id) === String(id));

  const mongoose = require('mongoose');

  if (!wth && mongoose.connection.readyState === 1) {
    try {
      const WithdrawalRequest = require('../models/WithdrawalRequest');
      if (mongoose.Types.ObjectId.isValid(id)) {
        const dbWth = await WithdrawalRequest.findById(id);
        if (dbWth) {
          wth = {
            _id: String(dbWth._id),
            id: String(dbWth._id),
            user: dbWth.username || 'User',
            amount: parseFloat(dbWth.amount) || 0,
            status: 'Approved'
          };
          memoryWithdrawals.unshift(wth);
        }
      }
    } catch (e) {}
  }

  if (!wth) {
    return res.status(404).json({ success: false, message: 'Withdrawal request not found' });
  }

  if (wth.status === 'Approved' || wth.status === 'approved') {
    return res.status(400).json({ success: false, message: 'Withdrawal request has already been approved' });
  }
  if (wth.status === 'Rejected' || wth.status === 'rejected' || wth.status === 'Refunded' || wth.status === 'refunded') {
    return res.status(400).json({ success: false, message: 'Withdrawal request was already rejected' });
  }

  wth.status = 'Approved';

  const rawMobile = String(wth.mobile || wth.phone || wth.user || '').replace(/[^0-9]/g, '');
  const cleanMobile = rawMobile.length >= 10 ? rawMobile.slice(-10) : '';

  let targetUser = registeredUsers.find(u => 
    (cleanMobile && String(u.mobile || '').replace(/[^0-9]/g, '').slice(-10) === cleanMobile) ||
    (wth.user && String(wth.user).includes(String(u.mobile || '')))
  );

  // Sync to MongoDB
  try {
    if (mongoose.connection.readyState === 1) {
      const WithdrawalRequest = require('../models/WithdrawalRequest');
      if (mongoose.Types.ObjectId.isValid(wth._id)) {
        await WithdrawalRequest.updateOne({ _id: wth._id }, { $set: { status: 'approved' } });
      }
    }
  } catch (e) {
    console.error('[MongoDB Approve Withdrawal Sync Error]', e);
  }

  saveDiskStore();
  console.log(`[Admin Withdrawal] Approved payout of ₹${wth.amount} for ${targetUser ? targetUser.name : wth.user}.`);
  res.json({ success: true, message: `Withdrawal payout approved successfully!`, withdrawal: wth, user: targetUser });
};

// @desc    Reject withdrawal request & refund amount to user profile
const rejectWithdrawal = async (req, res) => {
  const { id } = req.params;
  let wth = memoryWithdrawals.find(w => String(w._id) === String(id) || String(w.id) === String(id));

  const mongoose = require('mongoose');

  if (!wth && mongoose.connection.readyState === 1) {
    try {
      const WithdrawalRequest = require('../models/WithdrawalRequest');
      if (mongoose.Types.ObjectId.isValid(id)) {
        const dbWth = await WithdrawalRequest.findById(id);
        if (dbWth) {
          wth = {
            _id: String(dbWth._id),
            id: String(dbWth._id),
            user: dbWth.username || 'User',
            amount: parseFloat(dbWth.amount) || 0,
            status: 'Pending'
          };
          memoryWithdrawals.unshift(wth);
        }
      }
    } catch (e) {}
  }

  if (!wth) {
    return res.status(404).json({ success: false, message: 'Withdrawal request not found' });
  }

  if (wth.status === 'Refunded' || wth.status === 'refunded' || wth.status === 'Rejected' || wth.status === 'rejected') {
    return res.status(400).json({ success: false, message: 'Withdrawal request has already been rejected and refunded' });
  }
  if (wth.status === 'Approved' || wth.status === 'approved') {
    return res.status(400).json({ success: false, message: 'Cannot reject an already approved withdrawal' });
  }

  wth.status = 'Refunded';

  const rawMobile = String(wth.mobile || wth.phone || wth.user || '').replace(/[^0-9]/g, '');
  const cleanMobile = rawMobile.length >= 10 ? rawMobile.slice(-10) : '';

  let userObj = registeredUsers.find(u => 
    (cleanMobile && String(u.mobile || '').replace(/[^0-9]/g, '').slice(-10) === cleanMobile) ||
    (wth.user && String(wth.user).includes(String(u.mobile || '')))
  );

  const numAmt = parseFloat(wth.amount) || 0;
  let oldBalVal = userObj ? (userObj.balance || 0) : 0;
  let updatedNewBalance = oldBalVal;

  // Refund the amount back to user's wallet
  if (userObj && !wth.refundProcessed) {
    wth.refundProcessed = true;
    userObj.deposit_balance = parseFloat(((userObj.deposit_balance || 0) + numAmt).toFixed(2));
    userObj.winning_balance = Math.max(0, parseFloat((userObj.winning_balance || 0).toFixed(2)));
    userObj.balance = parseFloat(((userObj.deposit_balance || 0) + userObj.winning_balance).toFixed(2));
    updatedNewBalance = userObj.balance;
    userWalletStore.balance = userObj.balance;
  }

  // Update MongoDB
  try {
    if (mongoose.connection.readyState === 1) {
      const WithdrawalRequest = require('../models/WithdrawalRequest');
      const User = require('../models/User');
      const Transaction = require('../models/Transaction');

      if (mongoose.Types.ObjectId.isValid(wth._id)) {
        await WithdrawalRequest.updateOne({ _id: wth._id }, { $set: { status: 'Refunded', note: 'Withdrawal Rejected & Refunded' } }).catch(() => {});
      }

      if (userObj && cleanMobile) {
        await User.updateOne(
          { mobile: cleanMobile },
          { 
            $set: { 
              wallet_balance: userObj.balance,
              deposit_balance: userObj.deposit_balance,
              winning_balance: userObj.winning_balance
            } 
          }
        ).catch(() => {});

        await Transaction.create({
          user_id: cleanMobile,
          username: userObj.name,
          type: 'refund',
          amount: numAmt,
          status: 'success',
          reference_id: String(wth._id || wth.id),
          description: `Withdrawal Rejected (Refunded +₹${numAmt})`
        }).catch(() => {});
      }
    }
  } catch (e) {
    console.error('[MongoDB Reject Withdrawal Sync Error]', e);
  }

  // Log to Game Ledger
  try {
    const { logLedgerTransaction } = require('../store');
    logLedgerTransaction({
      user: userObj ? userObj.name : wth.user,
      email: `${cleanMobile}@gmail.com`,
      phone: cleanMobile,
      amount: `+${numAmt.toFixed(2)}`,
      transactType: 'Withdrawal Rejected (Refund)',
      oldBal: { wallet: oldBalVal.toFixed(2), deposit: (userObj ? (userObj.deposit_balance - numAmt) : 0).toFixed(2), winning: '0.00', commission: '0.00', bonus: '200.00', referral: '0.00' },
      newBal: { wallet: updatedNewBalance.toFixed(2), deposit: (userObj ? userObj.deposit_balance : 0).toFixed(2), winning: '0.00', commission: '0.00', bonus: '200.00', referral: '0.00' },
      gameType: '-'
    });
  } catch (e) {}

  saveDiskStore();
  console.log(`[Admin Withdrawal] Rejected & Refunded ₹${numAmt} back to ${userObj ? userObj.name : wth.user}. New balance: ₹${updatedNewBalance}`);
  res.json({ success: true, message: `Withdrawal rejected. ₹${numAmt} refunded back to user wallet!`, withdrawal: wth, user: userObj, newBalance: updatedNewBalance });
};

// @desc    Admin update user wallet balance
// @route   POST /api/admin/update-user-wallet
const updateUserWallet = async (req, res) => {
  const { userId, mobile, type, walletType, transactType, amount } = req.body;
  const val = parseFloat(amount) || 0;

  const cleanMobile = mobile ? mobile.replace(/[^0-9]/g, '').slice(-10) : (userId ? userId.replace(/[^0-9]/g, '').slice(-10) : '');
  let targetUser = registeredUsers.find(u => 
    u.id === userId || 
    (cleanMobile && u.mobile.replace(/[^0-9]/g, '').slice(-10) === cleanMobile)
  );

  if (targetUser) {
    const oldBal = {
      wallet: (targetUser.balance || 0).toFixed(2),
      deposit: (targetUser.deposit_balance || 0).toFixed(2),
      winning: (targetUser.winning_balance || 0).toFixed(2),
      commission: (targetUser.commission_balance || 0).toFixed(2),
      bonus: (targetUser.bonus_balance || 200).toFixed(2),
      referral: ((targetUser.referrals || 0) * 33).toFixed(2)
    };

    const targetKey = walletType || 'deposit';
    if (type === 'add') {
      if (targetKey === 'deposit') targetUser.deposit_balance = (targetUser.deposit_balance || 0) + val;
      else if (targetKey === 'winning') targetUser.winning_balance = (targetUser.winning_balance || 0) + val;
      else if (targetKey === 'bonus') targetUser.bonus_balance = (targetUser.bonus_balance || 0) + val;
      else if (targetKey === 'commission') targetUser.commission_balance = (targetUser.commission_balance || 0) + val;
      else targetUser.deposit_balance = (targetUser.deposit_balance || 0) + val;
    } else {
      if (targetKey === 'deposit') targetUser.deposit_balance = Math.max(0, (targetUser.deposit_balance || 0) - val);
      else if (targetKey === 'winning') targetUser.winning_balance = Math.max(0, (targetUser.winning_balance || 0) - val);
      else if (targetKey === 'bonus') targetUser.bonus_balance = Math.max(0, (targetUser.bonus_balance || 0) - val);
      else if (targetKey === 'commission') targetUser.commission_balance = Math.max(0, (targetUser.commission_balance || 0) - val);
      else targetUser.deposit_balance = Math.max(0, (targetUser.deposit_balance || 0) - val);
    }

    targetUser.balance = parseFloat(((targetUser.deposit_balance || 0) + (targetUser.winning_balance || 0)).toFixed(2));
    userWalletStore.balance = targetUser.balance;

    const newBal = {
      wallet: (targetUser.balance || 0).toFixed(2),
      deposit: (targetUser.deposit_balance || 0).toFixed(2),
      winning: (targetUser.winning_balance || 0).toFixed(2),
      commission: (targetUser.commission_balance || 0).toFixed(2),
      bonus: (targetUser.bonus_balance || 200).toFixed(2),
      referral: ((targetUser.referrals || 0) * 33).toFixed(2)
    };

    // Create deposit or withdrawal record so stats (e.g. todayDeposite) & histories update
    if (type === 'add' && (targetKey === 'deposit' || !targetKey)) {
      const depRecord = {
        _id: `dep_manual_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        id: `dep_manual_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        user: `${targetUser.name} (${targetUser.mobile})`,
        username: targetUser.name,
        user_id: targetUser.mobile,
        mobile: targetUser.mobile,
        phone: targetUser.mobile,
        amount: val,
        method: 'Admin Add (Manual)',
        payment_method: 'Admin Add (Manual)',
        utr: `ADMIN_MANUAL_${Date.now()}`,
        utr_number: `ADMIN_MANUAL_${Date.now()}`,
        status: 'Approved',
        created_at: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      memoryDeposits.unshift(depRecord);

      try {
        const mongoose = require('mongoose');
        if (mongoose.connection.readyState === 1) {
          const DepositRequest = require('../models/DepositRequest');
          DepositRequest.create({
            user_id: targetUser.mobile,
            username: targetUser.name,
            amount: val,
            payment_method: 'Admin Add (Manual)',
            utr_number: depRecord.utr,
            status: 'Approved'
          }).catch(e => console.error('[MongoDB DepositRequest Create Error]', e.message));
        }
      } catch (e) {}
    } else if (type !== 'add' && (targetKey === 'deposit' || !targetKey)) {
      const wthRecord = {
        _id: `wth_manual_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        id: `wth_manual_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        user: `${targetUser.name} (${targetUser.mobile})`,
        username: targetUser.name,
        user_id: targetUser.mobile,
        mobile: targetUser.mobile,
        phone: targetUser.mobile,
        amount: val,
        method: 'Admin Deduct (Manual)',
        status: 'Approved',
        created_at: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      memoryWithdrawals.unshift(wthRecord);

      try {
        const mongoose = require('mongoose');
        if (mongoose.connection.readyState === 1) {
          const WithdrawalRequest = require('../models/WithdrawalRequest');
          WithdrawalRequest.create({
            user_id: targetUser.mobile,
            username: targetUser.name,
            amount: val,
            payment_method: 'Admin Deduct (Manual)',
            status: 'Approved'
          }).catch(e => console.error('[MongoDB WithdrawalRequest Create Error]', e.message));
        }
      } catch (e) {}
    }

    // Log transaction to Game Ledger
    try {
      const { logLedgerTransaction } = require('../store');
      logLedgerTransaction({
        user: targetUser.name || 'User',
        email: targetUser.email || `${targetUser.mobile}@gmail.com`,
        phone: targetUser.mobile,
        amount: (type === 'add' ? `+${val.toFixed(2)}` : `-${val.toFixed(2)}`),
        transactType: transactType || (type === 'add' ? 'Deposit Manually' : 'Withdrawal Decline'),
        oldBal,
        newBal,
        gameType: '-'
      });
    } catch (e) {}

    // Sync updated wallet balance to MongoDB Atlas
    try {
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState === 1) {
        const User = require('../models/User');
        const cleanTargetMob = (targetUser.mobile || '').replace(/[^0-9]/g, '').slice(-10);
        User.updateOne(
          { mobile: { $regex: new RegExp(cleanTargetMob + '$') } },
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
      }
    } catch (e) { }

    saveDiskStore();
    console.log(`[Admin Wallet] Updated balance for ${targetUser.name} (${targetUser.mobile}): ${targetUser.balance}`);
    return res.json({ success: true, message: `Wallet updated for ${targetUser.name}`, newBalance: targetUser.balance, user: targetUser });
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

const getBannersList = async (req, res) => {
  const { bannersListStore } = require('../store');
  res.json(bannersListStore || []);
};

const saveBannersList = async (req, res) => {
  const { banners } = req.body;
  if (!Array.isArray(banners)) {
    return res.status(400).json({ error: 'Banners must be an array' });
  }

  const { bannersListStore, saveDiskStore } = require('../store');
  bannersListStore.length = 0;
  bannersListStore.push(...banners);
  saveDiskStore();

  // Sync to MongoDB
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      const BannersListModel = mongoose.models.BannersList || mongoose.model('BannersList', new mongoose.Schema({}, { strict: false }));
      await BannersListModel.deleteMany({});
      if (banners.length > 0) {
        await BannersListModel.insertMany(banners);
      }
      console.log(`[MongoDB] Saved banners list: ${banners.length} items.`);
    }
  } catch (e) {
    console.error('[MongoDB Saved Banners Sync Error]', e);
  }

  res.json({ success: true, message: 'Banners list updated successfully', banners: bannersListStore });
};

const getAppVersionConfig = async (req, res) => {
  const { appVersionConfig } = require('../store');
  res.json(appVersionConfig || {
    latestVersionCode: 25,
    latestVersionName: '1.0.25',
    minSupportedVersion: 1,
    apkUrl: 'https://95xmatka.com/95xmatka.apk',
    updateMessage: '🚀 New Update Available! Consolidated Bet History cards & instant wallet deduction. Tap UPDATE NOW!',
    forceUpdate: true
  });
};

const updateAppVersionConfig = async (req, res) => {
  const { appVersionConfig, saveDiskStore } = require('../store');
  if (req.body && appVersionConfig) Object.assign(appVersionConfig, req.body);
  saveDiskStore();
  res.json({ success: true, appVersionConfig });
};

const getSettingsConfig = async (req, res) => {
  const { settingsConfig } = require('../store');
  res.json(settingsConfig || {
    whatsapp_number: '+917206561420',
    whatsapp_call_number: '+917206561420',
    app_download_link: 'https://95xmatka.com/95xmatka.apk',
    app_version: '1.0.23',
    bank_withdrawal_enable: true,
    upi_withdrawal_enable: true,
    lucky_card_maintenance: false,
    jodi_rate: 95,
    crossing_rate: 95,
    haroof_rate: 9.5
  });
};

const updateSettingsConfig = async (req, res) => {
  const store = require('../store');
  if (req.body) {
    if (req.body.jodi_rate !== undefined) store.settingsConfig.jodi_rate = parseFloat(req.body.jodi_rate) || 95;
    if (req.body.crossing_rate !== undefined) store.settingsConfig.crossing_rate = parseFloat(req.body.crossing_rate) || 95;
    if (req.body.haroof_rate !== undefined) store.settingsConfig.haroof_rate = parseFloat(req.body.haroof_rate) || 9.5;

    Object.assign(store.settingsConfig, req.body);
    if (req.body.app_version) {
      store.appVersionConfig.latestVersionName = req.body.app_version;
      if (req.body.latestVersionCode !== undefined) {
        store.appVersionConfig.latestVersionCode = parseInt(req.body.latestVersionCode);
      }
    }
    if (req.body.app_download_link) {
      store.appVersionConfig.apkUrl = req.body.app_download_link;
    }
    if (req.body.updateMessage) {
      store.appVersionConfig.updateMessage = req.body.updateMessage;
    }
    if (req.body.forceUpdate !== undefined) {
      store.appVersionConfig.forceUpdate = !!req.body.forceUpdate;
    }
    store.saveDiskStore();
    res.json({ success: true, message: 'Settings saved successfully', settingsConfig: store.settingsConfig });
  } else {
    res.status(400).json({ error: 'Invalid settings body' });
  }
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
          const cleanMob = String(b.mobile || b.username || b.user || '').replace(/[^0-9]/g, '').slice(-10);
          const dbTime = b.createdAt ? new Date(b.createdAt).getTime() : (b.created_at ? new Date(b.created_at).getTime() : 0);

          const exists = memoryBets.some(m => {
            if (String(m._id || m.id) === String(b._id)) return true;
            const mMob = String(m.mobile || m.user || '').replace(/[^0-9]/g, '').slice(-10);
            const mTime = m.created_at ? new Date(m.created_at).getTime() : (m.timestamp || 0);
            if (mMob && cleanMob && mMob === cleanMob && m.game_name === b.game_name && String(m.number) === String(b.number) && Math.abs((m.bet_amount || m.amount || 0) - (b.bet_amount || 0)) < 0.01 && (mTime === 0 || dbTime === 0 || Math.abs(mTime - dbTime) < 30000)) {
              m._id = String(b._id);
              m.id = String(b._id);
              if (b.status && b.status !== 'pending') m.status = b.status;
              if (b.win_amount && b.win_amount > 0) m.win_amount = b.win_amount;
              return true;
            }
            return false;
          });

          if (!exists) {
            memoryBets.unshift({
              _id: b._id,
              id: b._id,
              user: b.username || b.mobile || 'User',
              mobile: b.mobile || 'N/A',
              game_name: b.game_name,
              bet_type: b.bet_type || 'JODI',
              number: b.number,
              bet_amount: b.bet_amount,
              multiplier: b.multiplier,
              potential_payout: b.potential_payout || (b.bet_amount * (b.multiplier || 90)),
              status: b.status || 'pending',
              win_amount: b.win_amount || b.winAmount || 0,
              date_key: b.date_key || b.createdDateKey || getGameBetDateKey(b.game_name, b.createdAt),
              createdDateKey: b.createdDateKey || b.date_key || getGameBetDateKey(b.game_name, b.createdAt),
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

// @desc    Update bid number / amount (Admin Control)
// @route   POST /api/admin/update-bid
const updateAdminBid = async (req, res) => {
  const { id, number, amount, status } = req.body;
  if (!id) {
    return res.status(400).json({ success: false, message: 'Bid ID is required' });
  }

  const { memoryBets, registeredUsers, saveDiskStore, logLedgerTransaction } = require('../store');
  const numVal = number !== undefined ? parseInt(number) : undefined;
  const amtVal = amount !== undefined ? parseFloat(amount) : undefined;

  // Update in memoryBets store
  const targetMemoryBet = memoryBets.find(b => String(b._id || b.id) === String(id));
  if (targetMemoryBet) {
    const oldAmt = parseFloat(targetMemoryBet.bet_amount || targetMemoryBet.amount || 0);

    if (numVal !== undefined && !isNaN(numVal)) targetMemoryBet.number = numVal;
    if (amtVal !== undefined && !isNaN(amtVal)) {
      targetMemoryBet.bet_amount = amtVal;
      targetMemoryBet.potential_payout = amtVal * (targetMemoryBet.multiplier || 95);

      // Adjust user balance if amount changed
      const diff = oldAmt - amtVal; // positive means refund difference, negative means deduct difference
      if (diff !== 0) {
        const rawMobile = targetMemoryBet.mobile || targetMemoryBet.user_mobile || targetMemoryBet.userMobile || targetMemoryBet.phone;
        const cleanMobile = rawMobile ? String(rawMobile).replace(/[^0-9]/g, '').slice(-10) : '';

        let targetUserObj = null;
        if (cleanMobile) {
          targetUserObj = registeredUsers.find(u => String(u.mobile || u.phone || '').replace(/[^0-9]/g, '').slice(-10) === cleanMobile);
        }
        if (!targetUserObj && targetMemoryBet.user) {
          targetUserObj = registeredUsers.find(u => u.name === targetMemoryBet.user || (u.mobile && String(targetMemoryBet.user).includes(u.mobile)));
        }

        if (targetUserObj) {
          if (targetUserObj.deposit_balance === undefined) targetUserObj.deposit_balance = targetUserObj.balance || 0;
          if (targetUserObj.winning_balance === undefined) targetUserObj.winning_balance = 0;

          const oldWalletBal = parseFloat(((targetUserObj.deposit_balance || 0) + (targetUserObj.winning_balance || 0)).toFixed(2));
          const oldDepBal = parseFloat((targetUserObj.deposit_balance || 0).toFixed(2));

          targetUserObj.deposit_balance = parseFloat((targetUserObj.deposit_balance + diff).toFixed(2));
          targetUserObj.balance = parseFloat(((targetUserObj.deposit_balance || 0) + (targetUserObj.winning_balance || 0)).toFixed(2));
          targetUserObj.wallet_balance = targetUserObj.balance;

          const userCleanMob = String(targetUserObj.mobile || cleanMobile).replace(/[^0-9]/g, '').slice(-10);

          try {
            const mongoose = require('mongoose');
            if (mongoose.connection.readyState === 1 && userCleanMob) {
              const User = require('../models/User');
              User.updateOne(
                { mobile: { $regex: new RegExp(userCleanMob + '$') } },
                {
                  $set: {
                    deposit_balance: targetUserObj.deposit_balance,
                    wallet_balance: targetUserObj.balance,
                    balance: targetUserObj.balance
                  }
                }
              ).catch(e => console.error('[Update Bid User Sync Error]:', e.message));
            }
          } catch (e) {}

          try {
            if (typeof logLedgerTransaction === 'function') {
              logLedgerTransaction({
                user: targetUserObj.name || targetMemoryBet.user || 'User',
                email: targetUserObj.email || `${userCleanMob}@gmail.com`,
                phone: userCleanMob,
                amount: diff >= 0 ? `+${diff.toFixed(2)}` : `${diff.toFixed(2)}`,
                transactType: diff >= 0 ? 'Bid Amount Edit (Refund)' : 'Bid Amount Edit (Deduction)',
                oldBal: {
                  wallet: oldWalletBal.toFixed(2),
                  deposit: oldDepBal.toFixed(2),
                  winning: (targetUserObj.winning_balance || 0).toFixed(2),
                  commission: (targetUserObj.commission_balance || 0).toFixed(2),
                  bonus: (targetUserObj.bonus_balance || 0).toFixed(2),
                  referral: '0.00'
                },
                newBal: {
                  wallet: targetUserObj.balance.toFixed(2),
                  deposit: targetUserObj.deposit_balance.toFixed(2),
                  winning: (targetUserObj.winning_balance || 0).toFixed(2),
                  commission: (targetUserObj.commission_balance || 0).toFixed(2),
                  bonus: (targetUserObj.bonus_balance || 0).toFixed(2),
                  referral: '0.00'
                },
                gameType: targetMemoryBet.game_name || targetMemoryBet.game || '-'
              });
            }
          } catch (err) {}
        }
      }
    }
    if (status) targetMemoryBet.status = status;
  }

  // Sync with MongoDB Atlas if connected
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      const Bet = require('../models/Bet');
      const updateData = {};
      if (numVal !== undefined && !isNaN(numVal)) updateData.number = numVal;
      if (amtVal !== undefined && !isNaN(amtVal)) {
        updateData.bet_amount = amtVal;
        updateData.potential_payout = amtVal * 95;
      }
      if (status) updateData.status = status;
      await Bet.findByIdAndUpdate(id, updateData);
    }
  } catch (e) {
    console.error('[Admin Update Bid DB Error]', e);
  }

  saveDiskStore();
  res.json({ success: true, message: `Bid ${id} updated successfully`, number: numVal, amount: amtVal });
};

// @desc    Get referral configuration
// @route   GET /api/admin/referral-config
const getReferralConfig = async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  const { referralConfig } = require('../store');
  try {
    const mongoose = require('mongoose');
    const ConfigModel = mongoose.models.SystemConfig || mongoose.model('SystemConfig', new mongoose.Schema({}, { strict: false }));
    const dbConfig = await ConfigModel.findOne({ type: 'referral' }).lean();
    if (dbConfig) {
      if (dbConfig.commissionPercentage !== undefined) referralConfig.commissionPercentage = dbConfig.commissionPercentage;
      if (dbConfig.signupBonus !== undefined) referralConfig.signupBonus = dbConfig.signupBonus;
      if (dbConfig.enabled !== undefined) referralConfig.enabled = dbConfig.enabled;
      if (dbConfig.status !== undefined) referralConfig.status = dbConfig.status;
      if (dbConfig.promoText !== undefined) referralConfig.promoText = dbConfig.promoText;
    }
  } catch (e) {}
  res.json(referralConfig);
};

// @desc    Update referral configuration
// @route   POST /api/admin/update-referral-config
const updateReferralConfig = async (req, res) => {
  const { referralConfig, saveDiskStore } = require('../store');
  const { commissionPercentage, signupBonus, enabled, status, promoText } = req.body;

  if (commissionPercentage !== undefined) referralConfig.commissionPercentage = parseFloat(commissionPercentage);
  if (signupBonus !== undefined) referralConfig.signupBonus = parseFloat(signupBonus);
  if (typeof enabled === 'boolean') referralConfig.enabled = enabled;
  if (status !== undefined) referralConfig.status = status;
  if (promoText !== undefined) referralConfig.promoText = promoText;

  saveDiskStore();

  try {
    const mongoose = require('mongoose');
    const ConfigModel = mongoose.models.SystemConfig || mongoose.model('SystemConfig', new mongoose.Schema({}, { strict: false }));
    await ConfigModel.findOneAndUpdate({ type: 'referral' }, { type: 'referral', ...referralConfig }, { upsert: true, new: true });
  } catch (e) {
    console.error('[MongoDB Referral Config Save Error]', e);
  }

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
        const totalStaked = userBets.reduce((sum, b) => {
          const mainAmt = b.wallet_deducted !== undefined ? parseFloat(b.wallet_deducted) : (b.main_wallet_amount !== undefined ? parseFloat(b.main_wallet_amount) : (b.bonus_deducted !== undefined ? Math.max(0, (parseFloat(b.bet_amount) || 0) - (parseFloat(b.bonus_deducted) || 0)) : (parseFloat(b.bet_amount) || 0)));
          return sum + (isNaN(mainAmt) ? 0 : mainAmt);
        }, 0);
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

// Admin Authentication Handlers
const adminLogin = async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required' });
  }

  // Accept nedstarkontop@gmail.com / Y2004S143lovE
  if (username === 'nedstarkontop@gmail.com' && password === 'Y2004S143lovE') {
    return res.json({
      success: true,
      requireOtp: true,
      message: 'Credentials verified! Please enter your 4-digit OTP to proceed.'
    });
  }

  res.status(401).json({ success: false, message: 'Invalid admin username or password.' });
};

const verifyAdminOtp = async (req, res) => {
  const { otp } = req.body;
  if (!otp) {
    return res.status(400).json({ success: false, message: 'OTP is required' });
  }

  // Verify via MSG91
  const ADMIN_PHONE = '7206561420';
  try {
    const { verifyOtp } = require('../utils/msg91');
    const result = await verifyOtp(ADMIN_PHONE, otp);
    if (result.success) {
      return res.json({
        success: true,
        token: 'admin_session_token_' + Date.now(),
        admin: {
          username: 'Admin',
          name: 'Admin',
          email: 'nedstarkontop@gmail.com',
          role: 'Super Admin',
          mobile: '+917206561420'
        }
      });
    }
  } catch (e) {}

  res.status(400).json({ success: false, message: 'Invalid OTP entered. Please try again.' });
};

// Extended Admin Modules API Handlers
const getAdminAdmins = async (req, res) => {
  res.json([
    { id: '1', name: 'John Snow', username: 'Johnsnow', mobile: '+919999988888', role: 'Super Admin', status: 'Active', createdAt: '2025-01-01 10:00:00' },
    { id: '2', name: 'Manager Admin', username: 'manager', mobile: '+919876543210', role: 'Manager', status: 'Active', createdAt: '2025-02-15 12:30:00' }
  ]);
};

const getAdminWinnings = async (req, res) => {
  const winningBets = memoryBets.filter(b => b.status === 'won' || b.win_amount > 0 || b.winAmount > 0 || b.status === 'Won');
  res.json(winningBets.map((b, i) => {
    const rawUser = b.user || b.mobile || '';
    const cleanMobile = rawUser.replace(/[^0-9]/g, '').slice(-10) || '8580642004';
    const winAmt = b.win_amount || b.winAmount || (b.bet_amount * 95);
    return {
      id: b.id || b._id || `win_${i+1}`,
      category: b.game_name || b.category || 'Desawar',
      user: rawUser.includes('(') ? rawUser.split('(')[0].trim() : (b.name || 'Player'),
      email: 'player@pk.com',
      mobile: cleanMobile,
      userId: (18426 - i).toString(),
      amount: winAmt,
      txnId: b.txnId || `06EDEACE83C${6988 + i}BB`,
      txnType: 'Winning amount',
      status: 'SUCCESS',
      dateOfWinning: b.created_at ? new Date(b.created_at).toISOString().split('T')[0] : '2026-08-29',
      dateOfTxn: b.created_at ? new Date(b.created_at).toISOString().replace('T', ' ').substring(0, 19) : '2026-08-29 05:52:35'
    };
  }));
};

function safeParseTime(d, fallback = Date.now(), id = null) {
  if (!d && !id) return fallback;
  if (typeof d === 'number' && !isNaN(d) && d > 0) return d < 10000000000 ? d * 1000 : d;
  
  const str = String(d || '').trim();
  if (/^\d{10,13}$/.test(str)) {
    const num = parseInt(str, 10);
    return num < 10000000000 ? num * 1000 : num;
  }

  const targetId = (id && /^[0-9a-fA-F]{24}$/.test(String(id))) ? String(id) :
                   (/^[0-9a-fA-F]{24}$/.test(str) ? str : null);
  if (targetId) {
    const epochSec = parseInt(targetId.substring(0, 8), 16);
    if (epochSec > 1600000000 && epochSec < 2500000000) return epochSec * 1000;
  }

  try {
    const dt = new Date(str);
    if (!isNaN(dt.getTime())) return dt.getTime();
  } catch (e) {}

  const matchTime = str.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?\s*(AM|PM)?/i);
  if (matchTime) {
    let [_, hr, min, sec, ampm] = matchTime;
    let h = parseInt(hr, 10);
    if (ampm && ampm.toUpperCase() === 'PM' && h < 12) h += 12;
    if (ampm && ampm.toUpperCase() === 'AM' && h === 12) h = 0;
    const base = (fallback && fallback > 86400000) ? new Date(fallback) : new Date();
    const validBase = isNaN(base.getTime()) ? new Date() : base;
    return new Date(validBase.getFullYear(), validBase.getMonth(), validBase.getDate(), h, parseInt(min, 10), sec ? parseInt(sec, 10) : 0).getTime();
  }

  return fallback;
}

function safeFormatISO(d, fallback = 'Today', id = null) {
  const t = safeParseTime(d, 0, id);
  if (t > 86400000) {
    try {
      const dt = new Date(t);
      if (!isNaN(dt.getTime())) return dt.toISOString().replace('T', ' ').slice(0, 19);
    } catch (e) {}
  }
  return String(d || fallback);
}

const getGameLedger = async (req, res) => {
  try {
    if (typeof purgeOldLedger === 'function') purgeOldLedger();

    const { memoryGameLedger, registeredUsers, memoryBets, memoryDeposits, memoryWithdrawals } = require('../store');
    const mongoose = require('mongoose');

    let allUsers = [];
    let allBets = [];
    let allDeps = [];
    let allWds = [];

    if (mongoose.connection.readyState === 1) {
      try {
        const User = require('../models/User');
        const Bet = require('../models/Bet');
        const DepositRequest = require('../models/DepositRequest');
        const WithdrawalRequest = require('../models/WithdrawalRequest');

        allUsers = await User.find({}).lean();
        allBets = await Bet.find({}).sort({ createdAt: -1 }).lean();
        allDeps = await DepositRequest.find({ status: { $in: ['Approved', 'approved'] } }).lean();
        allWds = await WithdrawalRequest.find({ status: { $in: ['Approved', 'approved'] } }).lean();
      } catch (dbErr) {}
    }

    if (!allUsers || allUsers.length === 0) allUsers = registeredUsers;
    if (!allBets || allBets.length === 0) allBets = memoryBets;

    const approvedMemDeps = memoryDeposits.filter(d => (d.status || '').toLowerCase() === 'approved');
    const approvedMemWds = memoryWithdrawals.filter(w => (w.status || '').toLowerCase() === 'approved');

    const depMap = new Map();
    (allDeps || []).forEach(d => {
      const key = String(d.utr_number || d.utr || d._id || d.id || `${d.mobile}_${d.amount}`);
      depMap.set(key, d);
    });
    approvedMemDeps.forEach(d => {
      const key = String(d.utr_number || d.utr || d._id || d.id || `${d.mobile}_${d.amount}`);
      if (!depMap.has(key)) depMap.set(key, d);
    });
    allDeps = Array.from(depMap.values());

    const wdMap = new Map();
    (allWds || []).forEach(w => {
      const key = String(w._id || w.id || `${w.mobile}_${w.amount}`);
      wdMap.set(key, w);
    });
    approvedMemWds.forEach(w => {
      const key = String(w._id || w.id || `${w.mobile}_${w.amount}`);
      if (!wdMap.has(key)) wdMap.set(key, w);
    });
    allWds = Array.from(wdMap.values());

    const ledgerItems = [];

    // 1. Include all explicitly logged items from memoryGameLedger
    (memoryGameLedger || []).forEach((item, idx) => {
      const itemDate = item.date || item.created_at || item.createdAt || new Date().toISOString().replace('T', ' ').slice(0, 19);
      ledgerItems.push({
        id: String(item.id || item._id || `mem_ldg_${idx}`),
        user: item.user || item.username || 'User',
        email: item.email || `${item.phone || item.mobile || ''}@gmail.com`,
        phone: String(item.phone || item.mobile || item.userPhone || ''),
        amount: typeof item.amount === 'number' ? (item.amount >= 0 ? `+${item.amount.toFixed(2)}` : `${item.amount.toFixed(2)}`) : String(item.amount || '0.00'),
        date: itemDate,
        transactType: item.transactType || item.type || 'Transaction',
        oldBal: item.oldBal || { wallet: '0.00', deposit: '0.00', winning: '0.00', commission: '0.00', bonus: '0.00', referral: '0.00' },
        newBal: item.newBal || { wallet: '0.00', deposit: '0.00', winning: '0.00', commission: '0.00', bonus: '0.00', referral: '0.00' },
        gameType: item.gameType || '-',
        timestamp: new Date(itemDate).getTime() || (Date.now() - idx * 100)
      });
    });

    const existingKeys = new Set(ledgerItems.map(l => `${l.phone}_${l.transactType}_${l.amount}`));

    const allUserMobiles = new Set();
    allUsers.forEach(u => {
      const m = String(u.mobile || '').replace(/[^0-9]/g, '').slice(-10);
      if (m) allUserMobiles.add(m);
    });

    allUserMobiles.forEach(mob => {
      const userObj = allUsers.find(u => String(u.mobile || '').replace(/[^0-9]/g, '').slice(-10) === mob);
      const name = userObj ? (userObj.name || userObj.username || 'User') : 'User';
      const email = userObj ? (userObj.email || `${mob}@gmail.com`) : `${mob}@gmail.com`;

      const matchesMob = (item) => {
        if (!item) return false;
        const rawItemMob = String(item.mobile || item.phone || item.userPhone || '').replace(/[^0-9]/g, '');
        const itemMob = rawItemMob.length >= 10 ? rawItemMob.slice(-10) : '';
        if (itemMob && itemMob === mob) return true;
        const rawUserStr = String(item.user || item.username || item.userName || '');
        const userStrMob = rawUserStr.replace(/[^0-9]/g, '');
        if (userStrMob.length >= 10 && userStrMob.includes(mob)) return true;
        return false;
      };

      const signupTime = safeParseTime(userObj && (userObj.createdAt || userObj._id), Date.now() - 86400000, userObj && userObj._id);

      const rawEvents = [];

      // Joining Bonus
      rawEvents.push({
        id: `bonus_${mob}`,
        timestamp: signupTime,
        dateStr: safeFormatISO(userObj && (userObj.createdAt || userObj._id), 'Today', userObj && userObj._id),
        type: 'Joining Bonus',
        amount: 200,
        amountStr: '+200.00',
        gameType: '-',
        kind: 'BONUS'
      });

      // Approved Deposits (including Manual Deposits)
      allDeps.filter(d => matchesMob(d)).forEach((d, idx) => {
        const t = safeParseTime(d.timestamp || d.created_at || d.createdAt || d.date, signupTime + 1000 + idx * 100, d._id || d.id);
        const depMethod = d.method || d.payment_method || 'UPI / Bank';
        rawEvents.push({
          id: String(d._id || d.id || `dep_${mob}_${idx}`),
          timestamp: t,
          dateStr: safeFormatISO(d.created_at || d.createdAt || d.date || d.timestamp, 'Today', d._id || d.id),
          type: depMethod.includes('Manual') ? 'Deposit Manually' : `Deposit Approved (${depMethod})`,
          amount: parseFloat(d.amount) || 0,
          amountStr: `+${(parseFloat(d.amount) || 0).toFixed(2)}`,
          gameType: depMethod,
          kind: 'DEPOSIT'
        });
      });

      // Bids & Winnings
      allBets.filter(b => matchesMob(b)).forEach((b, idx) => {
        const t = safeParseTime(b.timestamp || b.created_at || b.createdAt || b.date, signupTime + 2000 + idx * 100, b._id || b.id);
        const bAmt = parseFloat(b.bet_amount || b.amount) || 10;
        rawEvents.push({
          id: String(b._id || b.id || `bet_${mob}_${idx}`),
          timestamp: t,
          dateStr: safeFormatISO(b.created_at || b.createdAt || b.date || b.timestamp, 'Today', b._id || b.id),
          type: 'Bid Place',
          amount: bAmt,
          amountStr: `-${bAmt.toFixed(2)}`,
          gameType: `${b.game_name || b.category || 'Game'} - ${b.bet_type || b.gameType || 'Jodi'} (#${b.number})`,
          kind: 'BET'
        });

        if (b.status === 'Won' || b.status === 'won' || (parseFloat(b.win_amount || b.winAmount) || 0) > 0) {
          const winAmt = parseFloat(b.win_amount || b.winAmount) || (bAmt * 90);
          rawEvents.push({
            id: String(b._id || b.id || `win_${mob}_${idx}`) + '_win',
            timestamp: t + 50,
            dateStr: safeFormatISO(b.created_at || b.createdAt || b.date || b.timestamp, 'Today', b._id || b.id),
            type: 'Winning Credit',
            amount: winAmt,
            amountStr: `+${winAmt.toFixed(2)}`,
            gameType: `${b.game_name || b.category || 'Game'} - Won 🎉`,
            kind: 'WIN'
          });
        }
      });

      // Withdrawals
      allWds.filter(w => matchesMob(w)).forEach((w, idx) => {
        const t = safeParseTime(w.timestamp || w.created_at || w.createdAt || w.date, signupTime + 3000 + idx * 100, w._id || w.id);
        const wAmt = parseFloat(w.amount) || 0;
        rawEvents.push({
          id: String(w._id || w.id || `wd_${mob}_${idx}`),
          timestamp: t,
          dateStr: safeFormatISO(w.created_at || w.createdAt || w.date || w.timestamp, 'Today', w._id || w.id),
          type: 'Withdrawal Payout',
          amount: wAmt,
          amountStr: `-${wAmt.toFixed(2)}`,
          gameType: w.method || w.payment_method || 'Bank / UPI',
          kind: 'WITHDRAW'
        });
      });

      rawEvents.sort((a, b) => a.timestamp - b.timestamp);

      let runDeposit = 0.00;
      let runWinning = 0.00;
      let runCommission = 0.00;
      let runBonus = 0.00;
      let runReferral = 0.00;

      rawEvents.forEach(ev => {
        const oldBal = {
          wallet: (runDeposit + runWinning + runCommission).toFixed(2),
          deposit: runDeposit.toFixed(2),
          winning: runWinning.toFixed(2),
          commission: runCommission.toFixed(2),
          bonus: runBonus.toFixed(2),
          referral: runReferral.toFixed(2)
        };

        if (ev.kind === 'BONUS') {
          runBonus = parseFloat((runBonus + ev.amount).toFixed(2));
        } else if (ev.kind === 'DEPOSIT') {
          runDeposit = parseFloat((runDeposit + ev.amount).toFixed(2));
        } else if (ev.kind === 'BET') {
          const bonusDeduct = Math.min(ev.amount * 0.10, runBonus);
          runBonus = parseFloat((runBonus - bonusDeduct).toFixed(2));
          let rem = ev.amount - bonusDeduct;

          if (runDeposit >= rem) {
            runDeposit = parseFloat((runDeposit - rem).toFixed(2));
            rem = 0;
          } else {
            rem = parseFloat((rem - runDeposit).toFixed(2));
            runDeposit = 0.00;
            if (runWinning >= rem) {
              runWinning = parseFloat((runWinning - rem).toFixed(2));
              rem = 0;
            } else {
              rem = parseFloat((rem - runWinning).toFixed(2));
              runWinning = 0.00;
            }
          }
        } else if (ev.kind === 'WIN') {
          runWinning = parseFloat((runWinning + ev.amount).toFixed(2));
        } else if (ev.kind === 'WITHDRAW') {
          let rem = ev.amount;
          if (runWinning >= rem) {
            runWinning = parseFloat((runWinning - rem).toFixed(2));
            rem = 0;
          } else {
            rem = parseFloat((rem - runWinning).toFixed(2));
            runWinning = 0.00;
            runDeposit = parseFloat(Math.max(0, runDeposit - rem).toFixed(2));
          }
        }

        const newBal = {
          wallet: (runDeposit + runWinning + runCommission).toFixed(2),
          deposit: runDeposit.toFixed(2),
          winning: runWinning.toFixed(2),
          commission: runCommission.toFixed(2),
          bonus: runBonus.toFixed(2),
          referral: runReferral.toFixed(2)
        };

        const dedupeKey = `${mob}_${ev.type}_${ev.amountStr}`;
        if (!existingKeys.has(dedupeKey)) {
          ledgerItems.push({
            id: String(ev.id),
            user: name,
            email: email,
            phone: mob,
            amount: ev.amountStr,
            date: ev.dateStr,
            timestamp: ev.timestamp,
            transactType: ev.type,
            oldBal,
            newBal,
            gameType: ev.gameType
          });
        }
      });
    });

    ledgerItems.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    res.json(ledgerItems);
  } catch (err) {
    console.error('[Admin getGameLedger Error]', err);
    res.json(memoryGameLedger || []);
  }
};

const getCommissionLogs = async (req, res) => {
  res.json([
    { id: '1', dateTime: '2026-08-28 22:30', bidderName: 'Karan Sharma', bidderPhone: '9876543210', category: 'Gali', gameType: 'JODI', number: '71', commissionAmt: 4.00, receiver: 'Johnsnow (8888888888)' }
  ]);
};

const getLeaderboard = async (req, res) => {
  res.json(registeredUsers.map((u, i) => ({
    rank: i + 1,
    id: u.id,
    name: u.name,
    mobile: u.mobile,
    photo: '/logo.jpg',
    totalWinnings: Math.floor(Math.random() * 5000) + 1000,
    totalBets: Math.floor(Math.random() * 50) + 10,
    createdAt: u.createdAt || 'Today'
  })));
};

const getPayouts = async (req, res) => {
  const approvedWds = memoryWithdrawals.filter(w => w.status === 'Approved');
  res.json(approvedWds.map((w, i) => ({
    id: w.id || `payout_${i+1}`,
    name: w.user || 'Player',
    updateDate: w.createdAt || 'Today',
    status: 'Completed'
  })));
};

const getPackages = async (req, res) => {
  res.json([
    { id: '1', packageName: 'com.example.numberbetting', appName: '95X MATKA', version: '3.0', apkLink: 'https://95xmatka.com/95xmatka.apk', status: 'Active' }
  ]);
};

let memoryPaymentMethods = [
  {
    _id: 'pm_1',
    id: 'pm_1',
    name: 'PhonePe / GPay / Paytm UPI',
    upiId: '8930507940@ybl',
    upi_id: '8930507940@ybl',
    merchant_name: 'Matka Official',
    ordering: 1,
    qrCode: 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=upi://pay?pa=8930507940@ybl',
    updateDate: new Date().toLocaleDateString(),
    status: 'Active'
  }
];

const getPaymentMethods = async (req, res) => {
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      const PaymentMethod = require('../models/PaymentMethod');
      const dbPMs = await PaymentMethod.find().sort({ updatedAt: -1 }).lean();
      if (dbPMs && dbPMs.length > 0) {
        memoryPaymentMethods = dbPMs.map(p => {
          const actualUpi = p.upi_id || p.upiId || p.upi || '';
          return {
            _id: String(p._id),
            id: String(p._id),
            name: p.name || 'PhonePe / GPay / Paytm UPI',
            upiId: actualUpi,
            upi_id: actualUpi,
            merchant_name: p.merchant_name || 'Matka Official',
            ordering: p.ordering || 1,
            qrCode: `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=upi://pay?pa=${actualUpi}&pn=${encodeURIComponent(p.merchant_name || 'Matka Official')}`,
            updateDate: p.updateDate || (p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : 'Today'),
            status: p.status || 'Active'
          };
        });
      }
    }
  } catch (e) {
    console.error('[Get Payment Methods Error]', e);
  }
  res.json(memoryPaymentMethods);
};

const savePaymentMethod = async (req, res) => {
  const { id, _id, name, upi_id, upiId, merchant_name, ordering, status, isEdit } = req.body;
  const rawId = isEdit ? (_id || id) : null;
  const finalUpi = upi_id || upiId || '';
  const finalName = name || 'PhonePe / GPay / Paytm UPI';
  const finalMerchant = merchant_name || 'Matka Official';
  const finalOrdering = parseInt(ordering) || (memoryPaymentMethods.length + 1);
  const finalStatus = status || 'Active';
  const todayStr = new Date().toLocaleDateString();

  // Find if existing ID exists in memory store when editing
  let existingIdx = -1;
  if (isEdit && rawId) {
    existingIdx = memoryPaymentMethods.findIndex(p => 
      String(p._id) === String(rawId) || String(p.id) === String(rawId)
    );
  }
  if (isEdit && existingIdx < 0 && memoryPaymentMethods.length > 0) {
    existingIdx = 0; // Replace default entry on edit
  }

  // Deactivate others if this one is Active
  if (finalStatus === 'Active') {
    memoryPaymentMethods.forEach(p => {
      p.status = 'Inactive';
    });
  }

  let pmObj = {
    _id: rawId || `pm_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    id: rawId || `pm_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    name: finalName,
    upiId: finalUpi,
    upi_id: finalUpi,
    merchant_name: finalMerchant,
    ordering: finalOrdering,
    qrCode: `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=upi://pay?pa=${finalUpi}&pn=${encodeURIComponent(finalMerchant)}`,
    updateDate: todayStr,
    status: finalStatus
  };

  // Sync to MongoDB Atlas
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      const PaymentMethod = require('../models/PaymentMethod');

      if (finalStatus === 'Active') {
        await PaymentMethod.updateMany({}, { $set: { status: 'Inactive' } });
      }

      let dbPM = null;
      if (isEdit && rawId && mongoose.Types.ObjectId.isValid(rawId)) {
        try { dbPM = await PaymentMethod.findById(rawId); } catch(e) {}
      }
      if (isEdit && !dbPM) {
        dbPM = await PaymentMethod.findOne();
      }

      if (dbPM) {
        // EDIT EXISTING DOCUMENT
        dbPM.name = finalName;
        dbPM.upi_id = finalUpi;
        dbPM.merchant_name = finalMerchant;
        dbPM.ordering = finalOrdering;
        dbPM.status = finalStatus;
        dbPM.updateDate = todayStr;
        await dbPM.save();
        pmObj._id = String(dbPM._id);
        pmObj.id = String(dbPM._id);
      } else {
        // CREATE BRAND NEW DOCUMENT FOR EVERY ADD
        const created = await PaymentMethod.create({
          name: finalName,
          upi_id: finalUpi,
          merchant_name: finalMerchant,
          ordering: finalOrdering,
          status: finalStatus,
          updateDate: todayStr
        });
        pmObj._id = String(created._id);
        pmObj.id = String(created._id);
      }
    }
  } catch (e) {
    console.error('[Save Payment Method Error]', e);
  }

  // Update memory store: EDIT or ADD NEW
  if (existingIdx >= 0) {
    memoryPaymentMethods[existingIdx] = pmObj;
  } else {
    memoryPaymentMethods.unshift(pmObj);
  }

  saveDiskStore();
  console.log(`[Payment Method Saved] ${finalName} (${finalUpi}) - Status: ${finalStatus} (IsEdit: ${existingIdx >= 0}) - Total PMs: ${memoryPaymentMethods.length}`);
  res.json({ success: true, message: 'Payment method saved successfully!', paymentMethod: pmObj, paymentMethods: memoryPaymentMethods });
};

const toggleActivePaymentMethod = async (req, res) => {
  const { id } = req.params;
  
  memoryPaymentMethods.forEach(p => {
    if (String(p._id) === String(id) || String(p.id) === String(id)) {
      p.status = 'Active';
    } else {
      p.status = 'Inactive';
    }
  });

  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      const PaymentMethod = require('../models/PaymentMethod');
      await PaymentMethod.updateMany({}, { $set: { status: 'Inactive' } });
      await PaymentMethod.updateOne({ _id: id }, { $set: { status: 'Active' } });
    }
  } catch (e) {
    console.error('[Toggle Active Payment Method Error]', e);
  }

  saveDiskStore();
  console.log(`[Payment Method Toggled] #${id} is now ACTIVE. All other UPI IDs are INACTIVE.`);
  res.json({ success: true, message: 'Active UPI ID updated successfully!', paymentMethods: memoryPaymentMethods });
};

const deletePaymentMethod = async (req, res) => {
  const { id } = req.params;
  memoryPaymentMethods = memoryPaymentMethods.filter(p => String(p._id) !== String(id) && String(p.id) !== String(id));

  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      const PaymentMethod = require('../models/PaymentMethod');
      await PaymentMethod.deleteOne({ _id: id });
    }
  } catch (e) {}

  saveDiskStore();
  res.json({ success: true, message: 'Payment method deleted successfully', paymentMethods: memoryPaymentMethods });
};

const sendCustomNotification = async (req, res) => {
  let { memoryNotifications, saveDiskStore } = require('../store');
  const { title, body, targetUser, target } = req.body;
  if (!title || !body) {
    return res.status(400).json({ success: false, message: 'Title and body are required' });
  }

  const notifObj = {
    _id: `notif_${Date.now()}_${Math.floor(Math.random()*1000)}`,
    id: `notif_${Date.now()}_${Math.floor(Math.random()*1000)}`,
    title: title.trim(),
    body: body.trim(),
    target: targetUser || target || 'All Users',
    type: 'CUSTOM_BROADCAST',
    createdAt: new Date().toISOString()
  };

  memoryNotifications.unshift(notifObj);

  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      const NotificationModel = mongoose.models.Notification || mongoose.model('Notification', new mongoose.Schema({}, { strict: false }));
      await NotificationModel.create(notifObj);
    }
  } catch (e) {}

  saveDiskStore();

  const io = req.app.get('io');
  if (io) {
    io.emit('push_notification', notifObj);
  }

  console.log(`[Admin Notification Sent] "${title}" - Target: ${notifObj.target}`);
  res.json({ success: true, message: 'Notification broadcasted successfully!', notification: notifObj, notifications: memoryNotifications });
};

const getNotifications = async (req, res) => {
  let { memoryNotifications } = require('../store');
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      const NotificationModel = mongoose.models.Notification || mongoose.model('Notification', new mongoose.Schema({}, { strict: false }));
      const dbNotifs = await NotificationModel.find().sort({ createdAt: -1 }).limit(50).lean();
      if (dbNotifs && dbNotifs.length > 0) {
        dbNotifs.forEach(n => {
          const exists = memoryNotifications.some(m => String(m._id || m.id) === String(n._id));
          if (!exists) {
            memoryNotifications.push({
              _id: String(n._id),
              id: String(n._id),
              title: n.title || 'Notification',
              body: n.body || '',
              target: n.target || 'All Users',
              type: n.type || 'SYSTEM',
              createdAt: n.createdAt ? new Date(n.createdAt).toISOString() : new Date().toISOString()
            });
          }
        });
      }
    }
  } catch (e) {}
  res.json(memoryNotifications);
};

const deleteNotification = async (req, res) => {
  const { id } = req.params;
  let { memoryNotifications, saveDiskStore } = require('../store');
  const index = memoryNotifications.findIndex(n => String(n._id) === String(id) || String(n.id) === String(id));
  if (index >= 0) {
    memoryNotifications.splice(index, 1);
  }

  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      const NotificationModel = mongoose.models.Notification || mongoose.model('Notification', new mongoose.Schema({}, { strict: false }));
      await NotificationModel.deleteOne({ _id: id });
    }
  } catch (e) {}

  saveDiskStore();
  res.json({ success: true, message: 'Notification deleted successfully', notifications: memoryNotifications });
};



const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      registeredUsers, 
      memoryBets, 
      memoryGameLedger, 
      memoryDeposits, 
      memoryWithdrawals, 
      saveDiskStore 
    } = require('../store');
    
    let deletedCount = 0;
    const deletedMobiles = [];
    const idClean = String(id || '').replace(/[^0-9]/g, '').slice(-10);

    for (let i = registeredUsers.length - 1; i >= 0; i--) {
      const u = registeredUsers[i];
      const mobileClean = String(u.mobile || u.phone || '').replace(/[^0-9]/g, '').slice(-10);
      if (
        (u._id && String(u._id) === String(id)) || 
        (u.id && String(u.id) === String(id)) || 
        (u.mobile && String(u.mobile) === String(id)) || 
        (mobileClean && idClean && mobileClean.length >= 10 && idClean.length >= 10 && mobileClean === idClean)
      ) {
        if (mobileClean) deletedMobiles.push(mobileClean);
        registeredUsers.splice(i, 1);
        deletedCount++;
      }
    }
    if (idClean && idClean.length >= 10 && !deletedMobiles.includes(idClean)) {
      deletedMobiles.push(idClean);
    }

    // Clean up memoryBets for this user by exact mobile match only
    for (let i = memoryBets.length - 1; i >= 0; i--) {
      const b = memoryBets[i];
      const bm = String(b.mobile || b.phone || b.user || '').replace(/[^0-9]/g, '').slice(-10);
      if (bm && deletedMobiles.includes(bm)) {
        memoryBets.splice(i, 1);
      }
    }

    // Clean up memoryDeposits by exact mobile match only
    for (let i = memoryDeposits.length - 1; i >= 0; i--) {
      const d = memoryDeposits[i];
      const dm = String(d.mobile || d.phone || d.userPhone || d.user || '').replace(/[^0-9]/g, '').slice(-10);
      if (dm && deletedMobiles.includes(dm)) {
        memoryDeposits.splice(i, 1);
      }
    }

    // Clean up memoryWithdrawals by exact mobile match only
    for (let i = memoryWithdrawals.length - 1; i >= 0; i--) {
      const w = memoryWithdrawals[i];
      const wm = String(w.mobile || w.phone || w.userPhone || w.user || '').replace(/[^0-9]/g, '').slice(-10);
      if (wm && deletedMobiles.includes(wm)) {
        memoryWithdrawals.splice(i, 1);
      }
    }

    // Clean up memoryGameLedger by exact mobile match only
    for (let i = memoryGameLedger.length - 1; i >= 0; i--) {
      const l = memoryGameLedger[i];
      const lm = String(l.phone || l.mobile || l.user || '').replace(/[^0-9]/g, '').slice(-10);
      if (lm && deletedMobiles.includes(lm)) {
        memoryGameLedger.splice(i, 1);
      }
    }

    try {
      const { 
        deletedMobiles: storeDeletedMobiles, 
        userWalletStore,
        khaiwalPlayersStore,
        khaiwalPlayerBetsStore 
      } = require('../store');

      deletedMobiles.forEach(m => {
        if (m) {
          if (storeDeletedMobiles && !storeDeletedMobiles.includes(m)) storeDeletedMobiles.push(m);
          if (userWalletStore && userWalletStore[m]) delete userWalletStore[m];
          if (khaiwalPlayersStore && khaiwalPlayersStore[m]) delete khaiwalPlayersStore[m];
          if (khaiwalPlayerBetsStore && khaiwalPlayerBetsStore[m]) delete khaiwalPlayerBetsStore[m];
        }
      });

      // Remove any registered player entries whose mobile matches deletedMobiles from other Khaiwals' stores
      if (khaiwalPlayersStore) {
        Object.keys(khaiwalPlayersStore).forEach(k => {
          if (Array.isArray(khaiwalPlayersStore[k])) {
            khaiwalPlayersStore[k] = khaiwalPlayersStore[k].filter(p => {
              const pMob = String(p.mobile || p.phone || '').replace(/[^0-9]/g, '').slice(-10);
              return !deletedMobiles.includes(pMob);
            });
          }
        });
      }
    } catch (e) {}

    saveDiskStore();
    
    // Delete permanently from MongoDB Atlas
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      const orConditions = [];
      if (mongoose.Types.ObjectId.isValid(id)) {
        orConditions.push({ _id: new mongoose.Types.ObjectId(id) });
      }
      deletedMobiles.forEach(m => {
        orConditions.push({ mobile: new RegExp(m + "$") });
        orConditions.push({ phone: new RegExp(m + "$") });
        orConditions.push({ user: new RegExp(m + "$") });
      });
      deletedUserNames.forEach(un => {
        orConditions.push({ name: un });
        orConditions.push({ username: un });
        orConditions.push({ user: un });
      });

      if (orConditions.length > 0) {
        await mongoose.connection.db.collection('users').deleteMany({ $or: orConditions }).catch(()=>{});
        await mongoose.connection.db.collection('bets').deleteMany({ $or: orConditions }).catch(()=>{});
        await mongoose.connection.db.collection('transactions').deleteMany({ $or: orConditions }).catch(()=>{});
        await mongoose.connection.db.collection('depositrequests').deleteMany({ $or: orConditions }).catch(()=>{});
        await mongoose.connection.db.collection('withdrawalrequests').deleteMany({ $or: orConditions }).catch(()=>{});
        await mongoose.connection.db.collection('khaiwal_players').deleteMany({ $or: orConditions }).catch(()=>{});
        await mongoose.connection.db.collection('khaiwal_bets').deleteMany({ $or: orConditions }).catch(()=>{});
        await mongoose.connection.db.collection('khaiwal_player_bets').deleteMany({ $or: orConditions }).catch(()=>{});
      }
    }
    res.json({ success: true, message: `User and all related data deleted permanently` });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
};

const deleteAdminBid = async (req, res) => {
  try {
    const { id } = req.params;
    const { memoryBets, registeredUsers, saveDiskStore, logLedgerTransaction } = require('../store');
    const mongoose = require('mongoose');
    const Bet = require('../models/Bet');
    const User = require('../models/User');

    // 1. Locate the bet to be deleted in memory or MongoDB
    let targetBet = memoryBets.find(b => String(b._id) === String(id) || String(b.id) === String(id));
    if (!targetBet && mongoose.connection.readyState === 1) {
      targetBet = await Bet.findById(id).catch(() => null);
    }
    if (!targetBet) {
      targetBet = memoryBets.find(b => String(b._id || b.id || '').includes(String(id)));
    }

    let refundedAmount = 0;
    let targetUserObj = null;

    if (targetBet) {
      refundedAmount = parseFloat(targetBet.bet_amount || targetBet.amount || 0);
      const rawMobile = targetBet.mobile || targetBet.user_mobile || targetBet.userMobile || targetBet.phone;
      const cleanMobile = rawMobile ? String(rawMobile).replace(/[^0-9]/g, '').slice(-10) : '';

      // Locate matching user in registeredUsers
      if (cleanMobile) {
        targetUserObj = registeredUsers.find(u => {
          const uMob = String(u.mobile || u.phone || '').replace(/[^0-9]/g, '').slice(-10);
          return uMob === cleanMobile;
        });
      }

      if (!targetUserObj && targetBet.user) {
        targetUserObj = registeredUsers.find(u => {
          return u.name === targetBet.user || (u.mobile && String(targetBet.user).includes(u.mobile));
        });
      }

      // Refund the bet amount if user exists and amount > 0
      if (targetUserObj && refundedAmount > 0) {
        if (targetUserObj.deposit_balance === undefined) targetUserObj.deposit_balance = targetUserObj.balance || 0;
        if (targetUserObj.winning_balance === undefined) targetUserObj.winning_balance = 0;

        const oldWalletBal = parseFloat(((targetUserObj.deposit_balance || 0) + (targetUserObj.winning_balance || 0)).toFixed(2));
        const oldDepBal = parseFloat((targetUserObj.deposit_balance || 0).toFixed(2));

        targetUserObj.deposit_balance = parseFloat((targetUserObj.deposit_balance + refundedAmount).toFixed(2));
        targetUserObj.balance = parseFloat(((targetUserObj.deposit_balance || 0) + (targetUserObj.winning_balance || 0)).toFixed(2));
        targetUserObj.wallet_balance = targetUserObj.balance;

        const userCleanMob = String(targetUserObj.mobile || cleanMobile).replace(/[^0-9]/g, '').slice(-10);

        // Sync MongoDB User document
        if (mongoose.connection.readyState === 1 && userCleanMob) {
          await User.updateOne(
            { mobile: { $regex: new RegExp(userCleanMob + '$') } },
            {
              $set: {
                deposit_balance: targetUserObj.deposit_balance,
                wallet_balance: targetUserObj.balance,
                balance: targetUserObj.balance
              }
            }
          ).catch(e => console.error('[Refund MongoDB User Sync Error]:', e.message));
        }

        // Record entry in Game Ledger
        try {
          if (typeof logLedgerTransaction === 'function') {
            logLedgerTransaction({
              user: targetUserObj.name || targetBet.user || 'User',
              email: targetUserObj.email || `${userCleanMob}@gmail.com`,
              phone: userCleanMob,
              amount: `+${refundedAmount.toFixed(2)}`,
              transactType: 'Bid Deleted (Refund)',
              oldBal: {
                wallet: oldWalletBal.toFixed(2),
                deposit: oldDepBal.toFixed(2),
                winning: (targetUserObj.winning_balance || 0).toFixed(2),
                commission: (targetUserObj.commission_balance || 0).toFixed(2),
                bonus: (targetUserObj.bonus_balance || 0).toFixed(2),
                referral: '0.00'
              },
              newBal: {
                wallet: targetUserObj.balance.toFixed(2),
                deposit: targetUserObj.deposit_balance.toFixed(2),
                winning: (targetUserObj.winning_balance || 0).toFixed(2),
                commission: (targetUserObj.commission_balance || 0).toFixed(2),
                bonus: (targetUserObj.bonus_balance || 0).toFixed(2),
                referral: '0.00'
              },
              gameType: targetBet.game_name || targetBet.game || '-'
            });
          }
        } catch (err) {
          console.error('[Refund Game Ledger Error]:', err.message);
        }
      }
    }

    // 2. Remove bet from memory store
    const index = memoryBets.findIndex(b => String(b._id) === String(id) || String(b.id) === String(id));
    if (index !== -1) {
      memoryBets.splice(index, 1);
    }
    saveDiskStore();

    // 3. Remove bet from MongoDB Bet collection
    if (mongoose.connection.readyState === 1) {
      await Bet.deleteOne({ _id: id }).catch(() => {});
      await Bet.deleteOne({ id: id }).catch(() => {});
    }

    return res.json({
      success: true,
      message: refundedAmount > 0 && targetUserObj ? `Bid deleted. ₹${refundedAmount} refunded to ${targetUserObj.name || targetUserObj.mobile}'s wallet!` : 'Bid deleted successfully.'
    });
  } catch (e) {
    console.error('[deleteAdminBid Error]:', e);
    return res.json({ success: false, message: e.message });
  }
};

// Block a user permanently by mobile number
const blockUser = (req, res) => {
  const { mobile } = req.body;
  if (!mobile) return res.status(400).json({ success: false, message: 'Mobile number is required' });
  
  const reason = req.body.reason || '';
  const cleanMobile = mobile.replace(/[^0-9]/g, '').slice(-10);
  const { blockedMobiles, registeredUsers, saveDiskStore } = require('../store');
  
  if (!blockedMobiles.includes(cleanMobile)) {
    blockedMobiles.push(cleanMobile);
  }
  
  // Mark the user as blocked in registeredUsers
  const user = registeredUsers.find(u => (u.mobile || '').replace(/[^0-9]/g, '').slice(-10) === cleanMobile);
  if (user) {
    user.is_blocked = true;
    user.status = 'Blocked';
    user.blockReason = reason;
    user.blockedAt = new Date().toISOString();
  }
  
  saveDiskStore();
  
  // Also block in MongoDB
  try {
    const User = require('../models/User');
    User.updateOne(
      { mobile: { $regex: cleanMobile + '$' } },
      { $set: { is_blocked: true, status: 'Blocked', blockReason: reason, blockedAt: new Date() } }
    ).catch(e => console.error('[Block User DB Error]', e));
  } catch (e) {}
  
  return res.json({ success: true, message: `User ${cleanMobile} has been permanently blocked.` });
};

// Unblock a user
const unblockUser = (req, res) => {
  const { mobile } = req.body;
  if (!mobile) return res.status(400).json({ success: false, message: 'Mobile number is required' });
  
  const cleanMobile = mobile.replace(/[^0-9]/g, '').slice(-10);
  const { blockedMobiles, registeredUsers, saveDiskStore } = require('../store');
  
  const idx = blockedMobiles.indexOf(cleanMobile);
  if (idx !== -1) blockedMobiles.splice(idx, 1);
  
  const user = registeredUsers.find(u => (u.mobile || '').replace(/[^0-9]/g, '').slice(-10) === cleanMobile);
  if (user) {
    user.is_blocked = false;
    user.status = 'Active';
    user.blockReason = '';
    user.blockedAt = '';
  }
  
  saveDiskStore();
  
  try {
    const User = require('../models/User');
    User.updateOne(
      { mobile: { $regex: cleanMobile + '$' } },
      { $set: { is_blocked: false, status: 'Active', blockReason: '', blockedAt: null } }
    ).catch(e => console.error('[Unblock User DB Error]', e));
  } catch (e) {}
  
  return res.json({ success: true, message: `User ${cleanMobile} has been unblocked.` });
};

// Update user details (name, status, custom referral commission, custom rates, self-bet commission, etc.)
const updateUser = async (req, res) => {
  const { 
    id, mobile, name, email, gender, dob, address, bankName, accountNumber, branchName, ifscCode, upi, status, 
    custom_referral_commission, referral_enabled, custom_jodi_rate, custom_haroof_rate, custom_crossing_rate, self_bet_commission 
  } = req.body;

  const targetMobile = mobile || req.body.userPhone || req.body.phone;
  if (!targetMobile) {
    return res.status(400).json({ success: false, message: 'User mobile number is required' });
  }

  const cleanMobile = String(targetMobile).replace(/[^0-9]/g, '').slice(-10);
  const { registeredUsers, saveDiskStore } = require('../store');

  let user = registeredUsers.find(u => (u.mobile || '').replace(/[^0-9]/g, '').slice(-10) === cleanMobile);
  if (!user && id) {
    user = registeredUsers.find(u => String(u.id) === String(id) || String(u._id) === String(id));
  }

  let customComm = null;
  if (custom_referral_commission !== undefined && custom_referral_commission !== null && String(custom_referral_commission).trim() !== '') {
    const val = parseFloat(custom_referral_commission);
    if (!isNaN(val) && val >= 0) customComm = val;
  }

  const refEnabledBool = (referral_enabled === false || referral_enabled === 'OFF' || referral_enabled === 'false' || referral_enabled === 0) ? false : true;

  const parseRate = (val) => {
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      const num = parseFloat(val);
      if (!isNaN(num) && num > 0) return num;
    }
    return null;
  };

  const cJodi = parseRate(custom_jodi_rate);
  const cHaroof = parseRate(custom_haroof_rate);
  const cCross = parseRate(custom_crossing_rate);
  const cSelfComm = parseRate(self_bet_commission);

  if (user) {
    if (name) user.name = name;
    if (email !== undefined) user.email = email;
    if (gender !== undefined) user.gender = gender;
    if (dob !== undefined) user.dob = dob;
    if (address !== undefined) user.address = address;
    if (bankName !== undefined) user.bankName = bankName;
    if (accountNumber !== undefined) user.accountNumber = accountNumber;
    if (branchName !== undefined) user.branchName = branchName;
    if (ifscCode !== undefined) user.ifscCode = ifscCode;
    if (upi !== undefined) user.upi = upi;
    if (status !== undefined) user.status = status;
    user.custom_referral_commission = customComm;
    user.referral_enabled = refEnabledBool;
    user.is_khaiwal = !refEnabledBool;
    user.custom_jodi_rate = cJodi;
    user.custom_haroof_rate = cHaroof;
    user.custom_crossing_rate = cCross;
    user.self_bet_commission = cSelfComm;
  }

  try {
    const User = require('../models/User');
    const updatePayload = {
      ...(name ? { name, username: name } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(gender !== undefined ? { gender } : {}),
      ...(dob !== undefined ? { dob } : {}),
      ...(address !== undefined ? { address } : {}),
      ...(bankName !== undefined ? { bankName } : {}),
      ...(accountNumber !== undefined ? { accountNumber } : {}),
      ...(branchName !== undefined ? { branchName } : {}),
      ...(ifscCode !== undefined ? { ifscCode } : {}),
      ...(upi !== undefined ? { upi } : {}),
      ...(status !== undefined ? { status } : {}),
      custom_referral_commission: customComm,
      referral_enabled: refEnabledBool,
      is_khaiwal: !refEnabledBool,
      custom_jodi_rate: cJodi,
      custom_haroof_rate: cHaroof,
      custom_crossing_rate: cCross,
      self_bet_commission: cSelfComm
    };

    await User.updateOne(
      { mobile: { $regex: new RegExp(cleanMobile + '$') } },
      { $set: updatePayload }
    );
  } catch (e) {
    console.error('[Update User DB Error]', e.message);
  }

  saveDiskStore();
  console.log(`[Admin] Updated user controls for ${cleanMobile}: RefEnabled=${refEnabledBool}, Jodi=${cJodi}, Haroof=${cHaroof}, Crossing=${cCross}, SelfComm=${cSelfComm}%`);
  return res.json({ success: true, message: `User controls updated successfully for ${name || cleanMobile}!`, user });
};

const getLivePlayers = (req, res) => {
  const { livePlayersMap, autoPlayerConfig } = require('../store');
  res.json({
    success: true,
    data: livePlayersMap || {},
    autoConfig: autoPlayerConfig || { enabled: true }
  });
};

const updateLivePlayers = (req, res) => {
  const { livePlayersMap, autoPlayerConfig, saveDiskStore } = require('../store');
  const { livePlayers, autoEnabled, manualOverrides } = req.body;

  if (autoEnabled !== undefined) {
    autoPlayerConfig.enabled = Boolean(autoEnabled);
  }

  if (livePlayers && typeof livePlayers === 'object') {
    for (const key of Object.keys(livePlayers)) {
      const val = parseInt(String(livePlayers[key]), 10) || 0;
      livePlayersMap[key] = val;
    }

    if (livePlayers['Desawar'] !== undefined || livePlayers['Disawer'] !== undefined) {
      const val = parseInt(String(livePlayers['Desawar'] || livePlayers['Disawer']), 10) || 0;
      livePlayersMap['Desawar'] = val;
      livePlayersMap['Disawer'] = val;
    }

    if (livePlayers['Shree Ganesh'] !== undefined || livePlayers['Shri Ganesh'] !== undefined) {
      const val = parseInt(String(livePlayers['Shree Ganesh'] || livePlayers['Shri Ganesh']), 10) || 0;
      livePlayersMap['Shree Ganesh'] = val;
      livePlayersMap['Shri Ganesh'] = val;
    }

    if (autoPlayerConfig) {
      autoPlayerConfig.manualOverrides = {};
    }
  }

  saveDiskStore();
  return res.json({
    success: true,
    message: 'Live players count updated successfully',
    data: livePlayersMap,
    autoConfig: autoPlayerConfig
  });
};

module.exports = {
  editGameResult,
  getResultsHistory,
  deleteUser,
  deleteAdminBid,
  getStats,
  getUsers,
  getBetMatrix,
  getAdminBets,
  updateAdminBid,
  getGameSchedules,
  updateGameSchedule,
  toggleMarketStatus,
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
  getBannersList,
  saveBannersList,
  getAppVersionConfig,
  updateAppVersionConfig,
  getReferralConfig,
  updateReferralConfig,
  getReferralStats,
  adminLogin,
  verifyAdminOtp,
  getAdminAdmins,
  getAdminWinnings,
  getGameLedger,
  getCommissionLogs,
  getLeaderboard,
  getPayouts,
  getPackages,
  getPaymentMethods,
  savePaymentMethod,
  deletePaymentMethod,
  toggleActivePaymentMethod,
  sendCustomNotification,
  getNotifications,
  deleteNotification,
  getSettingsConfig,
  updateSettingsConfig,
  blockUser,
  unblockUser,
  updateUser,
  getLivePlayers,
  updateLivePlayers
};
