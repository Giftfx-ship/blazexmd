const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// ============ MIDDLEWARE ============
app.use(helmet({
    contentSecurityPolicy: false,
}));
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ============ MONGODB CONNECTION ============
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log('✅ MongoDB Connected Successfully'))
.catch(err => console.error('❌ MongoDB Connection Error:', err));

// ============ MODELS ============

// Chat Message Schema
const MessageSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    userName: { type: String, required: true },
    userEmail: { type: String, default: '' },
    message: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    isRead: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
    isAdminReply: { type: Boolean, default: false },
    room: { type: String, default: 'general' }
});

// Admin Schema
const AdminSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    isOnline: { type: Boolean, default: false },
    lastActive: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now }
});

// Pair Schema (WhatsApp Pairing)
const PairSchema = new mongoose.Schema({
    pairId: { type: String, required: true, unique: true },
    userId: { type: String, required: true },
    userName: { type: String, default: '' },
    phoneNumber: { type: String, default: '' },
    status: { type: String, enum: ['active', 'inactive', 'expired', 'pending'], default: 'pending' },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    deviceName: { type: String, default: 'WhatsApp Device' },
    autoViewStatus: { type: Boolean, default: true },
    antiDelete: { type: Boolean, default: true },
    autoReply: { type: Boolean, default: false }
});

// Support Number Schema
const SupportNumberSchema = new mongoose.Schema({
    country: { type: String, required: true },
    number: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    priority: { type: Number, default: 1 },
    whatsappLink: { type: String, default: '' }
});

// Bot Feature Schema
const BotFeatureSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String, required: true },
    icon: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    priority: { type: Number, default: 1 }
});

const Message = mongoose.model('Message', MessageSchema);
const Admin = mongoose.model('Admin', AdminSchema);
const Pair = mongoose.model('Pair', PairSchema);
const SupportNumber = mongoose.model('SupportNumber', SupportNumberSchema);
const BotFeature = mongoose.model('BotFeature', BotFeatureSchema);

// ============ INITIALIZE DATA ============

async function initializeAdmin() {
    try {
        const adminExists = await Admin.findOne({ username: process.env.ADMIN_USERNAME });
        if (!adminExists) {
            const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
            const admin = new Admin({
                username: process.env.ADMIN_USERNAME,
                password: hashedPassword,
                isOnline: false
            });
            await admin.save();
            console.log('✅ Admin user created successfully');
        }
    } catch (error) {
        console.error('❌ Error creating admin:', error);
    }
}

async function initializeFeatures() {
    try {
        const count = await BotFeature.countDocuments();
        if (count === 0) {
            const features = [
                { 
                    name: '👁️ Auto View Status', 
                    description: 'Automatically views all WhatsApp statuses from your contacts - never miss a status update!', 
                    icon: 'fa-eye',
                    priority: 1 
                },
                { 
                    name: '🗑️ Anti-Delete', 
                    description: 'Never miss deleted messages - view them instantly even after sender deletes', 
                    icon: 'fa-trash-alt',
                    priority: 2 
                },
                { 
                    name: '🤖 Auto-Reply', 
                    description: 'Smart AI-powered auto-replies to your messages with natural language processing', 
                    icon: 'fa-robot',
                    priority: 3 
                },
                { 
                    name: '📱 Pair System', 
                    description: 'Easily pair your WhatsApp device with Blaze XMD in seconds', 
                    icon: 'fa-link',
                    priority: 4 
                },
                { 
                    name: '👥 Group Management', 
                    description: 'Auto-moderation and group management tools for admins', 
                    icon: 'fa-users',
                    priority: 5 
                },
                { 
                    name: '📨 Broadcast', 
                    description: 'Send bulk messages to all your contacts with one click', 
                    icon: 'fa-bullhorn',
                    priority: 6 
                },
                { 
                    name: '📥 Download Media', 
                    description: 'Save statuses, images, videos and more directly to your device', 
                    icon: 'fa-download',
                    priority: 7 
                },
                { 
                    name: '🎙️ Voice Notes', 
                    description: 'Auto-transcribe voice notes to text for easy reading', 
                    icon: 'fa-microphone',
                    priority: 8 
                }
            ];
            await BotFeature.insertMany(features);
            console.log('✅ Bot features initialized');
        }
    } catch (error) {
        console.error('❌ Error initializing features:', error);
    }
}

async function initializeSupportNumbers() {
    try {
        const count = await SupportNumber.countDocuments();
        if (count === 0) {
            const numbers = [
                { 
                    country: '🇺🇸 USA', 
                    number: '+1 (555) 123-4567', 
                    priority: 1,
                    whatsappLink: 'https://wa.me/15551234567'
                },
                { 
                    country: '🇬🇧 UK', 
                    number: '+44 20 7946 0958', 
                    priority: 2,
                    whatsappLink: 'https://wa.me/442079460958'
                },
                { 
                    country: '🇳🇬 Nigeria', 
                    number: '+234 803 456 7890', 
                    priority: 3,
                    whatsappLink: 'https://wa.me/2348034567890'
                },
                { 
                    country: '🇮🇳 India', 
                    number: '+91 98765 43210', 
                    priority: 4,
                    whatsappLink: 'https://wa.me/919876543210'
                },
                { 
                    country: '🇧🇷 Brazil', 
                    number: '+55 11 98765-4321', 
                    priority: 5,
                    whatsappLink: 'https://wa.me/5511987654321'
                }
            ];
            await SupportNumber.insertMany(numbers);
            console.log('✅ Support numbers initialized');
        }
    } catch (error) {
        console.error('❌ Error initializing support numbers:', error);
    }
}

initializeAdmin();
initializeFeatures();
initializeSupportNumbers();

// ============ AUTH MIDDLEWARE ============
const authenticateAdmin = async (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const admin = await Admin.findById(decoded.id);
        if (!admin) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        req.admin = admin;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid token' });
    }
};

// ============ API ROUTES ============

// Admin Login
app.post('/api/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const admin = await Admin.findOne({ username });

        if (!admin) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const isValidPassword = await bcrypt.compare(password, admin.password);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { id: admin._id, username: admin.username },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            success: true,
            token,
            admin: {
                id: admin._id,
                username: admin.username,
                isOnline: admin.isOnline
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get Support Numbers
app.get('/api/support/numbers', async (req, res) => {
    try {
        const numbers = await SupportNumber.find({ isActive: true })
            .sort({ priority: 1 });
        res.json(numbers);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get Bot Features
app.get('/api/features', async (req, res) => {
    try {
        const features = await BotFeature.find({ isActive: true })
            .sort({ priority: 1 });
        res.json(features);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get Admin Status
app.get('/api/admin/status', async (req, res) => {
    try {
        const admin = await Admin.findOne({ username: process.env.ADMIN_USERNAME });
        res.json({
            isOnline: admin?.isOnline || false,
            lastActive: admin?.lastActive
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Generate Pair ID
app.post('/api/pair/generate', async (req, res) => {
    try {
        const { userId, userName, phoneNumber } = req.body;
        
        const pairId = 'BLZ-' + Date.now().toString(36).toUpperCase() + '-' + 
                       Math.random().toString(36).substring(2, 6).toUpperCase();
        
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);

        const pair = new Pair({
            pairId,
            userId: userId || 'guest_' + Date.now(),
            userName: userName || 'Guest',
            phoneNumber: phoneNumber || '',
            status: 'pending',
            expiresAt,
            autoViewStatus: true,
            antiDelete: true
        });

        await pair.save();

        res.json({
            success: true,
            pairId,
            pair,
            message: 'Pair ID generated successfully! Use this to connect your WhatsApp.'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all pairs
app.get('/api/pairs', async (req, res) => {
    try {
        const pairs = await Pair.find().sort({ createdAt: -1 });
        res.json(pairs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get pair status
app.get('/api/pair/status/:pairId', async (req, res) => {
    try {
        const pair = await Pair.findOne({ pairId: req.params.pairId });
        if (!pair) {
            return res.status(404).json({ error: 'Pair not found' });
        }
        res.json({
            status: pair.status,
            pairId: pair.pairId,
            userName: pair.userName,
            autoViewStatus: pair.autoViewStatus,
            antiDelete: pair.antiDelete
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ ADMIN PROTECTED ROUTES ============

// Get all messages
app.get('/api/admin/messages', authenticateAdmin, async (req, res) => {
    try {
        const { page = 1, limit = 50 } = req.query;
        const skip = (page - 1) * limit;

        const messages = await Message.find({ isDeleted: false })
            .sort({ timestamp: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Message.countDocuments({ isDeleted: false });

        res.json({
            messages,
            total,
            page: parseInt(page),
            totalPages: Math.ceil(total / limit)
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Send admin reply
app.post('/api/admin/reply', authenticateAdmin, async (req, res) => {
    try {
        const { userId, message } = req.body;

        if (!userId || !message) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const newMessage = new Message({
            userId,
            userName: 'Admin',
            userEmail: 'admin@blazexmd.com',
            message,
            isAdminReply: true,
            isRead: true
        });

        await newMessage.save();

        io.to(userId).emit('admin-reply', {
            message: newMessage,
            timestamp: newMessage.timestamp
        });

        res.json({
            success: true,
            message: newMessage
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete message
app.delete('/api/admin/message/:id', authenticateAdmin, async (req, res) => {
    try {
        const message = await Message.findById(req.params.id);
        if (!message) {
            return res.status(404).json({ error: 'Message not found' });
        }

        message.isDeleted = true;
        await message.save();

        res.json({ success: true, message: 'Message deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Toggle admin online status
app.put('/api/admin/status', authenticateAdmin, async (req, res) => {
    try {
        const { isOnline } = req.body;
        const admin = await Admin.findById(req.admin._id);
        admin.isOnline = isOnline;
        admin.lastActive = new Date();
        await admin.save();

        io.emit('admin-status-change', { isOnline });

        res.json({ success: true, isOnline });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get stats
app.get('/api/admin/stats', authenticateAdmin, async (req, res) => {
    try {
        const totalMessages = await Message.countDocuments({ isDeleted: false });
        const totalUsers = await Message.distinct('userId');
        const totalPairs = await Pair.countDocuments({ status: 'active' });
        const pendingPairs = await Pair.countDocuments({ status: 'pending' });
        const admin = await Admin.findOne({ username: process.env.ADMIN_USERNAME });

        res.json({
            totalMessages,
            totalUsers: totalUsers.length,
            totalPairs,
            pendingPairs,
            adminOnline: admin?.isOnline || false
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add support number
app.post('/api/admin/support/numbers', authenticateAdmin, async (req, res) => {
    try {
        const { country, number, priority, whatsappLink } = req.body;
        
        if (!country || !number) {
            return res.status(400).json({ error: 'Country and number required' });
        }

        const newNumber = new SupportNumber({
            country,
            number,
            priority: priority || 1,
            whatsappLink: whatsappLink || `https://wa.me/${number.replace(/[^0-9]/g, '')}`
        });

        await newNumber.save();
        res.json({ success: true, number: newNumber });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete support number
app.delete('/api/admin/support/numbers/:id', authenticateAdmin, async (req, res) => {
    try {
        await SupportNumber.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update pair status
app.put('/api/admin/pair/:pairId', authenticateAdmin, async (req, res) => {
    try {
        const { status } = req.body;
        const pair = await Pair.findOneAndUpdate(
            { pairId: req.params.pairId },
            { status },
            { new: true }
        );
        if (!pair) {
            return res.status(404).json({ error: 'Pair not found' });
        }
        res.json({ success: true, pair });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete pair
app.delete('/api/admin/pair/:pairId', authenticateAdmin, async (req, res) => {
    try {
        await Pair.findOneAndDelete({ pairId: req.params.pairId });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update bot feature
app.put('/api/admin/feature/:id', authenticateAdmin, async (req, res) => {
    try {
        const { isActive } = req.body;
        const feature = await BotFeature.findByIdAndUpdate(
            req.params.id,
            { isActive },
            { new: true }
        );
        if (!feature) {
            return res.status(404).json({ error: 'Feature not found' });
        }
        res.json({ success: true, feature });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ SOCKET.IO ============
io.on('connection', (socket) => {
    console.log('🟢 New client connected:', socket.id);

    socket.on('join', (userId) => {
        socket.join(userId);
        console.log(`📌 User ${userId} joined room`);
    });

    socket.on('send-message', async (data) => {
        try {
            const { userId, userName, userEmail, message } = data;
            
            const newMessage = new Message({
                userId,
                userName,
                userEmail,
                message,
                timestamp: new Date()
            });

            await newMessage.save();

            io.emit('new-message', newMessage);
            socket.emit('message-sent', newMessage);
        } catch (error) {
            console.error('Error saving message:', error);
        }
    });

    socket.on('disconnect', () => {
        console.log('🔴 Client disconnected:', socket.id);
    });
});

// ============ SERVE FRONTEND ============
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Admin URL: /blazesupportlol
app.get('/blazesupportlol', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ============ START SERVER ============
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🔥 Blaze XMD Server running on port ${PORT}`);
    console.log(`📍 Visit: http://localhost:${PORT}`);
    console.log(`📍 Admin: http://localhost:${PORT}/blazesupportlol`);
});