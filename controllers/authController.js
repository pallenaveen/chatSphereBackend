const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

// Register new user
exports.registerUser = async (req, res) => {
    const { username, email, password } = req.body;
    try {
        const userExists = await User.findOne({ $or: [{ email }, { username }] });
        if (userExists) return res.status(400).json({ message: "User already exists!" });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const user = await User.create({ username, email, password: hashedPassword });
        res.status(201).json({
            _id: user._id,
            username: user.username,
            email: user.email,
            avatar: user.avatar, // Added avatar here
            bio: user.bio,
            token: generateToken(user._id)
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Login user
exports.loginUser = async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email });
        if (user && (await bcrypt.compare(password, user.password))) {
            res.json({
                _id: user._id,
                username: user.username,
                email: user.email,
                avatar: user.avatar, // Added avatar here so it appears right on login!
                bio: user.bio,
                token: generateToken(user._id)
            });
        } else {
            res.status(401).json({ message: "Invalid email or password" });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Search users by username or email (/api/users?search=query)
exports.allUsers = async (req, res) => {
    const search = typeof req.query.search === 'string'
        ? req.query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        : '';
    const keyword = search
        ? {
              $or: [
                  { username: { $regex: search, $options: 'i' } },
                  { email: { $regex: search, $options: 'i' } },
              ],
          }
        : {};

    try {
        // Find matching users excluding the logged-in user
        const users = await User.find(keyword)
            .find({ _id: { $ne: req.user._id } })
            .select('_id username avatar bio lastSeen isOnline');
            
        res.status(200).json(users);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getUserProfile = async (req, res) => {
    try {
        const user = await User.findById(req.params.userId)
            .select('_id username avatar bio lastSeen isOnline');

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        return res.status(200).json(user);
    } catch (error) {
        if (error.name === 'CastError') {
            return res.status(400).json({ message: 'Invalid user ID' });
        }
        return res.status(500).json({ message: error.message });
    }
};

// Update user profile (username or avatar)
exports.updateProfile = async (req, res) => {
    try {
        const { username, avatar, bio } = req.body;
        const userId = req.user?._id || req.user?.id;

        if (!userId) {
            return res.status(401).json({ message: "Not authorized, user ID missing" });
        }

        const updateData = {};

        // If username is provided, validate and add it
        if (username !== undefined) {
            if (!username.trim()) {
                return res.status(400).json({ message: "Username cannot be empty" });
            }
            const trimmedUsername = username.trim();
            const existingUser = await User.findOne({ username: trimmedUsername });
            if (existingUser && existingUser._id.toString() !== userId.toString()) {
                return res.status(400).json({ message: "Username is already taken" });
            }
            updateData.username = trimmedUsername;
        }

        // If avatar is provided, add it to update payload
        if (avatar !== undefined) {
            updateData.avatar = avatar;
        }

        if (bio !== undefined) {
            if (typeof bio !== 'string') {
                return res.status(400).json({ message: "Bio must be text" });
            }
            const trimmedBio = bio.trim();
            if (trimmedBio.length > 139) {
                return res.status(400).json({ message: "Bio cannot exceed 139 characters" });
            }
            updateData.bio = trimmedBio;
        }

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            updateData,
            { returnDocument: 'after', runValidators: true }
        ).select('-password');

        if (!updatedUser) {
            return res.status(404).json({ message: 'User not found' });
        }

        // === ADD SOCKET EMISSION HERE ===
        const io = req.app.get('io');
        if (io) {
            io.emit('user_profile_updated', {
                userId: updatedUser._id,
                username: updatedUser.username,
                avatar: updatedUser.avatar,
                bio: updatedUser.bio,
            });
        }
        // ================================

        res.status(200).json({
            _id: updatedUser._id,
            username: updatedUser.username,
            email: updatedUser.email,
            avatar: updatedUser.avatar,
            bio: updatedUser.bio,
        });
    } catch (error) {
        console.error("Error updating profile:", error);
        res.status(500).json({ message: error.message });
    }
};