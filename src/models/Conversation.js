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
    latestMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
    groupKey: { type: String, select: false }
  },
  { timestamps: true }
);

conversationSchema.index({ groupKey: 1 }, { unique: true, sparse: true });
conversationSchema.index({ members: 1, updatedAt: -1 });

module.exports = mongoose.model('Conversation', conversationSchema);