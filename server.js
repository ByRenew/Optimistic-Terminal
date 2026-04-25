const WebSocket = require('ws');
const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3001;
const HOST = "0.0.0.0";

let server;

try {
  if (process.env.CODESPACE_NAME || fs.existsSync('/etc/ssl/certs/ssl-cert-snakeoil.pem')) {
    const https = require('https');
    try {
      server = https.createServer({
        key: fs.readFileSync('/etc/ssl/private/ssl-cert-snakeoil.key'),
        cert: fs.readFileSync('/etc/ssl/certs/ssl-cert-snakeoil.pem')
      });
      console.log('\x1b[32m✓\x1b[0m HTTPS mode');
    } catch(e) {
      const http = require('http');
      server = http.createServer();
      console.log('\x1b[33m⚠\x1b[0m HTTP mode');
    }
  } else {
    const http = require('http');
    server = http.createServer();
    console.log('\x1b[33m⚠\x1b[0m HTTP mode');
  }
} catch(e) {
  const http = require('http');
  server = http.createServer();
  console.log('\x1b[33m⚠\x1b[0m HTTP mode');
}

server.on('request', (req, res) => {
  let url = req.url.split('?')[0];
  if (url === '/') url = '/index.html';
  
  const filePath = path.join(__dirname, url);
  
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    const contentType = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css'
    }[ext] || 'text/plain';
    
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  let currentDir = os.homedir();
  let shell = null;
  
  console.log('\x1b[32m✓\x1b[0m Client connected');
  
  shell = spawn('/bin/bash', [], {
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
  
  shell.on('close', () => {
    ws.close();
  });
  
  ws.on('message', (msg) => {
    const command = msg.toString();
    
    if (command === '__cwd__') {
      ws.send(JSON.stringify({ type: 'cwd', data: currentDir }));
      return;
    }
    
    if (command.startsWith('__cd__:')) {
      const newDir = command.substring(7).replace('~', os.homedir());
      try {
        process.chdir(newDir);
        currentDir = process.cwd();
        ws.send(JSON.stringify({ type: 'cwd', data: currentDir }));
      } catch(e) {
        ws.send(JSON.stringify({ type: 'output', data: `cd: ${command.substring(7)}: No such file\n` }));
      }
      return;
    }
    
    if (shell && shell.stdin) {
      shell.stdin.write(command + '\n');
    }
  });
  
  ws.on('close', () => {
    if (shell) shell.kill();
    console.log('\x1b[31m✗\x1b[0m Client disconnected');
  });
  
  ws.send(JSON.stringify({ type: 'ready', message: 'Terminal ready' }));
  ws.send(JSON.stringify({ type: 'cwd', data: currentDir }));
});

server.listen(PORT, HOST, () => {
  const protocol = server.constructor.name === 'Server' ? 'http' : 'https';
  console.log('\x1b[36m════════════════════════════════════════════\x1b[0m');
  console.log('\x1b[32mOptimistic OS Terminal Server\x1b[0m');
  console.log('\x1b[36m════════════════════════════════════════════\x1b[0m');
  console.log(`\x1b[32m✓\x1b[0m ${protocol}://${HOST}:${PORT}`);
  console.log(`\x1b[32m✓\x1b[0m Ready\n`);
});