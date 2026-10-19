const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const connectDB = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const chatRoutes = require('./routes/chatRoutes');
const messageRoutes = require('./routes/messageRoutes');
const callRoutes = require('./routes/callRoutes'); // 📞 Import call routes
const Message = require('./models/Message'); 
const User = require('./models/User'); 
const Conversation = require('./models/Conversation');
const mongoose = require('mongoose');

const app = express();

// Middleware with increased payload limits for avatar images
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Database connection
connectDB();

// REST API endpoints
app.get('/', (req, res) => {
    res.send('API Server is running...');
});

// Mounted routes
app.use('/api/auth', authRoutes);
app.use('/api/users', authRoutes); 
app.use('/api/chats', chatRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/calls', callRoutes); // 📞 Mount call history endpoints

// Create HTTP & Socket.IO server
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

io.use((socket, next) => {
    try {
        const token = socket.handshake.auth?.token;
        if (!token) {
            return next(new Error('Not authorized'));
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded._id || decoded.id;
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return next(new Error('Not authorized'));
        }

        socket.userId = String(userId);
        return next();
    } catch {
        return next(new Error('Not authorized'));
    }
});

// Bind io to express app so REST controllers can trigger socket emissions
app.set('io', io);

// Store connected online users: Map(userId -> Set<socketId>)
const onlineUsers = new Map();
const activeCalls = new Map();

// Socket.IO Connection Handler
io.on('connection', (socket) => {
    console.log('User connected to socket:', socket.id);
    socket.join(`user:${socket.userId}`);
    const isAuthorizedRoom = async (room) => {
        if (!mongoose.Types.ObjectId.isValid(room) || !socket.rooms.has(String(room))) {
            return false;
        }
        return Boolean(await Conversation.exists({ _id: room, members: socket.userId }));
    };
    let authenticatedUserPromise;

    // Register user
    socket.on('setup_user', async () => {
        if (socket.userId) {
            const uidStr = socket.userId;
            const userSockets = onlineUsers.get(uidStr) || new Set();
            const wasOnline = userSockets.size > 0;
            userSockets.add(socket.id);
            onlineUsers.set(uidStr, userSockets);
            if (!wasOnline) {
                const lastSeen = new Date();
                try {
                    await User.findByIdAndUpdate(uidStr, { isOnline: true });
                } catch (error) {
                    console.error('Failed to update online status:', error);
                }
                io.emit('user_status_change', {
                    userId: uidStr,
                    isOnline: true,
                    lastSeen,
                });
            }

            io.emit('get_online_users', Array.from(onlineUsers.keys()));
        }
    });

    // Join chat room
    socket.on('join_room', async (room) => {
        try {
            if (
                mongoose.Types.ObjectId.isValid(room) &&
                await Conversation.exists({ _id: room, members: socket.userId })
            ) {
                socket.join(String(room));
            }
        } catch (error) {
            console.error('Failed to authorize conversation room join:', error);
        }
    });

    // Add / Toggle Emoji Reaction Event
    socket.on('add_reaction', async ({ messageId, emoji, conversationId }) => {
        try {
            if (
                !mongoose.Types.ObjectId.isValid(conversationId) ||
                !socket.rooms.has(String(conversationId)) ||
                !await Conversation.exists({ _id: conversationId, members: socket.userId })
            ) {
                return;
            }

            const message = await Message.findOne({ _id: messageId, conversationId });
            if (!message || typeof emoji !== 'string' || !emoji) return;

            const existingIndex = message.reactions.findIndex(
                (r) => r.user.toString() === socket.userId
            );

            if (existingIndex > -1) {
                if (message.reactions[existingIndex].emoji === emoji) {
                    message.reactions.splice(existingIndex, 1);
                } else {
                    message.reactions[existingIndex].emoji = emoji;
                }
            } else {
                message.reactions.push({ user: socket.userId, emoji });
            }

            await message.save();

            const updatedMessage = await Message.findById(messageId)
                .populate('sender', 'name username avatar')
                .populate('reactions.user', 'name username');

            io.to(conversationId).emit('message_updated', updatedMessage);
            socket.to(conversationId).emit('message_updated', updatedMessage);
        } catch (err) {
            console.error('Error handling reaction:', err);
        }
    });

    // Typing indicators
    socket.on('typing', async ({ room } = {}) => {
        try {
            if (await isAuthorizedRoom(room)) {
                authenticatedUserPromise ||= User.findById(socket.userId).select('username').lean();
                const user = await authenticatedUserPromise;
                if (user) {
                    socket.to(String(room)).emit('typing', { room, username: user.username });
                }
            }
        } catch (error) {
            console.error('Failed to authorize typing event:', error);
        }
    });

    socket.on('stop_typing', async ({ room } = {}) => {
        try {
            if (await isAuthorizedRoom(room)) {
                socket.to(String(room)).emit('stop_typing', { room });
            }
        } catch (error) {
            console.error('Failed to authorize stop-typing event:', error);
        }
    });

    // Disconnect Handler
    socket.on('disconnect', async () => {
        console.log('User disconnected from socket:', socket.id);
        
        const disconnectedUserId = socket.userId;
        for (const [callId, call] of activeCalls.entries()) {
            if (call.callerSocketId === socket.id) {
                io.to(`user:${call.targetId}`).emit('call_ended', { callId, status: 'missed' });
                activeCalls.delete(callId);
            } else if (call.targetSocketId === socket.id) {
                io.to(call.callerSocketId).emit('call_ended', { callId, status: 'missed' });
                activeCalls.delete(callId);
            }
        }

        if (disconnectedUserId) {
            const userSockets = onlineUsers.get(disconnectedUserId);
            userSockets?.delete(socket.id);
            if (userSockets?.size) return;
            onlineUsers.delete(disconnectedUserId);
            const lastSeenTime = new Date();

            try {
                await User.findByIdAndUpdate(disconnectedUserId, {
                    isOnline: false,
                    lastSeen: lastSeenTime,
                });
            } catch (err) {
                console.error('Failed to update lastSeen in DB:', err);
            }

            io.emit('get_online_users', Array.from(onlineUsers.keys()));
            io.emit('user_status_change', {
                userId: disconnectedUserId,
                isOnline: false,
                lastSeen: lastSeenTime
            });
        }
    });

    // 📞 User initiates a call (Signaling relay)
    socket.on('call_user', ({ callId, userToCall, signalData, callType, name, avatar }) => {
        const targetId = String(userToCall || '');
        const callerId = socket.userId;
        const targetRoom = `user:${targetId}`;
        const targetIsOnline = io.sockets.adapter.rooms.get(targetRoom)?.size > 0;
        if (!callId || !targetIsOnline || !callerId || targetId === callerId) {
            if (callId) socket.emit('call_ended', { callId, status: 'missed' });
            return;
        }

        activeCalls.set(callId, {
            callerId,
            targetId,
            callerSocketId: socket.id,
            targetSocketId: null,
            accepted: false,
        });

        io.to(targetRoom).emit('incoming_call', {
            callId,
            signal: signalData,
            from: callerId,
            callType,
            name,
            avatar
        });
    });

    // User answers an incoming call (Relays answer signal back to caller)
    socket.on('answer_call', (data) => {
        const call = activeCalls.get(data?.callId);
        if (!call || call.targetId !== socket.userId || call.accepted) return;
        call.accepted = true;
        call.targetSocketId = socket.id;
        io.to(call.callerSocketId).emit('call_accepted', {
            callId: data.callId,
            signal: data.signal,
        });
    });

    // Handle call hangup / rejection
    socket.on('hang_up', ({ callId, status }) => {
        const call = activeCalls.get(callId);
        if (!call) return;
        const isCaller = call.callerId === socket.userId && call.callerSocketId === socket.id;
        const isTarget = call.targetId === socket.userId;
        if (!isCaller && !isTarget) return;
        const otherPartyRoom = isCaller ? `user:${call.targetId}` : null;
        if (otherPartyRoom) {
            io.to(otherPartyRoom).emit('call_ended', { callId, status });
        } else {
            io.to(call.callerSocketId).emit('call_ended', { callId, status });
        }
        activeCalls.delete(callId);
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));