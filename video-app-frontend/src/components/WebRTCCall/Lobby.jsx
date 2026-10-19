import React, { useState, useEffect } from "react";
import Avatar from "./Avatar";
import Icon from "./Icon";
import Logo from "../../assets/Logo.jpg"

const TABS = [
  { id: "friends", label: "Friends" },
  { id: "requests", label: "Requests" },
  { id: "find", label: "Find people" },
];

// ------------------------------------------------------------ small pieces
const Badge = ({ count }) =>
  count > 0 ? (
    <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#d93025] text-white text-[11px] leading-[18px] font-medium text-center">
      {count > 9 ? "9+" : count}
    </span>
  ) : null;

const RoundButton = ({ icon, label, onClick, disabled, badge = 0, tone = "blue" }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    title={label}
    className={`relative shrink-0 w-10 h-10 rounded-full border flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1a73e8] ${tone === "red"
      ? "border-[#dadce0] text-[#5f6368] hover:bg-[#fce8e6] hover:text-[#d93025]"
      : "border-[#dadce0] text-[#1a73e8] hover:bg-[#e8f0fe]"
      }`}
  >
    <Icon name={icon} className="w-5 h-5" />
    {badge > 0 && (
      <span className="absolute -top-1 -right-1">
        <Badge count={badge} />
      </span>
    )}
  </button>
);

const PillButton = ({ children, onClick, disabled, variant = "primary", icon }) => {
  const styles = {
    primary:
      "bg-[#1a73e8] hover:bg-[#1765cc] text-white disabled:bg-[#e8eaed] disabled:text-[#9aa0a6]",
    outline:
      "border border-[#dadce0] text-[#1a73e8] hover:bg-[#e8f0fe] disabled:text-[#9aa0a6] disabled:hover:bg-transparent",
    ghost: "text-[#5f6368] hover:bg-[#f1f3f4]",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 rounded-full text-sm font-medium h-10 px-4 shrink-0 transition-colors disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1a73e8] ${styles[variant]}`}
    >
      {icon && <Icon name={icon} className="w-5 h-5" />}
      {children}
    </button>
  );
};

const Row = ({ children }) => (
  <li className="flex items-center gap-3 sm:gap-4 px-4 sm:px-6 py-3 hover:bg-[#f8f9fa]">
    {children}
  </li>
);

const Empty = ({ icon, title, hint, action }) => (
  <div className="px-4 sm:px-6 py-10 sm:py-14 text-center text-[#5f6368]">
    <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-[#f1f3f4] flex items-center justify-center">
      <Icon name={icon} className="w-7 h-7 text-[#80868b]" />
    </div>
    <div className="font-medium text-[#202124]">{title}</div>
    <div className="mt-1 text-sm">{hint}</div>
    {action}
  </div>
);

// ------------------------------------------------------------------ Lobby
const Lobby = ({
  hidden,
  deviceName,
  socketId,
  status,
  isConnected,
  inCall,
  friends = [],
  strangers = [],
  requests = { incoming: [], outgoing: [] },
  unread = {},
  serverOutdated,
  onCall,
  onChat,
  onAddFriend,
  onCancelRequest,
  onRespond,
  onRemoveFriend,
  onEditName,
}) => {
  const [clock, setClock] = useState(new Date());
  const [tab, setTab] = useState("friends");
  const [confirmRemove, setConfirmRemove] = useState(null); // friend publicId

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

  const onlineFriends = friends.filter((f) => f.online).length;
  const incomingCount = requests.incoming.length;
  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);

  const tabMeta = {
    friends: `${onlineFriends} online`,
    requests: incomingCount ? `${incomingCount} pending` : "",
    find: `${strangers.length} online`,
  };

  return (
    <div className={hidden ? "hidden" : "flex flex-col min-h-dvh"}>
      <header className="flex items-center justify-between px-4 sm:px-6 py-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-[#1a73e8] flex items-center justify-center text-white">
            {/* <Icon name="video" className="w-5 h-5" /> */}
            <img
              src={Logo}
              alt="DilConnect Logo"
              className="w-9 h-9 object-cover rounded-lg"
            />
          </div>
          <span className="text-xl sm:text-[22px] text-[#5f6368]">
            <span className="font-medium">DilConnect</span>
          </span>
        </div>
        <div className="flex items-center gap-4 text-[#5f6368] text-sm sm:text-base">
          <span className="hidden sm:inline">
            {timeLabel} &bull; {dateLabel}
          </span>
          <Avatar name={deviceName} size={36} />
        </div>
      </header>

      <main className="flex-1 grid md:grid-cols-2 gap-8 md:gap-10 items-start md:items-center max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Left: intro + own device */}
        <section>
          <h1 className="text-3xl sm:text-4xl md:text-[44px] leading-[1.15] font-normal text-[#202124] mb-4">
            Video calls with your friends
          </h1>
          <p className="text-base sm:text-lg text-[#5f6368] mb-6 sm:mb-8 max-w-md">
            Add a friend, and once they accept you can call and message each other any time
            they&apos;re online.
          </p>

          <div className="inline-flex max-w-full items-center gap-3 sm:gap-4 rounded-2xl border border-[#dadce0] px-4 sm:px-5 py-3 sm:py-4">
            <Avatar name={deviceName} size={48} />
            <div className="min-w-0">
              <div className="font-medium text-[#202124]">
                {deviceName || "Connecting..."}{" "}
                <span className="text-[#5f6368] font-normal">(You)</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-[#5f6368]">
                <span
                  className={`w-2 h-2 rounded-full ${isConnected ? "bg-[#188038]" : "bg-[#e37400]"}`}
                />
                {status}
              </div>
              {socketId && (
                <div className="text-xs text-[#80868b] font-mono mt-0.5 break-all">{socketId}</div>
              )}
            </div>
            <button
              onClick={onEditName}
              aria-label="Change your name"
              title="Change name"
              className="shrink-0 w-9 h-9 rounded-full text-[#5f6368] hover:bg-[#f1f3f4] flex items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1a73e8]"
            >
              <Icon name="edit" className="w-5 h-5" />
            </button>
          </div>
        </section>

        {/* Right: friends / requests / find people */}
        <section className="rounded-3xl border border-[#dadce0] shadow-[0_1px_3px_rgba(60,64,67,.15)] overflow-hidden">
          {/* Tabs */}
          <div role="tablist" className="flex border-b border-[#dadce0]">
            {TABS.map((t) => {
              const active = tab === t.id;
              const badge = t.id === "requests" ? incomingCount : t.id === "friends" ? totalUnread : 0;
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.id)}
                  className={`relative flex-1 flex items-center justify-center gap-1.5 px-2 py-3.5 text-sm font-medium transition-colors ${active ? "text-[#1a73e8]" : "text-[#5f6368] hover:bg-[#f8f9fa]"
                    }`}
                >
                  {t.label}
                  <Badge count={badge} />
                  {active && (
                    <span className="absolute left-3 right-3 bottom-0 h-[3px] rounded-t-full bg-[#1a73e8]" />
                  )}
                </button>
              );
            })}
          </div>
          <div className="px-4 sm:px-6 py-2 text-xs text-[#5f6368] border-b border-[#f1f3f4] min-h-8">
            {tabMeta[tab]}
          </div>

          {serverOutdated && isConnected && (
            <div className="mx-4 sm:mx-6 mt-3 rounded-lg bg-[#fff5c4] text-[#54656f] text-xs px-3 py-2">
              The backend server is out of date. Friend requests, calls and chat need the
              updated server. Redeploy the backend and reload.
            </div>
          )}

          {/* ------------------------------ Friends ------------------------------ */}
          {tab === "friends" &&
            (friends.length === 0 ? (
              <Empty
                icon="personAdd"
                title="No friends yet"
                hint="You can only call and message people who have accepted your friend request."
                action={
                  <div className="mt-4 flex justify-center">
                    <PillButton variant="outline" onClick={() => setTab("find")}>
                      Find people
                    </PillButton>
                  </div>
                }
              />
            ) : (
              <ul className="max-h-[55dvh] md:max-h-[420px] overflow-y-auto divide-y divide-[#f1f3f4]">
                {friends.map((f) => {
                  const busy = f.status === "busy";
                  const subtitle = !f.online ? "Offline" : busy ? "Busy" : "Available";
                  const subtitleColor = !f.online
                    ? "text-[#80868b]"
                    : busy
                      ? "text-[#d93025]"
                      : "text-[#188038]";

                  return (
                    <Row key={f.publicId}>
                      <div className="relative shrink-0">
                        <Avatar name={f.name} size={44} />
                        <span
                          className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white ${f.online ? "bg-[#188038]" : "bg-[#bdc1c6]"
                            }`}
                        />
                      </div>

                      {confirmRemove === f.publicId ? (
                        <>
                          <div className="min-w-0 flex-1 text-sm">
                            Remove <span className="font-medium">{f.name}</span>?
                          </div>
                          <PillButton variant="ghost" onClick={() => setConfirmRemove(null)}>
                            Cancel
                          </PillButton>
                          <button
                            onClick={() => {
                              onRemoveFriend(f.publicId);
                              setConfirmRemove(null);
                            }}
                            className="rounded-full bg-[#d93025] hover:bg-[#b3261e] text-white text-sm font-medium h-10 px-4 shrink-0"
                          >
                            Remove
                          </button>
                        </>
                      ) : (
                        <>
                          <div className="min-w-0 flex-1">
                            <div className="font-medium truncate">{f.name}</div>
                            <div className={`text-sm ${subtitleColor}`}>{subtitle}</div>
                          </div>
                          <RoundButton
                            icon="chat"
                            label={`Message ${f.name}`}
                            disabled={!f.online || !isConnected}
                            badge={unread[f.publicId] || 0}
                            onClick={() => onChat({ publicId: f.publicId, deviceName: f.name })}
                          />
                          <button
                            disabled={inCall || !f.online || busy || !isConnected}
                            onClick={() =>
                              onCall({
                                socketId: f.socketId,
                                publicId: f.publicId,
                                deviceName: f.name,
                              })
                            }
                            aria-label={`Call ${f.name}`}
                            title="Call"
                            className="flex items-center justify-center gap-2 rounded-full bg-[#1a73e8] hover:bg-[#1765cc] disabled:bg-[#e8eaed] disabled:text-[#9aa0a6] disabled:cursor-not-allowed text-white text-sm font-medium h-10 w-10 sm:w-auto sm:px-5 shrink-0 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1a73e8]"
                          >
                            <Icon name="video" className="w-5 h-5" />
                            <span className="hidden sm:inline">Call</span>
                          </button>
                          <RoundButton
                            icon="personRemove"
                            label={`Remove ${f.name}`}
                            tone="red"
                            onClick={() => setConfirmRemove(f.publicId)}
                          />
                        </>
                      )}
                    </Row>
                  );
                })}
              </ul>
            ))}

          {/* ------------------------------ Requests ----------------------------- */}
          {tab === "requests" &&
            (requests.incoming.length === 0 ? (
              <Empty
                icon="personAdd"
                title="No pending requests"
                hint="When someone sends you a friend request, it will show up here."
              />
            ) : (
              <ul className="max-h-[55dvh] md:max-h-[420px] overflow-y-auto divide-y divide-[#f1f3f4]">
                {requests.incoming.map((r) => (
                  <Row key={r.publicId}>
                    <Avatar name={r.name} size={44} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{r.name}</div>
                      <div className="text-sm text-[#5f6368]">wants to be your friend</div>
                    </div>
                    <PillButton variant="ghost" onClick={() => onRespond(r.publicId, false)}>
                      Decline
                    </PillButton>
                    <PillButton onClick={() => onRespond(r.publicId, true)} disabled={!isConnected}>
                      Accept
                    </PillButton>
                  </Row>
                ))}
              </ul>
            ))}

          {/* ----------------------------- Find people --------------------------- */}
          {tab === "find" &&
            (strangers.length === 0 ? (
              <Empty
                icon="video"
                title="No one else is online"
                hint="Share this link with someone. When they open it, they'll show up here."
              />
            ) : (
              <ul className="max-h-[55dvh] md:max-h-[420px] overflow-y-auto divide-y divide-[#f1f3f4]">
                {strangers.map((d) => {
                  const requested = requests.outgoing.includes(d.publicId);
                  const theySent = requests.incoming.some((r) => r.publicId === d.publicId);
                  return (
                    <Row key={d.socketId}>
                      <Avatar name={d.deviceName} size={44} />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{d.deviceName}</div>
                        <div className="text-sm text-[#5f6368]">
                          {theySent ? "Sent you a request" : "Online"}
                        </div>
                      </div>
                      {theySent ? (
                        <PillButton onClick={() => onRespond(d.publicId, true)} disabled={!isConnected}>
                          Accept
                        </PillButton>
                      ) : requested ? (
                        <>
                          <PillButton variant="ghost" onClick={() => onCancelRequest(d.publicId)}>
                            Cancel
                          </PillButton>
                          <span className="shrink-0 rounded-full bg-[#f1f3f4] text-[#5f6368] text-sm font-medium h-10 px-4 flex items-center">
                            Requested
                          </span>
                        </>
                      ) : (
                        <PillButton
                          variant="outline"
                          icon="personAdd"
                          disabled={!isConnected}
                          onClick={() => onAddFriend(d)}
                        >
                          <span className="hidden sm:inline">Add friend</span>
                          <span className="sm:hidden">Add</span>
                        </PillButton>
                      )}
                    </Row>
                  );
                })}
              </ul>
            ))}
        </section>
      </main>
    </div>
  );
};

export default Lobby;
