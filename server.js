#!/usr/bin/env node

const http = require("http");
const ws = require("ws");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const os = require("os");

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || "0.0.0.0";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

// Create HTTP server
const server = http.createServer((req, res) => {
  let urlPath = req.url.split("?")[0];
  
  // Default to index.html
  if (urlPath === "/") urlPath = "/index.html";
  
  // Security: prevent directory traversal
  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(__dirname, safePath);
  
  // Check if file exists and is within terminal directory
  if (filePath.startsWith(__dirname) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || "application/octet-stream";
    
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
    });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("404: Terminal file not found");
  }
});

// WebSocket server for terminal
const wss = new ws.Server({ server });
let terminalSessions = new Map();
let sessionCounter = 0;

console.log("\x1b[36m╔════════════════════════════════════════════╗\x1b[0m");
console.log("\x1b[36m║      Optimistic OS Terminal Server         ║\x1b[0m");
console.log("\x1b[36m╚════════════════════════════════════════════╝\x1b[0m");
console.log(`\x1b[32m✓\x1b[0m Server running at http://${HOST}:${PORT}`);
console.log(`\x1b[32m✓\x1b[0m WebSocket endpoint: ws://${HOST}:${PORT}`);
console.log(`\x1b[36m➜\x1b[0m Open in browser: http://${HOST}:${PORT}\n`);

wss.on("connection", (ws, req) => {
  const sessionId = ++sessionCounter;
  let currentDir = os.homedir();
  let shellProcess = null;
  let isAlive = true;
  let outputBuffer = "";

  console.log(`\x1b[32m✓\x1b[0m [Session ${sessionId}] Terminal connected from ${req.socket.remoteAddress}`);

  // Send welcome message
  ws.send(JSON.stringify({
    type: "ready",
    data: `\x1b[32mConnected to Optimistic OS Terminal\x1b[0m\n\x1b[33mSession ID: ${sessionId}\x1b[0m\n`
  }));

  // Spawn shell based on OS
  const shellCmd = process.platform === "win32" ? "cmd.exe" : "/bin/bash";
  const shellArgs = process.platform === "win32" ? [] : ["--norc", "--noediting"];
  
  shellProcess = spawn(shellCmd, shellArgs, {
    cwd: currentDir,
    env: { ...process.env, TERM: "xterm-256color" },
    shell: true
  });

  // Handle stdout
  shellProcess.stdout.on("data", (data) => {
    if (isAlive) {
      const output = data.toString();
      outputBuffer += output;
      
      // Send in chunks to avoid flooding
      if (outputBuffer.length > 1024 || output.includes("\n")) {
        ws.send(JSON.stringify({
          type: "output",
          data: outputBuffer
        }));
        outputBuffer = "";
      }
    }
  });

  // Handle stderr
  shellProcess.stderr.on("data", (data) => {
    if (isAlive) {
      ws.send(JSON.stringify({
        type: "output",
        data: `\x1b[31m${data.toString()}\x1b[0m`
      }));
    }
  });

  // Handle shell exit
  shellProcess.on("close", (code) => {
    console.log(`\x1b[33m⚠\x1b[0m [Session ${sessionId}] Shell exited with code ${code}`);
    if (isAlive) {
      ws.send(JSON.stringify({
        type: "output",
        data: `\n\x1b[31mShell terminated with code ${code}\x1b[0m\n`
      }));
    }
  });

  shellProcess.on("error", (err) => {
    console.error(`\x1b[31m✗\x1b[0m [Session ${sessionId}] Shell error: ${err.message}`);
    if (isAlive) {
      ws.send(JSON.stringify({
        type: "output",
        data: `\x1b[31mShell error: ${err.message}\x1b[0m\n`
      }));
    }
  });

  // Handle incoming messages
  ws.on("message", (message) => {
    const data = message.toString();
    
    // Special protocol commands
    if (data === "__GET_CWD__") {
      ws.send(JSON.stringify({
        type: "cwd",
        data: currentDir
      }));
      return;
    }
    
    if (data === "__GET_ENV__") {
      ws.send(JSON.stringify({
        type: "env",
        data: process.env
      }));
      return;
    }
    
    if (data.startsWith("__CD__:")) {
      const newDir = data.substring(7);
      try {
        process.chdir(newDir);
        currentDir = process.cwd();
        
        // Restart shell in new directory
        if (shellProcess) {
          shellProcess.kill();
          shellProcess = spawn(shellCmd, shellArgs, {
            cwd: currentDir,
            env: { ...process.env, TERM: "xterm-256color" },
            shell: true
          });
          
          // Reattach listeners
          shellProcess.stdout.on("data", (d) => {
            if (isAlive) ws.send(JSON.stringify({ type: "output", data: d.toString() }));
          });
          shellProcess.stderr.on("data", (d) => {
            if (isAlive) ws.send(JSON.stringify({ type: "output", data: `\x1b[31m${d.toString()}\x1b[0m` }));
          });
        }
        
        ws.send(JSON.stringify({
          type: "cwd",
          data: currentDir
        }));
      } catch (err) {
        ws.send(JSON.stringify({
          type: "output",
          data: `cd: ${err.message}\n`
        }));
      }
      return;
    }
    
    // Send command to shell
    if (shellProcess && shellProcess.stdin && !shellProcess.stdin.destroyed) {
      shellProcess.stdin.write(data + "\n");
    } else {
      ws.send(JSON.stringify({
        type: "output",
        data: "\x1b[31mShell not available\x1b[0m\n"
      }));
    }
  });

  // Handle ping/pong for keepalive
  ws.on("pong", () => {
    // Connection alive
  });

  // Handle close
  ws.on("close", () => {
    isAlive = false;
    if (shellProcess && !shellProcess.killed) {
      shellProcess.kill();
    }
    terminalSessions.delete(sessionId);
    console.log(`\x1b[31m✗\x1b[0m [Session ${sessionId}] Terminal disconnected`);
  });

  ws.on("error", (err) => {
    console.error(`\x1b[31m✗\x1b[0m [Session ${sessionId}] WebSocket error: ${err.message}`);
  });

  // Store session
  terminalSessions.set(sessionId, { ws, shell: shellProcess, dir: currentDir });
  
  // Send initial prompt
  setTimeout(() => {
    if (isAlive && shellProcess) {
      shellProcess.stdin.write("\n");
    }
  }, 100);
});

// Keepalive ping every 30 seconds
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on("close", () => {
  clearInterval(interval);
});

// Handle server shutdown
process.on("SIGINT", () => {
  console.log("\n\x1b[33m⚠\x1b[0m Shutting down terminal server...");
  wss.clients.forEach((ws) => {
    ws.close();
  });
  server.close(() => {
    console.log("\x1b[32m✓\x1b[0m Server stopped");
    process.exit(0);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`\x1b[32m✓\x1b[0m HTTP server: http://${HOST}:${PORT}`);
  console.log(`\x1b[32m✓\x1b[0m WebSocket: ws://${HOST}:${PORT}`);
  console.log(`\x1b[36m➜\x1b[0m Ready for connections\n`);
});
