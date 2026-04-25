const express = require('express');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static(__dirname));

app.get('/terminal', (req, res) => {
  res.sendFile(path.join(__dirname, 'terminal.html'));
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  let currentDir = os.homedir();
  let shell = spawn(process.platform === 'win32' ? 'cmd.exe' : '/bin/bash', [], {
    cwd: currentDir,
    env: { ...process.env, TERM: 'xterm-256color' },
    shell: true
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
  
  ws.on('close', () => shell.kill());
});
