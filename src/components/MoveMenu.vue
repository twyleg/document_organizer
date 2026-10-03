<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { FolderRecommendation } from '../folderTargets'
const props = defineProps<{ anchor: HTMLElement; filename: string; recommendations: FolderRecommendation[]; loading: boolean }>()
const emit = defineEmits<{ move: [path: string]; cancel: [restoreFocus: boolean] }>()
const menu = ref<HTMLElement>()
let observer: ResizeObserver | undefined
function position() {
  const element = menu.value
  if (!element || !props.anchor.isConnected) { emit('cancel', false); return }
  const anchor = props.anchor.getBoundingClientRect()
  const pane = props.anchor.closest('.panel-content')?.getBoundingClientRect()
  if (anchor.bottom < (pane?.top ?? 0) || anchor.top > (pane?.bottom ?? innerHeight)) { emit('cancel', false); return }
  const box = element.getBoundingClientRect()
  const below = anchor.bottom + 4
  const top = below + box.height <= innerHeight - 8 ? below : anchor.top - box.height - 4
  element.style.left = `${Math.max(8, Math.min(anchor.right - box.width, innerWidth - box.width - 8))}px`
  element.style.top = `${Math.max(8, Math.min(top, innerHeight - box.height - 8))}px`
}
function focusItem(index: number) {
  const items = menu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
  if (!items?.length) return
  const button = items[(index + items.length) % items.length]!
  button.focus({ preventScroll: true })
  button.scrollIntoView({ block: 'nearest' })
}
function key(event: KeyboardEvent) {
  if (event.key === 'Escape' || event.key === 'Tab') {
    event.preventDefault(); event.stopPropagation(); emit('cancel', true); return
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault(); event.stopPropagation()
  const items = Array.from(menu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
  const index = items.indexOf(document.activeElement as HTMLButtonElement)
  focusItem(event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : index + (event.key === 'ArrowDown' ? 1 : -1))
}
function outside(event: PointerEvent) {
  if (event.target instanceof Node && !menu.value?.contains(event.target) && !props.anchor.contains(event.target)) emit('cancel', false)
}
watch(() => props.recommendations, async () => {
  await nextTick()
  position()
  if (document.activeElement === menu.value) focusItem(0)
})
onMounted(async () => {
  menu.value?.showPopover()
  await nextTick()
  position()
  menu.value?.focus({ preventScroll: true })
  focusItem(0)
  observer = new ResizeObserver(position)
  if (menu.value) observer.observe(menu.value)
  window.addEventListener('resize', position)
  document.addEventListener('scroll', position, true)
  document.addEventListener('pointerdown', outside, true)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  window.removeEventListener('resize', position)
  document.removeEventListener('scroll', position, true)
  document.removeEventListener('pointerdown', outside, true)
  menu.value?.hidePopover()
})
</script>
<template>
  <Teleport to="body">
    <div id="quick-move-menu" ref="menu" class="quick-move-menu" popover="manual" role="menu" tabindex="-1" :aria-label="`Suggested folders for ${filename}`" @keydown="key">
      <button v-for="folder in recommendations" :key="folder.path" type="button" role="menuitem" tabindex="-1" :title="`${folder.path}\nMatches: ${folder.keywords.join(', ')}`" @click="emit('move', folder.path)"><i class="bi bi-folder2" aria-hidden="true" /><span>{{ folder.relative }}</span></button>
      <p v-if="loading && !recommendations.length" role="status">Finding suggestions…</p>
      <p v-else-if="!recommendations.length" role="status">No suggestions. Use Ctrl+F to find a folder.</p>
    </div>
  </Teleport>
</template>
