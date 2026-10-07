const AVATAR_COLORS = ["#1a73e8", "#188038", "#e37400", "#a142f4", "#d93025", "#00897b"];

export const initialsOf = (name = "") => {
  const code = name.replace(/^Device-/i, "");
  return (code.slice(0, 2) || "?").toUpperCase();
};

export const colorOf = (name = "") => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
};

export const formatTime = (s) => {
  const m = Math.floor(s / 60).toString().padStart(2, "0");
  const sec = (s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
};
