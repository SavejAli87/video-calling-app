import React, { useState, useEffect, useRef, useCallback } from "react";
import { io } from "socket.io-client";

// ---------------------------------------------------------------------------
// Server URL
// Vercel/Netlify WebSocket proxy nahi karte, isliye seedha Render backend use karo.
// ---------------------------------------------------------------------------
const BACKEND_URL = "https://video-calling-app-z1ed.onrender.com";
const SERVER_URL = import.meta.env.VITE_SIGNALING_URL || BACKEND_URL;

// ---------------------------------------------------------------------------
// WebRTC config
// TURN credentials .env me rakho:
//   VITE_TURN_USER=xxxx
//   VITE_TURN_CRED=xxxx
// (purane credentials jo code me the, unhe rotate/change kar do)
// ---------------------------------------------------------------------------
const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: [
        "turn:free.expressturn.com:3478?transport=udp",
        "turn:free.expressturn.com:3478?transport=tcp",
      ],
      username: import.meta.env.VITE_TURN_USER,
      credential: import.meta.env.VITE_TURN_CRED,
    },
  ],
  // "all" = direct + TURN fallback. Sirf debugging ke liye "relay" use karo.
  iceTransportPolicy: "all",
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

  // -------------------------------------------------------------------------
  // Call Cleanup
  // -------------------------------------------------------------------------
  const cleanupCall = useCallback(() => {
    if (peerRef.current) {
      peerRef.current.onicecandidate = null;
      peerRef.current.ontrack = null;
      peerRef.current.onconnectionstatechange = null;
      peerRef.current.oniceconnectionstatechange = null;
      peerRef.current.onicecandidateerror = null;
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

  // -------------------------------------------------------------------------
  // Flush Queued ICE Candidates
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // Camera & Mic Access
  // -------------------------------------------------------------------------
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
        "1. Open using HTTPS (e.g. your Vercel/Netlify URL)\n" +
        "2. Open using http://localhost:5173";
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
        : await new Promise((resolve, reject) =>
          getMedia(constraints, resolve, reject)
        );

      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      return stream;
    } catch (error) {
      console.error("Camera/Mic Error:", error);
      alert("Camera/Microphone permission denied or unavailable:\n\n" + error.message);
      throw error;
    }
  }, []);

  // -------------------------------------------------------------------------
  // Local tracks ko peer connection me add karna
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // Peer Connection Setup (har handler sirf ek baar)
  // -------------------------------------------------------------------------
  const createPeer = useCallback(() => {
    if (peerRef.current) {
      peerRef.current.close();
    }

    const peer = new RTCPeerConnection(RTC_CONFIG);
    remoteStreamRef.current = new MediaStream();

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStreamRef.current;
    }

    // Remote track receiver
    peer.ontrack = (event) => {
      let stream = event.streams && event.streams[0];
      if (!stream) {
        stream = remoteStreamRef.current;
        stream.addTrack(event.track);
      }
      remoteStreamRef.current = stream;

      // Sirf tab set karo jab alag stream ho -> AbortError nahi aayega
      if (remoteVideoRef.current && remoteVideoRef.current.srcObject !== stream) {
        remoteVideoRef.current.srcObject = stream;
      }
    };

    // ICE candidate doosre peer ko bhejna (sabse important)
    peer.onicecandidate = (event) => {
      if (!event.candidate) {
        console.log("🧊 ICE gathering completed");
        return;
      }
      console.log("🧊 ICE candidate:", event.candidate.candidate);

      if (currentTargetRef.current && socketRef.current?.connected) {
        socketRef.current.emit("ice-candidate", {
          targetSocketId: currentTargetRef.current,
          candidate: event.candidate,
        });
      }
    };

    peer.onicecandidateerror = (e) => {
      console.warn("ICE candidate error:", e.url, e.errorCode, e.errorText);
    };

    peer.oniceconnectionstatechange = () => {
      const s = peer.iceConnectionState;
      console.log("ICE state:", s);
      if (s === "connected" || s === "completed") {
        setStatus("🟢 Media connection established");
      }
      if (s === "failed") {
        setStatus("🔴 ICE failed");
      }
    };

    peer.onconnectionstatechange = () => {
      const state = peer.connectionState;
      console.log("Peer state:", state);

      if (state === "connected") {
        setStatus("🟢 Video call connected");
      } else if (state === "connecting") {
        setStatus("🟡 Connecting peer...");
      } else if (state === "disconnected") {
        setStatus("🟡 Connection unstable, trying to recover...");
        // Network recover hone ke liye 5 sec ka time do
        setTimeout(() => {
          if (peerRef.current?.connectionState === "disconnected") {
            cleanupCall();
          }
        }, 5000);
      } else if (state === "failed") {
        setStatus("🔴 WebRTC connection failed");
        cleanupCall();
      }
    };

    peerRef.current = peer;
    return peer;
  }, [cleanupCall]);

  // -------------------------------------------------------------------------
  // Socket Lifecycle
  // -------------------------------------------------------------------------
  useEffect(() => {
    let devId = localStorage.getItem("deviceId");
    if (!devId) {
      devId =
        "device-" + Date.now() + "-" + Math.random().toString(36).substring(2, 10);
      localStorage.setItem("deviceId", devId);
    }
    const devName = "Device-" + devId.slice(-5).toUpperCase();
    setDeviceName(devName);

    const socket = io(SERVER_URL, {
      transports: ["websocket", "polling"],
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
      setStatus("🔴 Connection failed (Check backend URL / CORS)");
      console.error("Socket error details:", err.message);
    });

    socket.on("device-list", (deviceList) => {
      setDevices(deviceList);
    });

    // Incoming call receiver
    socket.on("incoming-call", async (data) => {
      if (currentTargetRef.current) {
        socket.emit("call-rejected", { targetSocketId: data.callerSocketId });
        return;
      }

      const caller = data.caller?.deviceName || "Unknown Device";
      const accept = window.confirm(
        `📞 Incoming Video Call\n\n${caller} is calling you.\n\nAccept?`
      );

      if (!accept) {
        socket.emit("call-rejected", { targetSocketId: data.callerSocketId });
        return;
      }

      try {
        currentTargetRef.current = data.callerSocketId;
        setInCall(true);
        setStatus("📞 Call accepted. Starting camera...");

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

    // Caller side
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

    // Receiver: offer handle karke answer bhejna
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

    // Caller: answer receive karna
    socket.on("answer", async (data) => {
      try {
        if (!peerRef.current) return;
        await peerRef.current.setRemoteDescription(
          new RTCSessionDescription(data.answer)
        );
        remoteDescriptionSetRef.current = true;
        await flushPendingIceCandidates();
      } catch (err) {
        console.error("Answer error:", err);
      }
    });

    // ICE candidate handler
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

  // -------------------------------------------------------------------------
  // Call / End call triggers
  // -------------------------------------------------------------------------
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

  const handleEndCall = () => {
    if (currentTargetRef.current && socketRef.current?.connected) {
      socketRef.current.emit("end-call", {
        targetSocketId: currentTargetRef.current,
      });
    }
    cleanupCall();
  };

  const otherDevices = devices.filter((d) => d.socketId !== socketRef.current?.id);

  // -------------------------------------------------------------------------
  // UI
  // -------------------------------------------------------------------------
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
              Open this URL on another device or mobile phone.
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