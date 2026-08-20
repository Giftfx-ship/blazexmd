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
  email: { type: String, default: '' },
  name: { type: String, default: 'Guest' },
  message: { type: String, required: true },
  isFromAdmin: { type: Boolean, default: false },
  adminName: { type: String, default: 'Support Team' },
  isRead: { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now }
});

// ✅ Chat Session Schema - Stores every user session by email
const ChatSessionSchema = new mongoose.Schema({
  visitorId: { type: String, required: true, unique: true },
  email: { type: String, required: true, index: true },
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

// ✅ Get or create session by email
app.post('/api/chat/session', async (req, res) => {
  try {
    const { email, name } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }
    
    // Generate visitor ID from email
    const visitorId = 'user_' + email.replace(/[^a-zA-Z0-9]/g, '_');
    
    let session = await ChatSession.findOne({ visitorId });
    
    if (!session) {
      session = await ChatSession.create({
        visitorId,
        email: email.toLowerCase(),
        name: name || email.split('@')[0] || 'Guest',
        isActive: true,
        lastMessageAt: new Date(),
        unreadCount: 0,
        totalMessages: 0
      });
      console.log(`✅ New session created: ${email} (${visitorId})`);
    } else {
      if (name && session.name === 'Guest') {
        session.name = name;
        await session.save();
      }
    }
    
    res.json({ session, visitorId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ Get messages by visitorId
app.get('/api/chat/messages/:visitorId', async (req, res) => {
  try {
    const { visitorId } = req.params;
    const messages = await ChatMessage.find({ visitorId }).sort({ timestamp: 1 });
    const session = await ChatSession.findOne({ visitorId });
    res.json({ messages, session });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ Send message (visitor)
app.post('/api/chat/send', async (req, res) => {
  try {
    const { visitorId, name, email, message } = req.body;
    
    if (!visitorId || !message) {
      return res.status(400).json({ error: 'visitorId and message required' });
    }
    
    const newMessage = await ChatMessage.create({
      visitorId,
      name: name || 'Guest',
      email: email || '',
      message,
      isFromAdmin: false,
      isRead: false
    });
    
    const session = await ChatSession.findOneAndUpdate(
      { visitorId },
      {
        $set: { 
          lastMessageAt: new Date(), 
          name: name || 'Guest',
          email: email || '',
          isActive: true 
        },
        $inc: { unreadCount: 1, totalMessages: 1 }
      },
      { upsert: true, new: true }
    );
    
    // Emit to admin
    io.emit('new-message', {
      visitorId,
      name: name || 'Guest',
      email: email || '',
      message,
      timestamp: newMessage.timestamp,
      isFromAdmin: false,
      session
    });
    
    // Emit unread count
    const unreadCount = await ChatMessage.countDocuments({ isRead: false, isFromAdmin: false });
    io.emit('unread-update', { unread: unreadCount });
    
    res.json({ success: true, message: newMessage, session });
  } catch (error) {
    console.error('❌ Error sending message:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ ADMIN CHAT ROUTES ============

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
    
    // Mark messages as read
    await ChatMessage.updateMany(
      { visitorId, isRead: false },
      { isRead: true }
    );
    
    await ChatSession.findOneAndUpdate(
      { visitorId },
      { unreadCount: 0 }
    );
    
    const session = await ChatSession.findOne({ visitorId });
    
    const unreadCount = await ChatMessage.countDocuments({ isRead: false, isFromAdmin: false });
    io.emit('unread-update', { unread: unreadCount });
    
    res.json({ messages, session });
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

// ✅ Admin reply
app.post('/api/admin/reply', authenticate, async (req, res) => {
  try {
    const { visitorId, message } = req.body;
    
    if (!visitorId || !message) {
      return res.status(400).json({ error: 'visitorId and message required' });
    }
    
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
        $set: { lastMessageAt: new Date(), isActive: true },
        $inc: { totalMessages: 1 }
      }
    );
    
    // ✅ Emit to visitor's room
    io.to(visitorId).emit('admin-reply', {
      message,
      adminName,
      timestamp: newMessage.timestamp
    });
    
    res.json({ success: true, message: newMessage });
  } catch (error) {
    console.error('❌ Error sending admin reply:', error);
    res.status(500).json({ error: error.message });
  }
});

// ✅ Delete single message (admin only)
app.delete('/api/admin/message/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const message = await ChatMessage.findById(id);
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }
    
    const visitorId = message.visitorId;
    await ChatMessage.findByIdAndDelete(id);
    
    const totalMessages = await ChatMessage.countDocuments({ visitorId });
    await ChatSession.findOneAndUpdate(
      { visitorId },
      { totalMessages: totalMessages }
    );
    
    io.emit('message-deleted', { 
      messageId: id, 
      visitorId: visitorId
    });
    
    res.json({ success: true, message: 'Message deleted' });
  } catch (error) {
    console.error('❌ Error deleting message:', error);
    res.status(500).json({ error: error.message });
  }
});

// ✅ Clear all messages for a session (admin only)
app.delete('/api/admin/session/:visitorId/messages', authenticate, async (req, res) => {
  try {
    const { visitorId } = req.params;
    const result = await ChatMessage.deleteMany({ visitorId });
    
    await ChatSession.findOneAndUpdate(
      { visitorId },
      { totalMessages: 0, unreadCount: 0 }
    );
    
    io.emit('session-cleared', { visitorId });
    
    res.json({ 
      success: true, 
      message: `Cleared ${result.deletedCount} messages`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('❌ Error clearing messages:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ SOCKET.IO ============
io.on('connection', (socket) => {
  console.log('🔌 New connection:', socket.id);

  socket.on('join-room', (visitorId) => {
    socket.join(visitorId);
    console.log(`👤 ${visitorId} joined room`);
  });

  socket.on('visitor-message', async (data) => {
    try {
      const { visitorId, name, email, message } = data;
      if (!visitorId || !message) return;
      
      const newMessage = await ChatMessage.create({
        visitorId,
        name: name || 'Guest',
        email: email || '',
        message,
        isFromAdmin: false,
        isRead: false
      });
      
      const session = await ChatSession.findOneAndUpdate(
        { visitorId },
        {
          $set: { lastMessageAt: new Date(), name: name || 'Guest', email: email || '', isActive: true },
          $inc: { unreadCount: 1, totalMessages: 1 }
        },
        { upsert: true, new: true }
      );
      
      io.emit('new-message', {
        visitorId,
        name: name || 'Guest',
        email: email || '',
        message,
        timestamp: newMessage.timestamp,
        isFromAdmin: false,
        session
      });
      
      const unreadCount = await ChatMessage.countDocuments({ isRead: false, isFromAdmin: false });
      io.emit('unread-update', { unread: unreadCount });
      
    } catch (error) {
      console.error('❌ Socket error:', error);
    }
  });

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