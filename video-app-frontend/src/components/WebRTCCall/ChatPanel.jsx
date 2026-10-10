import React, { useState, useEffect, useRef } from "react";
import Avatar from "./Avatar";
import Icon from "./Icon";
import { formatClock, dayLabel, isSameDay } from "./utils";

// WhatsApp colors
const WA = {
  header: "#008069",
  bg: "#efeae2",
  out: "#d9fdd3",
  inc: "#ffffff",
  time: "#667781",
  send: "#00a884",
  tickBlue: "#53bdeb",
};

const Ticks = ({ status }) => {
  if (status === "failed") return <Icon name="alert" className="w-3.5 h-3.5 text-[#d93025]" />;
  if (status === "sending") return <Icon name="clock" className="w-3 h-3" />;
  return <Icon name="ticks" className="w-4 h-4" />; // delivered
};

/**
 * WhatsApp-style chat panel.
 * mode="call"  -> call ke dauran: mobile par bottom bar chhod kar full, desktop par right side
 * mode="lobby" -> lobby: mobile par full screen, desktop par bottom-right floating card
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

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, typing]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [target?.socketId]);

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

  const canChat = online && chatSupported;

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
    if (!clean || !canChat) return;
    onSend(clean);
    setText("");
    stopTyping();
    inputRef.current?.focus();
  };

  const position =
    mode === "call"
      ? "inset-x-0 top-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] sm:inset-x-auto sm:right-4 sm:top-4 sm:bottom-24 sm:w-[380px] sm:rounded-2xl"
      : "inset-0 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:top-auto sm:w-[380px] sm:h-[560px] sm:rounded-2xl";

  const subline = !chatSupported ? "unavailable" : !online ? "offline" : typing ? "typing…" : "online";

  return (
    <div
      role="dialog"
      aria-label={`Chat with ${target.deviceName}`}
      className={`fixed z-[35] flex flex-col overflow-hidden shadow-[0_8px_30px_rgba(0,0,0,.35)] ${position}`}
      style={{ background: WA.bg }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-1 pl-1 pr-3 py-2 text-white shrink-0"
        style={{ background: WA.header }}
      >
        <button
          onClick={onClose}
          aria-label="Back"
          title="Back"
          className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
        >
          <Icon name="back" className="w-6 h-6" />
        </button>
        <Avatar name={target.deviceName} size={38} />
        <div className="min-w-0 flex-1 ml-2 leading-tight">
          <div className="font-medium truncate">{target.deviceName}</div>
          <div className={`text-xs ${typing && canChat ? "text-white" : "text-white/80"}`}>
            {subline}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto px-3 py-3"
        style={{
          backgroundImage: "radial-gradient(rgba(0,0,0,.05) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
        }}
      >
        {messages.length === 0 && (
          <div className="flex justify-center mt-2">
            <span className="rounded-lg bg-[#fff5c4] text-[#54656f] text-xs px-3 py-1.5 shadow-sm text-center">
              No messages yet. Say hi to {target.deviceName} 👋
            </span>
          </div>
        )}

        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const mine = m.sender === "me";
          const newDay = !prev || !isSameDay(prev.timestamp, m.timestamp);
          const groupStart = newDay || prev.sender !== m.sender;

          return (
            <React.Fragment key={m.id}>
              {newDay && (
                <div className="flex justify-center my-2">
                  <span className="rounded-lg bg-white/90 text-[#54656f] text-xs px-3 py-1 shadow-sm">
                    {dayLabel(m.timestamp)}
                  </span>
                </div>
              )}

              <div className={`flex ${mine ? "justify-end" : "justify-start"} ${groupStart ? "mt-2" : "mt-0.5"}`}>
                <div
                  className={`relative max-w-[82%] rounded-lg px-2.5 py-1.5 shadow-[0_1px_0.5px_rgba(11,20,26,.13)] text-[#111b21] ${
                    groupStart ? (mine ? "rounded-tr-none" : "rounded-tl-none") : ""
                  }`}
                  style={{ background: mine ? WA.out : WA.inc }}
                >
                  {/* bubble tail */}
                  {groupStart && (
                    <span
                      aria-hidden="true"
                      className={`absolute top-0 w-2 h-3 ${mine ? "-right-2" : "-left-2"}`}
                      style={{
                        background: mine ? WA.out : WA.inc,
                        clipPath: mine
                          ? "polygon(0 0, 100% 0, 0 100%)"
                          : "polygon(0 0, 100% 0, 100% 100%)",
                      }}
                    />
                  )}

                  <div className="flex flex-wrap items-end justify-end gap-x-3">
                    <span className="min-w-0 text-[14.5px] leading-[1.35] whitespace-pre-wrap break-words">
                      {m.text}
                    </span>
                    <span
                      className="ml-auto flex items-center gap-1 text-[11px] leading-none translate-y-0.5 select-none"
                      style={{ color: WA.time }}
                    >
                      {formatClock(m.timestamp)}
                      {mine && <Ticks status={m.status} />}
                    </span>
                  </div>

                  {m.status === "failed" && (
                    <div className="text-[11px] text-[#d93025] text-right mt-0.5">Not delivered</div>
                  )}
                </div>
              </div>
            </React.Fragment>
          );
        })}

        <div ref={endRef} />
      </div>

      {/* Info chips */}
      {!canChat && (
        <div className="flex justify-center px-3 pb-1 shrink-0">
          <span className="rounded-lg bg-[#fff5c4] text-[#54656f] text-xs px-3 py-1.5 text-center shadow-sm">
            {!chatSupported
              ? "Chat is unavailable: the server needs to be updated."
              : "Device is offline. Messages can't be delivered."}
          </span>
        </div>
      )}

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 px-2 py-2 shrink-0"
        style={{ paddingBottom: mode === "lobby" ? "max(0.5rem, env(safe-area-inset-bottom))" : undefined }}
      >
        <div className="flex-1 min-w-0 rounded-full bg-white px-4 py-2.5 shadow-sm">
          <input
            ref={inputRef}
            type="text"
            value={text}
            onChange={handleChange}
            onKeyDown={(e) => e.key === "Escape" && onClose()}
            maxLength={1000}
            disabled={!canChat}
            placeholder="Message"
            enterKeyHint="send"
            autoComplete="off"
            className="w-full bg-transparent text-[15px] text-[#111b21] outline-none placeholder:text-[#667781] disabled:opacity-50"
          />
        </div>
        <button
          type="submit"
          disabled={!text.trim() || !canChat}
          aria-label="Send message"
          className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center text-white shadow-sm transition-opacity disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00a884]"
          style={{ background: WA.send }}
        >
          <Icon name="send" className="w-5 h-5" />
        </button>
      </form>
    </div>
  );
};

export default ChatPanel;
