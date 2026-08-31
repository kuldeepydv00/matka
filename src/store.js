const fs = require('fs');
const path = require('path');

const STORE_FILE = path.join(__dirname, 'dataStore.json');

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

const FORTY_DAYS_MS = 40 * 24 * 60 * 60 * 1000;

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
  minWithdrawal: '300',
  imageUrl: ''
};

let appVersionConfig = {
  latestVersionCode: 1,
  latestVersionName: '1.0.0',
  minSupportedVersion: 1,
  apkUrl: 'https://95xmatka.com/app-debug.apk',
  updateMessage: '🚀 A new performance update is available! Tap Update now to get the latest features & instant wallet sync.',
  forceUpdate: false
};

let settingsConfig = {
  whatsapp_number: '+917027709695',
  whatsapp_call_number: '+917027709695',
  app_download_link: 'https://95xmatka.com/app-debug.apk',
  app_version: '1.0.0',
  bank_withdrawal_enable: true,
  upi_withdrawal_enable: true,
  lucky_card_maintenance: false
};

let gameSchedulesStore = {
  "Desawar": {
    name: "Desawar",
    open: "05:00 AM IST",
    close: "04:00 AM IST",
    result: "06:00 AM IST",
    openHour: 5, openMinute: 0,
    closeHour: 4, closeMinute: 0,
    resultHour: 6, resultMinute: 0
  },
  "Shiv Parwati": {
    name: "Shiv Parwati",
    open: "04:00 AM IST",
    close: "12:00 PM IST",
    result: "12:40 PM IST",
    openHour: 4, openMinute: 0,
    closeHour: 12, closeMinute: 0,
    resultHour: 12, resultMinute: 40
  },
  "Delhi Bazar": {
    name: "Delhi Bazar",
    open: "04:00 AM IST",
    close: "02:45 PM IST",
    result: "03:20 PM IST",
    openHour: 4, openMinute: 0,
    closeHour: 14, closeMinute: 45,
    resultHour: 15, resultMinute: 20
  },
  "Dubai Market": {
    name: "Dubai Market",
    open: "04:00 AM IST",
    close: "04:00 PM IST",
    result: "04:00 PM IST",
    openHour: 4, openMinute: 0,
    closeHour: 16, closeMinute: 0,
    resultHour: 16, resultMinute: 0
  },
  "Shree Ganesh": {
    name: "Shree Ganesh",
    open: "04:00 AM IST",
    close: "04:30 PM IST",
    result: "04:50 PM IST",
    openHour: 4, openMinute: 0,
    closeHour: 16, closeMinute: 30,
    resultHour: 16, resultMinute: 50
  },
  "Faridabad": {
    name: "Faridabad",
    open: "04:00 AM IST",
    close: "05:40 PM IST",
    result: "06:20 PM IST",
    openHour: 4, openMinute: 0,
    closeHour: 17, closeMinute: 40,
    resultHour: 18, resultMinute: 20
  },
  "Ghaziabad": {
    name: "Ghaziabad",
    open: "04:00 AM IST",
    close: "09:30 PM IST",
    result: "10:10 PM IST",
    openHour: 4, openMinute: 0,
    closeHour: 21, closeMinute: 30,
    resultHour: 22, resultMinute: 10
  },
  "Gali": {
    name: "Gali",
    open: "04:00 AM IST",
    close: "11:30 PM IST",
    result: "11:59 PM IST",
    openHour: 4, openMinute: 0,
    closeHour: 23, closeMinute: 30,
    resultHour: 23, resultMinute: 59
  }
};

const { chartRecords } = require('./historicalChartStore');

function saveDiskStore() {
  try {
    const data = {
      registeredUsers,
      userWalletStore,
      memoryDeposits,
      memoryWithdrawals,
      memoryBets,
      declaredResultsMap,
      gameSchedulesStore,
      chartRecords,
      bannerConfig,
      referralConfig,
      appVersionConfig,
      settingsConfig
    };
    fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Disk Store] Save Error:', err.message);
  }
}

function loadDiskStore() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (data.registeredUsers && Array.isArray(data.registeredUsers)) registeredUsers.length = 0, registeredUsers.push(...data.registeredUsers);
      if (data.userWalletStore) Object.assign(userWalletStore, data.userWalletStore);
      if (data.memoryDeposits && Array.isArray(data.memoryDeposits)) memoryDeposits.length = 0, memoryDeposits.push(...data.memoryDeposits);
      if (data.memoryWithdrawals && Array.isArray(data.memoryWithdrawals)) memoryWithdrawals.length = 0, memoryWithdrawals.push(...data.memoryWithdrawals);
      if (data.memoryBets && Array.isArray(data.memoryBets)) memoryBets.length = 0, memoryBets.push(...data.memoryBets);
      if (data.declaredResultsMap) Object.assign(declaredResultsMap, data.declaredResultsMap);
      if (data.gameSchedulesStore) Object.assign(gameSchedulesStore, data.gameSchedulesStore);
      if (data.chartRecords) Object.assign(chartRecords, data.chartRecords);
      if (data.bannerConfig) Object.assign(bannerConfig, data.bannerConfig);
      if (data.referralConfig) Object.assign(referralConfig, data.referralConfig);
      if (data.appVersionConfig) Object.assign(appVersionConfig, data.appVersionConfig);
      if (data.settingsConfig) Object.assign(settingsConfig, data.settingsConfig);
      console.log(`[Disk Store] Successfully loaded disk data! Registered users: ${registeredUsers.length}`);
    }
  } catch (err) {
    console.error('[Disk Store] Load Error:', err.message);
  }
}

let referralConfig = {
  enabled: true,
  signupBonus: 50,
  commissionPercentage: 4
};

// Initial load on server startup
loadDiskStore();

let memoryNotifications = [];

module.exports = {
  registeredUsers,
  userWalletStore,
  memoryDeposits,
  memoryWithdrawals,
  memoryBets,
  memoryGameLedger,
  memoryNotifications,
  declaredResultsMap,
  gameSchedulesStore,
  bannerConfig,
  referralConfig,
  appVersionConfig,
  settingsConfig,
  saveDiskStore,
  logLedgerTransaction,
  purgeOldLedger
};
