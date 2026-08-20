require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const path = require('path');
const http = require('http');
const socketIO = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// ============ MIDDLEWARE ============
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use('/api/', limiter);

// ============ DATABASE ============
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('✅ Database Connected'))
.catch(err => console.error('❌ Database Error:', err.message));

// ============ MODELS ============

// ✅ Chat Message Schema
const ChatMessageSchema = new mongoose.Schema({
  visitorId: { type: String, required: true, index: true },
  name: { type: String, default: 'Guest' },
  message: { type: String, required: true },
  isFromAdmin: { type: Boolean, default: false },
  adminName: { type: String, default: 'Support Team' },
  isRead: { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now }
});

// ✅ Chat Session Schema - Stores every user session
const ChatSessionSchema = new mongoose.Schema({
  visitorId: { type: String, required: true, unique: true },
  name: { type: String, default: 'Guest' },
  isActive: { type: Boolean, default: true },
  lastMessageAt: { type: Date, default: Date.now },
  unreadCount: { type: Number, default: 0 },
  totalMessages: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

// ✅ Support Number Schema
const SupportSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true },
  countryCode: { type: String, required: true },
  countryFlag: { type: String, required: true },
  isActive: { type: Boolean, default: true }
});

// ✅ Settings Schema
const SettingsSchema = new mongoose.Schema({
  isOnline: { type: Boolean, default: true },
  adminName: { type: String, default: 'Support Team' },
  welcomeMessage: { type: String, default: 'Hello! How can I help you?' }
});

// ✅ Admin Schema
const AdminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true }
});

const ChatMessage = mongoose.model('ChatMessage', ChatMessageSchema);
const ChatSession = mongoose.model('ChatSession', ChatSessionSchema);
const Support = mongoose.model('Support', SupportSchema);
const Settings = mongoose.model('Settings', SettingsSchema);
const Admin = mongoose.model('Admin', AdminSchema);

// ============ AUTH ============
const authenticate = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) throw new Error();
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const admin = await Admin.findById(decoded.id);
    if (!admin) throw new Error();
    req.admin = admin;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Please authenticate' });
  }
};

// ============ INITIALIZE ============
(async () => {
  try {
    const existingAdmin = await Admin.findOne({ username: process.env.ADMIN_USERNAME });
    if (!existingAdmin) {
      const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
      await Admin.create({
        username: process.env.ADMIN_USERNAME,
        password: hashedPassword
      });
      console.log('✅ Admin created');
    }

    const existingSettings = await Settings.findOne();
    if (!existingSettings) {
      await Settings.create({
        isOnline: true,
        adminName: 'Support Team',
        welcomeMessage: 'Hello! How can I help you?'
      });
      console.log('✅ Settings created');
    }
  } catch (err) {
    console.error('⚠️ Init error:', err.message);
  }
})();

// ============ API ROUTES ============

// Admin Login
app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const admin = await Admin.findOne({ username });
    if (!admin) return res.status(401).json({ error: 'Invalid credentials' });
    
    const isValid = await bcrypt.compare(password, admin.password);
    if (!isValid) return res.status(401).json({ error: 'Invalid credentials' });
    
    const token = jwt.sign({ id: admin._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, username: admin.username });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get settings
app.get('/api/settings', async (req, res) => {
  try {
    const settings = await Settings.findOne();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update settings (admin only)
app.post('/api/admin/settings', authenticate, async (req, res) => {
  try {
    const { isOnline, adminName, welcomeMessage } = req.body;
    const settings = await Settings.findOneAndUpdate(
      {},
      { isOnline, adminName, welcomeMessage },
      { new: true, upsert: true }
    );
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get support numbers
app.get('/api/support', async (req, res) => {
  try {
    const supports = await Support.find({ isActive: true });
    res.json(supports);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add support number (admin only)
app.post('/api/admin/support', authenticate, async (req, res) => {
  try {
    const { name, phone, countryCode, countryFlag } = req.body;
    const support = await Support.create({ name, phone, countryCode, countryFlag });
    res.json(support);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Edit support number (admin only)
app.put('/api/admin/support/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone, countryCode, countryFlag, isActive } = req.body;
    const support = await Support.findByIdAndUpdate(
      id,
      { name, phone, countryCode, countryFlag, isActive },
      { new: true }
    );
    res.json(support);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete support number (admin only)
app.delete('/api/admin/support/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    await Support.findByIdAndDelete(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ CHAT API ROUTES ============

// ✅ Get or create session for visitor
app.post('/api/chat/session', async (req, res) => {
  try {
    const { visitorId, name } = req.body;
    
    if (!visitorId) {
      return res.status(400).json({ error: 'visitorId required' });
    }
    
    let session = await ChatSession.findOne({ visitorId });
    
    if (!session) {
      session = await ChatSession.create({
        visitorId,
        name: name || 'Guest',
        isActive: true,
        lastMessageAt: new Date(),
        unreadCount: 0,
        totalMessages: 0
      });
      console.log(`✅ New session created: ${visitorId} (${session.name})`);
    } else {
      // Update name if provided and different
      if (name && name !== 'Guest' && session.name === 'Guest') {
        session.name = name;
        await session.save();
      }
    }
    
    res.json({ session });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ Get chat history for a visitor
app.get('/api/chat/messages/:visitorId', async (req, res) => {
  try {
    const { visitorId } = req.params;
    const messages = await ChatMessage.find({ visitorId }).sort({ timestamp: 1 });
    
    // Get session info
    const session = await ChatSession.findOne({ visitorId });
    
    res.json({ 
      messages,
      session: session || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ Send message (visitor)
app.post('/api/chat/send', async (req, res) => {
  try {
    const { visitorId, name, message } = req.body;
    
    if (!visitorId || !message) {
      return res.status(400).json({ error: 'visitorId and message required' });
    }
    
    // Save message
    const newMessage = await ChatMessage.create({
      visitorId,
      name: name || 'Guest',
      message,
      isFromAdmin: false,
      isRead: false
    });
    
    // Update or create session
    const session = await ChatSession.findOneAndUpdate(
      { visitorId },
      {
        $set: { 
          lastMessageAt: new Date(),
          name: name || 'Guest',
          isActive: true
        },
        $inc: { 
          unreadCount: 1,
          totalMessages: 1
        }
      },
      { 
        upsert: true, 
        new: true 
      }
    );
    
    // ✅ Emit to admin (real-time)
    io.emit('new-message', {
      visitorId,
      name: name || 'Guest',
      message,
      timestamp: newMessage.timestamp,
      isFromAdmin: false,
      session: session
    });
    
    // ✅ Emit unread count update
    const unreadCount = await ChatMessage.countDocuments({ isRead: false, isFromAdmin: false });
    io.emit('unread-update', { unread: unreadCount });
    
    res.json({ 
      success: true, 
      message: newMessage,
      session: session
    });
  } catch (error) {
    console.error('❌ Error sending message:', error);
    res.status(500).json({ error: error.message });
  }
});

// ✅ Get all chat sessions (admin only)
app.get('/api/admin/sessions', authenticate, async (req, res) => {
  try {
    const sessions = await ChatSession.find().sort({ lastMessageAt: -1 });
    res.json({ sessions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ Get messages for a session (admin only)
app.get('/api/admin/session/:visitorId/messages', authenticate, async (req, res) => {
  try {
    const { visitorId } = req.params;
    const messages = await ChatMessage.find({ visitorId }).sort({ timestamp: 1 });
    
    // ✅ Mark messages as read
    await ChatMessage.updateMany(
      { visitorId, isRead: false },
      { isRead: true }
    );
    
    // ✅ Reset unread count
    await ChatSession.findOneAndUpdate(
      { visitorId },
      { unreadCount: 0 }
    );
    
    // Get updated session
    const session = await ChatSession.findOne({ visitorId });
    
    // ✅ Emit unread count update
    const unreadCount = await ChatMessage.countDocuments({ isRead: false, isFromAdmin: false });
    io.emit('unread-update', { unread: unreadCount });
    
    res.json({ 
      messages,
      session: session || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ Get unread count (admin only)
app.get('/api/admin/unread-count', authenticate, async (req, res) => {
  try {
    const count = await ChatMessage.countDocuments({ isRead: false, isFromAdmin: false });
    res.json({ unread: count });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ Admin reply to message
app.post('/api/admin/reply', authenticate, async (req, res) => {
  try {
    const { visitorId, message } = req.body;
    
    if (!visitorId || !message) {
      return res.status(400).json({ error: 'visitorId and message required' });
    }
    
    const settings = await Settings.findOne();
    const adminName = settings?.adminName || 'Support Team';
    
    // Save admin message
    const newMessage = await ChatMessage.create({
      visitorId,
      message,
      isFromAdmin: true,
      adminName: adminName,
      isRead: true
    });
    
    // Update session
    await ChatSession.findOneAndUpdate(
      { visitorId },
      {
        $set: { 
          lastMessageAt: new Date(),
          isActive: true
        },
        $inc: { totalMessages: 1 }
      }
    );
    
    // ✅ Emit to visitor (real-time)
    io.to(visitorId).emit('admin-reply', {
      message,
      adminName,
      timestamp: newMessage.timestamp
    });
    
    res.json({ 
      success: true, 
      message: newMessage 
    });
  } catch (error) {
    console.error('❌ Error sending admin reply:', error);
    res.status(500).json({ error: error.message });
  }
});

// ✅ Delete message (admin only)
app.delete('/api/admin/message/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await ChatMessage.findByIdAndDelete(id);
    
    if (!deleted) {
      return res.status(404).json({ error: 'Message not found' });
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ SOCKET.IO ============
io.on('connection', (socket) => {
  console.log('🔌 New connection:', socket.id);

  // ✅ Visitor joins their room
  socket.on('join-room', (visitorId) => {
    socket.join(visitorId);
    console.log(`👤 Visitor ${visitorId} joined room`);
  });

  // ✅ Visitor sends message
  socket.on('visitor-message', async (data) => {
    try {
      const { visitorId, name, message } = data;
      
      if (!visitorId || !message) return;
      
      // Save message
      const newMessage = await ChatMessage.create({
        visitorId,
        name: name || 'Guest',
        message,
        isFromAdmin: false,
        isRead: false
      });
      
      // Update session
      const session = await ChatSession.findOneAndUpdate(
        { visitorId },
        {
          $set: { 
            lastMessageAt: new Date(),
            name: name || 'Guest',
            isActive: true
          },
          $inc: { 
            unreadCount: 1,
            totalMessages: 1
          }
        },
        { upsert: true, new: true }
      );
      
      // Emit to admin
      io.emit('new-message', {
        visitorId,
        name: name || 'Guest',
        message,
        timestamp: newMessage.timestamp,
        isFromAdmin: false,
        session: session
      });
      
      // Emit unread count
      const unreadCount = await ChatMessage.countDocuments({ isRead: false, isFromAdmin: false });
      io.emit('unread-update', { unread: unreadCount });
      
    } catch (error) {
      console.error('❌ Socket error:', error);
    }
  });

  // ✅ Admin sends message
  socket.on('admin-message', async (data) => {
    try {
      const { visitorId, message } = data;
      
      if (!visitorId || !message) return;
      
      const settings = await Settings.findOne();
      const adminName = settings?.adminName || 'Support Team';
      
      const newMessage = await ChatMessage.create({
        visitorId,
        message,
        isFromAdmin: true,
        adminName: adminName,
        isRead: true
      });
      
      await ChatSession.findOneAndUpdate(
        { visitorId },
        {
          $set: { lastMessageAt: new Date() },
          $inc: { totalMessages: 1 }
        }
      );
      
      // Emit to visitor
      io.to(visitorId).emit('admin-reply', {
        message,
        adminName,
        timestamp: newMessage.timestamp
      });
      
    } catch (error) {
      console.error('❌ Socket admin error:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log('🔌 Disconnected:', socket.id);
  });
});

// ============ ROUTES ============
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/support', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'support.html'));
});

app.get('/blazesupport', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ============ START SERVER ============
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📱 Landing: http://localhost:${PORT}`);
  console.log(`💬 Support: http://localhost:${PORT}/support`);
  console.log(`🔐 Admin: http://localhost:${PORT}/blazesupport`);
});