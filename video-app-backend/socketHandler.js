const { setupChat } = require("./src/chatHandler");

const RING_TIMEOUT_MS = 45000;

function setupSocket(io) {
  const devices = new Map(); // socketId -> { socketId, deviceId, deviceName, status }

  // socketId -> { peer: socketId, state: "ringing" | "active" }
  // Dono taraf (A->B aur B->A) entry rehti hai. Ye hi "busy" ka single source of truth hai.
  const calls = new Map();

  function sendDeviceList() {
    io.emit("device-list", Array.from(devices.values()));
  }

  function setStatus(socketId, status) {
    const d = devices.get(socketId);
    if (d) d.status = status;
  }

  /**
   * Ek socket ka call-link tod do, dono devices ko free karo.
   * - expectedPeer diya ho to sirf tabhi todta hai jab link usi peer se ho
   *   (taaki purana/stale event kisi doosri chal rahi call ko na tod de).
   * - event diya ho to peer ko wo event bhej deta hai.
   * Peer ka socketId return karta hai (ya null agar koi link tha hi nahi).
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

  io.on("connection", (socket) => {
    console.log(`[+] Connected: ${socket.id}`);

    // ------------------------------------------------------ Register Device
    socket.on("register-device", (device) => {
      if (!device || typeof device.deviceId !== "string") return;

      // Same deviceId ke purane sockets hatao (reconnect / zombie sockets).
      // Agar wo kisi call me the, to partner ko free karke batao.
      for (const [oldId, dev] of devices.entries()) {
        if (dev.deviceId === device.deviceId && oldId !== socket.id) {
          endLink(oldId, null, "call-ended");
          devices.delete(oldId);
          io.sockets.sockets.get(oldId)?.disconnect(true);
        }
      }

      devices.set(socket.id, {
        socketId: socket.id,
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        status: calls.has(socket.id) ? "busy" : "available",
      });

      sendDeviceList();
    });

    // ----------------------------------------------------- Get Device List
    socket.on("get-devices", () => {
      socket.emit("device-list", Array.from(devices.values()));
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
      if (calls.has(socket.id)) {
        return socket.emit("call-error", { message: "You are already in a call." });
      }
      if (calls.has(targetSocketId)) {
        return socket.emit("call-error", { message: "User is busy on another call." });
      }

      // Ringing shuru: dono ko busy mark karo taaki koi teesra beech me call na kare
      calls.set(socket.id, { peer: targetSocketId, state: "ringing" });
      calls.set(targetSocketId, { peer: socket.id, state: "ringing" });
      setStatus(socket.id, "busy");
      setStatus(targetSocketId, "busy");
      sendDeviceList();

      io.to(targetSocketId).emit("incoming-call", {
        callerSocketId: socket.id,
        caller,
      });

      // Safety net: koi jawab na de to ringing khatam
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
      if (!link || link.peer !== targetSocketId || link.state !== "ringing") return; // stale event

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
    // Client ka targetSocketId ignore: server khud jaanta hai ki call kiske saath hai.
    socket.on("end-call", () => {
      endLink(socket.id, null, "call-ended");
      sendDeviceList();
    });

    // ------------------------------------------------------------------ Chat
    setupChat(io, socket, devices);

    // ------------------------------------------------------------ Disconnect
    socket.on("disconnect", () => {
      console.log(`[-] Disconnected: ${socket.id}`);
      endLink(socket.id, null, "call-ended");
      devices.delete(socket.id);
      sendDeviceList();
    });
  });
}

module.exports = { setupSocket };
