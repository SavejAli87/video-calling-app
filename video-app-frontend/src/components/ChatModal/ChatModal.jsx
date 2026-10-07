import React, { useState, useEffect, useRef } from "react";

const ChatModal = ({
  targetDevice, // { socketId, deviceName }
  onClose,
  socket,
  myDeviceName,
  messages = [],
  onSendMessage,
}) => {
  const [inputText, setInputText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // Auto-scroll to bottom jab naya message aaye
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Remote typing indicator listen karna
  useEffect(() => {
    if (!socket) return;

    const handleRemoteTyping = (data) => {
      if (data.senderSocketId === targetDevice.socketId) {
        setIsTyping(data.isTyping);
      }
    };

    socket.on("user-typing", handleRemoteTyping);
    return () => {
      socket.off("user-typing", handleRemoteTyping);
    };
  }, [socket, targetDevice.socketId]);

  // Input change & typing emit logic
  const handleInputChange = (e) => {
    const val = e.target.value;
    setInputText(val);

    if (!socket?.connected) return;

    socket.emit("typing-indicator", {
      targetSocketId: targetDevice.socketId,
      isTyping: val.length > 0,
    });

    // Reset typing after 2 seconds of inactivity
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit("typing-indicator", {
        targetSocketId: targetDevice.socketId,
        isTyping: false,
      });
    }, 2000);
  };

  const handleSend = (e) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    onSendMessage(targetDevice.socketId, inputText.trim());
    setInputText("");

    socket?.emit("typing-indicator", {
      targetSocketId: targetDevice.socketId,
      isTyping: false,
    });
  };

  return (
    <div className="fixed bottom-6 right-6 w-88 sm:w-96 h-[480px] bg-neutral-900 border border-neutral-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden z-50 font-sans animate-in fade-in slide-in-from-bottom-4 duration-200">
      {/* Header */}
      <div className="px-4 py-3 bg-neutral-800/90 border-b border-neutral-700 flex justify-between items-center backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse" />
          <div className="text-left">
            <h4 className="font-bold text-white text-sm leading-tight">
              {targetDevice.deviceName}
            </h4>
            <span className="text-[11px] text-neutral-400 font-mono">
              {targetDevice.socketId.slice(0, 10)}...
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-neutral-400 hover:text-white p-1 rounded-lg hover:bg-neutral-700/50 transition-colors cursor-pointer"
        >
          ✕
        </button>
      </div>

      {/* Messages Feed */}
      <div className="flex-1 p-4 overflow-y-auto space-y-2.5 text-sm flex flex-col bg-neutral-950/60">
        {messages.length === 0 ? (
          <div className="my-auto text-center text-neutral-500 text-xs px-4">
            No messages yet. Send a message to start chatting with{" "}
            <span className="text-neutral-400 font-semibold">{targetDevice.deviceName}</span>.
          </div>
        ) : (
          messages.map((msg, index) => (
            <div
              key={index}
              className={`flex flex-col max-w-[80%] px-3.5 py-2 rounded-2xl ${msg.sender === "me"
                ? "self-end bg-sky-600 text-white rounded-br-none shadow-md"
                : "self-start bg-neutral-800 text-neutral-100 rounded-bl-none border border-neutral-700/50"
                }`}
            >
              <p className="break-words text-left leading-relaxed">{msg.text}</p>
              <span
                className={`text-[10px] mt-1 self-end ${msg.sender === "me" ? "text-sky-200" : "text-neutral-400"
                  }`}
              >
                {msg.time}
              </span>
            </div>
          ))
        )}

        {/* Remote typing indicator */}
        {isTyping && (
          <div className="self-start bg-neutral-800/60 text-neutral-400 text-xs italic px-3 py-1.5 rounded-full border border-neutral-700/40 flex items-center gap-1">
            <span>typing</span>
            <span className="animate-bounce">.</span>
            <span className="animate-bounce delay-100">.</span>
            <span className="animate-bounce delay-200">.</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Box */}
      <form
        onSubmit={handleSend}
        className="p-3 bg-neutral-900 border-t border-neutral-800 flex gap-2 items-center"
      >
        <input
          type="text"
          placeholder="Type a message..."
          value={inputText}
          onChange={handleInputChange}
          className="flex-1 bg-neutral-800/90 border border-neutral-700 rounded-xl px-3.5 py-2 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-sky-500 transition-colors"
        />
        <button
          type="submit"
          disabled={!inputText.trim()}
          className="bg-sky-600 hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all shadow-md cursor-pointer"
        >
          Send
        </button>
      </form>
    </div>
  );
};

export default ChatModal;