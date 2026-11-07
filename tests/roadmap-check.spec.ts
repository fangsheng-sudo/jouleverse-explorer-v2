// @vitest-environment node
import { expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { checkRoadmap, checkRepository } from '../scripts/check-feature-roadmap'

const header = '## 一、当前 v2 实现状态总览\n\n| # | 功能模块 | 状态 | 实现位置 | 备注 |\n|---|---------|------|---------|------|'
const row = '| 1 | 首页 | 完成 | `Home.vue` | |'
const summary = '> **本表覆盖度自检**：共 **1** 个视图，本表 #1–#1 已全部覆盖（0 漏项）。'
const valid = `${header}\n${row}\n\n${summary}\n\n## 二、待开发\n`
it('检查实际仓库而非复制一份页面清单', () => {
  expect(checkRepository(process.cwd()).errors).toEqual([])
})
it('有效表格通过，路径形式的视图可识别', () => {
  expect(checkRoadmap(valid.replace('`Home.vue`', '`src/views/Home.vue`'), ['Home.vue']).errors).toEqual([])
})
it.each([
  ['删登记行', valid.replace(row, ''), ['Home.vue']],
  ['备注章节不能掩盖漏项', valid.replace('`Home.vue`', '`Other.vue`') + '`Home.vue`', ['Home.vue']],
  ['相似文件名不算覆盖', valid.replace('`Home.vue`', '`HomeXvue`'), ['Home.vue']],
  ['无反引号不算精确登记', valid.replace('`Home.vue`', 'Home.vue'), ['Home.vue']],
  ['重复编号', valid.replace(row, `${row}\n${row}`), ['Home.vue']],
  ['编号跳号', valid.replace('| 1 |', '| 2 |'), ['Home.vue']],
  ['过期视图数', valid.replace('**1** 个视图', '**16** 个视图'), ['Home.vue']],
  ['过期模块数', valid.replace('#1–#1', '#1–#29'), ['Home.vue']],
  ['标记缺失', valid.replace('本表覆盖度自检', '自检'), ['Home.vue']],
  ['标记重复', valid.replace(summary, `${summary}\n${summary}`), ['Home.vue']],
  ['表头缺失', valid.replace('| # |', '| 序号 |'), ['Home.vue']],
  ['章节缺失', valid.replace('## 一、当前 v2 实现状态总览', '## 其他'), ['Home.vue']],
  ['重复章节', valid + valid, ['Home.vue']],
  ['断裂表格', valid.replace(row, `\n${row}`), ['Home.vue']],
  ['新增页面未登记', valid, ['Home.vue', 'New.vue']],
] as const)('%s 应失败', (_, doc, files) => {
  expect(checkRoadmap(doc, files).errors.length).toBeGreaterThan(0)
})
it.each([
  ['表头后空行', valid.replace('|---|', '\n|---|')],
  ['十个漏项', valid.replace('0 漏项', '10 漏项')],
  ['非零小数漏项', valid.replace('0 漏项', '1.0 漏项')],
  ['错误目录同名', valid.replace('`Home.vue`', '`src/components/Home.vue`')],
  ['路径穿越', valid.replace('`Home.vue`', '`src/views/../components/Home.vue`')],
  ['分隔行缺左竖线', valid.replace('|---|---------|------|---------|------|', '---|---------|------|---------|------|')],
  ['分隔行缺右竖线', valid.replace('|---|---------|------|---------|------|', '|---|---------|------|---------|------')],
  ['分隔行带多余文字', valid.replace('|---|---------|------|---------|------|', 'x|---|---------|------|---------|------|x')],
  ['分隔列不足', valid.replace('|---|---------|------|---------|------|', '|---|---|')],
  ['分隔列过多', valid.replace('|---|---------|------|---------|------|', '|---|---|---|---|---|---|')],
])('%s 不能假绿', (_, doc) => {
  expect(checkRoadmap(doc, ['Home.vue']).errors.length).toBeGreaterThan(0)
})
it.each([
  ['合法对齐', valid.replace('|---|---------|------|---------|------|', '|:---|---:|:---:|---|---|')],
  ['Windows换行', valid.replace(/\n/g, '\r\n')],
])('%s 应通过', (_, doc) => {
  expect(checkRoadmap(doc, ['Home.vue']).errors).toEqual([])
})
it('真实命令对缺文件、空视图和遗漏返回非零，对正常仓库返回零', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'roadmap-cli-'))
  const command = (root: string) => spawnSync(process.execPath, ['scripts/check-feature-roadmap.ts', root], { encoding: 'utf8' })
  try {
    expect(command(dir).status).toBe(1)
    mkdirSync(resolve(dir, 'src/views'), { recursive: true })
    mkdirSync(resolve(dir, 'docs'))
    writeFileSync(resolve(dir, 'docs/feature-roadmap.md'), valid)
    expect(command(dir).status).toBe(1)
    writeFileSync(resolve(dir, 'src/views/Home.vue'), '<template />')
    expect(command(dir).status).toBe(0)
    writeFileSync(resolve(dir, 'src/views/New.vue'), '<template />')
    const bad = command(dir)
    expect(bad.status).toBe(1)
    expect(bad.stderr).toContain('MISSING New.vue')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
