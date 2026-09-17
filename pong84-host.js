#!/usr/bin/env bun
/**
 * PONG-84 局域网转发服务（Bun 版，无依赖）
 * 用法: bun run pong84-host.js --port 8080
 * 或双击编译后的 pong84-host.exe
 */
const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const PORT = portIdx >= 0 ? parseInt(args[portIdx + 1], 10) : 8080;

let hostWs = null;
const clients = new Map();

console.log('==============================================');
console.log('  PONG-84 LAN Server (Bun)');
console.log('  Listening on port ' + PORT);
console.log('  房主地址示例: ws://10.126.126.1:' + PORT);
console.log('==============================================');
console.log('等待房主和客户端连接...\n');

const server = Bun.serve({
  port: PORT,
  fetch(req, server) {
    // WebSocket 升级
    const url = new URL(req.url);
    const id = url.searchParams.get('id') || '';
    const role = url.searchParams.get('role') || '';
    const name = url.searchParams.get('name') || '';
    const upgraded = server.upgrade(req, {
      data: { id, role, name, registered: false }
    });
    if (upgraded) return undefined;

    // 健康检查
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, clients: clients.size, hasHost: !!hostWs }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response('PONG-84 LAN Server', { status: 200 });
  },
  websocket: {
    open(ws) { /* 等待 register 消息 */ },
    message(ws, raw) {
      let msg;
      try { msg = JSON.parse(raw); } catch (e) { return; }

      // 注册
      if (msg.t === 'register') {
        const role = msg.role;
        const id = msg.id || Math.random().toString(36).slice(2, 10);
        ws.data.role = role;
        ws.data.id = id;
        ws.data.name = msg.name || 'Player';
        ws.data.registered = true;

        if (role === 'host') {
          if (hostWs && hostWs !== ws) { try { hostWs.close(); } catch (e) {} }
          hostWs = ws;
          ws.send(JSON.stringify({ t: 'registered', role: 'host', id }));
          console.log('[+] 房主已连接  id=' + id);
        } else {
          clients.set(id, ws);
          ws.send(JSON.stringify({ t: 'registered', role: 'client', id }));
          if (hostWs) { try { hostWs.send(JSON.stringify({ t: 'peerJoin', id, name: ws.data.name })); } catch (e) {} }
          console.log('[+] 客户端已连接  id=' + id + '  name=' + ws.data.name);
        }
        return;
      }

      // 心跳
      if (msg.t === 'ping') {
        try { ws.send(JSON.stringify({ t: 'pong', ts: msg.ts })); } catch (e) {}
        return;
      }

      // 未注册的连接不允许转发
      if (!ws.data.registered) return;

      // 房主 → 客户端
      if (ws.data.role === 'host') {
        const target = msg.to;
        if (target) {
          const c = clients.get(target);
          if (c) { try { c.send(JSON.stringify(msg)); } catch (e) {} }
        } else {
          for (const c of clients.values()) { try { c.send(JSON.stringify(msg)); } catch (e) {} }
        }
        return;
      }

      // 客户端 → 房主
      if (ws.data.role === 'client') {
        if (hostWs) {
          msg.from = ws.data.id;
          try { hostWs.send(JSON.stringify(msg)); } catch (e) {}
        }
      }
    },
    close(ws) {
      if (ws.data.role === 'host' && hostWs === ws) {
        hostWs = null;
        for (const c of clients.values()) { try { c.close(); } catch (e) {} }
        clients.clear();
        console.log('[-] 房主断开，所有客户端被清理');
      } else if (ws.data.role === 'client' && ws.data.id) {
        clients.delete(ws.data.id);
        if (hostWs) { try { hostWs.send(JSON.stringify({ t: 'peerLeave', id: ws.data.id })); } catch (e) {} }
        console.log('[-] 客户端断开  id=' + ws.data.id);
      }
    }
  }
});

process.on('SIGINT', () => { console.log('\n关闭服务器...'); server.stop(); process.exit(0); });