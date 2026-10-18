/**
 * chatHandler.js
 * 1-to-1 instant messaging - sirf FRIENDS ke beech.
 * Target publicId se hota hai (socketId reconnect par badal jata hai).
 */
const crypto = require("crypto");

const MAX_MESSAGE_LENGTH = 1000;

function setupChat(io, socket, { devices, socketOfPublic, areFriends }) {
  // 1. Private message bhejna
  socket.on("send-private-message", (data = {}) => {
    try {
      const { targetPublicId, message, clientId } = data;
      const text = typeof message === "string" ? message.trim().slice(0, MAX_MESSAGE_LENGTH) : "";
      const sender = devices.get(socket.id);

      if (!sender || typeof targetPublicId !== "string" || !text) return;

      if (!areFriends(sender.publicId, targetPublicId)) {
        return socket.emit("message-error", {
          targetPublicId,
          clientId,
          message: "You can only message friends.",
        });
      }

      const targetSocketId = socketOfPublic.get(targetPublicId);
      if (!targetSocketId) {
        return socket.emit("message-error", {
          targetPublicId,
          clientId,
          message: "Friend is offline. Message was not delivered.",
        });
      }

      const timestamp = Date.now();

      io.to(targetSocketId).emit("receive-private-message", {
        id: crypto.randomUUID(),
        senderPublicId: sender.publicId,
        senderName: sender.deviceName, // server se aata hai, client spoof nahi kar sakta
        message: text,
        timestamp,
      });

      socket.emit("message-sent-ack", {
        targetPublicId,
        clientId,
        status: "delivered",
        timestamp,
      });
    } catch (err) {
      console.error("Chat forward error:", err);
    }
  });

  // 2. Typing indicator
  socket.on("typing-indicator", ({ targetPublicId, isTyping } = {}) => {
    const sender = devices.get(socket.id);
    const targetSocketId = socketOfPublic.get(targetPublicId);
    if (sender && targetSocketId && areFriends(sender.publicId, targetPublicId)) {
      io.to(targetSocketId).emit("user-typing", {
        senderPublicId: sender.publicId,
        isTyping: Boolean(isTyping),
      });
    }
  });
}

module.exports = { setupChat };
