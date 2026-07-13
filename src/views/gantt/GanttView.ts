import { ButtonComponent } from 'obsidian'
import type PMPlugin from '../../main'
import type { Project, Task, GanttGranularity } from '../../types'
import { type FlatTask, flattenTasks } from '../../store/TaskTreeOps'
import { applyTaskFilterPromote } from '../../store/TaskFilter'
import { renderAddButton } from '../../ui/composites/addButton'
import { SegmentedControl } from '../../ui/primitives/SegmentedControl'
import type { SubView } from '../SubView'
import type { TimelineCfg } from './TimelineConfig'
import { buildTimelineConfig, dateToX, xToDate, HEADER_HEIGHT, ROW_HEIGHT, LABEL_WIDTH } from './TimelineConfig'
import { makeDragState } from './GanttDragHandler'
import type { DragState } from './GanttDragHandler'
import { makeLinkState, cancelLink } from './GanttLinkHandler'
import type { LinkState } from './GanttLinkHandler'
import type { GanttHost } from './GanttHost'
import {
  renderTimelineHeader,
  renderGridLines,
  renderTodayLine,
  renderTaskBar,
  renderDependencyArrows,
  renderMilestoneLabels,
  renderProjectSepBar
} from './GanttRenderer'
import { svgEl } from '../../utils'
import { Temporal, today } from '../../dates'
import type { RendererContext } from './GanttRenderer'
import { renderTaskLabel, renderProjectSeparator } from './TaskLabelRenderer'

export class GanttView implements SubView {
  private granularity: GanttGranularity
  private scrollEl!: HTMLElement
  private svgEl!: SVGSVGElement
  private headerSvgEl!: SVGSVGElement
  private flatTasks: FlatTask[] = []
  private cfg!: TimelineCfg
  private drag: DragState = makeDragState()
  private link: LinkState = makeLinkState()
  private labelWidth: number = LABEL_WIDTH

  getLabelWidth(): number {
    return this.labelWidth
  }
  setLabelWidth(w: number): void {
    this.labelWidth = w
  }
  private cleanupFns: (() => void)[] = []
  private pendingScroll: { top: number; anchorDate: Temporal.PlainDate } | null = null

  constructor(
    private container: HTMLElement,
    private host: GanttHost,
    private plugin: PMPlugin
  ) {
    this.granularity = plugin.settings.ganttGranularity
  }

  destroy(): void {
    for (const fn of this.cleanupFns) fn()
    this.cleanupFns = []
  }

  getScrollPosition(): { top: number; anchorDate: Temporal.PlainDate } {
    const top = this.scrollEl?.scrollTop ?? 0
    const anchorDate = this.scrollEl ? xToDate(this.cfg, this.scrollEl.scrollLeft) : today()
    return { top, anchorDate }
  }

  setPendingScroll(pos: { top: number; anchorDate: Temporal.PlainDate }): void {
    this.pendingScroll = pos
  }

  refresh(): void {
    this.pendingScroll = this.getScrollPosition()
    this.render()
  }

  render(): void {
    this.cleanupFns.forEach((fn) => fn())
    this.cleanupFns = []
    cancelLink(this.link)
    this.container.empty()
    this.container.addClass('pm-gantt-view')

    const activeTasks = this.getVisibleTasks()
    this.flatTasks = flattenTasks(activeTasks).filter((f) => f.visible || f.depth === 0)
    this.cfg = buildTimelineConfig(activeTasks, this.granularity)

    this.renderGranularityControls()
    this.renderGantt()
  }

  private renderGranularityControls(): void {
    const bar = this.container.createDiv('pm-gantt-controls')
    const levels: GanttGranularity[] = ['day', 'week', 'month', 'quarter']
    const labels: Record<GanttGranularity, string> = { day: 'Day', week: 'Week', month: 'Month', quarter: 'Quarter' }

    new SegmentedControl<GanttGranularity>(bar, {
      options: levels.map((level) => ({ id: level, label: labels[level] })),
      active: this.granularity,
      onChange: (level) => {
        this.granularity = level
        this.plugin.settings.ganttGranularity = level
        void this.plugin.saveSettings()
        this.render()
      }
    })

    bar.createSpan({ cls: 'pm-gantt-sep' })
    new ButtonComponent(bar).setButtonText('Today').onClick(() => this.scrollToToday())

    new ButtonComponent(bar).setButtonText('Expand all').onClick(() => void this.setAllCollapsed(false))
    new ButtonComponent(bar).setButtonText('Collapse all').onClick(() => void this.setAllCollapsed(true))
  }

  private renderGantt(): void {
    const wrapper = this.container.createDiv('pm-gantt-wrapper')

    // Left panel: task labels
    const leftPanel = wrapper.createDiv('pm-gantt-left')
    leftPanel.style.width = `${this.labelWidth}px`
    leftPanel.style.minWidth = `${this.labelWidth}px`
    const leftHeader = leftPanel.createDiv('pm-gantt-left-header')
    leftHeader.style.height = `${HEADER_HEIGHT}px`
    leftHeader.createSpan({ text: 'Task', cls: 'pm-gantt-left-header-label' })
    const leftBody = leftPanel.createDiv('pm-gantt-left-body')

    // Resize handle
    const resizeHandle = wrapper.createDiv('pm-gantt-resize-handle')
    let resizing = false
    let startX = 0
    let startWidth = 0
    resizeHandle.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault()
      resizing = true
      startX = e.clientX
      startWidth = this.labelWidth
      activeDocument.body.addClass('pm-resize-active')
    })
    const onMouseMove = (e: MouseEvent) => {
      if (!resizing) return
      const newWidth = Math.max(150, Math.min(600, startWidth + (e.clientX - startX)))
      this.labelWidth = newWidth
      leftPanel.style.width = `${newWidth}px`
      leftPanel.style.minWidth = `${newWidth}px`
    }
    const onMouseUp = () => {
      if (!resizing) return
      resizing = false
      activeDocument.body.removeClass('pm-resize-active')
    }
    activeDocument.addEventListener('mousemove', onMouseMove)
    activeDocument.addEventListener('mouseup', onMouseUp)
    this.cleanupFns.push(() => {
      activeDocument.removeEventListener('mousemove', onMouseMove)
      activeDocument.removeEventListener('mouseup', onMouseUp)
    })

    // Right panel: timeline
    const rightPanel = wrapper.createDiv('pm-gantt-right')
    this.scrollEl = rightPanel

    // Timeline header lives in its own SVG inside a sticky wrapper. It shares the
    // right panel's horizontal scroll (so it tracks the body left/right) but pins to
    // the top on vertical scroll, keeping the time period visible while rows scroll.
    const headerSticky = rightPanel.createDiv('pm-gantt-header-sticky')
    headerSticky.style.width = `${this.cfg.totalWidth}px`
    headerSticky.style.height = `${HEADER_HEIGHT}px`
    this.headerSvgEl = svgEl('svg', {
      width: this.cfg.totalWidth,
      height: HEADER_HEIGHT,
      class: 'pm-gantt-header-svg'
    })
    headerSticky.appendChild(this.headerSvgEl)

    const svgContainer = rightPanel.createDiv('pm-gantt-svg-container')
    svgContainer.style.width = `${this.cfg.totalWidth}px`
    // Tuck the body's top band (still drawn at y=HEADER_HEIGHT) under the sticky header.
    svgContainer.style.marginTop = `-${HEADER_HEIGHT}px`

    const rootTasks = this.getVisibleTasks()
    const projectSet = new Set<string>()
    for (const t of rootTasks) projectSet.add(this.host.projectForTask(t.id).id)
    const multiProject = projectSet.size > 1
    const sepCount = multiProject ? projectSet.size : 0

    const totalRows = this.flatTasks.filter((f) => f.visible || f.depth === 0).length
    const adjustedRows = totalRows + sepCount
    const svgHeight = HEADER_HEIGHT + (adjustedRows + 1) * ROW_HEIGHT // +1 for add-task row

    this.svgEl = svgEl('svg', {
      width: this.cfg.totalWidth,
      height: svgHeight,
      class: 'pm-gantt-svg'
    })
    svgContainer.appendChild(this.svgEl)

    // Escape to cancel linking mode; Ctrl/Cmd+Z to undo, Ctrl/Cmd+Shift+Z
    // or Ctrl/Cmd+Y to redo the last drag. Only fire when the gantt view's
    // leaf is the active workspace leaf, so we don't hijack undo/redo while
    // the user is editing an unrelated note.
    const isGanttActive = (): boolean => {
      const leafEl = this.container.closest('.workspace-leaf')
      return leafEl?.classList.contains('mod-active') ?? false
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isGanttActive()) return
      if (e.key === 'Escape' && this.link.active) {
        cancelLink(this.link)
      }
      if (this.drag.isDragging) return
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        void this.plugin.undoLastAction()
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault()
        void this.plugin.redoLastAction()
      }
    }
    activeDocument.addEventListener('keydown', onKeyDown)
    this.cleanupFns.push(() => activeDocument.removeEventListener('keydown', onKeyDown))

    const rowMap = new Map<string, number>()
    const ctx = this.makeRendererContext(rowMap, adjustedRows)
    renderTimelineHeader(ctx)
    renderGridLines(ctx, adjustedRows)
    renderTodayLine(ctx, svgHeight)
    this.renderTaskRows(leftBody, ctx, multiProject)
    renderDependencyArrows(ctx)
    renderMilestoneLabels(ctx)

    // Forward wheel events from left panel to the scroll container
    // (left panel has overflow:hidden, so wheel events are swallowed otherwise)
    const onLeftWheel = (e: WheelEvent) => {
      rightPanel.scrollTop += e.deltaY
      rightPanel.scrollLeft += e.deltaX
      e.preventDefault()
    }
    leftPanel.addEventListener('wheel', onLeftWheel, { passive: false })
    this.cleanupFns.push(() => leftPanel.removeEventListener('wheel', onLeftWheel))

    // Add task button
    const addRow = leftBody.createDiv('pm-gantt-label-row pm-gantt-add-row')
    addRow.style.height = `${ROW_HEIGHT}px`
    renderAddButton(addRow, 'Add task', () => {
      this.host.addTask()
    })

    // Spacer compensates for horizontal scrollbar in the right panel.
    // The scrollbar reduces the right panel's viewport height, letting it
    // scroll further than the left body. Without this, rows desync at the bottom.
    const leftSpacer = leftBody.createDiv()
    leftSpacer.addClass('pm-no-shrink')
    const syncSpacer = () => {
      const hScrollbarH = rightPanel.offsetHeight - rightPanel.clientHeight
      leftSpacer.style.height = `${hScrollbarH}px`
    }

    // Sync vertical scroll: right → left
    rightPanel.addEventListener('scroll', () => {
      syncSpacer()
      leftBody.scrollTop = rightPanel.scrollTop
    })

    window.requestAnimationFrame(() => {
      syncSpacer()
      if (this.pendingScroll) {
        this.scrollEl.scrollTop = this.pendingScroll.top
        this.scrollEl.scrollLeft = Math.max(0, dateToX(this.cfg, this.pendingScroll.anchorDate))
        this.pendingScroll = null
      } else {
        this.scrollToToday()
      }
    })
  }

  private renderTaskRows(leftBody: HTMLElement, ctx: RendererContext, multiProject: boolean): void {
    const sepGroup = svgEl('g', { class: 'pm-gantt-project-seps' })
    const barsGroup = svgEl('g', { class: 'pm-gantt-bars' })
    this.svgEl.appendChild(sepGroup)
    this.svgEl.appendChild(barsGroup)

    const labelCtx = {
      plugin: this.plugin,
      projectForTask: (id: string) => this.host.projectForTask(id),
      statusesForTask: (id: string) => this.host.statusesForTask(id),
      onRefresh: this.host.onRefresh
    }

    let rowIndex = 0
    const projectBlocks: Array<{ project: Project; startRow: number; endRow: number }> = []

    const renderFlatList = (tasks: Task[], depth: number) => {
      for (const task of tasks) {
        if (depth === 0) {
          const proj = this.host.projectForTask(task.id)
          const openBlock = projectBlocks[projectBlocks.length - 1]
          if (!openBlock || openBlock.project.id !== proj.id) {
            if (openBlock) openBlock.endRow = rowIndex - 1
            if (openBlock || multiProject) {
              renderProjectSeparator(leftBody, proj)
              renderProjectSepBar(sepGroup, proj, rowIndex, ctx.cfg.totalWidth)
              rowIndex++
            }
            projectBlocks.push({ project: proj, startRow: rowIndex, endRow: rowIndex })
          }
        }

        ctx.rowMap.set(task.id, rowIndex)
        renderTaskLabel(leftBody, task, depth, rowIndex, labelCtx)
        renderTaskBar(barsGroup, task, rowIndex, depth, ctx)
        rowIndex++
        if (!task.collapsed && task.subtasks.length) {
          renderFlatList(task.subtasks, depth + 1)
        }
      }
    }

    renderFlatList(this.getVisibleTasks(), 0)

    const lastBlock = projectBlocks[projectBlocks.length - 1]
    if (lastBlock) lastBlock.endRow = rowIndex - 1

    if (projectBlocks.length > 1) {
      for (const block of projectBlocks) {
        const y = HEADER_HEIGHT + block.startRow * ROW_HEIGHT
        const h = (block.endRow - block.startRow + 1) * ROW_HEIGHT
        sepGroup.appendChild(
          svgEl('rect', {
            x: 0,
            y,
            width: ctx.cfg.totalWidth,
            height: h,
            fill: block.project.color,
            opacity: 0.03,
            class: 'pm-gantt-project-tint',
            'pointer-events': 'none'
          })
        )
      }
    }
  }

  private makeRendererContext(rowMap: Map<string, number>, totalRows: number): RendererContext {
    return {
      svgEl: this.svgEl,
      headerSvgEl: this.headerSvgEl,
      cfg: this.cfg,
      plugin: this.plugin,
      projectForTask: (id: string) => this.host.projectForTask(id),
      statusesForTask: (id: string) => this.host.statusesForTask(id),
      flatTasks: this.flatTasks,
      rowMap,
      totalRows,
      drag: this.drag,
      link: this.link,
      onRefresh: this.host.onRefresh,
      cleanupFns: this.cleanupFns
    }
  }

  private getVisibleTasks(): Task[] {
    return applyTaskFilterPromote(this.host.tasks, this.host.filter, this.host.filterStatuses)
  }

  private scrollToToday(): void {
    if (!this.scrollEl) return
    const x = dateToX(this.cfg, today())
    const center = x - this.scrollEl.clientWidth / 2
    this.scrollEl.scrollLeft = Math.max(0, center)
  }

  private async setAllCollapsed(collapsed: boolean): Promise<void> {
    for (const { task } of flattenTasks(this.host.tasks)) {
      if (task.subtasks.length > 0) task.collapsed = collapsed
    }
    await this.host.persistCollapsed()
    this.render()
  }
}
