import { setTooltip } from 'obsidian'
import { stringToColor } from '../../utils'

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const raw = parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2)
  return raw.toUpperCase()
}

export class Avatar {
  el: HTMLSpanElement

  constructor(parentEl: HTMLElement) {
    this.el = parentEl.createEl('span', { cls: 'pm-avatar' })
  }

  setName(name: string): this {
    this.el.setText(initialsFor(name))
    this.el.style.background = stringToColor(name)
    setTooltip(this.el, name)
    return this
  }

  setSize(size: 'md' | 'sm'): this {
    this.el.toggleClass('pm-avatar--sm', size === 'sm')
    return this
  }
}
