/**
 * chatHandler.js
 * 1-to-1 instant messaging (call ke andar aur lobby dono me kaam karta hai)
 */
const crypto = require("crypto");

const MAX_MESSAGE_LENGTH = 1000;

function setupChat(io, socket, devices) {
  // 1. Private message bhejna
  socket.on("send-private-message", (data = {}) => {
    try {
      const { targetSocketId, message, clientId } = data;
      const text = typeof message === "string" ? message.trim().slice(0, MAX_MESSAGE_LENGTH) : "";
      const sender = devices.get(socket.id);

      if (!sender || !targetSocketId || !text) return;

      if (!devices.has(targetSocketId)) {
        return socket.emit("message-error", {
          targetSocketId,
          clientId,
          message: "Device is offline. Message was not delivered.",
        });
      }

      const timestamp = Date.now();

      io.to(targetSocketId).emit("receive-private-message", {
        id: crypto.randomUUID(),
        senderSocketId: socket.id,
        senderName: sender.deviceName, // server se aata hai, client spoof nahi kar sakta
        message: text,
        timestamp,
      });

      socket.emit("message-sent-ack", {
        targetSocketId,
        clientId,
        status: "delivered",
        timestamp,
      });
    } catch (err) {
      console.error("Chat forward error:", err);
    }
  });

  // 2. Typing indicator
  socket.on("typing-indicator", ({ targetSocketId, isTyping } = {}) => {
    if (targetSocketId && devices.has(targetSocketId)) {
      io.to(targetSocketId).emit("user-typing", {
        senderSocketId: socket.id,
        isTyping: Boolean(isTyping),
      });
    }
  });
}

module.exports = { setupChat };
