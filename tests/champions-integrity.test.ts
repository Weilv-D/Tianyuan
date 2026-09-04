import { describe, expect, it } from 'vitest';
import { CHAMPIONS } from '../src/data/champions';

/**
 * 棋子表身份守卫。剪影是玩家的首要辨识通道（ART_BIBLE：剪影差异 > 配色差异），
 * 同剪影的棋子必须靠色相错开 —— 否则商店、侦查与战斗里就是两张一样的脸。
 */
describe('棋子表身份守卫', () => {
  it('(剪影, 色相) 全表唯一', () => {
    const seen = new Map<string, string>();
    for (const c of CHAMPIONS) {
      const key = `${c.silhouette}:${c.hue}`;
      const prev = seen.get(key);
      expect(prev, `${c.name}(${c.id}) 与 ${prev ?? '?'} 同剪影同色相，侦查/商店无法辨认`).toBeUndefined();
      seen.set(key, c.id);
    }
  });

  it('棋子 id 全表唯一且与中文名一一对应', () => {
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const c of CHAMPIONS) {
      expect(ids.has(c.id), `重复棋子 id：${c.id}`).toBe(false);
      expect(names.has(c.name), `重名棋子：${c.name}`).toBe(false);
      ids.add(c.id);
      names.add(c.name);
    }
    expect(CHAMPIONS.length).toBe(64);
  });
});
