#!/usr/bin/env node
/**
 * PONG-84 局域网转发服务（Node.js 版）
 * 用法: node pong84-host-node.js --port 8080
 * 依赖: npm install ws
 */
const WebSocket = require('ws');
const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const PORT = portIdx >= 0 ? parseInt(args[portIdx + 1], 10) : 8080;

let hostWs = null;
const clients = new Map();

console.log('==============================================');
console.log('  PONG-84 LAN Server (Node.js)');
console.log('  Listening on port ' + PORT);
console.log('  房主地址示例: ws://10.126.126.1:' + PORT);
console.log('==============================================');
console.log('等待房主和客户端连接...\n');

const wss = new WebSocket.Server({ port: PORT });

wss.on('connection', (ws) => {
  let role = null;
  let id = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }

    if (msg.t === 'register') {
      role = msg.role;
      id = msg.id || Math.random().toString(36).slice(2, 10);
      if (role === 'host') {
        if (hostWs && hostWs !== ws) { try { hostWs.close(); } catch (e) {} }
        hostWs = ws;
        ws.send(JSON.stringify({ t: 'registered', role: 'host', id }));
        console.log('[+] 房主已连接  id=' + id);
      } else {
        clients.set(id, ws);
        ws.send(JSON.stringify({ t: 'registered', role: 'client', id }));
        if (hostWs && hostWs.readyState === WebSocket.OPEN) {
          try { hostWs.send(JSON.stringify({ t: 'peerJoin', id, name: msg.name || 'Player' })); } catch (e) {}
        }
        console.log('[+] 客户端已连接  id=' + id + '  name=' + (msg.name || 'Player'));
      }
      return;
    }

    if (msg.t === 'ping') {
      try { ws.send(JSON.stringify({ t: 'pong', ts: msg.ts })); } catch (e) {}
      return;
    }

    if (!role) return;

    if (role === 'host') {
      const target = msg.to;
      if (target) {
        const c = clients.get(target);
        if (c && c.readyState === WebSocket.OPEN) {
          try { c.send(JSON.stringify(msg)); } catch (e) {}
        }
      } else {
        for (const c of clients.values()) {
          if (c.readyState === WebSocket.OPEN) {
            try { c.send(JSON.stringify(msg)); } catch (e) {}
          }
        }
      }
      return;
    }

    if (role === 'client') {
      if (hostWs && hostWs.readyState === WebSocket.OPEN) {
        msg.from = id;
        try { hostWs.send(JSON.stringify(msg)); } catch (e) {}
      }
    }
  });

  ws.on('close', () => {
    if (role === 'host' && hostWs === ws) {
      hostWs = null;
      for (const c of clients.values()) { try { c.close(); } catch (e) {} }
      clients.clear();
      console.log('[-] 房主断开，所有客户端被清理');
    } else if (role === 'client' && id) {
      clients.delete(id);
      if (hostWs && hostWs.readyState === WebSocket.OPEN) {
        try { hostWs.send(JSON.stringify({ t: 'peerLeave', id })); } catch (e) {}
      }
      console.log('[-] 客户端断开  id=' + id);
    }
  });

  ws.on('error', (e) => { console.error('WebSocket error:', e.message); });
});

process.on('SIGINT', () => {
  console.log('\n关闭服务器...');
  wss.close(() => process.exit(0));
});
