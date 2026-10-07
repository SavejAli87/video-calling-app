// Server URL
// Vercel/Netlify WebSocket proxy nahi karte, isliye seedha Render backend use karo.
const BACKEND_URL = "https://video-calling-app-z1ed.onrender.com";
export const SERVER_URL = import.meta.env.VITE_SIGNALING_URL || BACKEND_URL;

export const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: [
        "turn:free.expressturn.com:3478?transport=udp",
        "turn:free.expressturn.com:3478?transport=tcp",
      ],
      username: import.meta.env.VITE_TURN_USER,
      credential: import.meta.env.VITE_TURN_CRED,
    },
  ],
  // "all" = direct + TURN fallback. Sirf debugging ke liye "relay" use karo.
  iceTransportPolicy: "all",
  iceCandidatePoolSize: 10,
};
