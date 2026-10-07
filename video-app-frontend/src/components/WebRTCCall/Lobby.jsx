import React, { useState, useEffect } from "react";
import Avatar from "./Avatar";
import Icon from "./Icon";

const Lobby = ({
  hidden,
  deviceName,
  socketId,
  status,
  isConnected,
  inCall,
  devices,
  onCall,
}) => {
  const [clock, setClock] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  const timeLabel = clock.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const dateLabel = clock.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  return (
    <div className={hidden ? "hidden" : "flex flex-col min-h-screen"}>
      <header className="flex items-center justify-between px-4 sm:px-6 py-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-[#1a73e8] flex items-center justify-center text-white">
            <Icon name="video" className="w-5 h-5" />
          </div>
          <span className="text-[22px] text-[#5f6368]">
            Video <span className="font-medium">Call</span>
          </span>
        </div>
        <div className="flex items-center gap-4 text-[#5f6368] text-sm sm:text-base">
          <span className="hidden sm:inline">
            {timeLabel} &bull; {dateLabel}
          </span>
          <Avatar name={deviceName} size={36} />
        </div>
      </header>

      <main className="flex-1 grid md:grid-cols-2 gap-10 items-center max-w-6xl w-full mx-auto px-6 py-8">
        {/* Left: intro + own device */}
        <section>
          <h1 className="text-4xl sm:text-[44px] leading-[1.15] font-normal text-[#202124] mb-4">
            Video calls for any device, anywhere
          </h1>
          <p className="text-lg text-[#5f6368] mb-8 max-w-md">
            Open this page on a second device, pick it from the list, and start talking.
          </p>

          <div className="inline-flex items-center gap-4 rounded-2xl border border-[#dadce0] px-5 py-4">
            <Avatar name={deviceName} size={48} />
            <div>
              <div className="font-medium text-[#202124]">
                {deviceName || "Connecting..."}{" "}
                <span className="text-[#5f6368] font-normal">(You)</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-[#5f6368]">
                <span
                  className={`w-2 h-2 rounded-full ${isConnected ? "bg-[#188038]" : "bg-[#e37400]"
                    }`}
                />
                {status}
              </div>
              {socketId && (
                <div className="text-xs text-[#80868b] font-mono mt-0.5">{socketId}</div>
              )}
            </div>
          </div>
        </section>

        {/* Right: devices list */}
        <section className="rounded-3xl border border-[#dadce0] shadow-[0_1px_3px_rgba(60,64,67,.15)] overflow-hidden">
          <div className="px-6 py-4 border-b border-[#dadce0] flex items-center justify-between">
            <h2 className="text-lg font-medium">Available devices</h2>
            <span className="text-sm text-[#5f6368]">{devices.length} online</span>
          </div>

          {devices.length === 0 ? (
            <div className="px-6 py-14 text-center text-[#5f6368]">
              <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-[#f1f3f4] flex items-center justify-center">
                <Icon name="video" className="w-7 h-7 text-[#80868b]" />
              </div>
              No other devices online.
              <br />
              Open this URL on another device to see it here.
            </div>
          ) : (
            <ul className="max-h-[420px] overflow-y-auto divide-y divide-[#f1f3f4]">
              {devices.map((device) => {
                const busy = device.status === "busy";
                return (
                  <li
                    key={device.socketId}
                    className="flex items-center gap-4 px-6 py-3 hover:bg-[#f8f9fa]"
                  >
                    <Avatar name={device.deviceName} size={44} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{device.deviceName}</div>
                      <div
                        className={`text-sm ${busy ? "text-[#d93025]" : "text-[#188038]"}`}
                      >
                        {busy ? "In a call" : "Available"}
                      </div>
                    </div>
                    <button
                      disabled={inCall || busy || !isConnected}
                      onClick={() => onCall(device)}
                      className="flex items-center gap-2 rounded-full bg-[#1a73e8] hover:bg-[#1765cc] disabled:bg-[#e8eaed] disabled:text-[#9aa0a6] disabled:cursor-not-allowed text-white text-sm font-medium px-5 py-2.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1a73e8]"
                    >
                      <Icon name="video" className="w-5 h-5" />
                      Call
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
};

export default Lobby;
