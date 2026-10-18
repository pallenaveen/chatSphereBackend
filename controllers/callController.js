const CallLog = require('../models/CallLog');
const User = require('../models/User');
const mongoose = require('mongoose');

// @desc    Create a new call log entry
// @route   POST /api/calls
// @access  Private
const logCall = async (req, res) => {
  try {
    const { callId, receiverId, callType, status, duration } = req.body;

    if (
      typeof callId !== 'string' ||
      !callId ||
      !mongoose.Types.ObjectId.isValid(receiverId) ||
      !['audio', 'video'].includes(callType || 'audio') ||
      !['completed', 'missed', 'rejected', 'outgoing'].includes(status) ||
      (duration !== undefined && (!Number.isFinite(duration) || duration < 0))
    ) {
      return res.status(400).json({ message: 'Invalid call log details' });
    }

    if (String(receiverId) === String(req.user._id)) {
      return res.status(400).json({ message: 'Cannot create a call log for yourself' });
    }
    if (!await User.exists({ _id: receiverId })) {
      return res.status(404).json({ message: 'Call recipient not found' });
    }

    const newCallLog = await CallLog.findOneAndUpdate(
      { callId, caller: req.user._id },
      {
        $setOnInsert: {
          callId,
          caller: req.user._id,
          receiver: receiverId,
          callType: callType || 'audio',
          status,
          duration: duration ?? 0,
        },
      },
      { new: true, upsert: true, runValidators: true }
    );

    const populatedLog = await CallLog.findById(newCallLog._id)
      .populate('caller', 'username name avatar')
      .populate('receiver', 'username name avatar');

    res.status(201).json(populatedLog);
  } catch (err) {
    console.error('Error saving call log:', err);
    res.status(500).json({ message: 'Server error while saving call log' });
  }
};

// @desc    Get call history for the logged-in user
// @route   GET /api/calls
// @access  Private
const getCallHistory = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;

    // Find all logs where the user is either the caller or the receiver
    const callLogs = await CallLog.find({
      $or: [{ caller: userId }, { receiver: userId }]
    })
      .populate('caller', 'username name avatar')
      .populate('receiver', 'username name avatar')
      .sort({ createdAt: -1 }); // Most recent first

    res.json(callLogs);
  } catch (err) {
    console.error('Error fetching call history:', err);
    res.status(500).json({ message: 'Server error while fetching call history' });
  }
};

module.exports = {
  logCall,
  getCallHistory,
};