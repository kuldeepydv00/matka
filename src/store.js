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
let declaredResultsMap = {};

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
      referralConfig
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

module.exports = {
  registeredUsers,
  userWalletStore,
  memoryDeposits,
  memoryWithdrawals,
  memoryBets,
  declaredResultsMap,
  gameSchedulesStore,
  bannerConfig,
  referralConfig,
  saveDiskStore
};
