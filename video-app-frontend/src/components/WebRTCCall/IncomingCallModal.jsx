import React from "react";
import Avatar from "./Avatar";
import Icon from "./Icon";

const IncomingCallModal = ({ call, onAccept, onDecline }) => {
  if (!call) return null;
  const name = call.caller?.deviceName;

  return (
    <div className="fixed inset-0 z-40 flex items-start sm:items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-label="Incoming call"
        className="mt-10 sm:mt-0 w-full max-w-sm rounded-3xl bg-[#202124] text-[#e8eaed] p-6 shadow-2xl"
      >
        <div className="flex flex-col items-center text-center">
          <Avatar name={name} size={80} />
          <div className="mt-4 text-xl font-medium">{name || "Unknown device"}</div>
          <div className="text-sm text-[#9aa0a6] mt-1">Incoming video call</div>
        </div>
        <div className="mt-6 flex items-center justify-center gap-6">
          <button
            onClick={onDecline}
            aria-label="Decline"
            className="w-14 h-14 rounded-full bg-[#ea4335] hover:bg-[#d93025] text-white flex items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <Icon name="end" className="w-7 h-7" />
          </button>
          <button
            onClick={onAccept}
            aria-label="Accept"
            className="w-14 h-14 rounded-full bg-[#188038] hover:bg-[#137333] text-white flex items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <Icon name="call" className="w-7 h-7" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default IncomingCallModal;
