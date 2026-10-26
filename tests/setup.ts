import { vi } from 'vitest'

// jsdom 未实现 window.matchMedia（30.1.3 全包无此 API），而 theme.ts 在 store
// 初始化时即调用它（PR #2 引入）。任何 node 版本 × 任何 node_modules 布局都会抛
// `window.matchMedia is not a function`——此前 CI 未暴露，是因为没有 spec 真的
// 初始化 useThemeStore（现有用例均未覆盖该路径），属于测试覆盖盲区而非环境差异。
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
