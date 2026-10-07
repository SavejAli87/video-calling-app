/**
 * chatHandler.js
 * Standalone 1-to-1 Instant Messaging Module
 */

function setupChat(io, socket) {
  // 1. Private message bhejna
  socket.on("send-private-message", (data) => {
    try {
      const { targetSocketId, message, senderName, time } = data;

      if (!targetSocketId || !message || !message.trim()) {
        return;
      }

      // Target socket ko direct message forward karna
      io.to(targetSocketId).emit("receive-private-message", {
        senderSocketId: socket.id,
        senderName: senderName || "Anonymous Device",
        message: message.trim(),
        time: time || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      });

      // Sender ko delivery acknowledge karna (Optional)
      socket.emit("message-sent-ack", {
        targetSocketId,
        status: "delivered",
      });
    } catch (err) {
      console.error("Chat forward error:", err);
    }
  });

  // 2. Typing indicator event
  socket.on("typing-indicator", ({ targetSocketId, isTyping }) => {
    if (targetSocketId) {
      io.to(targetSocketId).emit("user-typing", {
        senderSocketId: socket.id,
        isTyping: Boolean(isTyping),
      });
    }
  });
}

module.exports = { setupChat };