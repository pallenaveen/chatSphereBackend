const initSockets = (io) => {
    io.on('connection', (socket) => {
        console.log(`Socket Connected: ${socket.id}`);

        // Join socket room corresponding to conversation ID
        socket.on('join_room', (roomId) => {
            socket.join(roomId);
        });

        // Broadcast live message to all other users in the chat room
        socket.on('send_message', (newMessage) => {
            const { conversationId } = newMessage;
            if (!conversationId) return;
            socket.to(conversationId).emit('receive_message', newMessage);
        });

        // Handle typing indicators
        socket.on('typing', (roomId) => socket.to(roomId).emit('typing'));
        socket.on('stop_typing', (roomId) => socket.to(roomId).emit('stop_typing'));

        socket.on('disconnect', () => {
            console.log(`Socket Disconnected: ${socket.id}`);
        });
    });
};

module.exports = initSockets;