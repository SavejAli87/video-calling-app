import React, { useState } from "react";
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
  chatOpen,
  chatUnread,
  onToggleChat,
  onToggleMic,
  onToggleCam,
  onEndCall,
}) => {
  // Mobile par default "fill" (poori screen bharo), desktop par "fit" (poora frame dikhao).
  // Video par tap karke ya fit button se badal sakte hain.
  const [fill, setFill] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.("(max-width: 639px)").matches
  );

  return (
    <div
      className={
        visible ? "fixed inset-0 z-30 flex flex-col bg-[#202124] text-[#e8eaed]" : "hidden"
      }
    >
      {/* Stage: mobile par edge-to-edge, desktop par rounded card */}
      <div
        className={`relative flex-1 min-h-0 sm:p-4 transition-[padding] duration-200 ${
          chatOpen ? "lg:pr-[392px]" : ""
        }`}
      >
        <div className="relative w-full h-full sm:rounded-2xl overflow-hidden bg-[#3c4043]">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            onClick={() => setFill((f) => !f)}
            className={`w-full h-full bg-black ${fill ? "object-cover" : "object-contain"} ${
              remoteReady ? "opacity-100" : "opacity-0"
            }`}
          />

          {!remoteReady && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#3c4043] px-6 text-center">
              <Avatar name={remoteName} size={112} />
              <div className="text-xl">{remoteName || "Connecting..."}</div>
              <div className="text-sm text-[#9aa0a6] animate-pulse">{status}</div>
            </div>
          )}

          {/* Mobile: top-left pill (naam + timer) */}
          {remoteReady && (
            <div className="sm:hidden absolute top-3 left-3 max-w-[55%] flex items-center gap-2 rounded-full bg-black/50 px-3 py-1 text-sm">
              <span className="truncate">{remoteName}</span>
              <span className="tabular-nums text-[#bdc1c6]">{formatTime(seconds)}</span>
            </div>
          )}

          {/* Desktop: bottom-left naam label */}
          {remoteReady && (
            <div className="hidden sm:block absolute left-4 bottom-4 max-w-[45%] truncate rounded-md bg-black/60 px-2.5 py-1 text-sm">
              {remoteName}
            </div>
          )}

          {/* Fit / Fill toggle */}
          {remoteReady && (
            <button
              onClick={() => setFill((f) => !f)}
              aria-label={fill ? "Show full video (fit)" : "Fill screen"}
              title={fill ? "Fit" : "Fill"}
              className="absolute right-3 bottom-3 sm:bottom-auto sm:top-4 sm:right-4 w-9 h-9 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center"
            >
              <Icon name="fit" className="w-5 h-5" />
            </button>
          )}

          {/* Self view: mobile par top-right portrait tile, desktop par bottom-right */}
          <div className="absolute top-3 right-3 sm:top-auto sm:bottom-4 sm:right-4 w-24 aspect-[3/4] sm:w-48 sm:aspect-video lg:w-60 rounded-xl overflow-hidden bg-[#202124] border border-white/20 shadow-xl">
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
                <Avatar name={deviceName} size={48} />
              </div>
            )}
            {/* Mobile par "You" text chhupa hai taaki chehra na dhake; mic off ho to chhota icon dikhta hai */}
            <div
              className={`absolute left-1.5 bottom-1.5 items-center gap-1.5 rounded bg-black/60 px-1.5 sm:px-2 py-0.5 text-xs ${
                micOn ? "hidden sm:flex" : "flex"
              }`}
            >
              <span className="hidden sm:inline">You</span>
              {!micOn && <Icon name="micOff" className="w-3.5 h-3.5 text-[#f28b82]" />}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div
        className="min-h-20 shrink-0 grid grid-cols-3 items-center px-3 sm:px-6"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="hidden sm:flex items-center gap-3 text-[15px] min-w-0">
          <span className="tabular-nums">{remoteReady ? formatTime(seconds) : "--:--"}</span>
          <span className="w-px h-4 bg-white/20" />
          <span className="truncate text-[#bdc1c6]">{remoteName}</span>
        </div>

        <div className="col-span-3 sm:col-span-1 flex items-center justify-center gap-2 sm:gap-3">
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
          <ControlButton
            onClick={onToggleChat}
            pressed={chatOpen}
            badge={chatOpen ? 0 : chatUnread}
            icon="chat"
            label="Chat"
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
};

export default CallScreen;
