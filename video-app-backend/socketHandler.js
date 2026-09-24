function setupSocket(io) {
  const devices = new Map(); // socketId -> { socketId, deviceId, deviceName, status }
  const activeCalls = new Map(); // socketId -> inCallWithSocketId

  function sendDeviceList() {
    const list = Array.from(devices.values());
    io.emit("device-list", list);
  }

  function freeDevice(socketId) {
    if (devices.has(socketId)) {
      devices.get(socketId).status = "available";
    }
  }

  io.on("connection", (socket) => {
    console.log(`[+] Connected: ${socket.id}`);

    // Register Device
    socket.on("register-device", (device) => {
      // Purane duplicate sockets saaf karein
      for (const [sId, dev] of devices.entries()) {
        if (dev.deviceId === device.deviceId && sId !== socket.id) {
          devices.delete(sId);
          activeCalls.delete(sId);
        }
      }

      devices.set(socket.id, {
        socketId: socket.id,
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        status: "available",
      });

      sendDeviceList();
    });

    // Get Device List
    socket.on("get-devices", () => {
      socket.emit("device-list", Array.from(devices.values()));
    });

    // Call Device
    socket.on("call-device", ({ targetSocketId }) => {
      const caller = devices.get(socket.id);
      const target = devices.get(targetSocketId);

      if (!target) {
        return socket.emit("call-error", { message: "Device is no longer online." });
      }

      if (target.status === "busy" || activeCalls.has(targetSocketId)) {
        return socket.emit("call-error", { message: "User is busy on another call." });
      }

      io.to(targetSocketId).emit("incoming-call", {
        callerSocketId: socket.id,
        caller: caller,
      });
    });

    // Call Accepted
    socket.on("call-accepted", ({ targetSocketId }) => {
      activeCalls.set(socket.id, targetSocketId);
      activeCalls.set(targetSocketId, socket.id);

      if (devices.has(socket.id)) devices.get(socket.id).status = "busy";
      if (devices.has(targetSocketId)) devices.get(targetSocketId).status = "busy";
      sendDeviceList();

      io.to(targetSocketId).emit("call-accepted", {
        targetSocketId: socket.id,
      });
    });

    // Call Rejected
    socket.on("call-rejected", ({ targetSocketId }) => {
      freeDevice(socket.id);
      if (targetSocketId) {
        freeDevice(targetSocketId);
        io.to(targetSocketId).emit("call-rejected");
      }
      sendDeviceList();
    });

    // WebRTC Offer
    socket.on("offer", ({ targetSocketId, offer }) => {
      io.to(targetSocketId).emit("offer", {
        callerSocketId: socket.id,
        offer: offer,
      });
    });

    // WebRTC Answer
    socket.on("answer", ({ targetSocketId, answer }) => {
      io.to(targetSocketId).emit("answer", {
        callerSocketId: socket.id,
        answer: answer,
      });
    });

    // ICE Candidate
    socket.on("ice-candidate", ({ targetSocketId, candidate }) => {
      io.to(targetSocketId).emit("ice-candidate", {
        callerSocketId: socket.id,
        candidate: candidate,
      });
    });

    // End Call
    socket.on("end-call", ({ targetSocketId }) => {
      activeCalls.delete(socket.id);
      freeDevice(socket.id);

      if (targetSocketId) {
        activeCalls.delete(targetSocketId);
        freeDevice(targetSocketId);
        io.to(targetSocketId).emit("call-ended");
      }
      sendDeviceList();
    });

    // Disconnect
    socket.on("disconnect", () => {
      console.log(`[-] Disconnected: ${socket.id}`);

      const peerSocketId = activeCalls.get(socket.id);
      if (peerSocketId) {
        activeCalls.delete(peerSocketId);
        freeDevice(peerSocketId);
        io.to(peerSocketId).emit("call-ended");
      }

      activeCalls.delete(socket.id);
      devices.delete(socket.id);
      sendDeviceList();
    });
  });
}

module.exports = { setupSocket };