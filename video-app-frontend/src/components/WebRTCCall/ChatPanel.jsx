import React, { useState, useEffect, useRef } from "react";
import Avatar from "./Avatar";
import Icon from "./Icon";
import { formatClock, dayLabel, isSameDay, fileToCompressedDataUrl } from "./utils";

// WhatsApp colors (seen ticks: pink)
const WA = {
  header: "#008069",
  bg: "#efeae2",
  out: "#d9fdd3",
  inc: "#ffffff",
  time: "#667781",
  send: "#00a884",
  quoteMe: "#00a884",
  quoteThem: "#8b5cf6",
};

const LONG_PRESS_MS = 500;

const Ticks = ({ status }) => {
  if (status === "failed") return <Icon name="alert" className="w-3.5 h-3.5 text-[#d93025]" />;
  if (status === "sending") return <Icon name="clock" className="w-3 h-3" />;
  if (status === "seen") return <Icon name="ticks" className="w-4 h-4 text-[#ec4899]" />;
  return <Icon name="ticks" className="w-4 h-4" />; // delivered (grey)
};

const quoteLabel = (kind, text) => (kind === "image" ? `📷 ${text || "Photo"}` : text);

/** Input ke upar wali bar: reply ya edit ka preview */
const ContextBar = ({ color, title, body, onCancel, cancelLabel }) => (
  <div className="mx-2 mb-1 flex items-stretch gap-2 rounded-lg bg-white shadow-sm overflow-hidden">
    <span className="w-1 shrink-0" style={{ background: color }} />
    <div className="min-w-0 flex-1 py-1.5">
      <div className="text-xs font-medium" style={{ color }}>
        {title}
      </div>
      <div className="text-sm text-[#54656f] truncate">{body}</div>
    </div>
    <button
      type="button"
      onClick={onCancel}
      aria-label={cancelLabel}
      title={cancelLabel}
      className="w-10 shrink-0 flex items-center justify-center text-[#54656f] hover:bg-black/5"
    >
      <Icon name="close" className="w-5 h-5" />
    </button>
  </div>
);

const SheetRow = ({ icon, label, hint, onClick, danger, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`w-full flex items-center gap-4 px-5 py-3.5 text-left text-[15px] hover:bg-black/5 disabled:opacity-40 disabled:hover:bg-transparent ${
      danger ? "text-[#d93025]" : "text-[#111b21]"
    }`}
  >
    {icon && <Icon name={icon} className="w-5 h-5 shrink-0" />}
    <span className="flex-1">{label}</span>
    {hint && <span className="text-xs text-[#667781]">{hint}</span>}
  </button>
);

const copyToClipboard = async (value) => {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch {
      /* clipboard unavailable */
    }
    document.body.removeChild(ta);
  }
};

/**
 * WhatsApp-style chat panel.
 *  - message par tap            -> reply
 *  - hold / right-click / ⌄     -> menu: Reply, Copy, Edit, Delete
 *  - photo par tap              -> bada viewer
 *  - ticks: clock -> grey double tick (delivered) -> PINK double tick (seen)
 *  - 24 ghante baad messages khud delete ho jaate hain (hook karta hai)
 * mode="call"  -> call ke dauran: mobile par bottom bar chhod kar full, desktop par right side
 * mode="lobby" -> lobby: mobile par full screen, desktop par bottom-right floating card
 *
 * NOTE: target badalne par state reset ke liye parent <ChatPanel key={target.publicId} /> use kare.
 */
const ChatPanel = ({
  target, // { publicId, deviceName }
  messages = [],
  typing = false,
  online = true,
  chatSupported = true,
  mode = "lobby",
  onSend, // ({ text, image?, replyTo? })
  onEdit, // (id, text)
  onDeleteForMe, // (id)
  onDeleteForEveryone, // (id)
  onTyping,
  onClose,
}) => {
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState(null); // { id, from, text, kind }
  const [editing, setEditing] = useState(null); // { id }
  const [menu, setMenu] = useState(null); // { msg, step: "main" | "delete" }
  const [pending, setPending] = useState(null); // { dataUrl }
  const [caption, setCaption] = useState("");
  const [processing, setProcessing] = useState(false);
  const [fileError, setFileError] = useState("");
  const [lightbox, setLightbox] = useState(null); // { src, msg }
  const [highlightId, setHighlightId] = useState(null);

  const endRef = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const typingTimerRef = useRef(null);
  const typingSentRef = useRef(false);
  const highlightTimerRef = useRef(null);
  const pressTimerRef = useRef(null);
  const pressFiredRef = useRef(false);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, typing]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [target?.publicId]);

  useEffect(() => {
    return () => {
      clearTimeout(typingTimerRef.current);
      clearTimeout(highlightTimerRef.current);
      clearTimeout(pressTimerRef.current);
      if (typingSentRef.current) {
        typingSentRef.current = false;
        onTyping?.(false);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.publicId]);

  // Esc: pehle photo viewer / menu band ho
  useEffect(() => {
    if (!lightbox && !menu) return;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (lightbox) setLightbox(null);
      else setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, menu]);

  if (!target) return null;

  const canChat = online && chatSupported;
  const byId = new Map(messages.map((m) => [m.id, m]));
  const editingMsg = editing ? byId.get(editing.id) : null;

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

  // ------------------------------------------------------------- edit
  const cancelEdit = () => {
    setEditing(null);
    setText("");
    stopTyping();
  };

  const startEdit = (m) => {
    setReplyTo(null);
    setEditing({ id: m.id });
    setText(m.text);
    setMenu(null);
    inputRef.current?.focus();
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const clean = text.trim();
    if (!clean || !canChat) return;

    if (editing) {
      const original = byId.get(editing.id);
      if (original && !original.deleted && clean !== original.text) onEdit?.(editing.id, clean);
      cancelEdit();
      return;
    }

    onSend({ text: clean, replyTo });
    setText("");
    setReplyTo(null);
    stopTyping();
    inputRef.current?.focus();
  };

  // ------------------------------------------------------------- reply
  const startReply = (m) => {
    if (m.deleted) return;
    if (editing) cancelEdit();
    setReplyTo({
      id: m.id,
      from: m.sender, // "me" | "them"
      text: (m.text || "").slice(0, 200),
      kind: m.image ? "image" : "text",
    });
    setLightbox(null);
    setMenu(null);
    inputRef.current?.focus();
  };

  const jumpTo = (id) => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightId(id);
    clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightId(null), 1200);
  };

  // ------------------------------------------------------------- menu
  const openMenu = (m) => setMenu({ msg: m, step: "main" });

  const startPress = (m) => {
    pressFiredRef.current = false;
    clearTimeout(pressTimerRef.current);
    pressTimerRef.current = setTimeout(() => {
      pressFiredRef.current = true;
      openMenu(m);
      try {
        navigator.vibrate?.(15);
      } catch {
        /* not supported */
      }
    }, LONG_PRESS_MS);
  };
  const cancelPress = () => clearTimeout(pressTimerRef.current);

  // ------------------------------------------------------------- photos
  const onPickFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // same photo dobara chuni ja sake
    if (!file) return;

    setFileError("");
    setProcessing(true);
    try {
      const dataUrl = await fileToCompressedDataUrl(file);
      setPending({ dataUrl });
      setCaption("");
    } catch (err) {
      setFileError(err?.message || "Couldn't use that photo.");
    } finally {
      setProcessing(false);
    }
  };

  const sendPending = (e) => {
    e?.preventDefault();
    if (!pending || !canChat) return;
    onSend({ text: caption.trim(), image: pending.dataUrl, replyTo });
    setPending(null);
    setCaption("");
    setReplyTo(null);
  };

  const position =
    mode === "call"
      ? "inset-x-0 top-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] sm:inset-x-auto sm:right-4 sm:top-4 sm:bottom-24 sm:w-[380px] sm:rounded-2xl"
      : "inset-0 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:top-auto sm:w-[380px] sm:h-[560px] sm:rounded-2xl";

  const subline = !chatSupported ? "unavailable" : !online ? "offline" : typing ? "typing…" : "online";

  // ----- menu options for the selected message
  const sel = menu?.msg;
  const selMine = sel?.sender === "me";
  const selDelivered = sel?.status === "delivered" || sel?.status === "seen";
  const canEditSel = Boolean(selMine && !sel?.deleted && sel?.text && selDelivered);
  const canDeleteEveryoneSel = Boolean(selMine && !sel?.deleted && selDelivered);

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
        <div className="flex justify-center mb-2">
          <span className="rounded-lg bg-[#fff5c4] text-[#54656f] text-xs px-3 py-1.5 shadow-sm text-center leading-relaxed">
            🕐 Messages are deleted automatically 24 hours after they&apos;re sent.
            <br />
            Tap a message to reply. Hold it (or right-click) for more options.
          </span>
        </div>

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
          const isLast = i === messages.length - 1;
          const timeAndTicks = (
            <>
              {m.edited && !m.deleted && <span className="mr-0.5">Edited</span>}
              {formatClock(m.timestamp)}
              {mine && !m.deleted && <Ticks status={m.status} />}
            </>
          );

          // reply quote: original abhi bhi hai to uska latest text / deleted status dikhao
          const orig = m.replyTo ? byId.get(m.replyTo.id) : null;
          const quoteGone = Boolean(orig?.deleted);
          const quoteText = quoteGone
            ? "🚫 Message deleted"
            : quoteLabel(m.replyTo?.kind, orig && orig.text ? orig.text : m.replyTo?.text);

          return (
            <React.Fragment key={m.id}>
              {newDay && (
                <div className="flex justify-center my-2">
                  <span className="rounded-lg bg-white/90 text-[#54656f] text-xs px-3 py-1 shadow-sm">
                    {dayLabel(m.timestamp)}
                  </span>
                </div>
              )}

              <div
                id={`msg-${m.id}`}
                className={`flex ${mine ? "justify-end" : "justify-start"} ${groupStart ? "mt-2" : "mt-0.5"}`}
              >
                <div
                  onClick={() => {
                    if (pressFiredRef.current) {
                      pressFiredRef.current = false; // long-press ke baad ka click ignore
                      return;
                    }
                    if (window.getSelection()?.toString()) return; // text select kar raha hai
                    startReply(m);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    openMenu(m);
                  }}
                  onTouchStart={() => startPress(m)}
                  onTouchEnd={cancelPress}
                  onTouchMove={cancelPress}
                  onTouchCancel={cancelPress}
                  className={`group relative max-w-[82%] ${m.deleted ? "cursor-default" : "cursor-pointer"} rounded-lg px-2.5 py-1.5 shadow-[0_1px_0.5px_rgba(11,20,26,.13)] text-[#111b21] transition-shadow ${
                    groupStart ? (mine ? "rounded-tr-none" : "rounded-tl-none") : ""
                  } ${highlightId === m.id ? "ring-2 ring-[#ec4899]/70" : ""}`}
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

                  {/* Desktop: hover par menu arrow */}
                  <button
                    type="button"
                    aria-label="Message options"
                    title="Options"
                    onClick={(e) => {
                      e.stopPropagation();
                      openMenu(m);
                    }}
                    className="hidden sm:flex absolute top-0.5 right-0.5 z-[1] w-6 h-6 items-center justify-center rounded-full text-[#667781] bg-black/10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                  >
                    <Icon name="chevron" className="w-5 h-5" />
                  </button>

                  {m.deleted ? (
                    <div className="flex items-end justify-between gap-4 italic text-[14px] text-[#667781]">
                      <span>
                        🚫 {mine ? "You deleted this message" : "This message was deleted"}
                      </span>
                      <span className="text-[11px] not-italic leading-none translate-y-0.5 select-none">
                        {formatClock(m.timestamp)}
                      </span>
                    </div>
                  ) : (
                    <>
                      {/* Quoted (reply) message */}
                      {m.replyTo && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            jumpTo(m.replyTo.id);
                          }}
                          className="block w-full text-left rounded-md bg-black/[.06] border-l-4 px-2 py-1 mb-1"
                          style={{ borderColor: m.replyTo.from === "me" ? WA.quoteMe : WA.quoteThem }}
                        >
                          <div
                            className="text-xs font-medium"
                            style={{ color: m.replyTo.from === "me" ? WA.quoteMe : WA.quoteThem }}
                          >
                            {m.replyTo.from === "me" ? "You" : target.deviceName}
                          </div>
                          <div className="text-xs text-[#54656f] line-clamp-2 break-words">
                            {quoteText}
                          </div>
                        </button>
                      )}

                      {/* Photo */}
                      {m.image && (
                        <div className="relative -mx-1 mb-1 overflow-hidden rounded-md">
                          <img
                            src={m.image}
                            alt="Shared photo"
                            onClick={(e) => {
                              e.stopPropagation();
                              setLightbox({ src: m.image, msg: m });
                            }}
                            onLoad={() => isLast && endRef.current?.scrollIntoView()}
                            className="block w-[240px] max-w-full max-h-[320px] object-cover cursor-zoom-in"
                          />
                          {!m.text && (
                            <span className="absolute bottom-1 right-1 flex items-center gap-1 rounded bg-black/45 px-1.5 py-0.5 text-[11px] leading-none text-white select-none">
                              {timeAndTicks}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Text + time */}
                      {m.text && (
                        <div className="flex flex-wrap items-end justify-end gap-x-3">
                          <span className="min-w-0 text-[14.5px] leading-[1.35] whitespace-pre-wrap break-words">
                            {m.text}
                          </span>
                          <span
                            className="ml-auto flex items-center gap-1 text-[11px] leading-none translate-y-0.5 select-none"
                            style={{ color: WA.time }}
                          >
                            {timeAndTicks}
                          </span>
                        </div>
                      )}

                      {m.status === "failed" && (
                        <div className="text-[11px] text-[#d93025] text-right mt-0.5">Not delivered</div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </React.Fragment>
          );
        })}

        <div ref={endRef} />
      </div>

      {/* Info chips */}
      {(!canChat || processing || fileError) && (
        <div className="flex justify-center px-3 pb-1 shrink-0">
          <span
            className={`rounded-lg text-xs px-3 py-1.5 text-center shadow-sm ${
              fileError && canChat ? "bg-[#fde7e9] text-[#d93025]" : "bg-[#fff5c4] text-[#54656f]"
            }`}
          >
            {!chatSupported
              ? "Chat is unavailable: the server needs to be updated."
              : !online
                ? "Your friend is offline. Messages can't be delivered."
                : processing
                  ? "Preparing photo…"
                  : fileError}
          </span>
        </div>
      )}

      {/* Edit / reply preview */}
      {editing && editingMsg && !editingMsg.deleted && (
        <ContextBar
          color={WA.send}
          title="Edit message"
          body={editingMsg.text}
          onCancel={cancelEdit}
          cancelLabel="Cancel edit"
        />
      )}
      {replyTo && !pending && !editing && (
        <ContextBar
          color={replyTo.from === "me" ? WA.quoteMe : WA.quoteThem}
          title={replyTo.from === "me" ? "You" : target.deviceName}
          body={quoteLabel(replyTo.kind, replyTo.text)}
          onCancel={() => setReplyTo(null)}
          cancelLabel="Cancel reply"
        />
      )}

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 px-2 py-2 shrink-0"
        style={{ paddingBottom: mode === "lobby" ? "max(0.5rem, env(safe-area-inset-bottom))" : undefined }}
      >
        <div className="flex-1 min-w-0 flex items-center gap-2 rounded-full bg-white pl-4 pr-1.5 py-1.5 shadow-sm">
          <input
            ref={inputRef}
            type="text"
            value={text}
            onChange={handleChange}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                if (editing) cancelEdit();
                else onClose();
              }
            }}
            maxLength={1000}
            disabled={!canChat}
            placeholder={editing ? "Edit message" : "Message"}
            enterKeyHint="send"
            autoComplete="off"
            className="flex-1 min-w-0 bg-transparent text-[15px] text-[#111b21] outline-none placeholder:text-[#667781] disabled:opacity-50"
          />
          <input ref={fileRef} type="file" accept="image/*" onChange={onPickFile} className="hidden" />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={!canChat || processing || Boolean(editing)}
            aria-label="Send a photo"
            title="Send a photo"
            className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-[#54656f] hover:bg-black/5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Icon name="image" className="w-6 h-6" />
          </button>
        </div>
        <button
          type="submit"
          disabled={!text.trim() || !canChat}
          aria-label={editing ? "Save edit" : "Send message"}
          className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center text-white shadow-sm transition-opacity disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00a884]"
          style={{ background: WA.send }}
        >
          <Icon name={editing ? "tick" : "send"} className="w-5 h-5" />
        </button>
      </form>

      {/* Message menu (bottom sheet) */}
      {menu && sel && (
        <div
          className="absolute inset-0 z-20 flex flex-col justify-end bg-black/40"
          onClick={() => setMenu(null)}
          role="dialog"
          aria-label="Message options"
        >
          <div
            className="rounded-t-2xl bg-white shadow-2xl py-2"
            style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
            onClick={(e) => e.stopPropagation()}
          >
            {menu.step === "main" ? (
              <>
                {!sel.deleted && (
                  <SheetRow icon="reply" label="Reply" onClick={() => startReply(sel)} />
                )}
                {!sel.deleted && sel.text && (
                  <SheetRow
                    icon="copy"
                    label="Copy"
                    onClick={() => {
                      copyToClipboard(sel.text);
                      setMenu(null);
                    }}
                  />
                )}
                {canEditSel && (
                  <SheetRow
                    icon="edit"
                    label="Edit"
                    hint={!online ? "Friend is offline" : undefined}
                    disabled={!canChat}
                    onClick={() => startEdit(sel)}
                  />
                )}
                <SheetRow
                  icon="trash"
                  label="Delete"
                  danger
                  onClick={() => setMenu({ msg: sel, step: "delete" })}
                />
              </>
            ) : (
              <>
                <div className="px-5 pt-3 pb-2 text-[15px] font-medium text-[#111b21]">
                  Delete message?
                </div>
                {canDeleteEveryoneSel && (
                  <SheetRow
                    label="Delete for everyone"
                    danger
                    hint={!online ? "Friend is offline" : undefined}
                    disabled={!canChat}
                    onClick={() => {
                      onDeleteForEveryone?.(sel.id);
                      setMenu(null);
                    }}
                  />
                )}
                <SheetRow
                  label="Delete for me"
                  danger
                  onClick={() => {
                    onDeleteForMe?.(sel.id);
                    if (replyTo?.id === sel.id) setReplyTo(null);
                    if (editing?.id === sel.id) cancelEdit();
                    setMenu(null);
                  }}
                />
                <SheetRow label="Cancel" onClick={() => setMenu(null)} />
              </>
            )}
          </div>
        </div>
      )}

      {/* Photo preview (bhejne se pehle, caption ke saath) */}
      {pending && (
        <div className="absolute inset-0 z-10 flex flex-col bg-[#0b141a]">
          <div className="flex items-center gap-2 px-2 py-2 text-white shrink-0">
            <button
              onClick={() => setPending(null)}
              aria-label="Discard photo"
              title="Discard"
              className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/10"
            >
              <Icon name="close" className="w-6 h-6" />
            </button>
            <span className="font-medium">Send photo</span>
          </div>
          <div className="flex-1 min-h-0 flex items-center justify-center p-3">
            <img src={pending.dataUrl} alt="Selected photo preview" className="max-w-full max-h-full object-contain rounded-md" />
          </div>
          {replyTo && (
            <ContextBar
              color={replyTo.from === "me" ? WA.quoteMe : WA.quoteThem}
              title={replyTo.from === "me" ? "You" : target.deviceName}
              body={quoteLabel(replyTo.kind, replyTo.text)}
              onCancel={() => setReplyTo(null)}
              cancelLabel="Cancel reply"
            />
          )}
          <form onSubmit={sendPending} className="flex items-center gap-2 px-2 py-2 shrink-0" style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}>
            <div className="flex-1 min-w-0 rounded-full bg-white px-4 py-2.5 shadow-sm">
              <input
                type="text"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                maxLength={1000}
                placeholder="Add a caption…"
                enterKeyHint="send"
                autoComplete="off"
                autoFocus
                className="w-full bg-transparent text-[15px] text-[#111b21] outline-none placeholder:text-[#667781]"
              />
            </div>
            <button
              type="submit"
              disabled={!canChat}
              aria-label="Send photo"
              className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center text-white shadow-sm disabled:opacity-50"
              style={{ background: WA.send }}
            >
              <Icon name="send" className="w-5 h-5" />
            </button>
          </form>
        </div>
      )}

      {/* Photo viewer */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-black/95"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-label="Photo viewer"
        >
          <div className="flex justify-end p-2 shrink-0">
            <button
              onClick={() => setLightbox(null)}
              aria-label="Close photo"
              title="Close"
              className="w-11 h-11 rounded-full flex items-center justify-center text-white hover:bg-white/10"
            >
              <Icon name="close" className="w-6 h-6" />
            </button>
          </div>
          <div className="flex-1 min-h-0 flex items-center justify-center px-2">
            <img src={lightbox.src} alt="Full size photo" className="max-w-full max-h-full object-contain" />
          </div>
          <div className="flex justify-center p-4 shrink-0" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                startReply(lightbox.msg);
              }}
              className="flex items-center gap-2 rounded-full bg-white/15 hover:bg-white/25 text-white px-5 h-11 text-sm font-medium"
            >
              <Icon name="reply" className="w-5 h-5" />
              Reply
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatPanel;
