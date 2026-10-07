import React from "react";
import Avatar from "./Avatar";
import Icon from "./Icon";
import ControlButton from "./ControlButton";
import { formatTime } from "./utils";

// NOTE: <video> elements hamesha mounted rehte hain (sirf hide/show hote hain),
// taaki startCamera() ke time refs null na hon.
const CallScreen = ({
  visible,
  localVideoRef,
  remoteVideoRef,
  deviceName,
  remoteName,
  remoteReady,
  status,
  micOn,
  camOn,
  seconds,
  onToggleMic,
  onToggleCam,
  onEndCall,
}) => (
  <div
    className={
      visible ? "fixed inset-0 z-30 flex flex-col bg-[#202124] text-[#e8eaed]" : "hidden"
    }
  >
    {/* Stage */}
    <div className="relative flex-1 min-h-0 p-3 sm:p-4">
      <div className="relative w-full h-full rounded-2xl overflow-hidden bg-[#3c4043]">
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className={`w-full h-full object-contain bg-black ${
            remoteReady ? "opacity-100" : "opacity-0"
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
            className={`w-full h-full object-cover -scale-x-100 ${
              camOn ? "opacity-100" : "opacity-0"
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
          onClick={onToggleMic}
          active={micOn}
          icon={micOn ? "mic" : "micOff"}
          label={micOn ? "Turn off microphone" : "Turn on microphone"}
        />
        <ControlButton
          onClick={onToggleCam}
          active={camOn}
          icon={camOn ? "cam" : "camOff"}
          label={camOn ? "Turn off camera" : "Turn on camera"}
        />
        <button
          onClick={onEndCall}
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
);

export default CallScreen;
