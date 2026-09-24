import React, { useState, useEffect, useRef, useCallback } from "react";
import { io } from "socket.io-client";

const RAW_URL = import.meta.env.VITE_SIGNALING_URL || "http://13.63.215.171:9090";
const SERVER_URL = RAW_URL.trim().replace(/\/+$/, "");

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
  const [isConnected, setIsConnected] = useState(false);
  const [deviceName, setDeviceName] = useState("");
  const [status, setStatus] = useState("🟡 Connecting to signaling server...");
  const [devices, setDevices] = useState([]);
  const [inCall, setInCall] = useState(false);

  const socketRef = useRef(null);
  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const currentTargetRef = useRef(null);
  const remoteDescriptionSetRef = useRef(false);
  const pendingIceCandidatesRef = useRef([]);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  // Call Cleanup
  const cleanupCall = useCallback(() => {
    if (peerRef.current) {
      peerRef.current.onicecandidate = null;
      peerRef.current.ontrack = null;
      peerRef.current.close();
      peerRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach((track) => track.stop());
      remoteStreamRef.current = null;
    }

    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;

    currentTargetRef.current = null;
    remoteDescriptionSetRef.current = false;
    pendingIceCandidatesRef.current = [];

    setInCall(false);
    setStatus("🟢 Ready for another call");
  }, []);

  // Flush Queued ICE Candidates
  const flushPendingIceCandidates = useCallback(async () => {
    if (!peerRef.current || !remoteDescriptionSetRef.current) return;

    while (pendingIceCandidatesRef.current.length > 0) {
      const candidate = pendingIceCandidatesRef.current.shift();
      try {
        await peerRef.current.addIceCandidate(candidate);
      } catch (error) {
        console.error("Queued ICE error:", error);
      }
    }
  }, []);

  // Camera & Mic Access
  const startCamera = useCallback(async () => {
    if (localStreamRef.current) return localStreamRef.current;

    const getMedia =
      navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices) ||
      navigator.getUserMedia?.bind(navigator) ||
      navigator.webkitGetUserMedia?.bind(navigator) ||
      navigator.mozGetUserMedia?.bind(navigator);

    if (!getMedia) {
      const errorMsg =
        "Camera/Microphone API blocked!\n\n" +
        "Browsers block camera access over plain HTTP (unless using http://localhost).\n\n" +
        "Solutions:\n" +
        "1. Open using http://localhost:5173\n" +
        "2. Or enable chrome://flags/#unsafely-treat-insecure-origin-as-secure for your IP";
      alert(errorMsg);
      throw new Error(errorMsg);
    }

    try {
      const constraints = {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user",
        },
        audio: true,
      };

      const stream = navigator.mediaDevices?.getUserMedia
        ? await navigator.mediaDevices.getUserMedia(constraints)
        : await new Promise((resolve, reject) => getMedia(constraints, resolve, reject));

      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.play().catch((err) => console.log("Local autoplay:", err));
      }
      return stream;
    } catch (error) {
      console.error("Camera/Mic Error:", error);
      alert("Camera/Microphone permission denied or unavailable:\n\n" + error.message);
      throw error;
    }
  }, []);

  // Local tracks peer connection me add karna
  const addLocalTracks = useCallback((peer, stream) => {
    if (!peer || !stream) return;

    const existingTrackIds = new Set(
      peer.getSenders().map((s) => s.track?.id).filter(Boolean)
    );

    stream.getTracks().forEach((track) => {
      if (!existingTrackIds.has(track.id)) {
        peer.addTrack(track, stream);
      }
    });
  }, []);

  // Peer Connection Setup
  const createPeer = useCallback(() => {
    if (peerRef.current) {
      peerRef.current.close();
    }

    const peer = new RTCPeerConnection(RTC_CONFIG);
    remoteStreamRef.current = new MediaStream();

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStreamRef.current;
    }

    // Remote Track Receiver Fix
    peer.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = event.streams[0];
          remoteStreamRef.current = event.streams[0];
        }
      } else {
        remoteStreamRef.current.addTrack(event.track);
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStreamRef.current;
        }
      }

      remoteVideoRef.current?.play().catch((err) => console.log("Remote play error:", err));
    };

    // Candidate Sending
    peer.onicecandidate = (event) => {
      if (event.candidate && currentTargetRef.current && socketRef.current?.connected) {
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
        setStatus("🔴 ICE failed - Relay connection dropped");
      }
    };

    peerRef.current = peer;
    return peer;
  }, [cleanupCall]);

  // Socket Lifecycle
  useEffect(() => {
    let devId = localStorage.getItem("deviceId");
    if (!devId) {
      devId = "device-" + Date.now() + "-" + Math.random().toString(36).substring(2, 10);
      localStorage.setItem("deviceId", devId);
    }
    const devName = "Device-" + devId.slice(-5).toUpperCase();
    setDeviceName(devName);

    const isSecureUrl = SERVER_URL.startsWith("https");

    const socket = io(SERVER_URL, {
      transports: ["polling", "websocket"],
      secure: isSecureUrl,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setSocketId(socket.id);
      setIsConnected(true);
      setStatus("🟢 Connected to signaling server");

      socket.emit("register-device", { deviceId: devId, deviceName: devName });
      socket.emit("get-devices");
    });

    socket.on("disconnect", (reason) => {
      setIsConnected(false);
      setStatus(`🔴 Disconnected from server (${reason})`);
    });

    socket.on("connect_error", (err) => {
      setIsConnected(false);
      setStatus("🔴 Connection failed (Check AWS port 9090 & HTTP mode)");
      console.error("Socket error details:", err.message);
    });

    socket.on("device-list", (deviceList) => {
      setDevices(deviceList);
    });

    // Incoming Call Receiver
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

      try {
        currentTargetRef.current = data.callerSocketId;
        setInCall(true);
        setStatus("📞 Call accepted. Starting camera...");

        // Pehle Camera start hoga taaki remote offer aane se pehle tracks available hon
        const localStream = await startCamera();

        remoteDescriptionSetRef.current = false;
        pendingIceCandidatesRef.current = [];
        const peer = createPeer();
        addLocalTracks(peer, localStream);

        socket.emit("call-accepted", { targetSocketId: data.callerSocketId });
      } catch (err) {
        console.error("Camera accept error:", err);
        socket.emit("call-rejected", { targetSocketId: data.callerSocketId });
        cleanupCall();
      }
    });

    // Caller Side (Jab receiver accept karta hai)
    socket.on("call-accepted", async (data) => {
      try {
        currentTargetRef.current = data.targetSocketId;
        const localStream = await startCamera();

        remoteDescriptionSetRef.current = false;
        pendingIceCandidatesRef.current = [];
        const peer = createPeer();
        addLocalTracks(peer, localStream);

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
        console.error("Call offer creation error:", err);
        cleanupCall();
      }
    });

    // Receiver Answer Handler
    socket.on("offer", async (data) => {
      try {
        currentTargetRef.current = data.callerSocketId;
        const localStream = await startCamera();

        let peer = peerRef.current;
        if (!peer) {
          remoteDescriptionSetRef.current = false;
          pendingIceCandidatesRef.current = [];
          peer = createPeer();
        }

        addLocalTracks(peer, localStream);
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

    // Caller Answer Receiver
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

    // ICE Candidate Handler
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

    return () => {
      cleanupCall();
      socket.disconnect();
    };
  }, [createPeer, addLocalTracks, startCamera, cleanupCall, flushPendingIceCandidates]);

  // Safe Call Device Trigger
  const handleCallDevice = (targetSocketId) => {
    if (!socketRef.current || !socketRef.current.connected) {
      alert("⚠️ Server connection lost. Please wait until status shows 🟢 Connected.");
      return;
    }
    if (inCall) return;

    currentTargetRef.current = targetSocketId;
    setInCall(true);
    setStatus("📞 Calling device...");
    socketRef.current.emit("call-device", { targetSocketId });
  };

  // Safe End Call Trigger
  const handleEndCall = () => {
    if (currentTargetRef.current && socketRef.current?.connected) {
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
              Open this app on another tab or device pointing to the same server URL.
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
                  disabled={inCall || device.status === "busy" || !isConnected}
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