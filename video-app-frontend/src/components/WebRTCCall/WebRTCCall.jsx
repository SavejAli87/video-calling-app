import React, { useState, useEffect } from "react";
import useWebRTCCall from "./useWebRTCCall";
import Lobby from "./Lobby";
import CallScreen from "./CallScreen";
import IncomingCallModal from "./IncomingCallModal";
import Toast from "./Toast";
import ChatModal from "../ChatModal/ChatModal";

const WebRTCCall = () => {
  const call = useWebRTCCall();

  // Chat States
  const [activeChatPeer, setActiveChatPeer] = useState(null); // Selected peer for chat modal
  const [chatConversations, setChatConversations] = useState({}); // { [socketId]: [ { sender, text, time } ] }
  const [unreadCounts, setUnreadCounts] = useState({}); // { [socketId]: number }

  // Socket listener for incoming chat messages
  useEffect(() => {
    // Agar custom hook socket expose karta hai
    const socket = call.socketRef?.current || call.socket;
    if (!socket) return;

    const handleReceiveMessage = (data) => {
      const { senderSocketId, message, time } = data;

      // Conversation update karein
      setChatConversations((prev) => {
        const thread = prev[senderSocketId] || [];
        return {
          ...prev,
          [senderSocketId]: [
            ...thread,
            { sender: "remote", text: message, time },
          ],
        };
      });

      // Agar chat box open nahi hai ya dusre device ka hai toh unread count badhayein
      setActiveChatPeer((current) => {
        if (current?.socketId !== senderSocketId) {
          setUnreadCounts((counts) => ({
            ...counts,
            [senderSocketId]: (counts[senderSocketId] || 0) + 1,
          }));
        }
        return current;
      });
    };

    socket.on("receive-private-message", handleReceiveMessage);

    return () => {
      socket.off("receive-private-message", handleReceiveMessage);
    };
  }, [call.socketRef, call.socket]);

  // Message Send Handler
  const handleSendChatMessage = (targetSocketId, text) => {
    const socket = call.socketRef?.current || call.socket;
    if (!socket?.connected) return;

    const timeString = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    // Server ko emit karein
    socket.emit("send-private-message", {
      targetSocketId,
      message: text,
      senderName: call.deviceName,
      time: timeString,
    });

    // Local state me update karein
    setChatConversations((prev) => {
      const thread = prev[targetSocketId] || [];
      return {
        ...prev,
        [targetSocketId]: [
          ...thread,
          { sender: "me", text, time: timeString },
        ],
      };
    });
  };

  // Open Chat and clear unread badge
  const handleOpenChat = (device) => {
    setActiveChatPeer(device);
    setUnreadCounts((prev) => ({
      ...prev,
      [device.socketId]: 0,
    }));
  };

  return (
    <div
      className="min-h-screen bg-white text-[#202124]"
      style={{
        fontFamily:
          "'Google Sans', 'Product Sans', Roboto, 'Segoe UI', Arial, sans-serif",
      }}
    >
      <Lobby
        hidden={call.inCall}
        deviceName={call.deviceName}
        socketId={call.socketId}
        status={call.status}
        isConnected={call.isConnected}
        inCall={call.inCall}
        devices={call.otherDevices}
        onCall={call.handleCallDevice}
        onOpenChat={handleOpenChat}
        unreadCounts={unreadCounts}
      />

      <CallScreen
        visible={call.inCall}
        localVideoRef={call.localVideoRef}
        remoteVideoRef={call.remoteVideoRef}
        deviceName={call.deviceName}
        remoteName={call.remoteName}
        remoteReady={call.remoteReady}
        status={call.status}
        micOn={call.micOn}
        camOn={call.camOn}
        seconds={call.seconds}
        onToggleMic={call.toggleMic}
        onToggleCam={call.toggleCam}
        onEndCall={call.handleEndCall}
      />

      <IncomingCallModal
        call={call.incomingCall}
        onAccept={call.acceptCall}
        onDecline={call.declineCall}
      />

      <Toast message={call.toast} />

      {/* Standalone Chat Modal */}
      {activeChatPeer && (
        <ChatModal
          targetDevice={activeChatPeer}
          onClose={() => setActiveChatPeer(null)}
          socket={call.socketRef?.current || call.socket}
          myDeviceName={call.deviceName}
          messages={chatConversations[activeChatPeer.socketId] || []}
          onSendMessage={handleSendChatMessage}
        />
      )}
    </div>
  );
};

export default WebRTCCall;