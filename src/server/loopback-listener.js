import net from 'node:net';
import { once } from 'node:events';

/**
 * 保留 Vite 的 IPv4 回环入口，再给同一个 HTTP / HMR server 一条 ::1 入口。
 * portless 在 IPv4 建连超过 250ms 后会试 ::1；IPv4 accept 队列拥塞时，
 * 独立的 IPv6 队列仍能接住连接。不能监听 ::，那会把服务暴露到局域网。
 */
export default function loopbackListener() {
  return {
    name: 'pinpoint-loopback-listener',
    configureServer(server) {
      const httpServer = server.httpServer;
      if (!httpServer) return;
      const ipv6 = net.createServer((socket) => httpServer.emit('connection', socket));
      const listen = server.listen.bind(server);
      const close = server.close.bind(server);
      server.close = async () => {
        // Vite 负责销毁交给它的 HTTP / websocket 连接，两边同时关，避免互相等连接退出。
        await Promise.all([
          new Promise((resolve) => ipv6.close(resolve)),
          close(),
        ]);
      };
      server.listen = async (...args) => {
        await listen(...args);
        if (ipv6.listening) return server;
        try {
          const listening = once(ipv6, 'listening');
          ipv6.listen({ host: '::1', port: httpServer.address().port, ipv6Only: true });
          await listening;
        } catch (error) {
          await server.close();
          throw error;
        }
        return server;
      };
    },
  };
}
