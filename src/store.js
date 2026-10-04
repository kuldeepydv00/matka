const fs = require('fs');
const path = require('path');

const STORE_DIR = path.resolve(__dirname, '..');
const STORE_FILE = process.env.DATA_STORE_PATH || (
  fs.existsSync(path.join(STORE_DIR, 'dataStore.json'))
    ? path.join(STORE_DIR, 'dataStore.json')
    : (fs.existsSync(path.join(__dirname, 'dataStore.json')) ? path.join(__dirname, 'dataStore.json') : path.join(STORE_DIR, 'dataStore.json'))
);

// Central in-memory & file store for production persistence
let registeredUsers = [];

let userWalletStore = {
  balance: 0.00,
  name: '',
  mobile: ''
};

let memoryDeposits = [];
let memoryWithdrawals = [];
let memoryBets = [];
let memoryGameLedger = [];
let declaredResultsMap = {};
let declaredResultsDateMap = {};
let memoryResultsHistory = [];
let blockedMobiles = [];
let deletedMobiles = [];
let khaiwalPlayersStore = {};
let khaiwalPlayerBetsStore = {};

const FORTY_DAYS_MS = 40 * 24 * 60 * 60 * 1000;

function purgeOldBets() {
  const cutoff = Date.now() - FORTY_DAYS_MS;
  for (let i = memoryBets.length - 1; i >= 0; i--) {
    const b = memoryBets[i];
    const bTime = b.created_at || b.createdAt ? new Date(b.created_at || b.createdAt).getTime() : Date.now();
    if (!isNaN(bTime) && bTime < cutoff) {
      memoryBets.splice(i, 1);
    }
  }
}

function purgeOldLedger() {
  const cutoff = Date.now() - FORTY_DAYS_MS;
  memoryGameLedger = memoryGameLedger.filter(item => {
    const itemTime = item.date ? new Date(item.date).getTime() : Date.now();
    return !isNaN(itemTime) && itemTime >= cutoff;
  });
}

function logLedgerTransaction(data) {
  purgeOldLedger();
  const entry = {
    id: 'ldg_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    user: data.user || 'NasibAnsari',
    email: data.email || 'na0193354@gmail.com',
    phone: data.phone || '9007724336',
    amount: data.amount !== undefined ? (typeof data.amount === 'number' ? (data.amount >= 0 ? `+${data.amount}` : `${data.amount}`) : data.amount) : '+0.5',
    date: data.date || new Date().toISOString().replace('T', ' ').slice(0, 19),
    transactType: data.transactType || 'Commission',
    oldBal: data.oldBal || {
      wallet: '0.00',
      deposit: '0.00',
      winning: '0.00',
      commission: '7.85',
      bonus: '0.00',
      referral: '99.10'
    },
    newBal: data.newBal || {
      wallet: '0.00',
      deposit: '0.00',
      winning: '0.00',
      commission: '8.60',
      bonus: '0.00',
      referral: '99.10'
    },
    gameType: data.gameType || '-'
  };

  memoryGameLedger.unshift(entry);
  return entry;
}

let bannerConfig = {
  enabled: true,
  title: '95X MATKA SATTA',
  subtitle: 'आपका भरोसा, हमारी पहचान',
  referralText: 'केवल 5 प्लेइंग यूजर को रिफर करें और पाएं ₹500 बोनस',
  commissionText: '4% लाइफटाइम कमिशन आपकी टीम के हर दांव पर',
  minDeposit: '100',
  minWithdrawal: '200',
  imageUrl: 'https://95xmatka.com/app_header.png'
};

let referralConfig = {
  enabled: true,
  signupBonus: 50,
  commissionPercentage: 4
};

let appVersionConfig = {
  latestVersionCode: 104,
  latestVersionName: '1.0.104',
  minSupportedVersion: 1,
  apkUrl: 'https://95xmatka.com/95xmatka.apk',
  updateMessage: '🚀 New Update Available! Saved Bank Name support for instant 1-click withdrawals & fast betting.',
  forceUpdate: true
};

let settingsConfig = {
  whatsapp_number: '+917206561420',
  whatsapp_call_number: '+917206561420',
  app_download_link: 'https://95xmatka.com/95xmatka.apk',
  app_version: '1.0.15',
  bank_withdrawal_enable: true,
  upi_withdrawal_enable: true,
  lucky_card_maintenance: false,
  jodi_rate: 97,
  crossing_rate: 97,
  haroof_rate: 9.7,
  ekqr_enabled: true,
  ekqr_api_key: '8f12c3ab-b6d9-4e75-b116-a7de230f0d83',
  ekqr_webhook_url: 'https://95xmatka.com/api/payment/ekqr/webhook',
  min_deposit: 100,
  max_deposit: 50000,
  msg91_auth_key: '566370AIKfwtcrpvh6aa17ef3P1',
  msg91_template_id: '6aa1635ed61d0b5f8e0551e2',
  msg91_otp_length: 4,
  msg91_otp_expiry: 10,
  msg91_enabled: true
};

let gameSchedulesStore = {
  "Shiv Parwati": {
    name: "Shiv Parwati",
    open: "04:00 AM IST",
    close: "12:00 PM IST",
    result: "12:40 PM IST",
    openHour: 4, openMinute: 0,
    closeHour: 12, closeMinute: 0,
    resultHour: 12, resultMinute: 40,
    enabled: true
  },
  "Delhi Bazar": {
    name: "Delhi Bazar",
    open: "04:00 AM IST",
    close: "02:45 PM IST",
    result: "03:20 PM IST",
    openHour: 4, openMinute: 0,
    closeHour: 14, closeMinute: 45,
    resultHour: 15, resultMinute: 20,
    enabled: true
  },
  "Dubai Market": {
    name: "Dubai Market",
    open: "04:00 AM IST",
    close: "04:00 PM IST",
    result: "04:00 PM IST",
    openHour: 4, openMinute: 0,
    closeHour: 16, closeMinute: 0,
    resultHour: 16, resultMinute: 0,
    enabled: true
  },
  "Shree Ganesh": {
    name: "Shree Ganesh",
    open: "04:00 AM IST",
    close: "04:30 PM IST",
    result: "04:50 PM IST",
    openHour: 4, openMinute: 0,
    closeHour: 16, closeMinute: 30,
    resultHour: 16, resultMinute: 50,
    enabled: true
  },
  "Faridabad": {
    name: "Faridabad",
    open: "04:00 AM IST",
    close: "05:40 PM IST",
    result: "06:20 PM IST",
    openHour: 4, openMinute: 0,
    closeHour: 17, closeMinute: 40,
    resultHour: 18, resultMinute: 20,
    enabled: true
  },
  "Ghaziabad": {
    name: "Ghaziabad",
    open: "04:00 AM IST",
    close: "09:30 PM IST",
    result: "10:10 PM IST",
    openHour: 4, openMinute: 0,
    closeHour: 21, closeMinute: 30,
    resultHour: 22, resultMinute: 10,
    enabled: true
  },
  "Gali": {
    name: "Gali",
    open: "04:00 AM IST",
    close: "11:30 PM IST",
    result: "11:59 PM IST",
    openHour: 4, openMinute: 0,
    closeHour: 23, closeMinute: 30,
    resultHour: 23, resultMinute: 59,
    enabled: true
  },
  "Desawar": {
    name: "Desawar",
    open: "07:00 PM IST",
    close: "04:00 AM IST",
    result: "06:00 AM IST",
    openHour: 19, openMinute: 0,
    closeHour: 4, closeMinute: 0,
    resultHour: 6, resultMinute: 0,
    enabled: true
  }
};

const { chartRecords } = require('./historicalChartStore');

let bannersListStore = [];

let livePlayersMap = {
  "Shiv Parwati": 0,
  "Delhi Bazar": 0,
  "Dubai Market": 0,
  "Shree Ganesh": 0,
  "Shri Ganesh": 0,
  "Faridabad": 0,
  "Ghaziabad": 0,
  "Gali": 0,
  "Desawar": 0,
  "Disawer": 0
};

let autoPlayerConfig = {
  enabled: true,
  targetPeakMin: 200000,
  targetPeakMax: 250000,
  manualOverrides: {}
};

function timeStrToMinutesOfDay(timeStr, fallbackHour, fallbackMinute) {
  if (fallbackHour !== undefined && fallbackMinute !== undefined) {
    return fallbackHour * 60 + fallbackMinute;
  }
  if (!timeStr) return 0;
  const m = String(timeStr).match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return 0;
  let hh = parseInt(m[1]);
  const mm = parseInt(m[2]);
  const ampm = m[3] ? m[3].toUpperCase() : null;

  if (ampm === 'PM' && hh < 12) hh += 12;
  if (ampm === 'AM' && hh === 12) hh = 0;

  return hh * 60 + mm;
}

function getMarketPeakSeed(gameName, todayDateStr) {
  let hash = 0;
  const str = gameName + '_' + todayDateStr;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const norm = (Math.abs(hash) % 1000) / 1000.0;
  const minPeak = autoPlayerConfig.targetPeakMin || 200000;
  const maxPeak = autoPlayerConfig.targetPeakMax || 250000;
  return Math.floor(minPeak + norm * (maxPeak - minPeak));
}

function tickLivePlayerCounts() {
  if (!autoPlayerConfig.enabled) return;

  const now = new Date();
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffsetMs);
  const year = istNow.getUTCFullYear();
  const month = String(istNow.getUTCMonth() + 1).padStart(2, '0');
  const day = String(istNow.getUTCDate()).padStart(2, '0');
  const todayStr = `${year}-${month}-${day}`;
  const nowMinOfDay = istNow.getUTCHours() * 60 + istNow.getUTCMinutes();

  for (const gameName in gameSchedulesStore) {
    if (gameName === 'Disawer' || gameName === 'Shri Ganesh') continue;

    const sched = gameSchedulesStore[gameName];
    if (!sched || sched.enabled === false) {
      livePlayersMap[gameName] = 0;
      continue;
    }

    const openMin = timeStrToMinutesOfDay(sched.open, sched.openHour, sched.openMinute);
    const closeMin = timeStrToMinutesOfDay(sched.close, sched.closeHour, sched.closeMinute);

    let isBettingOpen = false;
    let progress = 0;

    if (closeMin > openMin) {
      // Same-day market, e.g. open 04:00 (240), close 21:30 (1290)
      if (nowMinOfDay >= openMin && nowMinOfDay <= closeMin) {
        isBettingOpen = true;
        const totalDuration = closeMin - openMin;
        const elapsed = nowMinOfDay - openMin;
        progress = totalDuration > 0 ? Math.min(1.0, Math.max(0.0, elapsed / totalDuration)) : 0;
      }
    } else if (closeMin < openMin) {
      // Crosses midnight, e.g. Desawar open 19:00 (1140), close 04:00 (240)
      const totalDuration = (closeMin + 1440) - openMin;
      if (nowMinOfDay >= openMin) {
        isBettingOpen = true;
        const elapsed = nowMinOfDay - openMin;
        progress = totalDuration > 0 ? Math.min(1.0, Math.max(0.0, elapsed / totalDuration)) : 0;
      } else if (nowMinOfDay <= closeMin) {
        isBettingOpen = true;
        const elapsed = (nowMinOfDay + 1440) - openMin;
        progress = totalDuration > 0 ? Math.min(1.0, Math.max(0.0, elapsed / totalDuration)) : 0;
      }
    }

    if (!isBettingOpen) {
      livePlayersMap[gameName] = 0;
    } else {
      const peakTarget = getMarketPeakSeed(gameName, todayStr);
      const baseTarget = Math.floor(peakTarget * Math.pow(progress, 1.35));

      let currentVal = livePlayersMap[gameName] || 0;

      if (currentVal <= 0) {
        currentVal = Math.min(15, baseTarget);
      }

      const roll = Math.random();
      let delta = 0;
      if (currentVal < baseTarget) {
        delta = Math.floor(Math.random() * 3) + 5; // +5, +6, or +7
        if (roll < 0.20 && currentVal > 50) {
          delta = -(Math.floor(Math.random() * 2) + 1); // -1 or -2
        }
      } else {
        if (roll < 0.55) {
          delta = -(Math.floor(Math.random() * 3) + 1);
        } else {
          delta = Math.floor(Math.random() * 2) + 1;
        }
      }

      const nextVal = Math.max(0, currentVal + delta);
      livePlayersMap[gameName] = nextVal;
    }
  }

  if (livePlayersMap['Desawar'] !== undefined) livePlayersMap['Disawer'] = livePlayersMap['Desawar'];
  if (livePlayersMap['Shree Ganesh'] !== undefined) livePlayersMap['Shri Ganesh'] = livePlayersMap['Shree Ganesh'];
}

setInterval(() => {
  try {
    tickLivePlayerCounts();
  } catch (e) {}
}, 4000);

function assignUniqueEmails(users) {
  if (!Array.isArray(users)) return;
  const nameCounts = {};
  users.forEach(u => {
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
}

let saveTimer = null;

function saveDiskStoreImmediate() {
  try {
    assignUniqueEmails(registeredUsers);
    const data = {
      registeredUsers,
      userWalletStore,
      memoryDeposits,
      memoryWithdrawals,
      memoryBets,
      declaredResultsMap,
      declaredResultsDateMap,
      memoryResultsHistory,
      gameSchedulesStore,
      chartRecords,
      bannerConfig,
      referralConfig,
      appVersionConfig,
      settingsConfig,
      bannersListStore,
      blockedMobiles,
      deletedMobiles,
      livePlayersMap,
      autoPlayerConfig,
      khaiwalPlayersStore,
      khaiwalPlayerBetsStore
    };
    const payload = JSON.stringify(data);
    const tmpFile = STORE_FILE + '.tmp';
    const bakFile = STORE_FILE + '.bak';
    
    fs.promises.writeFile(tmpFile, payload, 'utf-8').then(() => {
      fs.rename(tmpFile, STORE_FILE, () => {});
      fs.promises.writeFile(bakFile, payload, 'utf-8').catch(() => {});
    }).catch(err => {
      console.error('[Disk Store] Async Save Error:', err.message);
    });

    const legacyPath = path.join(__dirname, 'dataStore.json');
    if (legacyPath !== STORE_FILE && fs.existsSync(legacyPath)) {
      const legacyTmp = legacyPath + '.tmp';
      fs.promises.writeFile(legacyTmp, payload, 'utf-8').then(() => {
        fs.rename(legacyTmp, legacyPath, () => {});
      }).catch(() => {});
    }
  } catch (err) {
    console.error('[Disk Store] Save Error:', err.message);
  }
}

function saveDiskStore() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveDiskStoreImmediate();
  }, 200);
}

function loadDiskStore() {
  try {
    let targetFile = STORE_FILE;
    const bakFile = STORE_FILE + '.bak';
    let fileToRead = null;

    if (fs.existsSync(targetFile)) {
      try {
        const stats = fs.statSync(targetFile);
        if (stats.size > 10) fileToRead = targetFile;
      } catch (e) {}
    }
    if (!fileToRead && fs.existsSync(bakFile)) {
      try {
        const bakStats = fs.statSync(bakFile);
        if (bakStats.size > 10) {
          fileToRead = bakFile;
          console.warn(`[Disk Store] Recovering from backup disk file: ${bakFile}`);
        }
      } catch (e) {}
    }
    const legacyPath = path.join(__dirname, 'dataStore.json');
    if (!fileToRead && legacyPath !== STORE_FILE && fs.existsSync(legacyPath)) {
      fileToRead = legacyPath;
    }

    if (fileToRead) {
      const raw = fs.readFileSync(fileToRead, 'utf-8');
      const data = JSON.parse(raw);
      if (data.registeredUsers && Array.isArray(data.registeredUsers)) {
        registeredUsers.length = 0;
        data.registeredUsers.forEach(u => {
          if (u.winning_balance !== undefined && u.winning_balance < 0) u.winning_balance = 0.00;
          if (u.deposit_balance !== undefined && u.deposit_balance < 0) u.deposit_balance = 0.00;
          if (u.commission_balance !== undefined && u.commission_balance < 0) u.commission_balance = 0.00;
          if (u.bonus_balance !== undefined && u.bonus_balance < 0) u.bonus_balance = 0.00;
          u.balance = parseFloat(((u.deposit_balance || 0) + (u.winning_balance || 0)).toFixed(2));
          if (u.balance < 0) u.balance = 0.00;
          registeredUsers.push(u);
        });
      }
      if (data.userWalletStore) Object.assign(userWalletStore, data.userWalletStore);
      if (data.memoryDeposits && Array.isArray(data.memoryDeposits)) memoryDeposits.length = 0, memoryDeposits.push(...data.memoryDeposits);
      if (data.memoryWithdrawals && Array.isArray(data.memoryWithdrawals)) memoryWithdrawals.length = 0, memoryWithdrawals.push(...data.memoryWithdrawals);
      if (data.memoryBets && Array.isArray(data.memoryBets)) {
        memoryBets.length = 0;
        const seenBetKeys = new Set();
        data.memoryBets.forEach(b => {
          const cleanMob = String(b.user || b.mobile || '').replace(/[^0-9]/g, '').slice(-10);
          const num = b.number !== undefined ? b.number : '';
          const amt = parseFloat(b.bet_amount || b.amount || 0);
          const game = b.game_name || '';
          const ep = b.created_at ? new Date(b.created_at).getTime() : (b.timestamp || 0);
          const timeBucket = Math.floor(ep / 15000);
          const key = `${cleanMob}_${game}_${num}_${amt}_${timeBucket}`;
          const idKey = String(b._id || b.id || '');
          if ((idKey && seenBetKeys.has(idKey)) || seenBetKeys.has(key)) return;
          if (idKey) seenBetKeys.add(idKey);
          seenBetKeys.add(key);
          memoryBets.push(b);
        });
      }
      if (data.declaredResultsMap) Object.assign(declaredResultsMap, data.declaredResultsMap);
      if (data.declaredResultsDateMap) Object.assign(declaredResultsDateMap, data.declaredResultsDateMap);
      if (data.memoryResultsHistory && Array.isArray(data.memoryResultsHistory)) memoryResultsHistory.length = 0, memoryResultsHistory.push(...data.memoryResultsHistory);
      
      // Backfill any missing date keys in declaredResultsDateMap from memoryResultsHistory
      Object.keys(declaredResultsMap).forEach(g => {
        if (!declaredResultsDateMap[g] && Array.isArray(memoryResultsHistory)) {
          const hist = memoryResultsHistory.find(h => (h.category === g || h.game_name === g) && h.date);
          if (hist && hist.date) {
            declaredResultsDateMap[g] = hist.date;
          }
        }
      });

      // Hydrate declaredResultsMap for games from memoryResultsHistory so results remain visible while market is closed
      const istNowBoot = new Date(Date.now() + (5.5 * 60 * 60 * 1000));
      const todayKeyBoot = `${istNowBoot.getUTCFullYear()}-${String(istNowBoot.getUTCMonth() + 1).padStart(2, '0')}-${String(istNowBoot.getUTCDate()).padStart(2, '0')}`;
      const yesterdayBoot = new Date(istNowBoot.getTime() - (24 * 60 * 60 * 1000));
      const yesterdayKeyBoot = `${yesterdayBoot.getUTCFullYear()}-${String(yesterdayBoot.getUTCMonth() + 1).padStart(2, '0')}-${String(yesterdayBoot.getUTCDate()).padStart(2, '0')}`;
      const allMarkets = ['Shiv Parwati', 'Delhi Bazar', 'Dubai Market', 'Shree Ganesh', 'Faridabad', 'Ghaziabad', 'Gali', 'Desawar'];
      allMarkets.forEach(g => {
        if ((declaredResultsMap[g] === undefined || declaredResultsMap[g] === null) && Array.isArray(memoryResultsHistory)) {
          const hist = memoryResultsHistory.find(h => {
            const match = (h.category === g || h.game_name === g ||
              (g === 'Desawar' && (h.category === 'Disawer' || h.game_name === 'Disawer')) ||
              (g === 'Shree Ganesh' && (h.category === 'Shri Ganesh' || h.game_name === 'Shri Ganesh')));
            return match && h.number !== undefined && h.number !== '--' && (h.date === todayKeyBoot || h.date === yesterdayKeyBoot);
          });
          if (hist && hist.number !== undefined && hist.number !== '--') {
            const num = parseInt(hist.number);
            if (!isNaN(num)) {
              declaredResultsMap[g] = num;
              declaredResultsDateMap[g] = hist.date;
              if (g === 'Desawar') {
                declaredResultsMap['Disawer'] = num;
                declaredResultsDateMap['Disawer'] = hist.date;
              }
              if (g === 'Shree Ganesh') {
                declaredResultsMap['Shri Ganesh'] = num;
                declaredResultsDateMap['Shri Ganesh'] = hist.date;
              }
            }
          }
        }
      });
      if (data.gameSchedulesStore) {
        Object.assign(gameSchedulesStore, data.gameSchedulesStore);
        for (const k in gameSchedulesStore) {
          if (gameSchedulesStore[k].enabled === undefined) {
            gameSchedulesStore[k].enabled = true;
          }
        }
      }
      if (data.chartRecords) Object.assign(chartRecords, data.chartRecords);
      if (data.bannerConfig) Object.assign(bannerConfig, data.bannerConfig);
      if (data.referralConfig) Object.assign(referralConfig, data.referralConfig);
      if (data.appVersionConfig) Object.assign(appVersionConfig, data.appVersionConfig);
      appVersionConfig.latestVersionCode = 104;
      appVersionConfig.latestVersionName = '1.0.104';
      appVersionConfig.forceUpdate = false;
      appVersionConfig.updateMessage = '🚀 New Update Available! Saved Bank Name support for instant 1-click withdrawals & fast betting.';
      appVersionConfig.apkUrl = 'https://95xmatka.com/95xmatka.apk';
      if (data.settingsConfig) Object.assign(settingsConfig, data.settingsConfig);
      settingsConfig.latestVersionCode = 104;
      settingsConfig.forceUpdate = false;
      settingsConfig.updateMessage = '🚀 New Update Available! Saved Bank Name support for instant 1-click withdrawals & fast betting.';
      if (data.bannersListStore && Array.isArray(data.bannersListStore)) bannersListStore.length = 0, bannersListStore.push(...data.bannersListStore);
      if (data.blockedMobiles && Array.isArray(data.blockedMobiles)) blockedMobiles.length = 0, blockedMobiles.push(...data.blockedMobiles);
      if (data.deletedMobiles && Array.isArray(data.deletedMobiles)) deletedMobiles.length = 0, deletedMobiles.push(...data.deletedMobiles);
      if (data.livePlayersMap && typeof data.livePlayersMap === 'object') Object.assign(livePlayersMap, data.livePlayersMap);
      if (data.autoPlayerConfig && typeof data.autoPlayerConfig === 'object') Object.assign(autoPlayerConfig, data.autoPlayerConfig);
      if (data.khaiwalPlayersStore && typeof data.khaiwalPlayersStore === 'object') Object.assign(khaiwalPlayersStore, data.khaiwalPlayersStore);
      if (data.khaiwalPlayerBetsStore && typeof data.khaiwalPlayerBetsStore === 'object') Object.assign(khaiwalPlayerBetsStore, data.khaiwalPlayerBetsStore);
      console.log(`[Disk Store] Successfully loaded disk data from ${fileToRead}! Registered users: ${registeredUsers.length}`);
    }
  } catch (err) {
    console.error('[Disk Store] Load Error:', err.message);
  }
}

// Initial load on server startup
loadDiskStore();

let memoryNotifications = [];

module.exports = {
  STORE_FILE,
  registeredUsers,
  userWalletStore,
  memoryDeposits,
  memoryWithdrawals,
  memoryBets,
  memoryGameLedger,
  memoryNotifications,
  declaredResultsMap,
  declaredResultsDateMap,
  memoryResultsHistory,
  gameSchedulesStore,
  bannerConfig,
  referralConfig,
  appVersionConfig,
  settingsConfig,
  bannersListStore,
  saveDiskStore,
  logLedgerTransaction,
  purgeOldLedger,
  purgeOldBets,
  blockedMobiles,
  deletedMobiles,
  livePlayersMap,
  autoPlayerConfig,
  tickLivePlayerCounts,
  khaiwalPlayersStore,
  khaiwalPlayerBetsStore
};
