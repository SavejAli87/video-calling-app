import React from "react";
import useWebRTCCall from "./useWebRTCCall";
import Lobby from "./Lobby";
import CallScreen from "./CallScreen";
import IncomingCallModal from "./IncomingCallModal";
import Toast from "./Toast";

const WebRTCCall = () => {
  const call = useWebRTCCall();

  return (
    <div
      className="min-h-screen bg-white text-[#202124]"
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
        onCall={call.handleCallDevice}
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
    </div>
  );
};

export default WebRTCCall;
