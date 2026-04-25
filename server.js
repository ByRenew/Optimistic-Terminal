const express = require('express');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Railway Terminal Server running on port ${PORT}`);
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  let currentDir = os.homedir();
  console.log(`Client connected`);
  
  const shell = spawn('/bin/bash', ['-l'], {
    cwd: currentDir,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
    },
    shell: false
  });
  
  shell.stdout.on('data', (data) => {
    ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
  });
  
  shell.stderr.on('data', (data) => {
    ws.send(JSON.stringify({ type: 'output', data: `\x1b[31m${data.toString()}\x1b[0m` }));
  });
  
  ws.on('message', (msg) => {
    const cmd = msg.toString();
    if (cmd === '__cwd__') {
      ws.send(JSON.stringify({ type: 'cwd', data: currentDir }));
    } else if (cmd.startsWith('__cd__:')) {
      const newDir = cmd.substring(7).replace('~', os.homedir());
      try {
        process.chdir(newDir);
        currentDir = process.cwd();
        ws.send(JSON.stringify({ type: 'cwd', data: currentDir }));
      } catch(e) {}
    } else {
      shell.stdin.write(cmd + '\n');
    }
  });
  
  ws.on('close', () => {
    shell.kill();
    console.log(`Client disconnected`);
  });
});
