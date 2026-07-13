import { ItemView, WorkspaceLeaf, TFile } from 'obsidian'
import type PMPlugin from '../main'
import type { Project } from '../types'
import { makeDefaultFilter } from '../types'
import { flattenTasks } from '../store/TaskTreeOps'
import { openProjectModal, openProjectPicker, openTaskModal } from '../ui/ModalFactory'
import { EmptyState } from '../ui/primitives/EmptyState'
import { renderProjectListToolbar, renderProjectListContent } from './ProjectListRenderer'
import type { ProjectListContext, DashboardMode } from './ProjectListRenderer'
import { GanttView } from './gantt/GanttView'
import type { GanttHost } from './gantt/GanttHost'

export const PM_DASHBOARD_VIEW_TYPE = 'pm-dashboard'

export class DashboardView extends ItemView {
  private plugin: PMPlugin
  private toolbarEl!: HTMLElement
  private bodyEl!: HTMLElement
  private renderToken = 0
  private reloadDebounceTimer: number | null = null
  private mode: DashboardMode = 'projects'
  private orgGantt: GanttView | null = null

  constructor(leaf: WorkspaceLeaf, plugin: PMPlugin) {
    super(leaf)
    this.plugin = plugin
    this.navigation = false
  }

  getViewType(): string {
    return PM_DASHBOARD_VIEW_TYPE
  }
  getDisplayText(): string {
    return 'Projects'
  }
  getIcon(): string {
    return 'chart-gantt'
  }

  onOpen(): Promise<void> {
    this.containerEl.addClass('pm-view')
    const root = this.contentEl
    root.empty()
    root.addClass('pm-root')
    this.toolbarEl = root.createDiv('pm-toolbar')
    this.bodyEl = root.createDiv('pm-content')
    this.render()
    this.registerVaultListeners()
    return Promise.resolve()
  }

  onClose(): Promise<void> {
    if (this.reloadDebounceTimer !== null) {
      window.clearTimeout(this.reloadDebounceTimer)
      this.reloadDebounceTimer = null
    }
    this.orgGantt?.destroy()
    this.orgGantt = null
    return Promise.resolve()
  }

  private registerVaultListeners(): void {
    const isRelevant = (path: string) => {
      const folder = this.plugin.settings.projectsFolder
      return path === folder || path.startsWith(`${folder}/`)
    }
    const scheduleReload = (path: string) => {
      if (!isRelevant(path)) return
      if (this.reloadDebounceTimer !== null) window.clearTimeout(this.reloadDebounceTimer)
      this.reloadDebounceTimer = window.setTimeout(() => {
        this.reloadDebounceTimer = null
        this.render()
      }, 300)
    }
    this.registerEvent(this.app.vault.on('create', (file) => scheduleReload(file.path)))
    this.registerEvent(this.app.vault.on('modify', (file) => scheduleReload(file.path)))
    this.registerEvent(this.app.vault.on('delete', (file) => scheduleReload(file.path)))
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        scheduleReload(file.path)
        scheduleReload(oldPath)
      })
    )
  }

  render(): void {
    const ctx = this.createContext()
    renderProjectListToolbar(ctx)
    if (this.mode === 'gantt') {
      this.bodyEl.removeClass('pm-project-list-container')
      this.renderOverviewGantt().catch(err => console.error('[PM] Failed to render overview gantt', err))
    } else {
      if (this.orgGantt) {
        this.orgGantt.destroy()
        this.orgGantt = null
      }
      this.bodyEl.empty()
      this.bodyEl.addClass('pm-project-list-container')
      renderProjectListContent(ctx)
    }
  }

  private createContext(): ProjectListContext {
    const token = ++this.renderToken
    return {
      plugin: this.plugin,
      toolbarEl: this.toolbarEl,
      contentEl: this.bodyEl,
      isStale: () => token !== this.renderToken,
      openProjectFile: (file: TFile) => this.plugin.router.openProject(file),
      mode: this.mode,
      setMode: (mode) => {
        this.mode = mode
        this.render()
      }
    }
  }

  private async renderOverviewGantt(): Promise<void> {
    const token = this.renderToken
    const savedScroll = this.orgGantt?.getScrollPosition() ?? null
    const savedLabelWidth = this.orgGantt?.getLabelWidth() ?? null
    const projects = await this.plugin.store.loadAllProjects(this.plugin.settings.projectsFolder)
    if (token !== this.renderToken) return

    for (const p of projects) this.plugin.applyCollapsedState(p)

    this.orgGantt?.destroy()
    this.orgGantt = null
    this.bodyEl.empty()

    if (projects.length === 0) {
      new EmptyState(this.bodyEl)
        .setIcon('📋')
        .setTitle('No projects yet')
        .setBody('Create your first project to get started.')
      return
    }

    const map = new Map<string, Project>()
    for (const p of projects) {
      for (const { task } of flattenTasks(p.tasks)) map.set(task.id, p)
    }

    const host: GanttHost = {
      tasks: projects.flatMap((p) => p.tasks),
      filter: makeDefaultFilter(),
      filterStatuses: this.plugin.settings.statuses,
      projectForTask: (id) => map.get(id) ?? projects[0],
      statusesForTask: (id) => {
        const p = map.get(id)
        return p ? this.plugin.store.configFor(p).statuses : this.plugin.settings.statuses
      },
      persistCollapsed: async () => {
        for (const p of projects) await this.plugin.persistCollapsedState(p)
      },
      addTask: () => {
        openProjectPicker(this.plugin, projects, (project) => {
          openTaskModal(this.plugin, project, { onSave: () => this.render() })
        })
      },
      onRefresh: async () => {
        await this.render()
      }
    }

    const gantt = new GanttView(this.bodyEl, host, this.plugin)
    if (savedScroll) gantt.setPendingScroll(savedScroll)
    if (savedLabelWidth !== null) gantt.setLabelWidth(savedLabelWidth)
    this.orgGantt = gantt
    gantt.render()
  }
}
