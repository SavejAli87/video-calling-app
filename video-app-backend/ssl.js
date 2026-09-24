const fs = require("fs");
const path = require("path");
const selfsigned = require("selfsigned");

const certDir = path.join(__dirname, "cert");
const keyPath = path.join(certDir, "key.pem");
const certPath = path.join(certDir, "cert.pem");

async function getSSLCredentials(hostIp) {
  if (!fs.existsSync(certDir)) {
    fs.mkdirSync(certDir, { recursive: true });
  }

  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    console.log("\nCreating local HTTPS certificate...");

    const attrs = [{ name: "commonName", value: hostIp || "localhost" }];
    const notBefore = new Date();
    const notAfter = new Date();
    notAfter.setFullYear(notAfter.getFullYear() + 1);

    const altNames = [
      { type: 2, value: "localhost" },
      { type: 7, ip: "127.0.0.1" },
    ];

    if (hostIp && hostIp !== "localhost" && hostIp !== "127.0.0.1") {
      altNames.push({ type: 7, ip: hostIp });
    }

    const pems = await selfsigned.generate(attrs, {
      keyType: "rsa",
      keySize: 2048,
      algorithm: "sha256",
      notBeforeDate: notBefore,
      notAfterDate: notAfter,
      extensions: [
        { name: "basicConstraints", cA: false, critical: true },
        {
          name: "keyUsage",
          digitalSignature: true,
          keyEncipherment: true,
          critical: true,
        },
        { name: "extKeyUsage", serverAuth: true },
        {
          name: "subjectAltName",
          altNames: altNames,
        },
      ],
    });

    fs.writeFileSync(keyPath, pems.private);
    fs.writeFileSync(certPath, pems.cert);
    console.log("HTTPS certificate created successfully.");
  } else {
    console.log("\nExisting HTTPS certificate found.");
  }

  return {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
    minVersion: "TLSv1.2",
  };
}

module.exports = { getSSLCredentials };