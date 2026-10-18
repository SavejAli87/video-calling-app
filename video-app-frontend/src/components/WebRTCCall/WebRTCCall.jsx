import React, { useState } from "react";
import useWebRTCCall from "./useWebRTCCall";
import Lobby from "./Lobby";
import CallScreen from "./CallScreen";
import ChatPanel from "./ChatPanel";
import IncomingCallModal from "./IncomingCallModal";
import Toast from "./Toast";
import NameScreen from "./NameScreen";

const WebRTCCall = () => {
  const call = useWebRTCCall();
  const [editingName, setEditingName] = useState(false);

  const chatTarget = call.chatTarget;
  const chatOnline = chatTarget
    ? call.friendsView.some((f) => f.publicId === chatTarget.publicId && f.online)
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
        friends={call.friendsView}
        strangers={call.strangers}
        requests={call.friendRequests}
        unread={call.unread}
        serverOutdated={call.serverOutdated}
        onCall={call.handleCallDevice}
        onChat={call.openChat}
        onAddFriend={call.sendFriendRequest}
        onCancelRequest={call.cancelFriendRequest}
        onRespond={call.respondFriendRequest}
        onRemoveFriend={call.removeFriend}
        onEditName={() => setEditingName(true)}
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
        chatUnread={call.unread[call.remotePublicId] || 0}
        onToggleChat={call.toggleCallChat}
        onToggleMic={call.toggleMic}
        onToggleCam={call.toggleCam}
        onEndCall={call.handleEndCall}
      />

      <ChatPanel
        target={chatTarget}
        messages={chatTarget ? call.messages[chatTarget.publicId] : []}
        typing={chatTarget ? !!call.typing[chatTarget.publicId] : false}
        online={chatOnline}
        chatSupported={!call.serverOutdated}
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

      {(call.needsName || editingName) && (
        <NameScreen
          required={call.needsName}
          initialName={call.deviceName}
          onSave={(n) => {
            if (call.saveName(n)) setEditingName(false);
          }}
          onCancel={() => setEditingName(false)}
        />
      )}

      <Toast message={call.toast} />
    </div>
  );
};

export default WebRTCCall;
