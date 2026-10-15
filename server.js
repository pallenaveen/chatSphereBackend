const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const connectDB = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const chatRoutes = require('./routes/chatRoutes');
const messageRoutes = require('./routes/messageRoutes');
const Message = require('./models/Message'); // Ensure Message model is imported
const User = require('./models/User'); // Imported User model for lastSeen tracking

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

// Store connected online users: Map(userId -> socketId)
const onlineUsers = new Map();

// Socket.IO Connection Handler
io.on('connection', (socket) => {
    console.log('User connected to socket:', socket.id);

    // Register user
    socket.on('setup_user', (userId) => {
        if (userId) {
            const uidStr = String(userId);
            socket.userId = uidStr; // Bind userId to socket instance
            onlineUsers.set(uidStr, socket.id);
            
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

            // Check if user has already reacted
            const existingIndex = message.reactions.findIndex(
                (r) => r.user.toString() === userId.toString()
            );

            if (existingIndex > -1) {
                if (message.reactions[existingIndex].emoji === emoji) {
                    // Toggle off if clicking the same emoji
                    message.reactions.splice(existingIndex, 1);
                } else {
                    // Switch emoji if clicking a different one
                    message.reactions[existingIndex].emoji = emoji;
                }
            } else {
                // Add new reaction
                message.reactions.push({ user: userId, emoji });
            }

            await message.save();

            // Populate user details for frontend rendering
            const updatedMessage = await Message.findById(messageId)
                .populate('sender', 'name username avatar')
                .populate('reactions.user', 'name username');

            // Broadcast update to the room
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
        
        let disconnectedUserId = socket.userId;

        // Fallback search if socket.userId was not set directly
        if (!disconnectedUserId) {
            for (let [uId, sId] of onlineUsers.entries()) {
                if (sId === socket.id) {
                    disconnectedUserId = uId;
                    break;
                }
            }
        }

        if (disconnectedUserId) {
            onlineUsers.delete(disconnectedUserId);
            const lastSeenTime = new Date();

            // Persist lastSeen to MongoDB
            try {
                await User.findByIdAndUpdate(disconnectedUserId, { lastSeen: lastSeenTime });
            } catch (err) {
                console.error('Failed to update lastSeen in DB:', err);
            }

            // Emit updated online list and status update to all connected clients
            io.emit('get_online_users', Array.from(onlineUsers.keys()));
            io.emit('user_status_change', {
                userId: disconnectedUserId,
                isOnline: false,
                lastSeen: lastSeenTime
            });
        }
    });

    // User initiates a call
    socket.on('call_user', ({ userToCall, signalData, from, callType, name }) => {
        const targetSocketId = onlineUsers.get(String(userToCall));
        if (targetSocketId) {
            io.to(targetSocketId).emit('incoming_call', {
                signal: signalData,
                from,
                callType,
                name
            });
        } else {
            console.log(`User ${userToCall} is not connected in onlineUsers map.`);
        }
    });

    // User answers an incoming call
    socket.on('answer_call', (data) => {
        const targetSocketId = onlineUsers.get(String(data.to));
        if (targetSocketId) {
            io.to(targetSocketId).emit('call_accepted', data.signal);
        }
    });

    // Handle call hangup / rejection
    socket.on('hang_up', ({ to }) => {
        const targetSocketId = onlineUsers.get(String(to));
        if (targetSocketId) {
            io.to(targetSocketId).emit('call_ended');
        }
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));