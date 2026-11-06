import type { Session } from '@/lib/types';
import { useSessionStore } from '@/stores/sessionStore';

/**
 * 回前台自动重连。
 *
 * 为什么需要：手机切后台后，连接可能被系统掐断——Doze/App Standby 限流、
 * 厂商省电策略冻结网络、Wi-Fi 与蜂窝之间切换、或者服务器侧 ClientAlive 超时。
 * 前台服务（`MarcelForegroundService`）能大幅降低进程被回收的概率，但它
 * **管不到网络**：只要链路真的断了，SSH 会话就没了。
 *
 * 用户回到前台时最需要的是"刚才那台机器还在"，而不是一条"连接已关闭"横幅。
 * 所以这里在 `mobile:foreground` 时把**非用户主动断开**的会话接回去。
 */

/** 用户自己点了断开：不该被自动接回来。 */
const MANUAL_REASON = '已主动断开连接';

/** 同一条会话两次自动重连之间的最短间隔，避免回到前台就疯狂重试。 */
export const AUTO_RECONNECT_COOLDOWN_MS = 5 * 60_000;

/**
 * 挑出这次该自动重连的会话 id。
 *
 * 规则：
 * - 只认 `disconnected`（连上过又断了）。`error` 是连接失败，重试会把用户
 *   辛苦排掉的错误再弹一遍，交给他手动点。
 * - 必须带 `configId`：临时会话没有可复用的配置，`ssh_reconnect` 也接不回来。
 * - 排除用户主动断开的（横幅原因里写着 `已主动断开连接`）。
 * - 同一会话在冷却窗口内只尝试一次。
 * - 活跃会话排在最前面：用户回来第一眼看的就是它。
 */
export function pickAutoReconnectCandidates(
  sessions: Record<string, Session>,
  activeSessionId: string | null,
  lastAttempt: ReadonlyMap<string, number>,
  now: number,
): string[] {
  const eligible = Object.values(sessions).filter((session) => {
    if (session.status !== 'disconnected') return false;
    if (!session.configId) return false;
    if (session.errorMessage?.includes(MANUAL_REASON)) return false;
    const previous = lastAttempt.get(session.id);
    if (previous !== undefined && now - previous < AUTO_RECONNECT_COOLDOWN_MS) {
      return false;
    }
    return true;
  });

  const ids = eligible.map((session) => session.id);
  if (!activeSessionId || !ids.includes(activeSessionId)) return ids;
  return [activeSessionId, ...ids.filter((id) => id !== activeSessionId)];
}

/** 已经尝试过的时间戳（会话 id → 毫秒）。跨多次回前台共享。 */
const lastAttempt = new Map<string, number>();

/**
 * 按上面的规则重连一次。
 *
 * 失败**不弹任何提示**：断线横幅已经写清了原因，重连再失败时把它盖成
 * "重连失败"只会更吵。HostKeyMismatch 这类需要用户决策的错误更该留给
 * 用户手动触发的那条路径去弹窗。
 */
export async function runMobileAutoReconnect(
  now: number = Date.now(),
): Promise<string[]> {
  const { sessions, activeSessionId, reconnect } = useSessionStore.getState();
  const candidates = pickAutoReconnectCandidates(
    sessions,
    activeSessionId,
    lastAttempt,
    now,
  );

  const reconnected: string[] = [];
  for (const sessionId of candidates) {
    lastAttempt.set(sessionId, now);
    try {
      // eslint-disable-next-line no-await-in-loop -- 串行重连：同时开多个 SSH 握手只会互相拖慢
      await reconnect(sessionId);
      reconnected.push(sessionId);
    } catch {
      /* 失败即放弃，见上面的注释 */
    }
  }
  return reconnected;
}

/**
 * 挂上"回前台自动重连"。返回卸载函数。
 *
 * 依赖 `mobile:foreground`（`src/mobile/App.tsx` 在 visibilitychange 时派发），
 * 桌面端不会触发，所以无需平台判断。
 */
export function installMobileAutoReconnect(): () => void {
  let inFlight = false;
  const handler = () => {
    if (inFlight) return;
    inFlight = true;
    void runMobileAutoReconnect().finally(() => {
      inFlight = false;
    });
  };
  window.addEventListener('mobile:foreground', handler);
  return () => window.removeEventListener('mobile:foreground', handler);
}

/** 测试用：清空冷却记录。 */
export function resetAutoReconnectState(): void {
  lastAttempt.clear();
}
