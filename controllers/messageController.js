const Message = require('../models/Message');
const { findConversationForMember } = require('../utils/conversationAccess');
const { emitToConversationMembers } = require('../utils/realtime');
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const MAX_MESSAGE_LENGTH = 10000;
const MAX_MEDIA_LENGTH = 15 * 1024 * 1024;

const sendMessage = async (req, res) => {
    const { content, conversationId, image, audio, attachment } = req.body;
    
    if (
        (content !== undefined && typeof content !== 'string') ||
        (content && content.length > MAX_MESSAGE_LENGTH) ||
        (image !== undefined && (typeof image !== 'string' || image.length > MAX_MEDIA_LENGTH)) ||
        (audio !== undefined && (typeof audio !== 'string' || audio.length > MAX_MEDIA_LENGTH))
    ) {
        return res.status(400).json({ message: 'Message content or media is invalid or too large' });
    }

    // Allow sending if content or any supported media is present
    if ((!content || !content.trim()) && !image && !audio && !attachment) {
        return res.status(400).json({ message: "Invalid message payload" });
    }
    if (!conversationId) {
        return res.status(400).json({ message: "Conversation ID is required" });
    }
    if (attachment) {
        if (typeof attachment !== 'object' || Array.isArray(attachment)) {
            return res.status(400).json({ message: "Invalid attachment" });
        }

        const { name, mimeType, size, data } = attachment;
        if (
            typeof name !== 'string' ||
            !name.trim() ||
            name.length > 255 ||
            typeof mimeType !== 'string' ||
            !mimeType ||
            mimeType.length > 255 ||
            !Number.isSafeInteger(size) ||
            size < 0 ||
            size > MAX_ATTACHMENT_SIZE ||
            typeof data !== 'string'
        ) {
            return res.status(400).json({ message: "Invalid attachment" });
        }

        const dataPrefix = `data:${mimeType};base64,`;
        if (!data.startsWith(dataPrefix)) {
            return res.status(400).json({ message: "Invalid attachment" });
        }

        const encodedData = data.slice(dataPrefix.length);
        if (
            encodedData.length > Math.ceil(MAX_ATTACHMENT_SIZE / 3) * 4 ||
            !/^[A-Za-z0-9+/]*={0,2}$/.test(encodedData) ||
            Buffer.from(encodedData, 'base64').length !== size
        ) {
            return res.status(400).json({ message: "Invalid attachment" });
        }
    }

    try {
        const conversation = await findConversationForMember(conversationId, req.user._id);
        if (!conversation) {
            return res.status(404).json({ message: "Conversation not found" });
        }

        const newMessage = await Message.create({
            sender: req.user._id,
            content: content || "",
            image: image || "",
            audio: audio || "",
            attachment,
            conversationId
        });

        conversation.latestMessage = newMessage._id;
        await conversation.save();

        const fullMessage = await Message.findById(newMessage._id)
            .populate("sender", "username avatar");

        const io = req.app.get('io');
        if (io) {
            emitToConversationMembers(io, conversation, 'receive_message', fullMessage);
            emitToConversationMembers(io, conversation, 'conversation_updated', {
                conversationId: conversation.id,
                latestMessage: fullMessage,
                updatedAt: conversation.updatedAt,
            });
        }

        res.status(201).json(fullMessage);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const allMessages = async (req, res) => {
    try {
        const conversation = await findConversationForMember(req.params.conversationId, req.user._id);
        if (!conversation) {
            return res.status(404).json({ message: "Conversation not found" });
        }

        const messages = await Message.find({ conversationId: req.params.conversationId })
            .populate("sender", "username avatar");
        res.status(200).json(messages);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Edit message
const editMessage = async (req, res) => {
    const { content } = req.body;
    const userId = req.user._id;

    try {
        const message = await Message.findById(req.params.id);
        if (!message) {
            return res.status(404).json({ message: "Message not found" });
        }

        if (message.sender.toString() !== userId.toString()) {
            return res.status(403).json({ message: "Not authorized to edit this message" });
        }

        const conversation = await findConversationForMember(message.conversationId, userId);
        if (!conversation) {
            return res.status(404).json({ message: "Conversation not found" });
        }

        if (typeof content !== 'string') {
            return res.status(400).json({ message: "Message content must be text" });
        }

        message.content = content;
        message.isEdited = true;
        await message.save();

        const latestMessageId = String(conversation.latestMessage || '');
        if (latestMessageId === String(message._id)) {
            conversation.updatedAt = new Date();
            await conversation.save();
        }
        
        // Return the populated message while preserving existing read states/ticks
        const populatedMessage = await Message.findById(message._id)
            .populate("sender", "username avatar");

        const io = req.app.get('io');
        if (io) {
            emitToConversationMembers(io, conversation, 'message_edited', populatedMessage);
            if (latestMessageId === String(message._id)) {
                emitToConversationMembers(io, conversation, 'conversation_updated', {
                    conversationId: conversation.id,
                    latestMessage: populatedMessage,
                    updatedAt: conversation.updatedAt,
                });
            }
        }

        res.status(200).json(populatedMessage);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Delete individual message
const deleteMessage = async (req, res) => {
    const userId = req.user._id;

    try {
        const message = await Message.findById(req.params.id);
        if (!message) {
            return res.status(404).json({ message: "Message not found" });
        }

        if (message.sender.toString() !== userId.toString()) {
            return res.status(403).json({ message: "Not authorized to delete this message" });
        }

        const conversation = await findConversationForMember(message.conversationId, userId);
        if (!conversation) {
            return res.status(404).json({ message: "Conversation not found" });
        }

        const wasLatestMessage = String(conversation.latestMessage || '') === String(message._id);
        await Message.findByIdAndDelete(req.params.id);
        let latestMessage = null;
        if (wasLatestMessage) {
            const remainingMessage = await Message.findOne({ conversationId: conversation._id })
                .sort({ createdAt: -1 })
                .populate('sender', 'username avatar');
            conversation.latestMessage = remainingMessage?._id || null;
            conversation.updatedAt = new Date();
            await conversation.save();
            latestMessage = remainingMessage;
        }

        const io = req.app.get('io');
        if (io) {
            emitToConversationMembers(io, conversation, 'message_deleted', {
                messageId: message.id,
                conversationId: message.conversationId,
            });
            if (wasLatestMessage) {
                emitToConversationMembers(io, conversation, 'conversation_updated', {
                    conversationId: conversation.id,
                    latestMessage,
                    updatedAt: conversation.updatedAt,
                });
            }
        }
        res.status(200).json({ message: "Message deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const markAsRead = async (req, res) => {
    const { conversationId, messageId } = req.body;
    const userId = req.user._id;

    try {
        if (conversationId) {
            const conversation = await findConversationForMember(conversationId, userId);
            if (!conversation) {
                return res.status(404).json({ message: "Conversation not found" });
            }

            await Message.updateMany(
                {
                    conversationId,
                    sender: { $ne: userId },
                },
                {
                    $addToSet: { readBy: userId }
                }
            );

            const io = req.app.get('io');
            if (io) {
                emitToConversationMembers(io, conversation, 'chat_marked_read', {
                    conversationId: conversation.id,
                    userId: String(userId),
                });
            }

            return res.status(200).json({ success: true, message: 'Conversation marked as read' });
        }

        if (messageId) {
            const message = await Message.findById(messageId);
            if (!message) {
                return res.status(404).json({ message: 'Message not found' });
            }

            const conversation = await findConversationForMember(message.conversationId, userId);
            if (!conversation) {
                return res.status(404).json({ message: 'Conversation not found' });
            }

            message.readBy.addToSet(userId);
            await message.save();
            const updatedMessage = await Message.findById(message._id)
                .populate('sender', 'username avatar');

            const io = req.app.get('io');
            if (io) {
                emitToConversationMembers(io, conversation, 'chat_marked_read', {
                    conversationId: conversation.id,
                    userId: String(userId),
                    messageId: message.id,
                });
            }

            return res.status(200).json(updatedMessage);
        }

        return res.status(400).json({ message: 'conversationId or messageId is required' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const markDelivered = async (req, res) => {
    try {
        const message = await Message.findById(req.params.id);
        if (!message) {
            return res.status(404).json({ message: 'Message not found' });
        }

        const conversation = await findConversationForMember(message.conversationId, req.user._id);
        if (!conversation) {
            return res.status(404).json({ message: 'Conversation not found' });
        }
        if (String(message.sender) === String(req.user._id)) {
            return res.status(400).json({ message: 'A sender cannot mark their own message as delivered' });
        }

        const wasDelivered = message.deliveredTo.some(
            (userId) => String(userId) === String(req.user._id)
        );
        if (!wasDelivered) {
            message.deliveredTo.addToSet(req.user._id);
            await message.save();

            const io = req.app.get('io');
            if (io) {
                emitToConversationMembers(io, conversation, 'message_delivery_update', {
                    messageId: message.id,
                    conversationId: conversation.id,
                    userId: String(req.user._id),
                });
            }
        }

        res.status(200).json({ success: true, deliveredTo: message.deliveredTo });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { sendMessage, allMessages, editMessage, deleteMessage, markAsRead, markDelivered };