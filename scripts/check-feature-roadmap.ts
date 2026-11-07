import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface RoadmapResult {
  errors: string[]
  viewCount: number
  moduleCount: number
}

/** Validate only section one. A mention elsewhere must not mask a missing row. */
export function checkRoadmap(markdown: string, viewFiles: readonly string[]): RoadmapResult {
  const errors: string[] = []
  const sections = markdown.split(/^## 一、当前 v2 实现状态总览\s*$/m)
  const section = sections[1]?.split(/^## /m)[0] ?? ''
  if (sections.length !== 2) errors.push('状态总览章节缺失或重复')
  const marker = section.indexOf('> **本表覆盖度自检')
  if (marker < 0) errors.push('覆盖度自检标记缺失')
  else if (section.indexOf('> **本表覆盖度自检', marker + 1) >= 0) errors.push('覆盖度自检标记重复')
  const beforeMarker = (marker < 0 ? '' : section.slice(0, marker)).replace(/\r\n/g, '\n')
  const tables = beforeMarker.split(/^\| # \| 功能模块 \| 状态 \| 实现位置 \| 备注 \|[ \t]*$/m)
  if (tables.length !== 2) errors.push('状态总览表头缺失或重复')
  const lines = (tables[1] ?? '').replace(/^\n/, '').split('\n')
  const separatorLine = (lines[0] ?? '').trim()
  const separators = separatorLine.split('|').slice(1, -1)
  if (!separatorLine.startsWith('|') || !separatorLine.endsWith('|') || separators.length !== 5 || separators.some(cell => !/^:?-{3,}:?$/.test(cell.trim()))) errors.push('表格分隔行无效')
  const rows: { id: number; content: string }[] = []
  let ended = false
  for (const line of lines.slice(1)) {
    if (!line.startsWith('|')) { ended = true; continue }
    if (ended) errors.push('表格被空行或其他文字断开')
    const match = /^\|\s*(\d+)\s*\|(.+)\|\s*$/.exec(line)
    if (!match) { errors.push('状态总览存在无效数据行'); continue }
    rows.push({ id: Number(match[1]), content: match[2]! })
  }
  if (!rows.length) errors.push('状态总览没有模块')
  if (rows.some((row, i) => row.id !== i + 1)) errors.push('模块编号必须从 1 连续且唯一')
  const listedFiles = new Set(rows.flatMap(row =>
    [...row.content.matchAll(/`([A-Za-z0-9_./-]+\.vue)`/g)].map(match => match[1]!),
  ))
  for (const file of viewFiles) {
    if (!listedFiles.has(file) && !listedFiles.has(`src/views/${file}`)) errors.push(`MISSING ${file}`)
  }
  const summary = marker < 0 ? '' : section.slice(marker).split(/\r?\n/, 1)[0]!
  const views = /共 \*\*(\d+)\*\* 个视图/.exec(summary)
  const modules = /本表 #1–#(\d+)/.exec(summary)
  if (!views || Number(views[1]) !== viewFiles.length) errors.push('自检视图数与 src/views 不一致')
  if (!modules || Number(modules[1]) !== rows.length) errors.push('自检末尾编号与实际模块数不一致')
  if (!/[（(]0 漏项[）)]/.test(summary)) errors.push('自检声明格式缺少 0 漏项')
  return { errors, viewCount: viewFiles.length, moduleCount: rows.length }
}

export function checkRepository(root: string): RoadmapResult {
  const views = readdirSync(resolve(root, 'src/views'), { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.vue')).map(entry => entry.name)
  if (!views.length) throw new Error('src/views 没有视图，拒绝空目录假绿')
  return checkRoadmap(readFileSync(resolve(root, 'docs/feature-roadmap.md'), 'utf8'), views)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const result = checkRepository(process.argv[2] ?? process.cwd())
    if (result.errors.length) {
      console.error(result.errors.join('\n'))
      process.exitCode = 1
    } else {
      console.log(`路线图检查通过：${result.viewCount} 个视图，${result.moduleCount} 个模块，0 漏项`)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
