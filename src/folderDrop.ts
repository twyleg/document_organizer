import { ref, watch } from 'vue'

export const documentDragType = 'application/x-document-organizer-input'

export function useFolderDrop(canDrop: () => boolean, onDrop: (event: DragEvent) => void) {
  const dropActive = ref(false)
  const accepts = (event: DragEvent) => canDrop() && !!event.dataTransfer?.types.includes(documentDragType)
  function dragOver(event: DragEvent) {
    if (!accepts(event)) return
    event.preventDefault()
    event.dataTransfer!.dropEffect = 'move'
    dropActive.value = true
  }
  function dragLeave(event: DragEvent) {
    if (event.currentTarget instanceof Node && event.relatedTarget instanceof Node &&
        event.currentTarget.contains(event.relatedTarget)) return
    dropActive.value = false
  }
  function drop(event: DragEvent) {
    event.preventDefault()
    dropActive.value = false
    if (accepts(event)) onDrop(event)
  }
  watch(canDrop, value => { if (!value) dropActive.value = false })
  return { dropActive, dragOver, dragLeave, drop }
}
