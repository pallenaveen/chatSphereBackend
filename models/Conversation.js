const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
  {
    chatName: { type: String, trim: true },
    isGroup: { type: Boolean, default: false },
    // Added avatar to store group profile images as base64 strings
    avatar: { type: String, default: '' },
    // Added isFavorite to support the Favorites sidebar filter
    isFavorite: { type: Boolean, default: false },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    groupAdmin: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    latestMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Conversation', conversationSchema);