import React, { useState, useEffect, useRef, useCallback } from "react";
import { io } from "socket.io-client";

// .trim() laga kar kisi bhi accidental space ko sanitize kiya gaya hai
const RAW_URL = import.meta.env.VITE_SIGNALING_URL || "https://superleniently-unattributive-alondra.ngrok-free.dev";
const SERVER_URL = RAW_URL.trim();

// STUN + TURN Server Configuration (Cleaned Credentials)
const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    {
      urls: "turn:relay.metered.ca:80",
      username: "7d0a3eb1d65b2b34241a0504",
      credential: "4aIMxkrkrBGwZaEV",
    },
    {
      urls: "turn:relay.metered.ca:443",
      username: "7d0a3eb1d65b2b34241a0504",
      credential: "4aIMxkrkrBGwZaEV",
    },
    {
      urls: "turn:relay.metered.ca:443?transport=tcp",
      username: "7d0a3eb1d65b2b34241a0504",
      credential: "4aIMxkrkrBGwZaEV",
    },
  ],
  iceCandidatePoolSize: 10,
};

const WebRTCCall = () => {
  const [socketId, setSocketId] = useState("Connecting to server...");
  const [deviceName, setDeviceName] = useState("");
  const [status, setStatus] = useState("🟡 Connecting...");
  const [devices, setDevices] = useState([]);
  const [inCall, setInCall] = useState(false);

  const socketRef = useRef(null);
  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const currentTargetRef = useRef(null);
  const remoteDescriptionSetRef = useRef(false);
  const pendingIceCandidatesRef = useRef([]);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  // Call cleanup
  const cleanupCall = useCallback(() => {
    if (peerRef.current) {
      peerRef.current.close();
      peerRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;

    currentTargetRef.current = null;
    remoteDescriptionSetRef.current = false;
    pendingIceCandidatesRef.current = [];

    setInCall(false);
    setStatus("🟢 Ready for another call");
  }, []);

  // Flush queued ICE candidates
  const flushPendingIceCandidates = useCallback(async () => {
    if (!peerRef.current || !remoteDescriptionSetRef.current) return;

    for (const candidate of pendingIceCandidatesRef.current) {
      try {
        await peerRef.current.addIceCandidate(candidate);
      } catch (error) {
        console.error("Queued ICE error:", error);
      }
    }
    pendingIceCandidatesRef.current = [];
  }, []);

  // Camera aur Mic access
  const startCamera = useCallback(async () => {
    if (localStreamRef.current) return localStreamRef.current;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user",
        },
        audio: true,
      });

      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.play().catch((err) => console.log("Local autoplay:", err));
      }
      return stream;
    } catch (error) {
      console.error("Camera/Mic Error:", error);
      alert("Camera/Microphone permission required.\n\n" + error.message);
      throw error;
    }
  }, []);

  // RTCPeerConnection setup with STUN & TURN
  const createPeer = useCallback(() => {
    if (peerRef.current) {
      peerRef.current.close();
    }

    const peer = new RTCPeerConnection(RTC_CONFIG);

    peer.ontrack = (event) => {
      if (remoteVideoRef.current) {
        if (event.streams && event.streams[0]) {
          remoteVideoRef.current.srcObject = event.streams[0];
        } else {
          const stream = remoteVideoRef.current.srcObject || new MediaStream();
          stream.addTrack(event.track);
          remoteVideoRef.current.srcObject = stream;
        }
        remoteVideoRef.current.play().catch((err) => console.log("Remote autoplay:", err));
      }
    };

    peer.onicecandidate = (event) => {
      if (event.candidate && currentTargetRef.current && socketRef.current) {
        socketRef.current.emit("ice-candidate", {
          targetSocketId: currentTargetRef.current,
          candidate: event.candidate,
        });
      }
    };

    peer.onconnectionstatechange = () => {
      if (!peerRef.current) return;
      const state = peerRef.current.connectionState;
      if (state === "connected") setStatus("🟢 Video call connected");
      if (state === "connecting") setStatus("🟡 Connecting peer...");
      if (state === "failed") {
        setStatus("🔴 WebRTC connection failed");
        cleanupCall();
      }
      if (state === "disconnected" || state === "closed") {
        cleanupCall();
      }
    };

    peer.oniceconnectionstatechange = () => {
      if (!peerRef.current) return;
      const iceState = peerRef.current.iceConnectionState;
      if (iceState === "connected" || iceState === "completed") {
        setStatus("🟢 Media connection established");
      }
      if (iceState === "failed") {
        setStatus("🔴 ICE failed - NAT traversal blocked");
      }
    };

    peerRef.current = peer;
    return peer;
  }, [cleanupCall]);

  const addLocalTracks = useCallback(() => {
    if (!peerRef.current || !localStreamRef.current) return;

    const existingTrackIds = new Set(
      peerRef.current.getSenders().map((s) => s.track?.id).filter(Boolean)
    );

    localStreamRef.current.getTracks().forEach((track) => {
      if (!existingTrackIds.has(track.id)) {
        peerRef.current.addTrack(track, localStreamRef.current);
      }
    });
  }, []);

  // Socket Lifecycle
  useEffect(() => {
    let devId = localStorage.getItem("deviceId");
    if (!devId) {
      devId = "device-" + Date.now() + "-" + Math.random().toString(36).substring(2, 10);
      localStorage.setItem("deviceId", devId);
    }
    const devName = "Device-" + devId.slice(-5).toUpperCase();
    setDeviceName(devName);

    // Ngrok free tier browser warning bypass header
    const socket = io(SERVER_URL, {
      transports: ["websocket", "polling"],
      secure: true,
      reconnectionAttempts: 5,
      extraHeaders: {
        "ngrok-skip-browser-warning": "true",
      },
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setSocketId(socket.id);
      setStatus("🟢 Connected");

      socket.emit("register-device", { deviceId: devId, deviceName: devName });
      socket.emit("get-devices");
    });

    socket.on("disconnect", () => {
      setStatus("🔴 Disconnected from server");
    });

    socket.on("device-list", (deviceList) => {
      setDevices(deviceList);
    });

    socket.on("incoming-call", async (data) => {
      if (currentTargetRef.current) {
        socket.emit("call-rejected", { targetSocketId: data.callerSocketId });
        return;
      }

      const caller = data.caller?.deviceName || "Unknown Device";
      const accept = window.confirm(`📞 Incoming Video Call\n\n${caller} is calling you.\n\nAccept?`);

      if (!accept) {
        socket.emit("call-rejected", { targetSocketId: data.callerSocketId });
        return;
      }

      currentTargetRef.current = data.callerSocketId;
      setInCall(true);
      setStatus("📞 Call accepted. Connecting...");

      remoteDescriptionSetRef.current = false;
      pendingIceCandidatesRef.current = [];
      createPeer();

      socket.emit("call-accepted", { targetSocketId: data.callerSocketId });
    });

    socket.on("call-accepted", async (data) => {
      try {
        currentTargetRef.current = data.targetSocketId;
        await startCamera();

        remoteDescriptionSetRef.current = false;
        pendingIceCandidatesRef.current = [];
        const peer = createPeer();
        addLocalTracks();

        const offer = await peer.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });
        await peer.setLocalDescription(offer);

        socket.emit("offer", {
          targetSocketId: data.targetSocketId,
          offer: offer,
        });

        setStatus("📞 Connecting video call...");
      } catch (err) {
        console.error("Call error:", err);
        cleanupCall();
      }
    });

    socket.on("offer", async (data) => {
      try {
        currentTargetRef.current = data.callerSocketId;
        await startCamera();

        let peer = peerRef.current;
        if (!peer) {
          remoteDescriptionSetRef.current = false;
          pendingIceCandidatesRef.current = [];
          peer = createPeer();
        }

        addLocalTracks();
        await peer.setRemoteDescription(new RTCSessionDescription(data.offer));
        remoteDescriptionSetRef.current = true;
        await flushPendingIceCandidates();

        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);

        socket.emit("answer", {
          targetSocketId: data.callerSocketId,
          answer: answer,
        });

        setStatus("📹 Video call connecting...");
      } catch (err) {
        console.error("Offer error:", err);
        cleanupCall();
      }
    });

    socket.on("answer", async (data) => {
      try {
        if (!peerRef.current) return;
        await peerRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
        remoteDescriptionSetRef.current = true;
        await flushPendingIceCandidates();
      } catch (err) {
        console.error("Answer error:", err);
      }
    });

    socket.on("ice-candidate", async (data) => {
      try {
        const candidate = new RTCIceCandidate(data.candidate);
        if (!peerRef.current || !remoteDescriptionSetRef.current) {
          pendingIceCandidatesRef.current.push(candidate);
          return;
        }
        await peerRef.current.addIceCandidate(candidate);
      } catch (err) {
        console.error("ICE candidate error:", err);
      }
    });

    socket.on("call-rejected", () => {
      alert("❌ Call was rejected.");
      cleanupCall();
    });

    socket.on("call-error", (data) => {
      alert(data?.message || "Unable to call device.");
      cleanupCall();
    });

    socket.on("call-ended", () => {
      cleanupCall();
      alert("📴 Remote device ended the call.");
    });

    socket.on("connect_error", (err) => {
      console.error("Socket connection error:", err);
      setStatus("🔴 Connection failed (Check Ngrok tunnel status)");
    });

    return () => {
      cleanupCall();
      socket.disconnect();
    };
  }, [createPeer, addLocalTracks, startCamera, cleanupCall, flushPendingIceCandidates]);

  const handleCallDevice = (targetSocketId) => {
    if (inCall) return;
    currentTargetRef.current = targetSocketId;
    setInCall(true);
    setStatus("📞 Calling device...");
    socketRef.current.emit("call-device", { targetSocketId });
  };

  const handleEndCall = () => {
    if (currentTargetRef.current && socketRef.current) {
      socketRef.current.emit("end-call", {
        targetSocketId: currentTargetRef.current,
      });
    }
    cleanupCall();
  };

  const otherDevices = devices.filter((d) => d.socketId !== socketRef.current?.id);

  return (
    <div className="min-h-screen bg-neutral-900 text-white font-sans p-6 text-center">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">📹 WebRTC Internet Calling</h1>

        {/* Local Device Info */}
        <div className="inline-block bg-neutral-800 px-5 py-3 rounded-xl mb-4 shadow border border-neutral-700">
          <span className="text-xl">🖥️</span>{" "}
          <strong className="text-lg">{deviceName || "Connecting..."}</strong>
          <div className="text-xs text-neutral-400 mt-1">
            Socket ID: <span className="font-mono">{socketId}</span>
          </div>
        </div>

        {/* Status */}
        <div className="my-3 text-lg font-semibold tracking-wide">{status}</div>

        {/* Devices List */}
        <h2 className="text-2xl font-bold mt-8 mb-4 border-b border-neutral-800 pb-2">
          Connected Devices (Anywhere on Internet)
        </h2>
        <div className="flex flex-wrap justify-center gap-5 my-6">
          {otherDevices.length === 0 ? (
            <div className="text-neutral-400 p-6 bg-neutral-800/50 rounded-xl border border-dashed border-neutral-700">
              No other devices connected.
              <br />
              Open this app on another network or mobile data using the same URL.
            </div>
          ) : (
            otherDevices.map((device) => (
              <div
                key={device.socketId}
                className="bg-neutral-800 p-5 rounded-xl w-64 shadow-lg border border-neutral-700/60 flex flex-col items-center"
              >
                <h3 className="text-lg font-bold mb-1">🖥️ {device.deviceName}</h3>
                <p className="text-emerald-400 font-medium mb-1 text-sm">🟢 Online</p>
                <small className="text-neutral-400 text-xs font-mono break-all mb-4">
                  {device.socketId}
                </small>

                <button
                  disabled={inCall || device.status === "busy"}
                  onClick={() => handleCallDevice(device.socketId)}
                  className="w-full mt-auto py-2 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  {device.status === "busy" ? "🔴 Busy" : "📞 Call"}
                </button>
              </div>
            ))
          )}
        </div>

        {/* Video Feeds */}
        <h2 className="text-2xl font-bold mt-10 mb-4 border-b border-neutral-800 pb-2">
          Live Video
        </h2>
        <div className="flex flex-wrap justify-center gap-6 mt-4">
          <div className="flex flex-col items-center">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 mb-2">
              My Feed
            </h3>
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="w-[450px] max-w-[90vw] h-[300px] object-cover bg-black rounded-xl border border-neutral-700 shadow-md"
            />
          </div>
          <div className="flex flex-col items-center">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 mb-2">
              Remote Feed
            </h3>
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-[450px] max-w-[90vw] h-[300px] object-cover bg-black rounded-xl border border-neutral-700 shadow-md"
            />
          </div>
        </div>

        {/* Controls */}
        <div className="mt-8">
          <button
            disabled={!inCall}
            onClick={handleEndCall}
            className="py-3 px-8 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all shadow-lg cursor-pointer"
          >
            ❌ End Call
          </button>
        </div>
      </div>
    </div>
  );
};

export default WebRTCCall;