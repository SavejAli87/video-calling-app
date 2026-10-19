const AVATAR_COLORS = ["#1a73e8", "#188038", "#e37400", "#a142f4", "#d93025", "#00897b"];

// "Savej Ali" -> "SA", "Savej" -> "SA", "Device-XSGMA" -> "XS"
export const initialsOf = (name = "") => {
  const parts = name.replace(/^Device-/i, "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0] || "?").slice(0, 2).toUpperCase();
};

// Extra spaces hatao, trim karo, max length lagao
export const normalizeName = (raw, max = 30) =>
  String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, max);

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

export const formatClock = (ts) =>
  new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

// WhatsApp jaise date separator: Today / Yesterday / 12 Oct 2026
export const dayLabel = (ts) => {
  const d = new Date(ts);
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(new Date()) - startOf(d)) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
};

export const isSameDay = (a, b) => dayLabel(a) === dayLabel(b);

/**
 * Photo ko bhejne se pehle chhota karo: max 1280px, JPEG, ~700KB se kam.
 * (Server limit se bahut neeche, taaki slow network par bhi chale.)
 * Reject hota hai (readable message ke saath) agar file image nahi hai ya padhi nahi ja sakti.
 */
export const fileToCompressedDataUrl = (file, { maxDim = 1280, maxChars = 700000 } = {}) =>
  new Promise((resolve, reject) => {
    if (!file || !file.type || !file.type.startsWith("image/")) {
      return reject(new Error("Please choose an image file."));
    }
    if (file.size > 25 * 1024 * 1024) {
      return reject(new Error("That photo is too large (max 25 MB)."));
    }

    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        let scale = Math.min(1, maxDim / Math.max(w, h));

        for (let attempt = 0; attempt < 6; attempt++) {
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(w * scale));
          canvas.height = Math.max(1, Math.round(h * scale));
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#ffffff"; // PNG transparency JPEG me kaali na ho
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          for (const quality of [0.82, 0.7, 0.58]) {
            const out = canvas.toDataURL("image/jpeg", quality);
            if (out.length <= maxChars) return resolve(out);
          }
          scale *= 0.75;
        }
        reject(new Error("Couldn't shrink that photo enough to send."));
      } catch {
        reject(new Error("Couldn't read that photo."));
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn't read that photo."));
    };
    img.src = url;
  });

// ---------------------------------------------------------------- message helpers
/** 24 ghante (ttl) se purane messages hata do. Kuch na hataya ho to wahi object wapas (re-render nahi). */
export const pruneExpired = (messagesByPeer, now, ttl) => {
  let changed = false;
  const next = {};
  for (const [peer, list] of Object.entries(messagesByPeer)) {
    const kept = list.filter((m) => now - m.timestamp <= ttl);
    if (kept.length !== list.length) changed = true;
    if (kept.length) next[peer] = kept;
  }
  return changed ? next : messagesByPeer;
};

/** Storage se aaye messages ko live state ke saath milao (same id ho to live wala jeetta hai). */
export const mergeMessages = (restored, live) => {
  const out = { ...live };
  for (const [peer, list] of Object.entries(restored)) {
    const current = live[peer] || [];
    const seen = new Set(current.map((m) => m.id));
    const merged = [...list.filter((m) => !seen.has(m.id)), ...current];
    merged.sort((a, b) => a.timestamp - b.timestamp);
    out[peer] = merged;
  }
  return out;
};

// Deleted-for-everyone ka placeholder
export const toDeletedMessage = (m) => ({
  ...m,
  deleted: true,
  text: "",
  image: null,
  replyTo: null,
  edited: false,
});
