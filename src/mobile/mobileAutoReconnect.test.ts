import { describe, expect, it, vi } from 'vitest';
import type { Session } from '@/lib/types';

// sessionStore 会顺着 terminalInstanceManager 把 xterm 拉进 jsdom，
// 而这里只测纯函数，把它换成空壳即可。
vi.mock('@/stores/sessionStore', () => ({
  useSessionStore: {
    getState: () => ({ sessions: {}, activeSessionId: null, reconnect: async () => {} }),
  },
}));
import {
  AUTO_RECONNECT_COOLDOWN_MS,
  pickAutoReconnectCandidates,
} from './mobileAutoReconnect';

function session(over: Partial<Session> & { id: string }): Session {
  return {
    connectionId: 'conn-1',
    status: 'disconnected',
    createdAt: '2026-01-01T00:00:00Z',
    configId: 'conn-1',
    ...over,
  } as Session;
}

const none = new Map<string, number>();

describe('pickAutoReconnectCandidates', () => {
  it('只挑 disconnected 且带 configId 的会话', () => {
    const sessions = {
      a: session({ id: 'a' }),
      b: session({ id: 'b', status: 'connected' }),
      c: session({ id: 'c', status: 'error' }),
      d: session({ id: 'd', configId: undefined }),
    };
    expect(pickAutoReconnectCandidates(sessions, null, none, 1_000)).toEqual(['a']);
  });

  it('用户主动断开的不接回来', () => {
    const sessions = {
      a: session({ id: 'a', errorMessage: '已主动断开连接' }),
    };
    expect(pickAutoReconnectCandidates(sessions, null, none, 1_000)).toEqual([]);
  });

  it('活跃会话排在最前面', () => {
    const sessions = {
      a: session({ id: 'a' }),
      b: session({ id: 'b' }),
    };
    expect(pickAutoReconnectCandidates(sessions, 'b', none, 1_000)).toEqual([
      'b',
      'a',
    ]);
  });

  it('冷却窗口内不重复尝试，过期后恢复', () => {
    const attempts = new Map([['a', 1_000]]);
    const sessions = { a: session({ id: 'a' }) };
    expect(
      pickAutoReconnectCandidates(sessions, null, attempts, 1_000 + 1_000),
    ).toEqual([]);
    expect(
      pickAutoReconnectCandidates(
        sessions,
        null,
        attempts,
        1_000 + AUTO_RECONNECT_COOLDOWN_MS,
      ),
    ).toEqual(['a']);
  });
});
