const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    content: {
      type: String,
      default: '', // Optional for media-only messages
    },
    image: {
      type: String, // Base64 or uploaded URL
      default: '',
    },
    audio: {
      type: String,
      default: '',
    },
    attachment: {
      type: new mongoose.Schema(
        {
          name: { type: String, required: true },
          mimeType: { type: String, required: true },
          size: { type: Number, required: true },
          data: { type: String, required: true },
        },
        { _id: false }
      ),
      default: undefined,
    },

    // 1. WhatsApp Double Grey Ticks (Delivered to devices)
    deliveredTo: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],

    // 2. WhatsApp Double Blue Ticks (Read/Seen by members)
    readBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],

    // 3. Emoji Reactions
    reactions: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
        emoji: {
          type: String,
          required: true,
        },
      },
    ],

    // 4. Message Editing Support
    isEdited: {
      type: Boolean,
      default: false,
    },

    // 5. "Delete for Everyone" Feature
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Message', messageSchema);