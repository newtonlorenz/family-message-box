import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const certificatePath = path.resolve(".certs/family-message-box-lan-ca.cer");
const certificate = fs.readFileSync(certificatePath);
const profile = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadCertificateFileName</key>
      <string>family-message-box-lan-ca.cer</string>
      <key>PayloadContent</key>
      <data>${certificate.toString("base64")}</data>
      <key>PayloadDescription</key>
      <string>Trusts the private Family Message Box HTTPS server on this LAN.</string>
      <key>PayloadDisplayName</key>
      <string>Family Message Box LAN Root</string>
      <key>PayloadIdentifier</key>
      <string>com.familymessagebox.lan.ca</string>
      <key>PayloadType</key>
      <string>com.apple.security.root</string>
      <key>PayloadUUID</key>
      <string>329B8C2F-6D32-4BAA-8B68-6A953DD0A89F</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
    </dict>
  </array>
  <key>PayloadDescription</key>
  <string>Installs the local certificate required to use the Family Message Box microphone PWA over HTTPS.</string>
  <key>PayloadDisplayName</key>
  <string>Family Message Box LAN Certificate</string>
  <key>PayloadIdentifier</key>
  <string>com.familymessagebox.lan.profile</string>
  <key>PayloadOrganization</key>
  <string>Family Message Box</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>542E139C-6B1D-47EF-8F80-E10FE370E933</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>
`);

const server = http.createServer((request, response) => {
  if (request.url === "/family-message-box.mobileconfig") {
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-disposition": "attachment; filename=\"family-message-box.mobileconfig\"",
      "content-length": String(profile.length),
      "content-type": "application/x-apple-aspen-config"
    });
    response.end(profile);
    return;
  }

  if (request.url !== "/family-message-box-lan-ca.cer") {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "cache-control": "no-store",
    "content-disposition": "attachment; filename=\"family-message-box-lan-ca.cer\"",
    "content-length": String(certificate.length),
    "content-type": "application/x-x509-ca-cert"
  });
  response.end(certificate);
});

server.listen(5175, "0.0.0.0", () => {
  console.log("LAN certificate available on port 5175");
});
