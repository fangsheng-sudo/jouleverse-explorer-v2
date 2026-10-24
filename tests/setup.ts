import { vi } from 'vitest'

// jsdom 无 window.matchMedia，而 theme.ts 在 store 初始化时调用它（PR #2 引入）。
// 本地 node 24 + jsdom 30.1.3 会抛 `window.matchMedia is not a function`，CI node 22 未触发。
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
