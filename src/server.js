// Set server timezone to Indian Standard Time (IST - Asia/Kolkata)
process.env.TZ = 'Asia/Kolkata';

const express = require('express');
const http = require('http');
const cors = require('cors');
const dotenv = require('dotenv');
const { Server } = require('socket.io');
const connectDB = require('./config/db');

// Load env vars
dotenv.config();

// Connect to database, then repair any bets whose created_at was overwritten with a later time
connectDB().catch(() => {}).finally(() => {
  try {
    const fs = require('fs');
    const store = require('./store');
    const { repairRestampedBets } = require('./utils/betTime');
    const summary = repairRestampedBets(store.memoryBets, store.gameSchedulesStore);
    if (summary.fixed > 0) {
      try {
        if (store.STORE_FILE && fs.existsSync(store.STORE_FILE)) {
          const backupFile = `${store.STORE_FILE}.before-bet-time-repair-${Date.now()}.json`;
          fs.copyFileSync(store.STORE_FILE, backupFile);
          console.log(`[Bet Time Repair] Backup saved: ${backupFile}`);
        }
      } catch (e) { console.error('[Bet Time Repair] Backup failed:', e.message); }
      store.saveDiskStore();
      console.log(`[Bet Time Repair] Restored real time + draw date on ${summary.fixed} of ${summary.checked} bets:`, JSON.stringify(summary.byGame));
    } else {
      console.log(`[Bet Time Repair] OK - no restamped bets (${summary.checked} checked)`);
    }
  } catch (e) {
    console.error('[Bet Time Repair Error]', e.message);
  }
});

const app = express();
const server = http.createServer(app);

// Socket.io setup
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Admin API protection (must stay before every /api/admin route, including update-settings below)
const { adminApiGuard, adminWriteGuard, requireAdmin } = require('./middleware/adminAuth');
app.use('/api/admin', adminApiGuard);
app.use(['/api/payment-methods', '/api/send-notification', '/api/notifications', '/api/game/banner'], adminWriteGuard);
app.use('/api/user/upload-apk-chunk', requireAdmin);

// Make io accessible to routers
app.set('io', io);

// Socket.io connection
io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);
  
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

// Basic route
app.get('/', (req, res) => {
  res.send('95XMATKA API (IST) is running...');
});

app.get('/api/app/version', (req, res) => {
  const { appVersionConfig } = require('./store');
  res.json(appVersionConfig || {
    latestVersionCode: 100,
    latestVersionName: '1.0.100',
    minSupportedVersion: 1,
    apkUrl: 'https://95xmatka.com/95xmatka.apk',
    updateMessage: '🚀 New Update Available! Clean UI, OTP keyboard fixes & fast betting. Tap UPDATE NOW!',
    forceUpdate: true
  });
});

const getSettingsHandler = (req, res) => {
  const { settingsConfig } = require('./store');
  res.json(settingsConfig || {
    whatsapp_number: '+917206561420',
    whatsapp_call_number: '+917206561420',
    app_download_link: 'https://95xmatka.com/95xmatka.apk',
    app_version: '1.0.0',
    bank_withdrawal_enable: true,
    upi_withdrawal_enable: true,
    lucky_card_maintenance: false,
    jodi_rate: 97,
    crossing_rate: 97,
    haroof_rate: 9.7
  });
};

app.get('/api/settings', getSettingsHandler);
app.get('/api/app/settings', getSettingsHandler);

app.post('/api/admin/update-settings', (req, res) => {
  const store = require('./store');
  if (req.body) {
    if (req.body.jodi_rate !== undefined) store.settingsConfig.jodi_rate = parseFloat(req.body.jodi_rate) || 95;
    if (req.body.crossing_rate !== undefined) store.settingsConfig.crossing_rate = parseFloat(req.body.crossing_rate) || 95;
    if (req.body.haroof_rate !== undefined) store.settingsConfig.haroof_rate = parseFloat(req.body.haroof_rate) || 9.5;

    Object.assign(store.settingsConfig, req.body);
    
    // Sync settings with appVersionConfig so both configurations update
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
    res.json({ success: true, settingsConfig: store.settingsConfig });
  } else {
    res.status(400).json({ error: 'Invalid settings body' });
  }
});

// Routes
const { getPaymentMethods, savePaymentMethod, deletePaymentMethod, toggleActivePaymentMethod, getNotifications, sendCustomNotification, deleteNotification } = require('./controllers/adminController');
app.get('/api/payment-methods', getPaymentMethods);
app.post('/api/payment-methods', savePaymentMethod);
app.delete('/api/payment-methods/:id', deletePaymentMethod);
app.post('/api/payment-methods/:id/toggle', toggleActivePaymentMethod);

app.get('/api/notifications', getNotifications);
app.post('/api/send-notification', sendCustomNotification);
app.delete('/api/notifications/:id', deleteNotification);

app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/user', require('./routes/userRoutes'));
app.use('/api/game', require('./routes/gameRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/payment', require('./routes/paymentRoutes'));

// EKQR Webhook direct alias routes for all possible callback paths
const paymentController = require('./controllers/paymentController');
app.all('/api/v1/callbacks/upigateway', paymentController.handleEkqrWebhook);
app.all('/api/payment/webhook', paymentController.handleEkqrWebhook);

// Background worker to auto-clear yesterday's results when a game's betting window opens or date rolls over
setInterval(() => {
  try {
    const { gameSchedulesStore, declaredResultsMap, declaredResultsDateMap, saveDiskStore } = require('./store');
    if (!gameSchedulesStore || !declaredResultsMap) return;

    let clearedAny = false;
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const istDate = new Date(utc + (3600000 * 5.5));
    const currentMinutes = istDate.getHours() * 60 + istDate.getMinutes();

    const yyyy = istDate.getFullYear();
    const mm = String(istDate.getMonth() + 1).padStart(2, '0');
    const dd = String(istDate.getDate()).padStart(2, '0');
    const istTodayKey = `${yyyy}-${mm}-${dd}`;

    const parseTime = (str) => {
      if (!str) return 0;
      const match = str.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (!match) return 0;
      let h = parseInt(match[1]);
      const m = parseInt(match[2]);
      const ampm = match[3].toUpperCase();
      if (ampm === 'PM' && h < 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
      return h * 60 + m;
    };

    Object.keys(declaredResultsMap).forEach(gameName => {
      const sched = gameSchedulesStore[gameName];
      if (!sched || !sched.open || !sched.close) return;
      
      const openM = parseTime(sched.open);
      const closeM = parseTime(sched.close);
      
      let isOpen = false;
      if (closeM < openM || gameName === 'Desawar' || gameName === 'Disawer') {
        isOpen = (currentMinutes >= openM || currentMinutes < closeM);
      } else {
        isOpen = (currentMinutes >= openM && currentMinutes < closeM);
      }

      // Clear result ONLY when the new betting window OPENS (e.g. 4:00 AM for daytime, 12:00 PM for Desawar)
      // Results remain visible across midnight while the market is closed!
      const declaredDate = (declaredResultsDateMap && declaredResultsDateMap[gameName]) ? declaredResultsDateMap[gameName] : null;
      const staleCutoff = new Date(Date.now() - (24 * 60 * 60 * 1000) + (5.5 * 3600000));
      const staleKey = `${staleCutoff.getUTCFullYear()}-${String(staleCutoff.getUTCMonth() + 1).padStart(2, '0')}-${String(staleCutoff.getUTCDate()).padStart(2, '0')}`;
      const isStale = declaredDate && declaredDate < staleKey;

      if (isOpen || isStale) {
        delete declaredResultsMap[gameName];
        if (declaredResultsDateMap) delete declaredResultsDateMap[gameName];
        if (gameName === 'Desawar') {
          delete declaredResultsMap['Disawer'];
          if (declaredResultsDateMap) delete declaredResultsDateMap['Disawer'];
        }
        if (gameName === 'Disawer') {
          delete declaredResultsMap['Desawar'];
          if (declaredResultsDateMap) delete declaredResultsDateMap['Desawar'];
        }
        if (gameName === 'Shree Ganesh') {
          delete declaredResultsMap['Shri Ganesh'];
          if (declaredResultsDateMap) delete declaredResultsDateMap['Shri Ganesh'];
        }
        if (gameName === 'Shri Ganesh') {
          delete declaredResultsMap['Shree Ganesh'];
          if (declaredResultsDateMap) delete declaredResultsDateMap['Shree Ganesh'];
        }
        clearedAny = true;
      }
    });

    if (clearedAny) {
      saveDiskStore();
      console.log('[Auto-Clear] Cleared old results from live display because new betting window opened.');
    }
  } catch(e) {}
}, 60000);

const PORT = process.env.PORT || 5001;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT} [Timezone: Asia/Kolkata (IST)]`);
});

