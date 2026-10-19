const crypto = require("crypto");
const { setupChat } = require("./src/chatHandler");

const RING_TIMEOUT_MS = 45000;
const SERVER_VERSION = 5;
const MAX_FRIENDS = 500;
const MAX_OUTGOING_REQUESTS = 20;
const REQUEST_GRACE_MS = 15000; // reload/reconnect par pending requests turant na hatein

// deviceId private hai. Dusron ko sirf iska hash (publicId) dikhta hai.
const publicIdOf = (deviceId) =>
  crypto.createHash("sha256").update(deviceId).digest("hex").slice(0, 16);

const cleanName = (n) =>
  typeof n === "string" ? n.replace(/\s+/g, " ").trim().slice(0, 30) : "";

function setupSocket(io) {
  // socketId -> { socketId, deviceId, publicId, deviceName, status }
  const devices = new Map();
  // publicId -> socketId (sirf online devices)
  const socketOfPublic = new Map();
  // publicId -> Set(publicId): jo friends ye device claim karta hai (online devices ke liye)
  // Friendship tabhi valid jab DONO taraf se claim ho (mutual).
  const claims = new Map();
  // "from>to" -> { from, to, createdAt }   (pending friend requests, memory me)
  const requests = new Map();
  // socketId -> { peer: socketId, state: "ringing" | "active" }
  const calls = new Map();

  // ------------------------------------------------------------- helpers
  const publicDevice = (d) => ({
    socketId: d.socketId,
    publicId: d.publicId,
    deviceName: d.deviceName,
    status: d.status,
  });

  const sendDeviceList = () =>
    io.emit("device-list", Array.from(devices.values()).map(publicDevice));

  const setStatus = (socketId, status) => {
    const d = devices.get(socketId);
    if (d) d.status = status;
  };

  const deviceOfPublic = (pid) => devices.get(socketOfPublic.get(pid));

  const emitToPublic = (pid, event, payload) => {
    const sid = socketOfPublic.get(pid);
    if (sid) io.to(sid).emit(event, payload);
  };

  const areFriends = (a, b) => Boolean(claims.get(a)?.has(b) && claims.get(b)?.has(a));

  // Is device ke pending requests ka poora snapshot bhejo
  function sendRequests(pid) {
    const incoming = [];
    const outgoing = [];
    for (const r of requests.values()) {
      if (r.to === pid) {
        incoming.push({
          publicId: r.from,
          name: deviceOfPublic(r.from)?.deviceName || "Unknown",
          createdAt: r.createdAt,
        });
      } else if (r.from === pid) {
        outgoing.push(r.to);
      }
    }
    emitToPublic(pid, "friend-requests", { incoming, outgoing });
  }

  /**
   * Do online devices me se sirf EK taraf friend claim kare to wo claim purana (stale) hai
   * (doosre ne unfriend kar diya). Claimer ko "friend-removed" bhejo.
   */
  function reconcile(pid) {
    for (const other of devices.values()) {
      const oid = other.publicId;
      if (oid === pid) continue;
      const mine = claims.get(pid)?.has(oid);
      const theirs = claims.get(oid)?.has(pid);
      if (mine && !theirs) {
        claims.get(pid).delete(oid);
        emitToPublic(pid, "friend-removed", { publicId: oid });
      } else if (theirs && !mine) {
        claims.get(oid).delete(pid);
        emitToPublic(oid, "friend-removed", { publicId: pid });
      }
    }
  }

  function makeFriends(a, b) {
    requests.delete(`${a}>${b}`);
    requests.delete(`${b}>${a}`);
    claims.get(a)?.add(b);
    claims.get(b)?.add(a);
    emitToPublic(a, "friend-added", { publicId: b, name: deviceOfPublic(b)?.deviceName || "" });
    emitToPublic(b, "friend-added", { publicId: a, name: deviceOfPublic(a)?.deviceName || "" });
    sendRequests(a);
    sendRequests(b);
  }

  /**
   * Ek socket ka call-link tod do, dono devices ko free karo.
   * expectedPeer diya ho to sirf tabhi todta hai jab link usi peer se ho.
   */
  function endLink(socketId, expectedPeer, event) {
    const link = calls.get(socketId);
    if (!link) return null;
    if (expectedPeer && link.peer !== expectedPeer) return null;

    const peerId = link.peer;
    calls.delete(socketId);
    if (calls.get(peerId)?.peer === socketId) calls.delete(peerId);

    setStatus(socketId, "available");
    setStatus(peerId, "available");

    if (event) io.to(peerId).emit(event);
    return peerId;
  }

  // ---------------------------------------------------------- connection
  io.on("connection", (socket) => {
    console.log(`[+] Connected: ${socket.id}`);

    // Frontend isse jaanta hai ki server chat + friends support karta hai
    socket.emit("server-info", { chat: true, friends: true, images: true, version: SERVER_VERSION });

    // ------------------------------------------------------ Register Device
    socket.on("register-device", (payload) => {
      if (!payload || typeof payload.deviceId !== "string" || !payload.deviceId) return;

      const deviceId = payload.deviceId.slice(0, 100);
      const publicId = publicIdOf(deviceId);
      const name = cleanName(payload.deviceName) || "Guest";
      const alreadyRegistered = socketOfPublic.get(publicId) === socket.id;

      // Same device ka purana socket (reconnect / dusra tab) hatao
      const oldSid = socketOfPublic.get(publicId);
      if (oldSid && oldSid !== socket.id) {
        endLink(oldSid, null, "call-ended");
        devices.delete(oldSid);
        const oldSocket = io.sockets.sockets.get(oldSid);
        oldSocket?.emit("replaced");
        oldSocket?.disconnect(true);
      }

      devices.set(socket.id, {
        socketId: socket.id,
        deviceId,
        publicId,
        deviceName: name,
        status: calls.has(socket.id) ? "busy" : "available",
      });
      socketOfPublic.set(publicId, socket.id);

      // Naye connection par client ki saved friends list se claims banao.
      // Sirf naam badalne (same socket re-register) par claims ko chhedo mat.
      if (!alreadyRegistered) {
        const list = Array.isArray(payload.friends) ? payload.friends : [];
        const claimed = new Set(
          list
            .filter((f) => typeof f === "string" && f.length <= 32 && f !== publicId)
            .slice(0, MAX_FRIENDS)
        );
        claims.set(publicId, claimed);
      }

      socket.emit("registered", { publicId });
      reconcile(publicId);
      sendRequests(publicId);
      sendDeviceList();
    });

    // ----------------------------------------------------- Get Device List
    socket.on("get-devices", () => {
      socket.emit("device-list", Array.from(devices.values()).map(publicDevice));
    });

    // -------------------------------------------------------- Friend system
    socket.on("friend-request", ({ targetPublicId } = {}) => {
      const me = devices.get(socket.id);
      if (!me || typeof targetPublicId !== "string" || targetPublicId === me.publicId) return;

      const target = deviceOfPublic(targetPublicId);
      if (!target) {
        return socket.emit("friend-error", { message: "That device is no longer online." });
      }
      if (areFriends(me.publicId, targetPublicId)) {
        return socket.emit("friend-error", { message: "You are already friends." });
      }
      // Samne wale ne pehle hi request bheji thi -> dono ki marzi hai, seedha friends
      if (requests.has(`${targetPublicId}>${me.publicId}`)) {
        return makeFriends(targetPublicId, me.publicId);
      }
      if (requests.has(`${me.publicId}>${targetPublicId}`)) return; // duplicate

      let outgoingCount = 0;
      for (const r of requests.values()) if (r.from === me.publicId) outgoingCount++;
      if (outgoingCount >= MAX_OUTGOING_REQUESTS) {
        return socket.emit("friend-error", { message: "Too many pending requests." });
      }

      requests.set(`${me.publicId}>${targetPublicId}`, {
        from: me.publicId,
        to: targetPublicId,
        createdAt: Date.now(),
      });
      sendRequests(me.publicId);
      sendRequests(targetPublicId);
      io.to(target.socketId).emit("friend-request-received", {
        publicId: me.publicId,
        name: me.deviceName,
      });
    });

    socket.on("friend-request-respond", ({ fromPublicId, accept } = {}) => {
      const me = devices.get(socket.id);
      if (!me || typeof fromPublicId !== "string") return;

      const key = `${fromPublicId}>${me.publicId}`;
      if (!requests.has(key)) return sendRequests(me.publicId); // purani/stale request

      if (!accept) {
        requests.delete(key);
        sendRequests(me.publicId);
        sendRequests(fromPublicId);
        return;
      }

      // Dono online hone chahiye, taaki dono ki list ek saath update ho
      if (!deviceOfPublic(fromPublicId)) {
        requests.delete(key);
        sendRequests(me.publicId);
        return socket.emit("friend-error", {
          message: "They went offline. Ask them to send the request again.",
        });
      }
      makeFriends(fromPublicId, me.publicId);
    });

    socket.on("friend-request-cancel", ({ targetPublicId } = {}) => {
      const me = devices.get(socket.id);
      if (!me || typeof targetPublicId !== "string") return;
      requests.delete(`${me.publicId}>${targetPublicId}`);
      sendRequests(me.publicId);
      sendRequests(targetPublicId);
    });

    socket.on("remove-friend", ({ friendPublicId } = {}) => {
      const me = devices.get(socket.id);
      if (!me || typeof friendPublicId !== "string") return;

      claims.get(me.publicId)?.delete(friendPublicId);
      claims.get(friendPublicId)?.delete(me.publicId);
      requests.delete(`${me.publicId}>${friendPublicId}`);
      requests.delete(`${friendPublicId}>${me.publicId}`);
      emitToPublic(friendPublicId, "friend-removed", { publicId: me.publicId });

      // Unfriend karte hi chal rahi / ringing call bhi khatam
      const friendSid = socketOfPublic.get(friendPublicId);
      if (friendSid && endLink(socket.id, friendSid, "call-ended")) sendDeviceList();

      sendRequests(me.publicId);
      sendRequests(friendPublicId);
    });

    // ---------------------------------------------------------- Call Device
    socket.on("call-device", ({ targetSocketId } = {}) => {
      const caller = devices.get(socket.id);
      const target = devices.get(targetSocketId);

      if (!caller) {
        return socket.emit("call-error", { message: "Device is not registered yet. Please refresh." });
      }
      if (!target || targetSocketId === socket.id) {
        return socket.emit("call-error", { message: "Device is no longer online." });
      }
      if (!areFriends(caller.publicId, target.publicId)) {
        return socket.emit("call-error", { message: "You can only call friends." });
      }
      if (calls.has(socket.id)) {
        return socket.emit("call-error", { message: "You are already in a call." });
      }
      if (calls.has(targetSocketId)) {
        return socket.emit("call-error", { message: "User is busy on another call." });
      }

      calls.set(socket.id, { peer: targetSocketId, state: "ringing" });
      calls.set(targetSocketId, { peer: socket.id, state: "ringing" });
      setStatus(socket.id, "busy");
      setStatus(targetSocketId, "busy");
      sendDeviceList();

      io.to(targetSocketId).emit("incoming-call", {
        callerSocketId: socket.id,
        caller: publicDevice(caller),
      });

      setTimeout(() => {
        const link = calls.get(socket.id);
        if (link && link.peer === targetSocketId && link.state === "ringing") {
          endLink(socket.id, targetSocketId, "call-ended");
          socket.emit("call-error", { message: "No answer." });
          sendDeviceList();
        }
      }, RING_TIMEOUT_MS);
    });

    // -------------------------------------------------------- Call Accepted
    socket.on("call-accepted", ({ targetSocketId } = {}) => {
      const link = calls.get(socket.id);
      if (!link || link.peer !== targetSocketId || link.state !== "ringing") return;

      link.state = "active";
      const peerLink = calls.get(targetSocketId);
      if (peerLink) peerLink.state = "active";

      io.to(targetSocketId).emit("call-accepted", { targetSocketId: socket.id });
    });

    // -------------------------------------------------------- Call Rejected
    socket.on("call-rejected", ({ targetSocketId } = {}) => {
      endLink(socket.id, targetSocketId, "call-rejected");
      sendDeviceList();
    });

    // ------------------------------------------------------- WebRTC Signals
    socket.on("offer", ({ targetSocketId, offer }) => {
      if (calls.get(socket.id)?.peer !== targetSocketId) return;
      io.to(targetSocketId).emit("offer", { callerSocketId: socket.id, offer });
    });

    socket.on("answer", ({ targetSocketId, answer }) => {
      if (calls.get(socket.id)?.peer !== targetSocketId) return;
      io.to(targetSocketId).emit("answer", { callerSocketId: socket.id, answer });
    });

    socket.on("ice-candidate", ({ targetSocketId, candidate }) => {
      if (calls.get(socket.id)?.peer !== targetSocketId) return;
      io.to(targetSocketId).emit("ice-candidate", { callerSocketId: socket.id, candidate });
    });

    // -------------------------------------------------------------- End Call
    socket.on("end-call", () => {
      endLink(socket.id, null, "call-ended");
      sendDeviceList();
    });

    // ------------------------------------------------------------------ Chat
    setupChat(io, socket, { devices, socketOfPublic, areFriends });

    // ------------------------------------------------------------ Disconnect
    socket.on("disconnect", () => {
      console.log(`[-] Disconnected: ${socket.id}`);
      endLink(socket.id, null, "call-ended");

      const dev = devices.get(socket.id);
      devices.delete(socket.id);

      // Agar ye device pehle hi naye socket se replace ho chuka hai to kuch saaf nahi karna
      if (dev && socketOfPublic.get(dev.publicId) === socket.id) {
        const pid = dev.publicId;
        socketOfPublic.delete(pid);
        claims.delete(pid); // wapas aane par register-device se dobara ban jayega

        // Is device ke bheje hue pending requests thodi der baad hatao (reload par bach jaate hain)
        setTimeout(() => {
          if (socketOfPublic.has(pid)) return;
          for (const [key, r] of requests.entries()) {
            if (r.from === pid) {
              requests.delete(key);
              sendRequests(r.to);
            }
          }
        }, REQUEST_GRACE_MS);
      }

      sendDeviceList();
    });
  });
}

module.exports = { setupSocket };
