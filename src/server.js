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
app.use(express.json());

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

// Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/user', require('./routes/userRoutes'));
app.use('/api/game', require('./routes/gameRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));

const PORT = process.env.PORT || 5001;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT} [Timezone: Asia/Kolkata (IST)]`);
});
