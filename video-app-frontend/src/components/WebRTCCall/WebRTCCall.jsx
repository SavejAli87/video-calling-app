import React from "react";
import useWebRTCCall from "./useWebRTCCall";
import Lobby from "./Lobby";
import CallScreen from "./CallScreen";
import ChatPanel from "./ChatPanel";
import IncomingCallModal from "./IncomingCallModal";
import Toast from "./Toast";

const WebRTCCall = () => {
  const call = useWebRTCCall();

  const chatTarget = call.chatTarget;
  const chatOnline = chatTarget
    ? call.otherDevices.some((d) => d.socketId === chatTarget.socketId)
    : false;

  return (
    <div
      className="min-h-dvh bg-white text-[#202124]"
      style={{
        fontFamily: "'Google Sans', 'Product Sans', Roboto, 'Segoe UI', Arial, sans-serif",
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
        unread={call.unread}
        onCall={call.handleCallDevice}
        onChat={call.openChat}
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
        chatOpen={call.inCall && !!chatTarget}
        chatUnread={call.unread[call.remoteSocketId] || 0}
        onToggleChat={call.toggleCallChat}
        onToggleMic={call.toggleMic}
        onToggleCam={call.toggleCam}
        onEndCall={call.handleEndCall}
      />

      <ChatPanel
        target={chatTarget}
        messages={chatTarget ? call.messages[chatTarget.socketId] : []}
        typing={chatTarget ? !!call.typing[chatTarget.socketId] : false}
        online={chatOnline}
        chatSupported={call.chatSupported}
        mode={call.inCall ? "call" : "lobby"}
        onSend={call.sendMessage}
        onTyping={call.sendTyping}
        onClose={call.closeChat}
      />

      <IncomingCallModal
        call={call.incomingCall}
        onAccept={call.acceptCall}
        onDecline={call.declineCall}
      />

      <Toast message={call.toast} />
    </div>
  );
};

export default WebRTCCall;
