const Message = require('../models/Message');
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

const sendMessage = async (req, res) => {
    const { content, conversationId, image, audio, attachment } = req.body;
    
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
        const newMessage = await Message.create({
            sender: req.user.id || req.user._id,
            content: content || "",
            image: image || "",
            audio: audio || "",
            attachment,
            conversationId
        });

        const fullMessage = await Message.findById(newMessage._id)
            .populate("sender", "username email avatar");
            
        res.status(201).json(fullMessage);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const allMessages = async (req, res) => {
    try {
        const messages = await Message.find({ conversationId: req.params.conversationId })
            .populate("sender", "username email avatar");
        res.status(200).json(messages);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Edit message
const editMessage = async (req, res) => {
    const { content } = req.body;
    const userId = req.user.id || req.user._id;

    try {
        const message = await Message.findById(req.params.id);
        if (!message) {
            return res.status(404).json({ message: "Message not found" });
        }

        if (message.sender.toString() !== userId.toString()) {
            return res.status(403).json({ message: "Not authorized to edit this message" });
        }

        message.content = content;
        message.isEdited = true;
        await message.save();
        
        // Return the populated message while preserving existing read states/ticks
        const populatedMessage = await Message.findById(message._id)
            .populate("sender", "username email avatar");
            
        res.status(200).json(populatedMessage);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Delete individual message
const deleteMessage = async (req, res) => {
    const userId = req.user.id || req.user._id;

    try {
        const message = await Message.findById(req.params.id);
        if (!message) {
            return res.status(404).json({ message: "Message not found" });
        }

        if (message.sender.toString() !== userId.toString()) {
            return res.status(403).json({ message: "Not authorized to delete this message" });
        }

        await Message.findByIdAndDelete(req.params.id);
        res.status(200).json({ message: "Message deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const markAsRead = async (req, res) => {
    const { conversationId, messageId } = req.body;
    const userId = req.user.id || req.user._id;

    try {
        if (conversationId) {
            await Message.updateMany(
                {
                    conversationId,
                    sender: { $ne: userId },
                    isRead: false
                },
                {
                    $set: { isRead: true, status: 'read' },
                    $addToSet: { readBy: userId }
                }
            );

            // Socket broadcast is cleanly handled via server.js on 'mark_chat_as_read' event
            return res.status(200).json({ success: true, message: 'Conversation marked as read' });
        }

        if (messageId) {
            const updatedMessage = await Message.findByIdAndUpdate(
                messageId,
                {
                    $set: { isRead: true, status: 'read' },
                    $addToSet: { readBy: userId }
                },
                { returnDocument: 'after' }
            ).populate('sender', 'username email avatar');

            return res.status(200).json(updatedMessage);
        }

        return res.status(400).json({ message: 'conversationId or messageId is required' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { sendMessage, allMessages, editMessage, deleteMessage, markAsRead };