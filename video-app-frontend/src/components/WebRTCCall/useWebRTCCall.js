import { useState, useEffect, useRef, useCallback } from "react";
import { io } from "socket.io-client";
import {
  SERVER_URL,
  RTC_CONFIG,
  NAME_KEY,
  MAX_NAME_LENGTH,
  DEVICE_ID_KEY,
  FRIENDS_KEY,
  SOUND_KEY,
  MESSAGE_TTL_MS,
} from "./constants";
import { normalizeName, pruneExpired, mergeMessages, toDeletedMessage } from "./utils";
import { loadMessages, putMessages, deleteMessages } from "./messageStore";
import {
  unlockAudio,
  setSoundEnabled,
  startRingtone,
  stopRingtone,
  startRingback,
  stopRingback,
  playMessageTone,
} from "./sounds";

const RING_TIMEOUT_MS = 30000;
const ACK_TIMEOUT_MS = 6000;

// ----------------------------------------------------------------- storage
const loadName = () => {
  try {
    return normalizeName(localStorage.getItem(NAME_KEY), MAX_NAME_LENGTH);
  } catch {
    return "";
  }
};

const loadSound = () => {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
};

// Permanent device identity: friendship isi device ke saath bandhi hai.
const getDeviceId = () => {
  const fresh = () =>
    "device-" + Date.now() + "-" + Math.random().toString(36).substring(2, 10);
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = fresh();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return fresh(); // storage blocked: is session ke liye temporary id
  }
};

// [{ id: publicId, name: lastKnownName }]
const loadFriends = () => {
  try {
    const arr = JSON.parse(localStorage.getItem(FRIENDS_KEY) || "[]");
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((f) => f && typeof f.id === "string")
      .map((f) => ({ id: f.id, name: String(f.name || "") }));
  } catch {
    return [];
  }
};

const saveFriends = (list) => {
  try {
    localStorage.setItem(FRIENDS_KEY, JSON.stringify(list));
  } catch {
    /* storage blocked */
  }
};

const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Saara signaling + WebRTC + chat + friends logic yaha hai.
 * UI components sirf iska return value use karte hain.
 */
const useWebRTCCall = () => {
  const [socketId, setSocketId] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [userName, setUserName] = useState(loadName);
  const [status, setStatus] = useState("Connecting to signaling server...");
  const [devices, setDevices] = useState([]);
  const [inCall, setInCall] = useState(false);

  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [remoteReady, setRemoteReady] = useState(false);
  const [remoteName, setRemoteName] = useState("");
  const [remotePublicId, setRemotePublicId] = useState("");
  const [incomingCall, setIncomingCall] = useState(null);
  const [toast, setToast] = useState("");
  const [seconds, setSeconds] = useState(0);

  // Friends
  const [friends, setFriends] = useState(loadFriends); // [{ id, name }]
  const [friendRequests, setFriendRequests] = useState({ incoming: [], outgoing: [] });
  const [serverOutdated, setServerOutdated] = useState(false);
  const [soundOn, setSoundOn] = useState(loadSound);
  const [callingOut, setCallingOut] = useState(false); // caller: samne wale ki ring baj rahi hai

  // Chat (publicId se key: friend ka socketId reconnect par badalta hai, publicId nahi)
  const [chatTarget, setChatTarget] = useState(null); // { publicId, deviceName } | null
  const [messages, setMessages] = useState({}); // { [publicId]: Message[] }
  const [unread, setUnread] = useState({}); // { [publicId]: number }
  const [typing, setTyping] = useState({}); // { [publicId]: boolean }

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
  const serverReadyRef = useRef(false);
  const userNameRef = useRef(userName);
  const registerRef = useRef(null);
  const friendsRef = useRef(friends);
  const replacedRef = useRef(false);
  const messagesRef = useRef({});
  const seenSentRef = useRef(new Set()); // jin messages ki "seen" receipt bhej chuke hain
  const hydratedRef = useRef(false); // storage se messages load ho chuke
  const persistedRef = useRef(new Map()); // "peer|id" -> last saved message object
  const devicesRef = useRef([]);

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

  // ------------------------------------------------------------- Sounds
  useEffect(() => {
    setSoundEnabled(soundOn);
  }, [soundOn]);

  // Browser pehle tap/key ke baad hi awaaz bajane deta hai
  useEffect(() => {
    const unlock = () => unlockAudio();
    const events = ["pointerdown", "keydown", "touchstart"];
    events.forEach((e) => window.addEventListener(e, unlock, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, unlock));
  }, []);

  // Incoming call: popup dikhte hi ringtone, accept/decline/cancel par band
  useEffect(() => {
    if (!incomingCall) return;
    startRingtone();
    return () => stopRingtone();
  }, [incomingCall]);

  // Caller ko ringback tone jab tak samne wala utha na le
  useEffect(() => {
    if (!callingOut) return;
    startRingback();
    return () => stopRingback();
  }, [callingOut]);

  const toggleSound = useCallback(() => {
    const next = !soundOn;
    try {
      localStorage.setItem(SOUND_KEY, next ? "on" : "off");
    } catch {
      /* storage blocked */
    }
    setSoundOn(next);
  }, [soundOn]);

  // -------------------------------------- Messages: 24h storage + auto-delete
  // Server kuch store nahi karta. Har device apni copy IndexedDB me 24 ghante rakhta hai.
  useEffect(() => {
    let cancelled = false;

    loadMessages(MESSAGE_TTL_MS).then((byPeer) => {
      if (cancelled) return;

      const restored = {};
      const restoredUnread = {};
      for (const [peer, list] of Object.entries(byPeer)) {
        restored[peer] = list.map((m) => {
          // Bhejte-bhejte band hua message ab "Not delivered" hai
          const fixed = m.status === "sending" ? { ...m, status: "failed" } : m;
          if (fixed === m) persistedRef.current.set(`${peer}|${m.id}`, m);
          if (fixed.sender === "them") {
            if (fixed.seen) seenSentRef.current.add(fixed.id);
            else if (!fixed.deleted) restoredUnread[peer] = (restoredUnread[peer] || 0) + 1;
          }
          return fixed;
        });
      }

      hydratedRef.current = true;
      setMessages((prev) => mergeMessages(restored, prev));
      if (Object.keys(restoredUnread).length) {
        setUnread((prev) => {
          const next = { ...prev };
          for (const [p, n] of Object.entries(restoredUnread)) next[p] = (next[p] || 0) + n;
          return next;
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // State me jo badla (naya / edit / status / delete) wo storage me likho
  useEffect(() => {
    if (!hydratedRef.current) return;

    const toPut = [];
    const present = new Set();
    for (const [peerId, list] of Object.entries(messages)) {
      for (const msg of list) {
        const key = `${peerId}|${msg.id}`;
        present.add(key);
        if (persistedRef.current.get(key) !== msg) {
          persistedRef.current.set(key, msg);
          toPut.push({ peerId, msg });
        }
      }
    }
    const toDelete = [];
    for (const key of persistedRef.current.keys()) {
      if (!present.has(key)) {
        persistedRef.current.delete(key);
        toDelete.push(key);
      }
    }
    if (toPut.length) putMessages(toPut);
    if (toDelete.length) deleteMessages(toDelete);
  }, [messages]);

  // 24 ghante poore hote hi message khud delete (page khula ho tab bhi)
  useEffect(() => {
    const t = setInterval(
      () => setMessages((prev) => pruneExpired(prev, Date.now(), MESSAGE_TTL_MS)),
      30000
    );
    return () => clearInterval(t);
  }, []);

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
    setCallingOut(false);
    setRemoteReady(false);
    setMicOn(true);
    setCamOn(true);
    setRemoteName("");
    setRemotePublicId("");
    setStatus("Ready for another call");

    if (socketRef.current?.connected) socketRef.current.emit("get-devices");
  }, []);

  // Server ko bhi batao ki call khatam
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
      setRemotePublicId(data.caller?.publicId || "");
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
  const openChat = useCallback((target) => {
    if (!target?.publicId) return;
    const t = { publicId: target.publicId, deviceName: target.deviceName };
    chatTargetRef.current = t;
    setChatTarget(t);
    setUnread((prev) => {
      if (!prev[t.publicId]) return prev;
      const next = { ...prev };
      delete next[t.publicId];
      return next;
    });
  }, []);

  const closeChat = useCallback(() => {
    chatTargetRef.current = null;
    setChatTarget(null);
  }, []);

  // Call ke andar chat button: samne wale friend ke saath chat open/close
  const toggleCallChat = useCallback(() => {
    if (!remotePublicId) return;
    if (chatTarget?.publicId === remotePublicId) {
      closeChat();
    } else {
      openChat({ publicId: remotePublicId, deviceName: remoteName });
    }
  }, [remotePublicId, remoteName, chatTarget, openChat, closeChat]);

  const updateMessageStatus = useCallback((targetPublicId, clientId, status) => {
    setMessages((prev) => {
      const list = prev[targetPublicId];
      if (!list) return prev;
      return {
        ...prev,
        // "seen" ko wapas "delivered" mat karo (ack seen ke baad aa sakta hai)
        [targetPublicId]: list.map((m) =>
          m.id === clientId && m.status !== "seen" ? { ...m, status } : m
        ),
      };
    });
  }, []);

  const failIfPending = useCallback((targetPublicId, clientId) => {
    setMessages((prev) => {
      const list = prev[targetPublicId];
      if (!list) return prev;
      return {
        ...prev,
        [targetPublicId]: list.map((m) =>
          m.id === clientId && m.status === "sending" ? { ...m, status: "failed" } : m
        ),
      };
    });
  }, []);

  // payload: "text"  YA  { text?, image? (data-URL), replyTo? { id, from, text, kind } }
  const sendMessage = useCallback(
    (payload) => {
      const target = chatTargetRef.current;
      const socket = socketRef.current;
      const p = typeof payload === "string" ? { text: payload } : payload || {};
      const clean = (p.text || "").trim();
      const image = typeof p.image === "string" && p.image ? p.image : null;
      if (!target || (!clean && !image)) return;

      const replyTo = p.replyTo?.id
        ? {
            id: String(p.replyTo.id),
            from: p.replyTo.from === "me" ? "me" : "them",
            text: String(p.replyTo.text || "").slice(0, 200),
            kind: p.replyTo.kind === "image" ? "image" : "text",
          }
        : null;

      if (!socket?.connected) {
        showToast("Server connection lost. Message not sent.");
        return;
      }

      if (!serverReadyRef.current) {
        showToast("Chat isn't available: the backend server needs to be updated and redeployed.");
        return;
      }

      const clientId = makeId();
      setMessages((prev) => ({
        ...prev,
        [target.publicId]: [
          ...(prev[target.publicId] || []),
          { id: clientId, sender: "me", text: clean, image, replyTo, timestamp: Date.now(), status: "sending" },
        ],
      }));

      socket.emit("send-private-message", {
        targetPublicId: target.publicId,
        message: clean,
        image,
        replyTo: replyTo
          ? { id: replyTo.id, text: replyTo.text, kind: replyTo.kind, mine: replyTo.from === "me" }
          : null,
        clientId,
      });

      // Photo ke liye zyada time (slow mobile network)
      setTimeout(
        () => failIfPending(target.publicId, clientId),
        image ? ACK_TIMEOUT_MS * 3 : ACK_TIMEOUT_MS
      );
    },
    [showToast, failIfPending]
  );

  const sendTyping = useCallback((isTyping) => {
    const target = chatTargetRef.current;
    if (!target || !socketRef.current?.connected) return;
    socketRef.current.emit("typing-indicator", {
      targetPublicId: target.publicId,
      isTyping,
    });
  }, []);

  // ----------------------------------------------------- Edit / delete messages
  const friendOnline = useCallback(
    (publicId) => devicesRef.current.some((d) => d.publicId === publicId),
    []
  );

  const findMessage = useCallback((id) => {
    const target = chatTargetRef.current;
    if (!target) return null;
    return (messagesRef.current[target.publicId] || []).find((m) => m.id === id) || null;
  }, []);

  // Apna text message edit karo (friend ke paas bhi badal jata hai)
  const editMessage = useCallback(
    (id, text) => {
      const target = chatTargetRef.current;
      const socket = socketRef.current;
      const clean = (text || "").trim().slice(0, 1000);
      const msg = findMessage(id);
      if (!target || !clean || !msg) return false;
      if (msg.sender !== "me" || msg.deleted || !msg.text) return false;

      if (!socket?.connected) {
        showToast("Server connection lost. Edit not sent.");
        return false;
      }
      if (!friendOnline(target.publicId)) {
        showToast("Your friend is offline. Try editing when they're online.");
        return false;
      }

      setMessages((prev) => ({
        ...prev,
        [target.publicId]: (prev[target.publicId] || []).map((m) =>
          m.id === id ? { ...m, text: clean, edited: true } : m
        ),
      }));
      socket.emit("edit-private-message", { targetPublicId: target.publicId, id, text: clean });
      return true;
    },
    [findMessage, friendOnline, showToast]
  );

  // Sirf mere device se hatao
  const deleteForMe = useCallback((id) => {
    const target = chatTargetRef.current;
    if (!target) return;
    setMessages((prev) => {
      const list = prev[target.publicId];
      if (!list) return prev;
      return { ...prev, [target.publicId]: list.filter((m) => m.id !== id) };
    });
  }, []);

  // Dono taraf se hatao (apna message). Jo message friend tak pahuncha hi nahi, wo bas local hata do.
  const deleteForEveryone = useCallback(
    (id) => {
      const target = chatTargetRef.current;
      const socket = socketRef.current;
      const msg = findMessage(id);
      if (!target || !msg || msg.sender !== "me") return false;

      if (msg.status === "failed" || msg.status === "sending") {
        deleteForMe(id);
        return true;
      }
      if (!socket?.connected) {
        showToast("Server connection lost. Try again.");
        return false;
      }
      if (!friendOnline(target.publicId)) {
        showToast("Your friend is offline. You can delete it for yourself only.");
        return false;
      }

      setMessages((prev) => ({
        ...prev,
        [target.publicId]: (prev[target.publicId] || []).map((m) =>
          m.id === id ? toDeletedMessage(m) : m
        ),
      }));
      socket.emit("delete-private-message", { targetPublicId: target.publicId, id });
      return true;
    },
    [findMessage, deleteForMe, friendOnline, showToast]
  );

  // ---------------------------------------------------------- Seen receipts
  // Chat us friend ke saath khula ho AUR page dikh raha ho -> unke naye messages "seen" bhejo.
  const flushSeen = useCallback(() => {
    const target = chatTargetRef.current;
    const socket = socketRef.current;
    if (!target || !socket?.connected) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;

    const list = messagesRef.current[target.publicId] || [];
    const ids = list
      .filter((m) => m.sender === "them" && !seenSentRef.current.has(m.id))
      .map((m) => m.id);
    if (!ids.length) return;

    ids.forEach((id) => seenSentRef.current.add(id));
    socket.emit("messages-seen", { targetPublicId: target.publicId, ids });

    // Reload ke baad dobara "seen" na bheje aur unread badge sahi rahe: flag message par save karo
    const sent = new Set(ids);
    setMessages((prev) => {
      const l = prev[target.publicId];
      if (!l) return prev;
      return {
        ...prev,
        [target.publicId]: l.map((m) => (sent.has(m.id) ? { ...m, seen: true } : m)),
      };
    });
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
    flushSeen();
  }, [messages, chatTarget, flushSeen]);

  useEffect(() => {
    const onVisible = () => flushSeen();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [flushSeen]);

  // --------------------------------------------------------------- Friends
  // friendsRef hamesha latest list rakhta hai (socket handlers me stale closure nahi)
  const commitFriends = useCallback((next) => {
    friendsRef.current = next;
    saveFriends(next);
    setFriends(next);
  }, []);

  // Unfriend par is dost ki chat history aur unread hata do
  const clearThread = useCallback((publicId) => {
    setMessages((prev) => {
      if (!prev[publicId]) return prev;
      const next = { ...prev };
      delete next[publicId];
      return next;
    });
    setUnread((prev) => {
      if (!prev[publicId]) return prev;
      const next = { ...prev };
      delete next[publicId];
      return next;
    });
  }, []);

  const requireConnection = useCallback(() => {
    if (!socketRef.current?.connected) {
      showToast("Server connection lost. Wait until it reconnects.");
      return false;
    }
    return true;
  }, [showToast]);

  const sendFriendRequest = useCallback(
    (device) => {
      if (!device?.publicId || !requireConnection()) return;
      socketRef.current.emit("friend-request", { targetPublicId: device.publicId });
    },
    [requireConnection]
  );

  const cancelFriendRequest = useCallback(
    (publicId) => {
      if (!requireConnection()) return;
      socketRef.current.emit("friend-request-cancel", { targetPublicId: publicId });
    },
    [requireConnection]
  );

  const respondFriendRequest = useCallback(
    (publicId, accept) => {
      if (!requireConnection()) return;
      socketRef.current.emit("friend-request-respond", { fromPublicId: publicId, accept });
    },
    [requireConnection]
  );

  const removeFriend = useCallback(
    (publicId) => {
      commitFriends(friendsRef.current.filter((f) => f.id !== publicId));
      clearThread(publicId);
      if (chatTargetRef.current?.publicId === publicId) closeChat();
      socketRef.current?.emit("remove-friend", { friendPublicId: publicId });
    },
    [commitFriends, clearThread, closeChat]
  );

  // ------------------------------------------------------ Socket lifecycle
  useEffect(() => {
    const devId = getDeviceId();

    const socket = io(SERVER_URL, {
      transports: ["websocket", "polling"],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;
    const typingTimers = typingTimersRef.current;
    let serverCheckTimer = null;

    // Naam set hone ke baad hi register hote hain. Saved friends list bhi saath jaati hai.
    registerRef.current = () => {
      const name = userNameRef.current;
      if (!name || !socket.connected) return;
      socket.emit("register-device", {
        deviceId: devId,
        deviceName: name,
        friends: friendsRef.current.map((f) => f.id),
      });
    };

    socket.on("server-info", (info) => {
      const ok = Boolean(info?.chat && info?.friends && (info?.version || 0) >= 5);
      serverReadyRef.current = ok;
      setServerOutdated(!ok);
      clearTimeout(serverCheckTimer);
    });

    socket.on("connect", () => {
      replacedRef.current = false;
      serverReadyRef.current = false;
      setServerOutdated(false);

      // Server ne 3 sec me server-info nahi bheja -> purana backend
      clearTimeout(serverCheckTimer);
      serverCheckTimer = setTimeout(() => {
        if (!serverReadyRef.current) setServerOutdated(true);
      }, 3000);

      // Reconnect hone par server purani call khatam kar chuka hota hai
      if (currentTargetRef.current || incomingRef.current) {
        incomingRef.current = null;
        setIncomingCall(null);
        cleanupCall();
        showToast("Connection was lost. The call has ended.");
      }

      setSocketId(socket.id);
      setIsConnected(true);
      setStatus("Connected to signaling server");

      registerRef.current?.();
      socket.emit("get-devices");
    });

    socket.on("disconnect", (reason) => {
      serverReadyRef.current = false;
      setIsConnected(false);
      setStatus(
        replacedRef.current
          ? "Opened in another tab. Reload this page to use it here."
          : `Disconnected from server (${reason})`
      );
    });

    socket.on("connect_error", (err) => {
      setIsConnected(false);
      setStatus("Connection failed. Check backend URL / CORS.");
      console.error("Socket error details:", err.message);
    });

    socket.on("replaced", () => {
      // Same device doosre tab me khul gaya
      replacedRef.current = true;
      showToast("This device was opened in another tab.");
    });

    socket.on("device-list", (deviceList) => {
      devicesRef.current = deviceList;
      setDevices(deviceList);

      // Friends ke naam badle hon to saved list update karo
      const current = friendsRef.current;
      const changed = current.some((f) => {
        const d = deviceList.find((x) => x.publicId === f.id);
        return d && d.deviceName !== f.name;
      });
      if (changed) {
        commitFriends(
          current.map((f) => {
            const d = deviceList.find((x) => x.publicId === f.id);
            return d ? { ...f, name: d.deviceName } : f;
          })
        );
      }
    });

    // ----------------------------------------------------- Friend events
    socket.on("friend-requests", (snapshot) => {
      setFriendRequests({
        incoming: snapshot?.incoming || [],
        outgoing: snapshot?.outgoing || [],
      });
    });

    socket.on("friend-request-received", ({ name }) => {
      playMessageTone();
      showToast(`${name || "Someone"} sent you a friend request`);
    });

    socket.on("friend-added", ({ publicId, name }) => {
      const list = friendsRef.current;
      const exists = list.some((f) => f.id === publicId);
      commitFriends(
        exists
          ? list.map((f) => (f.id === publicId ? { ...f, name: name || f.name } : f))
          : [...list, { id: publicId, name: name || "" }]
      );
      showToast(`You and ${name || "your friend"} are now friends`);
    });

    socket.on("friend-removed", ({ publicId }) => {
      const existing = friendsRef.current.find((f) => f.id === publicId);
      if (!existing) return;
      commitFriends(friendsRef.current.filter((f) => f.id !== publicId));
      clearThread(publicId);
      if (chatTargetRef.current?.publicId === publicId) {
        chatTargetRef.current = null;
        setChatTarget(null);
      }
      showToast(`${existing.name || "A friend"} is no longer in your friends list`);
    });

    socket.on("friend-error", ({ message }) => {
      showToast(message || "Something went wrong.");
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
        setCallingOut(false);
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
        leaveCall();
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
      incomingRef.current = null;
      setIncomingCall(null);
      cleanupCall();
      showToast("The call has ended.");
    });

    // ------------------------------------------------------------- Chat events
    socket.on("receive-private-message", (m) => {
      const from = m.senderPublicId;
      playMessageTone();

      setMessages((prev) => ({
        ...prev,
        [from]: [
          ...(prev[from] || []),
          {
            id: m.id,
            sender: "them",
            text: m.message || "",
            image: m.image || null,
            // server "mine" sender ke hisaab se bhejta hai; mere liye ulta
            replyTo: m.replyTo
              ? {
                  id: m.replyTo.id,
                  text: m.replyTo.text,
                  kind: m.replyTo.kind,
                  from: m.replyTo.mine ? "them" : "me",
                }
              : null,
            timestamp: m.timestamp,
          },
        ],
      }));
      setTyping((prev) => ({ ...prev, [from]: false }));

      if (chatTargetRef.current?.publicId !== from) {
        setUnread((prev) => ({ ...prev, [from]: (prev[from] || 0) + 1 }));
        showToast(`New message from ${m.senderName || "a friend"}`);
      }
    });

    socket.on("user-typing", ({ senderPublicId, isTyping }) => {
      clearTimeout(typingTimers[senderPublicId]);
      setTyping((prev) => ({ ...prev, [senderPublicId]: Boolean(isTyping) }));
      if (isTyping) {
        typingTimers[senderPublicId] = setTimeout(() => {
          setTyping((prev) => ({ ...prev, [senderPublicId]: false }));
        }, 4000);
      }
    });

    // Friend ne apna message edit kiya. Server store nahi karta, isliye yahin check hota hai:
    // edit tabhi lagta hai jab wo message is thread me USI friend ka ho (koi doosre ka message nahi badal sakta).
    socket.on("message-edited", ({ byPublicId, id, text }) => {
      setMessages((prev) => {
        const list = prev[byPublicId];
        if (!list) return prev;
        let changed = false;
        const next = list.map((m) => {
          if (m.id === id && m.sender === "them" && !m.deleted) {
            changed = true;
            return { ...m, text, edited: true };
          }
          return m;
        });
        return changed ? { ...prev, [byPublicId]: next } : prev;
      });
    });

    // Friend ne "delete for everyone" kiya
    socket.on("message-deleted", ({ byPublicId, id }) => {
      setMessages((prev) => {
        const list = prev[byPublicId];
        if (!list) return prev;
        let changed = false;
        const next = list.map((m) => {
          if (m.id === id && m.sender === "them" && !m.deleted) {
            changed = true;
            return toDeletedMessage(m);
          }
          return m;
        });
        return changed ? { ...prev, [byPublicId]: next } : prev;
      });
    });

    socket.on("message-action-error", ({ message }) => {
      showToast(message || "That action could not be delivered.");
    });

    // Samne wale ne mere messages dekh liye -> ticks pink
    socket.on("messages-seen", ({ byPublicId, ids }) => {
      const seen = new Set(ids || []);
      setMessages((prev) => {
        const list = prev[byPublicId];
        if (!list) return prev;
        return {
          ...prev,
          [byPublicId]: list.map((m) =>
            m.sender === "me" && seen.has(m.id) && m.status !== "failed"
              ? { ...m, status: "seen" }
              : m
          ),
        };
      });
    });

    socket.on("message-sent-ack", ({ targetPublicId, clientId }) => {
      updateMessageStatus(targetPublicId, clientId, "delivered");
    });

    socket.on("message-error", ({ targetPublicId, clientId, message }) => {
      updateMessageStatus(targetPublicId, clientId, "failed");
      showToast(message || "Message was not delivered.");
    });

    return () => {
      clearTimeout(serverCheckTimer);
      registerRef.current = null;
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
    commitFriends,
    clearThread,
    showToast,
  ]);

  // ------------------------------------------------------------ Display name
  const saveName = useCallback((raw) => {
    const clean = normalizeName(raw, MAX_NAME_LENGTH);
    if (!clean) return false;

    try {
      localStorage.setItem(NAME_KEY, clean);
    } catch {
      /* private mode: is session me naam chalega, par save nahi hoga */
    }
    userNameRef.current = clean;
    setUserName(clean);

    registerRef.current?.(); // server ko naya naam batao
    socketRef.current?.emit("get-devices");
    return true;
  }, []);

  // ------------------------------------------------- Call / end call actions
  // device: { socketId, publicId, deviceName } - sirf friends ko call hoti hai (server bhi check karta hai)
  const handleCallDevice = useCallback(
    (device) => {
      if (!socketRef.current || !socketRef.current.connected) {
        showToast("Server connection lost. Wait until it reconnects.");
        return;
      }
      if (inCall || incomingRef.current) return;
      if (!device?.socketId) {
        showToast("Your friend is offline right now.");
        return;
      }

      callAcceptedRef.current = false;
      currentTargetRef.current = device.socketId;
      setRemoteName(device.deviceName);
      setRemotePublicId(device.publicId || "");
      setInCall(true);
      setStatus(`Calling ${device.deviceName}...`);
      socketRef.current.emit("call-device", { targetSocketId: device.socketId });
      setCallingOut(true);

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

  // ---------------------------------------------------------- Derived lists
  const otherDevices = devices.filter((d) => d.socketId !== socketId);
  const onlineByPublic = new Map(otherDevices.map((d) => [d.publicId, d]));
  const friendIds = new Set(friends.map((f) => f.id));

  // Friends: online pehle, phir naam ke hisaab se
  const friendsView = friends
    .map((f) => {
      const d = onlineByPublic.get(f.id);
      return {
        publicId: f.id,
        name: d?.deviceName || f.name || "Friend",
        online: Boolean(d),
        socketId: d?.socketId || "",
        status: d ? d.status : "offline",
      };
    })
    .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));

  // Online log jo abhi friend nahi hain
  const strangers = otherDevices.filter((d) => !friendIds.has(d.publicId));

  return {
    // state
    socketId,
    isConnected,
    deviceName: userName,
    needsName: !userName,
    saveName,
    status,
    otherDevices,
    inCall,
    micOn,
    camOn,
    remoteReady,
    remoteName,
    remotePublicId,
    incomingCall,
    toast,
    seconds,
    serverOutdated,
    soundOn,
    toggleSound,
    // friends
    friendsView,
    strangers,
    friendRequests,
    sendFriendRequest,
    cancelFriendRequest,
    respondFriendRequest,
    removeFriend,
    // chat state
    chatTarget,
    messages,
    unread,
    typing,
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
    editMessage,
    deleteForMe,
    deleteForEveryone,
  };
};

export default useWebRTCCall;
