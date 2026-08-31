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

// Connect to database
connectDB();

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
    latestVersionCode: 1,
    latestVersionName: '1.0.0',
    minSupportedVersion: 1,
    apkUrl: 'https://95xmatka.com/app-debug.apk',
    updateMessage: '🚀 A new performance update is available! Tap Update now to get the latest features & instant wallet sync.',
    forceUpdate: false
  });
});

app.get('/api/app/settings', (req, res) => {
  const { settingsConfig } = require('./store');
  res.json(settingsConfig || {
    whatsapp_number: '+917027709695',
    whatsapp_call_number: '+917027709695',
    app_download_link: 'https://95xmatka.com/app-debug.apk',
    app_version: '1.0.0',
    bank_withdrawal_enable: true,
    upi_withdrawal_enable: true,
    lucky_card_maintenance: false
  });
});

app.post('/api/admin/update-settings', (req, res) => {
  const store = require('./store');
  if (req.body) {
    Object.assign(store.settingsConfig, req.body);
    
    // Sync settings with appVersionConfig so both configurations update
    if (req.body.app_version) {
      store.appVersionConfig.latestVersionName = req.body.app_version;
      const cleanNum = req.body.app_version.replace(/[^0-9]/g, '');
      const parsedCode = parseInt(cleanNum);
      if (!isNaN(parsedCode) && parsedCode > 0) {
        store.appVersionConfig.latestVersionCode = parsedCode;
      }
    }
    if (req.body.app_download_link) {
      store.appVersionConfig.apkUrl = req.body.app_download_link;
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

const PORT = process.env.PORT || 5001;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT} [Timezone: Asia/Kolkata (IST)]`);
});
