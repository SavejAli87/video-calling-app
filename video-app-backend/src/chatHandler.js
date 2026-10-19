/**
 * chatHandler.js
 * 1-to-1 instant messaging - sirf FRIENDS ke beech.
 * Text, photo, reply (quoted message), "seen" receipts, edit aur delete-for-everyone.
 * Server koi message STORE nahi karta: har device apni copy 24 ghante rakhta hai.
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

      // Offline device ki claims server ke paas nahi hoti, isliye friendship verify nahi ho sakti:
      // pehle "offline" batao, phir online hone par friend check karo.
      const targetSocketId = socketOfPublic.get(targetPublicId);
      if (!targetSocketId) {
        return socket.emit("message-error", {
          targetPublicId,
          clientId: id,
          message: "Friend is offline. Message was not delivered.",
        });
      }

      if (!areFriends(sender.publicId, targetPublicId)) {
        return socket.emit("message-error", {
          targetPublicId,
          clientId: id,
          message: "You can only message friends.",
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

  // 3. Message edit (sirf text). Server store nahi karta, isliye authorship receiver ka client check karta hai:
  //    wo edit tabhi lagata hai jab wo message us conversation me us sender ka ho.
  socket.on("edit-private-message", ({ targetPublicId, id, text } = {}) => {
    const me = devices.get(socket.id);
    if (!me || typeof targetPublicId !== "string" || typeof id !== "string" || !id || id.length > 64) return;

    const clean = typeof text === "string" ? text.trim().slice(0, MAX_MESSAGE_LENGTH) : "";
    if (!clean) return;

    const targetSocketId = socketOfPublic.get(targetPublicId);
    if (!targetSocketId) {
      return socket.emit("message-action-error", {
        targetPublicId,
        id,
        message: "Friend is offline. The edit was not delivered.",
      });
    }
    if (!areFriends(me.publicId, targetPublicId)) {
      return socket.emit("message-action-error", { targetPublicId, id, message: "You can only message friends." });
    }

    io.to(targetSocketId).emit("message-edited", {
      byPublicId: me.publicId,
      id,
      text: clean,
      editedAt: Date.now(),
    });
  });

  // 4. Delete for everyone
  socket.on("delete-private-message", ({ targetPublicId, id } = {}) => {
    const me = devices.get(socket.id);
    if (!me || typeof targetPublicId !== "string" || typeof id !== "string" || !id || id.length > 64) return;

    const targetSocketId = socketOfPublic.get(targetPublicId);
    if (!targetSocketId) {
      return socket.emit("message-action-error", {
        targetPublicId,
        id,
        message: "Friend is offline. The message was not deleted for them.",
      });
    }
    if (!areFriends(me.publicId, targetPublicId)) {
      return socket.emit("message-action-error", { targetPublicId, id, message: "You can only message friends." });
    }

    io.to(targetSocketId).emit("message-deleted", { byPublicId: me.publicId, id });
  });

  // 5. Typing indicator
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
