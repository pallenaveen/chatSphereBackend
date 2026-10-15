const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');
const mongoose = require('mongoose');

// Create 1-on-1 conversation or return existing
const accessChat = async (req, res) => {
  const { friendId, userId } = req.body;
  const targetUserId = friendId || userId;
  const currentUserId = req.user._id || req.user.id;

  if (!targetUserId) {
    return res.status(400).json({ message: 'friendId is required' });
  }

  try {
    const currentObjId = new mongoose.Types.ObjectId(currentUserId);
    const friendObjId = new mongoose.Types.ObjectId(targetUserId);

    let isChat = await Conversation.find({
      isGroup: false,
      members: { $size: 2, $all: [currentObjId, friendObjId] }
    })
      .populate("members", "-password")
      .populate("latestMessage");

    isChat = await User.populate(isChat, {
      path: "latestMessage.sender",
      select: "username email"
    });

    if (isChat.length > 0) {
      return res.status(200).json(isChat[0]);
    } else {
      const newChat = await Conversation.create({
        chatName: "sender",
        isGroup: false,
        members: [currentObjId, friendObjId]
      });

      const fullChat = await Conversation.findOne({ _id: newChat._id }).populate("members", "-password");
      return res.status(200).json(fullChat);
    }
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Fetch all conversations for the logged-in user with accurate unread counts
const fetchChats = async (req, res) => {
  const currentUserId = req.user._id || req.user.id;

  try {
    const currentObjId = new mongoose.Types.ObjectId(currentUserId);

    let chats = await Conversation.find({ members: { $in: [currentObjId] } })
      .populate("members", "-password")
      .populate("groupAdmin", "-password")
      .populate("latestMessage")
      .sort({ updatedAt: -1 })
      .lean();

    chats = await User.populate(chats, {
      path: "latestMessage.sender",
      select: "username email"
    });

    const chatsWithUnreadCount = await Promise.all(
      chats.map(async (chat) => {
        const unreadCount = await Message.countDocuments({
          conversationId: chat._id,
          sender: { $ne: currentObjId },
          readBy: { $ne: currentObjId }
        });

        return {
          ...chat,
          unreadCount
        };
      })
    );

    res.status(200).json(chatsWithUnreadCount);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Mark all messages in a conversation as read and emit socket event
const markMessagesAsRead = async (req, res) => {
  const { chatId } = req.params;
  const currentUserId = req.user._id || req.user.id;

  try {
    const currentObjId = new mongoose.Types.ObjectId(currentUserId);
    
    let chatObjId;
    try {
      chatObjId = new mongoose.Types.ObjectId(chatId);
    } catch (e) {
      chatObjId = chatId;
    }

    await Message.updateMany(
      {
        $or: [
          { conversationId: chatId },
          { conversationId: chatObjId }
        ],
        sender: { $ne: currentObjId },
        readBy: { $ne: currentObjId }
      },
      { $addToSet: { readBy: currentObjId } }
    );

    const io = req.app.get('io');
    if (io) {
      io.to(chatId).emit('chat_marked_read', {
        conversationId: chatId,
        userId: currentUserId
      });
    }

    res.status(200).json({ success: true, message: 'Messages marked as read' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Delete entire chat conversation
const deleteChat = async (req, res) => {
  try {
    const chatId = req.params.id;
    await Message.deleteMany({ conversationId: chatId });
    await Conversation.findByIdAndDelete(chatId);
    res.status(200).json({ message: 'Chat deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Create a new Group Conversation
const createGroupChat = async (req, res) => {
  const { name, members, users } = req.body;
  const currentUserId = req.user._id || req.user.id;

  if (!name || (!members && !users)) {
    return res.status(400).json({ message: 'Please fill all fields' });
  }

  let parsedMembers = Array.isArray(members)
    ? members
    : Array.isArray(users)
      ? users
      : typeof members === 'string'
        ? JSON.parse(members)
        : typeof users === 'string'
          ? JSON.parse(users)
          : [];

  if (parsedMembers.length < 2) {
    return res.status(400).json({ message: 'At least 2 members are required to form a group chat' });
  }

  if (!parsedMembers.includes(String(currentUserId))) {
    parsedMembers.push(currentUserId);
  }

  try {
    const groupChat = await Conversation.create({
      chatName: name,
      isGroup: true,
      members: parsedMembers,
      groupAdmin: currentUserId
    });

    const fullGroupChat = await Conversation.findOne({ _id: groupChat._id })
      .populate("members", "-password")
      .populate("groupAdmin", "-password");

    const io = req.app.get('io');
    if (io) {
      parsedMembers.forEach((memberId) => {
        io.to(String(memberId)).emit('group_created', fullGroupChat);
      });
    }

    res.status(200).json(fullGroupChat);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Rename Group or Update Group Avatar
const renameGroup = async (req, res) => {
  const { chatId, chatName, avatar } = req.body;

  if (!chatId) {
    return res.status(400).json({ message: "Chat ID is required" });
  }

  const updateFields = {};
  if (chatName !== undefined) updateFields.chatName = chatName;
  if (avatar !== undefined) updateFields.avatar = avatar;

  try {
    const updatedChat = await Conversation.findByIdAndUpdate(
      chatId,
      { $set: updateFields },
      { new: true }
    )
      .populate("members", "-password")
      .populate("groupAdmin", "-password");

    if (!updatedChat) {
      return res.status(404).json({ message: "Conversation Not Found" });
    }

    const io = req.app.get('io');
    if (io) {
      io.to(chatId).emit('group_updated', updatedChat);
    }

    res.status(200).json(updatedChat);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Add Member to Group
const addToGroup = async (req, res) => {
  const { chatId, userId } = req.body;

  try {
    const added = await Conversation.findByIdAndUpdate(
      chatId,
      { $addToSet: { members: userId } },
      { new: true }
    )
      .populate("members", "-password")
      .populate("groupAdmin", "-password");

    if (!added) {
      return res.status(404).json({ message: "Conversation Not Found" });
    }

    // Broadcast update via socket
    const io = req.app.get('io');
    if (io) {
      io.to(chatId).emit('group_updated', added);
      io.to(String(userId)).emit('group_created', added); // Notify newly added user
    }

    res.status(200).json(added);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Remove Member from Group
const removeFromGroup = async (req, res) => {
  const { chatId, userId } = req.body;

  try {
    const removed = await Conversation.findByIdAndUpdate(
      chatId,
      { $pull: { members: userId } },
      { new: true }
    )
      .populate("members", "-password")
      .populate("groupAdmin", "-password");

    if (!removed) {
      return res.status(404).json({ message: "Conversation Not Found" });
    }

    // Broadcast update via socket
    const io = req.app.get('io');
    if (io) {
      io.to(chatId).emit('group_updated', removed);
    }

    res.status(200).json(removed);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Toggle Favorite Status for a Conversation
const toggleFavorite = async (req, res) => {
  const chatId = req.params.id || req.body.chatId;
  const { isFavorite } = req.body;

  try {
    const updatedChat = await Conversation.findByIdAndUpdate(
      chatId,
      { isFavorite: isFavorite },
      { new: true }
    )
      .populate("members", "-password")
      .populate("groupAdmin", "-password");

    if (!updatedChat) {
      return res.status(404).json({ message: "Conversation Not Found" });
    }

    res.status(200).json(updatedChat);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  accessChat,
  fetchChats,
  markMessagesAsRead,
  deleteChat,
  createGroupChat,
  renameGroup,
  addToGroup,
  removeFromGroup,
  toggleFavorite
};