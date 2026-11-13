const mongoose = require('mongoose');

const callLogSchema = new mongoose.Schema({
  callId: {
    type: String,
  },
  caller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  receiver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  callType: {
    type: String,
    enum: ['audio', 'video'],
    required: true,
  },
  status: {
    type: String,
    enum: ['completed', 'missed', 'rejected', 'outgoing'],
    required: true,
  },
  duration: {
    type: Number, // in seconds
    default: 0,
  },
}, {
  timestamps: true,
});

callLogSchema.index({ callId: 1 }, { unique: true, sparse: true });
callLogSchema.index({ caller: 1, createdAt: -1 });
callLogSchema.index({ receiver: 1, createdAt: -1 });

module.exports = mongoose.model('CallLog', callLogSchema);