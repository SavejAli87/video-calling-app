import React, { useState, useEffect, useRef } from "react";
import Avatar from "./Avatar";
import Icon from "./Icon";
import { formatClock } from "./utils";

/**
 * Google Meet jaisa chat panel.
 * mode="call"  -> call screen ke right side me docked
 * mode="lobby" -> lobby me neeche-right floating
 */
const ChatPanel = ({
  target, // { socketId, deviceName }
  messages = [],
  typing = false,
  online = true,
  chatSupported = true,
  mode = "lobby",
  onSend,
  onTyping,
  onClose,
}) => {
  const [text, setText] = useState("");
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const typingTimerRef = useRef(null);
  const typingSentRef = useRef(false);

  // Naya message / typing aaye to neeche scroll
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, typing]);

  // Panel khulte hi / target badalte hi input focus
  useEffect(() => {
    inputRef.current?.focus();
  }, [target?.socketId]);

  // Unmount / target change par typing band karo
  useEffect(() => {
    return () => {
      clearTimeout(typingTimerRef.current);
      if (typingSentRef.current) {
        typingSentRef.current = false;
        onTyping?.(false);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.socketId]);

  if (!target) return null;

  const stopTyping = () => {
    clearTimeout(typingTimerRef.current);
    if (typingSentRef.current) {
      typingSentRef.current = false;
      onTyping?.(false);
    }
  };

  const handleChange = (e) => {
    const val = e.target.value;
    setText(val);

    if (val && !typingSentRef.current) {
      typingSentRef.current = true;
      onTyping?.(true);
    }
    clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(stopTyping, 2000);
    if (!val) stopTyping();
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const clean = text.trim();
    if (!clean || !online || !chatSupported) return;
    onSend(clean);
    setText("");
    stopTyping();
  };

  const position =
    mode === "call"
      ? "inset-x-0 top-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] sm:inset-x-auto sm:right-4 sm:top-4 sm:bottom-24 sm:w-[360px] sm:rounded-2xl"
      : "inset-0 pb-[env(safe-area-inset-bottom)] sm:pb-0 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:top-auto sm:w-[360px] sm:h-[520px] sm:rounded-2xl";

  return (
    <div
      role="dialog"
      aria-label={`Chat with ${target.deviceName}`}
      className={`fixed z-[35] flex flex-col bg-white text-[#202124] shadow-[0_8px_30px_rgba(0,0,0,.35)] overflow-hidden ${position}`}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[#dadce0]">
        <Avatar name={target.deviceName} size={36} />
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate">{target.deviceName}</div>
          <div className={`text-xs ${online ? "text-[#188038]" : "text-[#80868b]"}`}>
            {online ? "Online" : "Offline"}
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close chat"
          title="Close"
          className="w-9 h-9 rounded-full flex items-center justify-center text-[#5f6368] hover:bg-[#f1f3f4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1a73e8]"
        >
          <Icon name="close" className="w-5 h-5" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-center text-sm text-[#5f6368] px-6">
            No messages yet. Say hi to {target.deviceName}.
          </div>
        ) : (
          messages.map((m, i) => {
            const prev = messages[i - 1];
            const showHeader =
              !prev || prev.sender !== m.sender || m.timestamp - prev.timestamp > 60000;
            return (
              <div key={m.id} className={showHeader ? "pt-3" : ""}>
                {showHeader && (
                  <div className="flex items-baseline gap-2 mb-0.5">
                    <span className="text-sm font-medium">
                      {m.sender === "me" ? "You" : target.deviceName}
                    </span>
                    <span className="text-xs text-[#5f6368]">{formatClock(m.timestamp)}</span>
                  </div>
                )}
                <p
                  className={`text-sm leading-relaxed whitespace-pre-wrap break-words ${
                    m.status === "failed" ? "text-[#d93025]" : ""
                  }`}
                >
                  {m.text}
                </p>
                {m.status === "failed" && (
                  <span className="text-xs text-[#d93025]">Not delivered</span>
                )}
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      {/* Typing + offline notice */}
      <div className={`px-4 min-h-5 text-xs ${chatSupported ? "text-[#5f6368]" : "text-[#d93025]"}`}>
        {!chatSupported
          ? "Chat is unavailable: the server needs to be updated."
          : !online
            ? "Device is offline. Messages can't be delivered."
            : typing
              ? `${target.deviceName} is typing…`
              : ""}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-3 pt-1">
        <div className="flex items-center gap-1 rounded-full bg-[#f1f3f4] pl-4 pr-1.5 py-1.5">
          <input
            ref={inputRef}
            type="text"
            value={text}
            onChange={handleChange}
            onKeyDown={(e) => e.key === "Escape" && onClose()}
            maxLength={1000}
            disabled={!online || !chatSupported}
            placeholder="Send a message"
            className="flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-[#5f6368] disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!text.trim() || !online || !chatSupported}
            aria-label="Send message"
            className="w-9 h-9 rounded-full flex items-center justify-center text-[#1a73e8] hover:bg-[#e2e5e9] disabled:text-[#9aa0a6] disabled:hover:bg-transparent disabled:cursor-not-allowed"
          >
            <Icon name="send" className="w-5 h-5" />
          </button>
        </div>
      </form>
    </div>
  );
};

export default ChatPanel;
