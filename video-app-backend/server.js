require("dotenv").config();
const express = require("express");
const http = require("http");
const https = require("https");
const path = require("path");
const { Server } = require("socket.io");
const { getSSLCredentials } = require("./ssl");
const { setupSocket } = require("./socketHandler");


const app = express();

const PORT = process.env.PORT || 5000;
const HOST = "0.0.0.0";
const IS_PRODUCTION = process.env.NODE_ENV === "production" || process.env.USE_HTTP === "true";

// Metered.ca Credentials (Environment variables ya direct yahan daalein)
const METERED_DOMAIN = process.env.METERED_DOMAIN || "YOUR_METERED_DOMAIN";
const METERED_API_KEY = process.env.METERED_API_KEY || "YOUR_METERED_API_KEY";



app.use(express.static(path.join(__dirname, "public")));

// Deploy check: browser me <backend-url>/version kholo. {"chat":true} aaye to naya code live hai.
app.get("/version", (req, res) => res.json({ chat: true, version: 2 }));

// Dynamic TURN credentials API endpoint
// app.get("/api/turn-credentials", async (req, res) => {
//   try {
//     const response = await fetch(
//       `https://${METERED_DOMAIN}.metered.ca/api/v1/turn/credentials?apiKey=${METERED_API_KEY}`
//     );
//     const iceServers = await response.json();
//     res.json(iceServers);
//   } catch (error) {
//     console.error("Failed to fetch TURN credentials:", error);
//     // Fallback STUN
//     res.json([{ urls: "stun:stun.l.google.com:19302" }]);
//   }
// });

app.get("/api/turn-credentials", (req, res) => {
  try {
    const turnServer = process.env.TURN_SERVER;
    const username = process.env.TURN_USERNAME;
    const credential = process.env.TURN_PASSWORD;

    if (!turnServer || !username || !credential) {
      return res.status(500).json({
        error: "TURN credentials are not configured"
      });
    }

    const iceServers = [
      {
        urls: "stun:stun.l.google.com:19302"
      },
      {
        urls: [
          `turn:${turnServer}?transport=udp`,
          `turn:${turnServer}?transport=tcp`
        ],
        username,
        credential
      }
    ];

    res.json(iceServers);

  } catch (error) {
    console.error("TURN credentials error:", error);

    res.status(500).json({
      error: "Failed to generate TURN configuration"
    });
  }
});


async function startServer() {
  try {
    let server;

    if (IS_PRODUCTION) {
      // Cloud platforms (Render, Railway, AWS ALB, Ngrok) SSL khud terminate karte hain
      server = http.createServer(app);
      console.log("Running in standard HTTP mode (SSL handled by proxy/cloud)");
    } else {
      // Local Wi-Fi testing ke liye selfsigned HTTPS
      const SSL_HOST = process.env.SSL_HOST || "192.168.1.3";
      const sslOptions = await getSSLCredentials(SSL_HOST);
      server = https.createServer(sslOptions, app);
      console.log(`Running in Local HTTPS mode for IP: ${SSL_HOST}`);
    }

    const io = new Server(server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"],
      },
    });

    setupSocket(io);

    server.listen(PORT, HOST, () => {
      console.log("\n================================");
      console.log("       WEBRTC SIGNALING SERVER");
      console.log("================================");
      console.log(`Port: ${PORT}`);
      console.log("================================\n");
    });
  } catch (error) {
    console.error("SERVER START ERROR:", error);
    process.exit(1);
  }
}

startServer();