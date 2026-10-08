import { useState, useEffect, useRef, useCallback } from "react";
import { io } from "socket.io-client";
import { SERVER_URL, RTC_CONFIG } from "./constants";

const RING_TIMEOUT_MS = 30000;
const ACK_TIMEOUT_MS = 6000;

const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Saara signaling + WebRTC + chat logic yaha hai.
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
  const [remoteSocketId, setRemoteSocketId] = useState("");
  const [incomingCall, setIncomingCall] = useState(null);
  const [toast, setToast] = useState("");
  const [seconds, setSeconds] = useState(0);

  // Chat state
  const [chatTarget, setChatTarget] = useState(null); // { socketId, deviceName } | null
  const [messages, setMessages] = useState({}); // { [socketId]: Message[] }
  const [unread, setUnread] = useState({}); // { [socketId]: number }
  const [typing, setTyping] = useState({}); // { [socketId]: boolean }
  const [chatSupported, setChatSupported] = useState(false); // server "server-info" bhejta hai

  const socketRef = useRef(null);
  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const currentTargetRef = useRef(null);
  const remoteDescriptionSetRef = useRef(false);
  const pendingIceCandidatesRef = useRef([]);
  const incomingRef = useRef(null);
  const toastTimerRef = useRef(null);
  const ringTimerRef = useRef(null);
  const callAcceptedRef = useRef(false);
  const chatTargetRef = useRef(null);
  const typingTimersRef = useRef({});
  const chatSupportedRef = useRef(false);

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
    clearTimeout(ringTimerRef.current);
    callAcceptedRef.current = false;

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
    setRemoteSocketId("");
    setStatus("Ready for another call");

    // Server se fresh device list mangao, taaki busy/available status sahi dikhe
    if (socketRef.current?.connected) socketRef.current.emit("get-devices");
  }, []);

  // Server ko bhi batao ki call khatam (sirf local cleanup kaafi nahi hai)
  const leaveCall = useCallback(() => {
    if (currentTargetRef.current && socketRef.current?.connected) {
      socketRef.current.emit("end-call", {
        targetSocketId: currentTargetRef.current,
      });
    }
    cleanupCall();
  }, [cleanupCall]);

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
          if (peerRef.current === peer && peer.connectionState === "disconnected") {
            leaveCall();
          }
        }, 5000);
      } else if (state === "failed") {
        setStatus("Connection failed");
        showToast("Connection failed. Try calling again.");
        leaveCall();
      }
    };

    peerRef.current = peer;
    return peer;
  }, [leaveCall, showToast]);

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
      setRemoteSocketId(data.callerSocketId);
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

  // ------------------------------------------------------------------ Chat
  const openChat = useCallback((device) => {
    if (!device?.socketId) return;
    const target = { socketId: device.socketId, deviceName: device.deviceName };
    chatTargetRef.current = target;
    setChatTarget(target);
    setUnread((prev) => {
      if (!prev[device.socketId]) return prev;
      const next = { ...prev };
      delete next[device.socketId];
      return next;
    });
  }, []);

  const closeChat = useCallback(() => {
    chatTargetRef.current = null;
    setChatTarget(null);
  }, []);

  // Call ke andar chat button: peer ke saath chat open/close
  const toggleCallChat = useCallback(() => {
    if (!remoteSocketId) return;
    if (chatTarget?.socketId === remoteSocketId) {
      closeChat();
    } else {
      openChat({ socketId: remoteSocketId, deviceName: remoteName });
    }
  }, [remoteSocketId, remoteName, chatTarget, openChat, closeChat]);

  const updateMessageStatus = useCallback((targetSocketId, clientId, status) => {
    setMessages((prev) => {
      const list = prev[targetSocketId];
      if (!list) return prev;
      return {
        ...prev,
        [targetSocketId]: list.map((m) => (m.id === clientId ? { ...m, status } : m)),
      };
    });
  }, []);

  const failIfPending = useCallback((targetSocketId, clientId) => {
    setMessages((prev) => {
      const list = prev[targetSocketId];
      if (!list) return prev;
      return {
        ...prev,
        [targetSocketId]: list.map((m) =>
          m.id === clientId && m.status === "sending" ? { ...m, status: "failed" } : m
        ),
      };
    });
  }, []);

  const sendMessage = useCallback(
    (text) => {
      const target = chatTargetRef.current;
      const socket = socketRef.current;
      const clean = (text || "").trim();
      if (!target || !clean) return;

      if (!socket?.connected) {
        showToast("Server connection lost. Message not sent.");
        return;
      }

      if (!chatSupportedRef.current) {
        showToast("Chat isn't available: the backend server needs to be updated and redeployed.");
        return;
      }

      const clientId = makeId();
      setMessages((prev) => ({
        ...prev,
        [target.socketId]: [
          ...(prev[target.socketId] || []),
          { id: clientId, sender: "me", text: clean, timestamp: Date.now(), status: "sending" },
        ],
      }));

      socket.emit("send-private-message", {
        targetSocketId: target.socketId,
        message: clean,
        clientId,
      });

      // Ack na aaye to "Not delivered" dikhao (silently atka na rahe)
      setTimeout(() => failIfPending(target.socketId, clientId), ACK_TIMEOUT_MS);
    },
    [showToast, failIfPending]
  );

  const sendTyping = useCallback((isTyping) => {
    const target = chatTargetRef.current;
    if (!target || !socketRef.current?.connected) return;
    socketRef.current.emit("typing-indicator", {
      targetSocketId: target.socketId,
      isTyping,
    });
  }, []);

  // ------------------------------------------------------ Socket lifecycle
  useEffect(() => {
    // sessionStorage: har browser tab apna alag device hai (same browser ke 2 tab
    // ab ek-doosre ko evict nahi karte), aur refresh par naam wahi rehta hai.
    let devId = sessionStorage.getItem("deviceId");
    if (!devId) {
      devId = "device-" + Date.now() + "-" + Math.random().toString(36).substring(2, 10);
      sessionStorage.setItem("deviceId", devId);
    }
    const devName = "Device-" + devId.slice(-5).toUpperCase();
    setDeviceName(devName);

    const socket = io(SERVER_URL, {
      transports: ["websocket", "polling"],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;
    const typingTimers = typingTimersRef.current;

    socket.on("server-info", (info) => {
      const supported = Boolean(info?.chat);
      chatSupportedRef.current = supported;
      setChatSupported(supported);
    });

    socket.on("connect", () => {
      chatSupportedRef.current = false;
      setChatSupported(false);

      // Reconnect hone par server purani call khatam kar chuka hota hai,
      // lekin hume "call-ended" mila nahi (hum offline the) -> local state saaf karo.
      if (currentTargetRef.current || incomingRef.current) {
        incomingRef.current = null;
        setIncomingCall(null);
        cleanupCall();
        showToast("Connection was lost. The call has ended.");
      }

      setSocketId(socket.id);
      setIsConnected(true);
      setStatus("Connected to signaling server");

      socket.emit("register-device", { deviceId: devId, deviceName: devName });
      socket.emit("get-devices");
    });

    socket.on("disconnect", (reason) => {
      chatSupportedRef.current = false;
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
        clearTimeout(ringTimerRef.current);
        callAcceptedRef.current = true;
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
        leaveCall(); // partner ko bhi batao, warna wo call me atka rehta hai
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
        leaveCall();
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

    // ------------------------------------------------------------- Chat events
    socket.on("receive-private-message", (m) => {
      const from = m.senderSocketId;

      setMessages((prev) => ({
        ...prev,
        [from]: [
          ...(prev[from] || []),
          { id: m.id, sender: "them", text: m.message, timestamp: m.timestamp },
        ],
      }));
      setTyping((prev) => ({ ...prev, [from]: false }));

      // Is device ka chat abhi khula nahi hai -> unread badge + toast
      if (chatTargetRef.current?.socketId !== from) {
        setUnread((prev) => ({ ...prev, [from]: (prev[from] || 0) + 1 }));
        showToast(`New message from ${m.senderName || "a device"}`);
      }
    });

    socket.on("user-typing", ({ senderSocketId, isTyping }) => {
      clearTimeout(typingTimers[senderSocketId]);
      setTyping((prev) => ({ ...prev, [senderSocketId]: Boolean(isTyping) }));
      if (isTyping) {
        // agar "stopped typing" event miss ho jaye to indicator khud hat jaye
        typingTimers[senderSocketId] = setTimeout(() => {
          setTyping((prev) => ({ ...prev, [senderSocketId]: false }));
        }, 4000);
      }
    });

    socket.on("message-sent-ack", ({ targetSocketId, clientId }) => {
      updateMessageStatus(targetSocketId, clientId, "delivered");
    });

    socket.on("message-error", ({ targetSocketId, clientId, message }) => {
      updateMessageStatus(targetSocketId, clientId, "failed");
      showToast(message || "Message was not delivered.");
    });

    return () => {
      Object.values(typingTimers).forEach(clearTimeout);
      cleanupCall();
      socket.disconnect();
    };
  }, [
    createPeer,
    addLocalTracks,
    startCamera,
    cleanupCall,
    leaveCall,
    flushPendingIceCandidates,
    updateMessageStatus,
    showToast,
  ]);

  // ------------------------------------------------- Call / end call actions
  const handleCallDevice = useCallback(
    (device) => {
      if (!socketRef.current || !socketRef.current.connected) {
        showToast("Server connection lost. Wait until it reconnects.");
        return;
      }
      if (inCall || incomingRef.current) return;

      callAcceptedRef.current = false;
      currentTargetRef.current = device.socketId;
      setRemoteName(device.deviceName);
      setRemoteSocketId(device.socketId);
      setInCall(true);
      setStatus(`Calling ${device.deviceName}...`);
      socketRef.current.emit("call-device", { targetSocketId: device.socketId });

      // Koi jawab na de to ring cancel (callee ka popup bhi band ho jata hai)
      clearTimeout(ringTimerRef.current);
      ringTimerRef.current = setTimeout(() => {
        if (!callAcceptedRef.current && currentTargetRef.current === device.socketId) {
          showToast(`${device.deviceName} did not answer.`);
          leaveCall();
        }
      }, RING_TIMEOUT_MS);
    },
    [inCall, showToast, leaveCall]
  );

  const handleEndCall = leaveCall;

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
    remoteSocketId,
    incomingCall,
    toast,
    seconds,
    // chat state
    chatTarget,
    messages,
    unread,
    typing,
    chatSupported,
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
    // chat actions
    openChat,
    closeChat,
    toggleCallChat,
    sendMessage,
    sendTyping,
  };
};

export default useWebRTCCall;
