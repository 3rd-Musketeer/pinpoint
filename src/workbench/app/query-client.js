// Server state 的唯一住处（goal-20260810-workbench-react-rebuild P2）。
// manifest / board / screen / include / frame-note 的拉取与缓存都归这里；
// SSE（preview:update HMR 通道）是唯一失效源 —— 桥接 invalidateQueries，
// 不许再有手工 cacheBust / generation 计数机械。
// 命令式模块直接 import queryClient 调 fetchQuery/invalidateQueries/setQueryData；
// React 组件本阶段仍读 store（fetch 成功后 wbSet 镜像），不挂 Provider。
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // staleTime Infinity = 缓存不失效于时间，只失效于 SSE 桥的 invalidateQueries
      // （staleTime 0 会让 fetchQuery 每次都重拉，Query 退化成 fetch 包装，
      // 「SSE 是唯一失效源」就失去意义；页面切换回填也由缓存承担）。
      staleTime: Infinity,
      gcTime: 10 * 60 * 1000,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});
