/**
 * chatHandler.js
 * 1-to-1 instant messaging - sirf FRIENDS ke beech.
 * Text, photo, reply (quoted message) aur "seen" receipts.
 * Target publicId se hota hai (socketId reconnect par badal jata hai).
 */
const crypto = require("crypto");

const MAX_MESSAGE_LENGTH = 1000;
const MAX_IMAGE_CHARS = 1_500_000; // base64 data-URL ki max length (~1.1MB image)
const IMAGE_RE = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/;

// Reply (quote) ka sirf safe subset aage bhejo
function sanitizeReply(r) {
  if (!r || typeof r !== "object") return null;
  if (typeof r.id !== "string" || !r.id || r.id.length > 64) return null;
  return {
    id: r.id,
    text: typeof r.text === "string" ? r.text.slice(0, 200) : "",
    kind: r.kind === "image" ? "image" : "text",
    mine: Boolean(r.mine), // true => original message ka author isi message ka sender hai
  };
}

function setupChat(io, socket, { devices, socketOfPublic, areFriends }) {
  // 1. Private message (text / photo / reply)
  socket.on("send-private-message", (data = {}) => {
    try {
      const { targetPublicId, message, image, replyTo, clientId } = data;
      const text = typeof message === "string" ? message.trim().slice(0, MAX_MESSAGE_LENGTH) : "";
      const sender = devices.get(socket.id);
      const id =
        typeof clientId === "string" && clientId && clientId.length <= 64
          ? clientId
          : crypto.randomUUID();

      if (!sender || typeof targetPublicId !== "string") return;

      const hasImage =
        typeof image === "string" && image.length <= MAX_IMAGE_CHARS && IMAGE_RE.test(image);

      if (image && !hasImage) {
        return socket.emit("message-error", {
          targetPublicId,
          clientId: id,
          message: "That photo is invalid or too large.",
        });
      }
      if (!text && !hasImage) return;

      if (!areFriends(sender.publicId, targetPublicId)) {
        return socket.emit("message-error", {
          targetPublicId,
          clientId: id,
          message: "You can only message friends.",
        });
      }

      const targetSocketId = socketOfPublic.get(targetPublicId);
      if (!targetSocketId) {
        return socket.emit("message-error", {
          targetPublicId,
          clientId: id,
          message: "Friend is offline. Message was not delivered.",
        });
      }

      const timestamp = Date.now();

      io.to(targetSocketId).emit("receive-private-message", {
        id, // sender wali hi id: reply aur "seen" dono taraf isi se match hote hain
        senderPublicId: sender.publicId,
        senderName: sender.deviceName, // server se aata hai, client spoof nahi kar sakta
        message: text,
        image: hasImage ? image : null,
        replyTo: sanitizeReply(replyTo),
        timestamp,
      });

      socket.emit("message-sent-ack", {
        targetPublicId,
        clientId: id,
        status: "delivered",
        timestamp,
      });
    } catch (err) {
      console.error("Chat forward error:", err);
    }
  });

  // 2. "Seen" receipt: receiver batata hai ki usne ye messages dekh liye
  socket.on("messages-seen", ({ targetPublicId, ids } = {}) => {
    const me = devices.get(socket.id);
    const targetSocketId = socketOfPublic.get(targetPublicId);
    if (!me || !targetSocketId || !Array.isArray(ids)) return;
    if (!areFriends(me.publicId, targetPublicId)) return;

    const clean = ids.filter((i) => typeof i === "string" && i && i.length <= 64).slice(0, 200);
    if (!clean.length) return;

    io.to(targetSocketId).emit("messages-seen", { byPublicId: me.publicId, ids: clean });
  });

  // 3. Typing indicator
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
