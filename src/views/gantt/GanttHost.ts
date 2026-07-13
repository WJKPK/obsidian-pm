import type { Project, StatusConfig, Task, FilterState } from '../../types'

export interface GanttHost {
  tasks: Task[]
  filter: FilterState
  filterStatuses: StatusConfig[]
  projectForTask(taskId: string): Project
  statusesForTask(taskId: string): StatusConfig[]
  persistCollapsed(): Promise<void>
  addTask(): void
  onRefresh: () => Promise<void>
}
