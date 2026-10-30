<template>
  <div class="pb">
    <div class="pb-label">
      活动照片
      <span class="pb-count">{{ list.length }} / {{ max }}</span>
      <span class="pb-hint">单张不超过 5MB</span>
    </div>
    <div class="pb-grid">
      <div v-for="(url, i) in list" :key="url + i" class="pb-item">
        <img :src="url" alt="活动照片" />
        <span v-if="!readonly" class="pb-del" @click="$emit('remove', section, i)">✕</span>
      </div>

      <label v-if="!readonly && list.length < max" class="pb-add">
        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden @change="onPick" />
        <span class="pb-plus">＋</span>
        <span class="pb-add-text">上传照片</span>
      </label>

      <div v-if="readonly && list.length === 0" class="pb-empty">未上传照片</div>
    </div>
  </div>
</template>

<script setup>
const props = defineProps({
  section: { type: String, required: true },
  list: { type: Array, default: () => [] },
  readonly: { type: Boolean, default: false },
  max: { type: Number, default: 3 }
});
const emit = defineEmits(['pick', 'remove']);

function onPick(e) {
  const f = e.target.files && e.target.files[0];
  if (f) emit('pick', f, props.section);
  e.target.value = '';
}
</script>

<style scoped>
.pb { margin-top: 14px; }
.pb-label { font-size: 12px; color: var(--app-text-2); margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
.pb-count { color: var(--app-text-3); }
.pb-hint { color: var(--app-text-3); font-size: 11px; }

.pb-grid { display: flex; flex-wrap: wrap; gap: 10px; }

.pb-item { position: relative; width: 104px; height: 78px; border-radius: 6px; overflow: hidden; border: 1px solid var(--app-border); }
.pb-item img { width: 100%; height: 100%; object-fit: cover; display: block; }
.pb-del {
  position: absolute; top: 2px; right: 2px;
  width: 18px; height: 18px; border-radius: 50%;
  background: rgba(0, 0, 0, .55); color: #fff;
  font-size: 11px; line-height: 18px; text-align: center;
  cursor: pointer;
}

.pb-add {
  width: 104px; height: 78px;
  border: 1px dashed var(--app-border-2);
  border-radius: 6px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  cursor: pointer; color: var(--app-text-3);
  transition: border-color .15s ease, color .15s ease;
}
.pb-add:hover { border-color: var(--td-brand-color); color: var(--td-brand-color); }
.pb-plus { font-size: 18px; line-height: 1; }
.pb-add-text { font-size: 11px; }

.pb-empty { font-size: 12px; color: var(--app-text-3); padding: 8px 0; }
</style>
