import { Notice } from 'obsidian'
import type { Task, StatusConfig, PriorityConfig, TaskPriority } from './types'
import { today, parsePlainDate, Temporal } from './dates'

export function stringToColor(s: string): string {
  let hash = 0
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash)
  return `hsl(${Math.abs(hash) % 360}, 55%, 45%)`
}

export function formatDateShort(iso: string): string {
  const d = parsePlainDate(iso)
  return d ? d.toLocaleString(undefined, { month: 'short', day: 'numeric' }) : ''
}

export function formatDateLong(iso: string): string {
  const d = parsePlainDate(iso)
  return d ? d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: '2-digit' }) : ''
}

export function isTerminalStatus(status: string, statuses: StatusConfig[]): boolean {
  const cfg = statuses.find((s) => s.id === status)
  return cfg ? cfg.complete : false
}

export function getDefaultStatusId(statuses: StatusConfig[]): string {
  return statuses.length > 0 ? statuses[0].id : 'todo'
}

export function getDefaultPriorityId(priorities: PriorityConfig[]): string {
  if (priorities.some((p) => p.id === 'medium')) return 'medium'
  return priorities.length > 0 ? priorities[Math.floor(priorities.length / 2)].id : 'medium'
}

export function getCompleteStatusId(statuses: StatusConfig[]): string {
  const found = statuses.find((s) => s.complete)
  return found ? found.id : 'done'
}

export function statusSortOrder(status: string, statuses: StatusConfig[]): number {
  const idx = statuses.findIndex((s) => s.id === status)
  return idx >= 0 ? idx : 999
}

export function isTaskOverdue(task: Task, statuses: StatusConfig[]): boolean {
  const due = parsePlainDate(task.due)
  if (!due) return false
  return Temporal.PlainDate.compare(due, today()) < 0 && !isTerminalStatus(task.status, statuses)
}

export function stringifyCustomValue(val: unknown): string {
  if (val === undefined || val === null) return ''
  if (typeof val === 'string') return val
  if (typeof val === 'number' || typeof val === 'boolean') return String(val)
  if (Array.isArray(val)) return val.map((v) => String(v)).join(', ')
  return ''
}

export function truncateTitle(title: string, maxLen = 20): string {
  if (title.length <= maxLen) return title
  return title.slice(0, maxLen - 1) + '…'
}

export function sanitizeFileName(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, '-')
}

export function getStatusConfig(statuses: StatusConfig[], id: string): StatusConfig | undefined {
  return statuses.find((s) => s.id === id)
}

export function getPriorityConfig(priorities: PriorityConfig[], id: TaskPriority): PriorityConfig | undefined {
  return priorities.find((p) => p.id === id)
}

const iconNames = new Set([
  'chevrons-up', 'chevron-up', 'equal', 'chevron-down',
  'plus', 'x', 'pencil', 'copy', 'archive', 'archive-restore', 'trash',
  'layout-dashboard', 'git-fork', 'table', 'list-plus', 'settings', 'flame'
])

export function isIconName(icon: string): boolean {
  return iconNames.has(icon)
}

export function formatBadgeText(icon: string | undefined, label: string): string {
  if (icon && isIconName(icon)) return label
  return [icon, label].filter(Boolean).join(' ')
}

export function safeAsync<A extends unknown[]>(fn: (...args: A) => Promise<void>): (...args: A) => void {
  return (...args: A) => {
    void (async () => {
      try {
        await fn(...args)
      } catch (err: unknown) {
        console.error('[PM]', err)
        new Notice(err instanceof Error ? err.message : 'Something went wrong. Check the console for details.')
      }
    })()
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg'

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string | number>
): SVGElementTagNameMap[K] {
  const el = activeDocument.createElementNS(SVG_NS, tag)
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      el.setAttribute(k, String(v))
    }
  }
  return el
}
