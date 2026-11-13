const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: String,
        required: true,
    },
    avatar: {
        type: String,
        default: ""
    },
    bio: {
        type: String,
        default: "",
        maxlength: 139
    },
    ringtone: {
        data: {
            type: String,
            default: "",
            maxlength: 8 * 1024 * 1024
        },
        fileName: {
            type: String,
            default: "",
            maxlength: 255
        },
        mimeType: {
            type: String,
            default: ""
        }
    },
    isOnline: {
        type: Boolean,
        default: false
    },
    lastSeen: {
        type: Date,
        default: Date.now
    }
}, {timestamps: true});

module.exports = mongoose.model('User', userSchema);