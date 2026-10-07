import { useState, useEffect, useRef, useCallback } from "react";
import { io } from "socket.io-client";
import { SERVER_URL, RTC_CONFIG } from "./constants";

/**
 * Saara signaling + WebRTC logic yaha hai.
 * UI components sirf iska return value use karte hain.
 */
const useWebRTCCall = () => {
  const [socketId, setSocketId] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [deviceName, setDeviceName] = useState("");
  const [status, setStatus] = useState("Connecting to signaling server...");
  const [devices, setDevices] = useState([]);
  const [inCall, setInCall] = useState(false);

  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [remoteReady, setRemoteReady] = useState(false);
  const [remoteName, setRemoteName] = useState("");
  const [incomingCall, setIncomingCall] = useState(null);
  const [toast, setToast] = useState("");
  const [seconds, setSeconds] = useState(0);

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

  // ---------------------------------------------------------------- Toast
  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(""), 4000);
  }, []);

  // ---------------------------------------------------------- Call timer
  useEffect(() => {
    if (!inCall || !remoteReady) {
      setSeconds(0);
      return;
    }
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [inCall, remoteReady]);

  // -------------------------------------------------------- Call cleanup
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

  // ------------------------------------------------ Flush queued ICE
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

  // ------------------------------------------------- Camera & mic access
  const startCamera = useCallback(async () => {
    if (localStreamRef.current) return localStreamRef.current;

    if (!navigator.mediaDevices?.getUserMedia) {
      const msg = "Camera/Mic blocked. Open this app over HTTPS (or http://localhost).";
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

  // ------------------------------------------------ Mic / camera toggles
  const toggleMic = useCallback(() => {
    const next = !micOn;
    (localStreamRef.current?.getAudioTracks() || []).forEach((t) => (t.enabled = next));
    setMicOn(next);
  }, [micOn]);

  const toggleCam = useCallback(() => {
    const next = !camOn;
    (localStreamRef.current?.getVideoTracks() || []).forEach((t) => (t.enabled = next));
    setCamOn(next);
  }, [camOn]);

  // ------------------------------------- Local tracks ko peer me add karna
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

  // ------------------------------------------------ Peer connection setup
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

  // --------------------------------------------- Incoming call accept/decline
  const acceptCall = useCallback(async () => {
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
  }, [startCamera, createPeer, addLocalTracks, cleanupCall]);

  const declineCall = useCallback(() => {
    const data = incomingRef.current;
    if (data && socketRef.current) {
      socketRef.current.emit("call-rejected", { targetSocketId: data.callerSocketId });
    }
    incomingRef.current = null;
    setIncomingCall(null);
  }, []);

  // ------------------------------------------------------ Socket lifecycle
  useEffect(() => {
    let devId = localStorage.getItem("deviceId");
    if (!devId) {
      devId = "device-" + Date.now() + "-" + Math.random().toString(36).substring(2, 10);
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

        socket.emit("offer", { targetSocketId: data.targetSocketId, offer });
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

        socket.emit("answer", { targetSocketId: data.callerSocketId, answer });
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
        await peerRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
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
      // caller ring ke beech cut kare to incoming popup bhi band ho
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

  // ------------------------------------------------- Call / end call actions
  const handleCallDevice = useCallback(
    (device) => {
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
    },
    [inCall, showToast]
  );

  const handleEndCall = useCallback(() => {
    if (currentTargetRef.current && socketRef.current?.connected) {
      socketRef.current.emit("end-call", {
        targetSocketId: currentTargetRef.current,
      });
    }
    cleanupCall();
  }, [cleanupCall]);

  const otherDevices = devices.filter((d) => d.socketId !== socketId);

  return {
    // state
    socketId,
    isConnected,
    deviceName,
    status,
    otherDevices,
    inCall,
    micOn,
    camOn,
    remoteReady,
    remoteName,
    incomingCall,
    toast,
    seconds,
    // refs
    localVideoRef,
    remoteVideoRef,
    // actions
    toggleMic,
    toggleCam,
    acceptCall,
    declineCall,
    handleCallDevice,
    handleEndCall,
  };
};

export default useWebRTCCall;
