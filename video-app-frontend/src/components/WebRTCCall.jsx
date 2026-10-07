import React, { useState, useEffect, useRef, useCallback } from "react";
import { io } from "socket.io-client";

// ---------------------------------------------------------------------------
// Server URL
// ---------------------------------------------------------------------------
const BACKEND_URL = "https://video-calling-app-z1ed.onrender.com";
const SERVER_URL = import.meta.env.VITE_SIGNALING_URL || BACKEND_URL;

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
  iceTransportPolicy: "all",
  iceCandidatePoolSize: 10,
};

// ---------------------------------------------------------------------------
// Small UI helpers (inline SVG icons, no extra dependency)
// ---------------------------------------------------------------------------
const ICONS = {
  mic: "M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z",
  micOff:
    "M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z",
  cam: "M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z",
  camOff:
    "M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2z",
  end: "M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z",
  call: "M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z",
  video:
    "M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z",
};

const Icon = ({ name, className = "w-6 h-6" }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d={ICONS[name]} />
  </svg>
);

const AVATAR_COLORS = ["#1a73e8", "#188038", "#e37400", "#a142f4", "#d93025", "#00897b"];

const initialsOf = (name = "") => {
  const code = name.replace(/^Device-/i, "");
  return (code.slice(0, 2) || "?").toUpperCase();
};

const colorOf = (name = "") => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
};

const Avatar = ({ name, size = 40, className = "" }) => (
  <div
    className={`flex items-center justify-center rounded-full font-medium text-white select-none shrink-0 ${className}`}
    style={{ width: size, height: size, background: colorOf(name), fontSize: size * 0.4 }}
  >
    {initialsOf(name)}
  </div>
);

const formatTime = (s) => {
  const m = Math.floor(s / 60).toString().padStart(2, "0");
  const sec = (s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
};

const ControlButton = ({ onClick, active = true, label, icon, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    title={label}
    className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8ab4f8] disabled:opacity-40 ${active
      ? "bg-[#3c4043] hover:bg-[#4a4e51] text-[#e8eaed]"
      : "bg-[#ea4335] hover:bg-[#d93025] text-white"
      }`}
  >
    <Icon name={icon} />
  </button>
);

// ---------------------------------------------------------------------------
const WebRTCCall = () => {
  const [socketId, setSocketId] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [deviceName, setDeviceName] = useState("");
  const [status, setStatus] = useState("Connecting to signaling server...");
  const [devices, setDevices] = useState([]);
  const [inCall, setInCall] = useState(false);

  // New UI state
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [remoteReady, setRemoteReady] = useState(false);
  const [remoteName, setRemoteName] = useState("");
  const [incomingCall, setIncomingCall] = useState(null);
  const [toast, setToast] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [clock, setClock] = useState(new Date());

  const socketRef = useRef(null);
  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const currentTargetRef = useRef(null);
  const remoteDescriptionSetRef = useRef(false);
  const pendingIceCandidatesRef = useRef([]);
  const incomingRef = useRef(null);
  const toastTimerRef = useRef(null);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  // -------------------------------------------------------------------------
  // Toast (replaces alert)
  // -------------------------------------------------------------------------
  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(""), 4000);
  }, []);

  // Clock + call timer
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!inCall || !remoteReady) {
      setSeconds(0);
      return;
    }
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [inCall, remoteReady]);

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
    setRemoteReady(false);
    setMicOn(true);
    setCamOn(true);
    setRemoteName("");
    setStatus("Ready for another call");
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

    if (!navigator.mediaDevices?.getUserMedia) {
      const msg =
        "Camera/Mic blocked. Open this app over HTTPS (or http://localhost).";
      showToast(msg);
      throw new Error(msg);
    }

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
      }
      return stream;
    } catch (error) {
      console.error("Camera/Mic Error:", error);
      showToast("Camera or microphone is unavailable. Allow access and try again.");
      throw error;
    }
  }, [showToast]);

  // -------------------------------------------------------------------------
  // Mic / Camera toggles
  // -------------------------------------------------------------------------
  const toggleMic = () => {
    const tracks = localStreamRef.current?.getAudioTracks() || [];
    const next = !micOn;
    tracks.forEach((t) => (t.enabled = next));
    setMicOn(next);
  };

  const toggleCam = () => {
    const tracks = localStreamRef.current?.getVideoTracks() || [];
    const next = !camOn;
    tracks.forEach((t) => (t.enabled = next));
    setCamOn(next);
  };

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
  // Peer Connection Setup
  // -------------------------------------------------------------------------
  const createPeer = useCallback(() => {
    if (peerRef.current) peerRef.current.close();

    const peer = new RTCPeerConnection(RTC_CONFIG);
    remoteStreamRef.current = new MediaStream();
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStreamRef.current;
    }

    peer.ontrack = (event) => {
      let stream = event.streams && event.streams[0];
      if (!stream) {
        stream = remoteStreamRef.current;
        stream.addTrack(event.track);
      }
      remoteStreamRef.current = stream;

      if (remoteVideoRef.current && remoteVideoRef.current.srcObject !== stream) {
        remoteVideoRef.current.srcObject = stream;
      }
      if (event.track.kind === "video") setRemoteReady(true);
    };

    peer.onicecandidate = (event) => {
      if (!event.candidate) return;

      if (currentTargetRef.current && socketRef.current?.connected) {
        socketRef.current.emit("ice-candidate", {
          targetSocketId: currentTargetRef.current,
          candidate: event.candidate,
        });
      }
    };

    peer.oniceconnectionstatechange = () => {
      const s = peer.iceConnectionState;
      if (s === "connected" || s === "completed") {
        setStatus("Media connection established");
      }
      if (s === "failed") {
        setStatus("ICE failed");
      }
    };

    peer.onconnectionstatechange = () => {
      const state = peer.connectionState;

      if (state === "connected") {
        setStatus("Video call connected");
      } else if (state === "connecting") {
        setStatus("Connecting...");
      } else if (state === "disconnected") {
        setStatus("Connection unstable, trying to recover...");
        setTimeout(() => {
          if (peerRef.current?.connectionState === "disconnected") {
            cleanupCall();
          }
        }, 5000);
      } else if (state === "failed") {
        setStatus("Connection failed");
        showToast("Connection failed. Try calling again.");
        cleanupCall();
      }
    };

    peerRef.current = peer;
    return peer;
  }, [cleanupCall, showToast]);

  // -------------------------------------------------------------------------
  // Incoming call: accept / decline (modal replaces window.confirm)
  // -------------------------------------------------------------------------
  const acceptCall = async () => {
    const data = incomingRef.current;
    const socket = socketRef.current;
    if (!data || !socket) return;

    incomingRef.current = null;
    setIncomingCall(null);

    try {
      currentTargetRef.current = data.callerSocketId;
      setRemoteName(data.caller?.deviceName || "Unknown device");
      setInCall(true);
      setStatus("Starting camera...");

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
  };

  const declineCall = () => {
    const data = incomingRef.current;
    if (data && socketRef.current) {
      socketRef.current.emit("call-rejected", { targetSocketId: data.callerSocketId });
    }
    incomingRef.current = null;
    setIncomingCall(null);
  };

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
      setStatus("Connected to signaling server");

      socket.emit("register-device", { deviceId: devId, deviceName: devName });
      socket.emit("get-devices");
    });

    socket.on("disconnect", (reason) => {
      setIsConnected(false);
      setStatus(`Disconnected from server (${reason})`);
    });

    socket.on("connect_error", (err) => {
      setIsConnected(false);
      setStatus("Connection failed. Check backend URL / CORS.");
      console.error("Socket error details:", err.message);
    });

    socket.on("device-list", (deviceList) => {
      setDevices(deviceList);
    });

    // Incoming call receiver
    socket.on("incoming-call", (data) => {
      if (currentTargetRef.current || incomingRef.current) {
        socket.emit("call-rejected", { targetSocketId: data.callerSocketId });
        return;
      }
      incomingRef.current = data;
      setIncomingCall(data);
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

        setStatus("Connecting...");
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

        setStatus("Connecting...");
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
      showToast("Call declined.");
      cleanupCall();
    });

    socket.on("call-error", (data) => {
      showToast(data?.message || "Unable to call this device.");
      cleanupCall();
    });

    socket.on("call-ended", () => {
      // caller may hang up while our incoming-call modal is still open
      incomingRef.current = null;
      setIncomingCall(null);
      cleanupCall();
      showToast("The call has ended.");
    });

    return () => {
      cleanupCall();
      socket.disconnect();
    };
  }, [
    createPeer,
    addLocalTracks,
    startCamera,
    cleanupCall,
    flushPendingIceCandidates,
    showToast,
  ]);

  // -------------------------------------------------------------------------
  // Call / End call triggers
  // -------------------------------------------------------------------------
  const handleCallDevice = (device) => {
    if (!socketRef.current || !socketRef.current.connected) {
      showToast("Server connection lost. Wait until it reconnects.");
      return;
    }
    if (inCall) return;

    currentTargetRef.current = device.socketId;
    setRemoteName(device.deviceName);
    setInCall(true);
    setStatus(`Calling ${device.deviceName}...`);
    socketRef.current.emit("call-device", { targetSocketId: device.socketId });
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

  const timeLabel = clock.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const dateLabel = clock.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  // -------------------------------------------------------------------------
  // UI
  // -------------------------------------------------------------------------
  return (
    <div
      className="min-h-screen bg-white text-[#202124]"
      style={{ fontFamily: "'Google Sans', 'Product Sans', Roboto, 'Segoe UI', Arial, sans-serif" }}
    >
      {/* ------------------------------ LOBBY ------------------------------ */}
      <div className={inCall ? "hidden" : "flex flex-col min-h-screen"}>
        <header className="flex items-center justify-between px-4 sm:px-6 py-3">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-[#1a73e8] flex items-center justify-center text-white">
              <Icon name="video" className="w-5 h-5" />
            </div>
            <span className="text-[22px] text-[#5f6368]">
              Video <span className="font-medium">Call</span>
            </span>
          </div>
          <div className="flex items-center gap-4 text-[#5f6368] text-sm sm:text-base">
            <span className="hidden sm:inline">
              {timeLabel} &bull; {dateLabel}
            </span>
            <Avatar name={deviceName} size={36} />
          </div>
        </header>

        <main className="flex-1 grid md:grid-cols-2 gap-10 items-center max-w-6xl w-full mx-auto px-6 py-8">
          {/* Left: intro + own device */}
          <section>
            <h1 className="text-4xl sm:text-[44px] leading-[1.15] font-normal text-[#202124] mb-4">
              Video calls for any device, anywhere
            </h1>
            <p className="text-lg text-[#5f6368] mb-8 max-w-md">
              Open this page on a second device, pick it from the list, and start
              talking.
            </p>

            <div className="inline-flex items-center gap-4 rounded-2xl border border-[#dadce0] px-5 py-4">
              <Avatar name={deviceName} size={48} />
              <div>
                <div className="font-medium text-[#202124]">
                  {deviceName || "Connecting..."}{" "}
                  <span className="text-[#5f6368] font-normal">(You)</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-[#5f6368]">
                  <span
                    className={`w-2 h-2 rounded-full ${isConnected ? "bg-[#188038]" : "bg-[#e37400]"
                      }`}
                  />
                  {status}
                </div>
                {socketId && (
                  <div className="text-xs text-[#80868b] font-mono mt-0.5">{socketId}</div>
                )}
              </div>
            </div>
          </section>

          {/* Right: people list */}
          <section className="rounded-3xl border border-[#dadce0] shadow-[0_1px_3px_rgba(60,64,67,.15)] overflow-hidden">
            <div className="px-6 py-4 border-b border-[#dadce0] flex items-center justify-between">
              <h2 className="text-lg font-medium">Available devices</h2>
              <span className="text-sm text-[#5f6368]">{otherDevices.length} online</span>
            </div>

            {otherDevices.length === 0 ? (
              <div className="px-6 py-14 text-center text-[#5f6368]">
                <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-[#f1f3f4] flex items-center justify-center">
                  <Icon name="video" className="w-7 h-7 text-[#80868b]" />
                </div>
                No other devices online.
                <br />
                Open this URL on another device to see it here.
              </div>
            ) : (
              <ul className="max-h-[420px] overflow-y-auto divide-y divide-[#f1f3f4]">
                {otherDevices.map((device) => {
                  const busy = device.status === "busy";
                  return (
                    <li
                      key={device.socketId}
                      className="flex items-center gap-4 px-6 py-3 hover:bg-[#f8f9fa]"
                    >
                      <Avatar name={device.deviceName} size={44} />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{device.deviceName}</div>
                        <div
                          className={`text-sm ${busy ? "text-[#d93025]" : "text-[#188038]"}`}
                        >
                          {busy ? "In a call" : "Available"}
                        </div>
                      </div>
                      <button
                        disabled={inCall || busy || !isConnected}
                        onClick={() => handleCallDevice(device)}
                        className="flex items-center gap-2 rounded-full bg-[#1a73e8] hover:bg-[#1765cc] disabled:bg-[#e8eaed] disabled:text-[#9aa0a6] disabled:cursor-not-allowed text-white text-sm font-medium px-5 py-2.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1a73e8]"
                      >
                        <Icon name="video" className="w-5 h-5" />
                        Call
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </main>
      </div>

      {/* ----------------------------- IN CALL ----------------------------- */}
      <div
        className={
          inCall
            ? "fixed inset-0 z-30 flex flex-col bg-[#202124] text-[#e8eaed]"
            : "hidden"
        }
      >
        {/* Stage */}
        <div className="relative flex-1 min-h-0 p-3 sm:p-4">
          <div className="relative w-full h-full rounded-2xl overflow-hidden bg-[#3c4043]">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className={`w-full h-full object-contain bg-black ${remoteReady ? "opacity-100" : "opacity-0"
                }`}
            />

            {!remoteReady && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#3c4043]">
                <Avatar name={remoteName} size={112} />
                <div className="text-xl">{remoteName || "Connecting..."}</div>
                <div className="text-sm text-[#9aa0a6] animate-pulse">{status}</div>
              </div>
            )}

            {remoteReady && (
              <div className="absolute left-4 bottom-4 rounded-md bg-black/60 px-2.5 py-1 text-sm">
                {remoteName}
              </div>
            )}

            {/* Self view */}
            <div className="absolute right-3 bottom-3 sm:right-4 sm:bottom-4 w-36 sm:w-60 aspect-video rounded-xl overflow-hidden bg-[#202124] border border-white/10 shadow-xl">
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                className={`w-full h-full object-cover -scale-x-100 ${camOn ? "opacity-100" : "opacity-0"
                  }`}
              />
              {!camOn && (
                <div className="absolute inset-0 flex items-center justify-center bg-[#3c4043]">
                  <Avatar name={deviceName} size={56} />
                </div>
              )}
              <div className="absolute left-2 bottom-2 flex items-center gap-1.5 rounded bg-black/60 px-2 py-0.5 text-xs">
                You
                {!micOn && <Icon name="micOff" className="w-3.5 h-3.5 text-[#f28b82]" />}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="h-20 shrink-0 grid grid-cols-3 items-center px-4 sm:px-6">
          <div className="hidden sm:flex items-center gap-3 text-[15px] min-w-0">
            <span className="tabular-nums">{remoteReady ? formatTime(seconds) : "--:--"}</span>
            <span className="w-px h-4 bg-white/20" />
            <span className="truncate text-[#bdc1c6]">{remoteName}</span>
          </div>

          <div className="col-span-3 sm:col-span-1 flex items-center justify-center gap-3">
            <ControlButton
              onClick={toggleMic}
              active={micOn}
              icon={micOn ? "mic" : "micOff"}
              label={micOn ? "Turn off microphone" : "Turn on microphone"}
            />
            <ControlButton
              onClick={toggleCam}
              active={camOn}
              icon={camOn ? "cam" : "camOff"}
              label={camOn ? "Turn off camera" : "Turn on camera"}
            />
            <button
              onClick={handleEndCall}
              aria-label="Leave call"
              title="Leave call"
              className="h-12 w-16 rounded-full bg-[#ea4335] hover:bg-[#d93025] text-white flex items-center justify-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <Icon name="end" />
            </button>
          </div>

          <div className="hidden sm:block" />
        </div>
      </div>

      {/* -------------------------- INCOMING CALL -------------------------- */}
      {incomingCall && (
        <div className="fixed inset-0 z-40 flex items-start sm:items-center justify-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-label="Incoming call"
            className="mt-10 sm:mt-0 w-full max-w-sm rounded-3xl bg-[#202124] text-[#e8eaed] p-6 shadow-2xl"
          >
            <div className="flex flex-col items-center text-center">
              <Avatar name={incomingCall.caller?.deviceName} size={80} />
              <div className="mt-4 text-xl font-medium">
                {incomingCall.caller?.deviceName || "Unknown device"}
              </div>
              <div className="text-sm text-[#9aa0a6] mt-1">Incoming video call</div>
            </div>
            <div className="mt-6 flex items-center justify-center gap-6">
              <button
                onClick={declineCall}
                aria-label="Decline"
                className="w-14 h-14 rounded-full bg-[#ea4335] hover:bg-[#d93025] text-white flex items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <Icon name="end" className="w-7 h-7" />
              </button>
              <button
                onClick={acceptCall}
                aria-label="Accept"
                className="w-14 h-14 rounded-full bg-[#188038] hover:bg-[#137333] text-white flex items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <Icon name="call" className="w-7 h-7" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------ TOAST ------------------------------ */}
      {toast && (
        <div
          role="status"
          className="fixed left-1/2 -translate-x-1/2 bottom-24 z-50 max-w-[90vw] rounded-lg bg-[#323232] px-5 py-3 text-sm text-white shadow-lg"
        >
          {toast}
        </div>
      )}
    </div>
  );
};

export default WebRTCCall;