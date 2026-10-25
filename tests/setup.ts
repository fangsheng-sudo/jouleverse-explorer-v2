import { vi } from 'vitest'

// jsdom 未实现 window.matchMedia，而 theme.ts 在 store 初始化时调用它（PR #2 引入）。
// 一旦测试环境真正初始化 useThemeStore 即抛 `window.matchMedia is not a function`，与 node 版本无关
// （node 22 / node 24 均复现），差异来自 node_modules 布局（本地 pnpm 布局 vs CI npm ci 布局）。
// 这里 mock 出最小可用实现，使 useThemeStore 在测试环境可正常初始化。
// theme.ts 只用到 matches / addEventListener / removeEventListener 三个成员。
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}
