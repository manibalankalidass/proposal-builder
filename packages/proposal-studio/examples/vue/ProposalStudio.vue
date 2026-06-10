<!--
  Vue 3 wrapper for <proposal-studio>.

  Tell Vue that `proposal-studio` is a custom element so it does not warn /
  try to resolve it as a component. In vite.config.js:

    vue({ template: { compilerOptions: {
      isCustomElement: (tag) => tag === 'proposal-studio'
    }}})

  Usage:
    <ProposalStudio v-model="html" @ready="onReady" style="display:block;min-height:600px" />
-->
<template>
  <proposal-studio ref="el" />
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import 'proposal-studio'; // registers the element

const props = defineProps({ modelValue: { type: String, default: '' } });
const emit = defineEmits(['update:modelValue', 'ready']);

const el = ref(null);

function onChange(e) {
  emit('update:modelValue', e.detail.html);
}
function onReady() {
  if (props.modelValue) el.value.setHtml(props.modelValue);
  emit('ready', el.value);
}

onMounted(() => {
  el.value.addEventListener('change', onChange);
  el.value.addEventListener('ready', onReady);
});
onBeforeUnmount(() => {
  el.value.removeEventListener('change', onChange);
  el.value.removeEventListener('ready', onReady);
});

// Keep the editor in sync when the bound value changes from outside.
watch(
  () => props.modelValue,
  (v) => {
    const node = el.value;
    if (node && node.ready && v !== node.getHtml()) node.setHtml(v);
  }
);
</script>
