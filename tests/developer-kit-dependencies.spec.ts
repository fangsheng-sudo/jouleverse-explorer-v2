// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { expect, it } from 'vitest'

// Security overrides cross major versions in the test-only formatting chain.
// Exercise the APIs consumed by that chain, not just the resolved version numbers.
const require = createRequire(import.meta.url)
const beautify = require('js-beautify') as { html: (html: string) => string }
const fromBeautifier = createRequire(require.resolve('js-beautify'))
const glob = fromBeautifier('glob') as { globSync: (pattern: string, options: { cwd: string }) => string[] }
const editorconfig = fromBeautifier('editorconfig') as { parseSync: (file: string) => Record<string, unknown> }

it('测试工具的 HTML 格式化路径保持兼容', () => {
  expect(beautify.html('<div><span>read only</span></div>')).toBe('<div><span>read only</span></div>')
})

it('补丁后的 glob 和 EditorConfig 匹配接口保持兼容', () => {
  const directory = mkdtempSync(join(tmpdir(), 'jouleverse-dependency-check-'))
  try {
    const file = join(directory, 'sample.ts')
    writeFileSync(file, 'export {}\n')
    writeFileSync(join(directory, '.editorconfig'), 'root = true\n\n[*.ts]\nindent_style = space\nindent_size = 2\n')
    expect(glob.globSync('**/*.ts', { cwd: directory })).toEqual(['sample.ts'])
    expect(editorconfig.parseSync(file)).toMatchObject({ indent_style: 'space', indent_size: 2 })
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
