<script setup lang="ts">
defineProps<{ explanation: string; tabindex?: number }>()
</script>

<template>
  <button
    type="button"
    class="suggestion-help"
    :tabindex="tabindex"
    :title="explanation"
    :aria-label="`Why this suggestion? ${explanation}`"
    @click.stop
  >
    <i
      class="bi bi-question-circle"
      aria-hidden="true"
    />
  </button>
</template>
