const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const connectDB = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const chatRoutes = require('./routes/chatRoutes');
const messageRoutes = require('./routes/messageRoutes');
const callRoutes = require('./routes/callRoutes'); // 📞 Import call routes
const Message = require('./models/Message'); 
const User = require('./models/User'); 

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

// Bind io to express app so REST controllers can trigger socket emissions
app.set('io', io);

// Store connected online users: Map(userId -> Set<socketId>)
const onlineUsers = new Map();
const activeCalls = new Map();

// Socket.IO Connection Handler
io.on('connection', (socket) => {
    console.log('User connected to socket:', socket.id);

    // Register user
    socket.on('setup_user', (userId) => {
        if (userId) {
            const uidStr = String(userId);
            socket.userId = uidStr;
            const userSockets = onlineUsers.get(uidStr) || new Set();
            userSockets.add(socket.id);
            onlineUsers.set(uidStr, userSockets);
            socket.join(`user:${uidStr}`);
            
            // Broadcast online list and online status update
            io.emit('get_online_users', Array.from(onlineUsers.keys()));
            io.emit('user_status_change', {
                userId: uidStr,
                isOnline: true,
                lastSeen: new Date()
            });
        }
    });

    // Join chat room
    socket.on('join_room', (room) => {
        socket.join(room);
    });

    // Send message
    socket.on('send_message', (newMessage) => {
        const conversationId = typeof newMessage.conversationId === 'object' 
            ? newMessage.conversationId._id 
            : newMessage.conversationId;

        if (conversationId) {
            socket.broadcast.to(conversationId).emit('receive_message', newMessage);
        }
    });

    // Delete message event
    socket.on('delete_message', ({ messageId, conversationId }) => {
        if (conversationId && messageId) {
            socket.to(conversationId).emit('message_deleted', { messageId });
        }
    });

    // Edit message event
    socket.on('edit_message', (updatedMsg) => {
        const conversationId = typeof updatedMsg.conversationId === 'object' 
            ? updatedMsg.conversationId._id 
            : updatedMsg.conversationId;

        if (conversationId) {
            socket.to(conversationId).emit('message_edited', updatedMsg);
        }
    });

    // Add / Toggle Emoji Reaction Event
    socket.on('add_reaction', async ({ messageId, emoji, userId, conversationId }) => {
        try {
            const message = await Message.findById(messageId);
            if (!message) return;

            const existingIndex = message.reactions.findIndex(
                (r) => r.user.toString() === userId.toString()
            );

            if (existingIndex > -1) {
                if (message.reactions[existingIndex].emoji === emoji) {
                    message.reactions.splice(existingIndex, 1);
                } else {
                    message.reactions[existingIndex].emoji = emoji;
                }
            } else {
                message.reactions.push({ user: userId, emoji });
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
    socket.on('typing', ({ room, username }) => {
        if (room) {
            socket.to(room).emit('typing', { room, username });
        }
    });

    socket.on('stop_typing', ({ room }) => {
        if (room) {
            socket.to(room).emit('stop_typing', { room });
        }
    });

    // Broadcast read receipt when opening a chat room
    socket.on('mark_chat_as_read', ({ conversationId, userId }) => {
        if (conversationId) {
            io.in(conversationId).emit('chat_marked_read', { conversationId, userId });
            socket.to(conversationId).emit('chat_marked_read', { conversationId, userId });
        }
    });

    // Single message read listener
    socket.on('mark_as_read', ({ messageId, conversationId, userId }) => {
        if (conversationId) {
            socket.in(conversationId).emit('message_read', { messageId, userId });
        }
    });

    // Disconnect Handler
    socket.on('disconnect', async () => {
        console.log('User disconnected from socket:', socket.id);
        
        const disconnectedUserId = socket.userId;
        for (const [callId, call] of activeCalls.entries()) {
            if (call.callerSocketId === socket.id || call.targetSocketId === socket.id) {
                const otherSocketId = call.callerSocketId === socket.id
                    ? call.targetSocketId
                    : call.callerSocketId;
                io.to(otherSocketId).emit('call_ended', { callId, status: 'missed' });
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
                await User.findByIdAndUpdate(disconnectedUserId, { lastSeen: lastSeenTime });
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
    socket.on('call_user', ({ callId, userToCall, signalData, from, callType, name, avatar }) => {
        const targetId = String(userToCall || '');
        const callerId = socket.userId || String(from || '');
        const targetSocketIds = onlineUsers.get(targetId);
        const targetSocketId = targetSocketIds ? Array.from(targetSocketIds).at(-1) : null;
        if (!callId || !targetSocketId || !callerId) {
            if (callId) socket.emit('call_ended', { callId, status: 'missed' });
            return;
        }

        activeCalls.set(callId, {
            callerId,
            targetId,
            callerSocketId: socket.id,
            targetSocketId,
            accepted: false,
        });

        if (targetSocketId) {
            io.to(targetSocketId).emit('incoming_call', {
                callId,
                signal: signalData,
                from: callerId,
                callType,
                name,
                avatar 
            });
        }
    });

    // User answers an incoming call (Relays answer signal back to caller)
    socket.on('answer_call', (data) => {
        const call = activeCalls.get(data.callId);
        if (!call || call.targetSocketId !== socket.id || call.accepted) return;
        call.accepted = true;
        io.to(call.callerSocketId).emit('call_accepted', {
            callId: data.callId,
            signal: data.signal,
        });
    });

    // Handle call hangup / rejection
    socket.on('hang_up', ({ callId, status }) => {
        const call = activeCalls.get(callId);
        if (!call) return;
        const targetSocketId = call.callerSocketId === socket.id
            ? call.targetSocketId
            : call.targetSocketId === socket.id
                ? call.callerSocketId
                : null;
        if (!targetSocketId) return;
        io.to(targetSocketId).emit('call_ended', { callId, status });
        activeCalls.delete(callId);
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));