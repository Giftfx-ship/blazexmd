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

app.use(helmet({
    contentSecurityPolicy: false,
}));
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log('MongoDB Connected Successfully'))
.catch(err => console.error('MongoDB Connection Error:', err));

// ============ MODELS ============

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

const AdminSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    isOnline: { type: Boolean, default: false },
    lastActive: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now }
});

const SupportNumberSchema = new mongoose.Schema({
    name: { type: String, required: true },
    country: { type: String, required: true },
    flag: { type: String, required: true },
    number: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    priority: { type: Number, default: 1 },
    whatsappLink: { type: String, default: '' }
});

const BotFeatureSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String, required: true },
    icon: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    priority: { type: Number, default: 1 }
});

const Message = mongoose.model('Message', MessageSchema);
const Admin = mongoose.model('Admin', AdminSchema);
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
            console.log('Admin user created successfully');
        }
    } catch (error) {
        console.error('Error creating admin:', error);
    }
}

async function initializeFeatures() {
    try {
        const count = await BotFeature.countDocuments();
        if (count === 0) {
            const features = [
                { 
                    name: 'Auto View Status', 
                    description: 'Automatically views all WhatsApp statuses from your contacts', 
                    icon: 'fa-eye',
                    priority: 1 
                },
                { 
                    name: 'Anti-Delete', 
                    description: 'View deleted messages instantly even after sender removes them', 
                    icon: 'fa-trash-alt',
                    priority: 2 
                },
                { 
                    name: 'Auto-Reply', 
                    description: 'Smart automated replies to messages with custom responses', 
                    icon: 'fa-robot',
                    priority: 3 
                },
                { 
                    name: 'Group Management', 
                    description: 'Auto-moderation and group management tools', 
                    icon: 'fa-users',
                    priority: 4 
                },
                { 
                    name: 'Broadcast', 
                    description: 'Send messages to all contacts with one click', 
                    icon: 'fa-bullhorn',
                    priority: 5 
                },
                { 
                    name: 'Download Media', 
                    description: 'Save statuses, images, videos and more', 
                    icon: 'fa-download',
                    priority: 6 
                },
                { 
                    name: 'Voice Notes', 
                    description: 'Auto-transcribe voice notes to text', 
                    icon: 'fa-microphone',
                    priority: 7 
                }
            ];
            await BotFeature.insertMany(features);
            console.log('Bot features initialized');
        }
    } catch (error) {
        console.error('Error initializing features:', error);
    }
}

initializeAdmin();
initializeFeatures();

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

app.get('/api/support/numbers', async (req, res) => {
    try {
        const numbers = await SupportNumber.find({ isActive: true })
            .sort({ priority: 1 });
        res.json(numbers);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/features', async (req, res) => {
    try {
        const features = await BotFeature.find({ isActive: true })
            .sort({ priority: 1 });
        res.json(features);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

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

app.get('/api/pair/redirect', (req, res) => {
    res.json({ 
        url: process.env.PAIR_SITE_URL || 'https://blaze.zone.id'
    });
});

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

app.get('/api/admin/stats', authenticateAdmin, async (req, res) => {
    try {
        const totalMessages = await Message.countDocuments({ isDeleted: false });
        const totalUsers = await Message.distinct('userId');
        const admin = await Admin.findOne({ username: process.env.ADMIN_USERNAME });

        res.json({
            totalMessages,
            totalUsers: totalUsers.length,
            adminOnline: admin?.isOnline || false
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/support/numbers', authenticateAdmin, async (req, res) => {
    try {
        const { name, country, flag, number, priority, whatsappLink } = req.body;
        
        if (!name || !country || !flag || !number) {
            return res.status(400).json({ error: 'Name, country, flag and number required' });
        }

        const newNumber = new SupportNumber({
            name,
            country,
            flag,
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

app.delete('/api/admin/support/numbers/:id', authenticateAdmin, async (req, res) => {
    try {
        await SupportNumber.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

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
    console.log('New client connected:', socket.id);

    socket.on('join', (userId) => {
        socket.join(userId);
        console.log('User joined room:', userId);
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
        console.log('Client disconnected:', socket.id);
    });
});

// ============ SERVE FRONTEND ============
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/blazesupportlol', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'blazesupportlol.html'));
});

// ============ START SERVER ============
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('Blaze XMD Server running on port', PORT);
    console.log('Visit: http://localhost:' + PORT);
    console.log('Admin: http://localhost:' + PORT + '/blazesupportlol');
});