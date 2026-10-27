<template>
  <t-popup
    v-model:visible="visible"
    placement="bottom-left"
    :overlay-inner-style="{ padding: 0 }"
    :attach="attachTarget"
  >
    <template #content>
      <div class="ldp-panel">
        <div class="ldp-head">
          <button class="ldp-nav" type="button" title="上一年" @click="shiftYear(-1)">
            <t-icon name="chevron-left-double" size="14px" />
          </button>
          <button class="ldp-nav" type="button" title="上一月" @click="shiftMonth(-1)">
            <t-icon name="chevron-left" size="14px" />
          </button>
          <div class="ldp-title">
            <span class="ldp-year">{{ viewYear }}</span>
            <span class="ldp-sep">年</span>
            <span class="ldp-month">{{ viewMonth + 1 }}</span>
            <span class="ldp-sep">月</span>
            <span v-if="viewLunarMonth" class="ldp-lmonth">{{ viewLunarMonth }}</span>
          </div>
          <button class="ldp-nav" type="button" title="下一月" @click="shiftMonth(1)">
            <t-icon name="chevron-right" size="14px" />
          </button>
          <button class="ldp-nav" type="button" title="下一年" @click="shiftYear(1)">
            <t-icon name="chevron-right-double" size="14px" />
          </button>
        </div>

        <div class="ldp-week">
          <span
            v-for="(w, i) in WEEK_SHORT"
            :key="w"
            class="ldp-week-item"
            :class="{ weekend: i === 0 || i === 6 }"
          >{{ w }}</span>
        </div>

        <div class="ldp-grid">
          <div
            v-for="(cell, idx) in cells"
            :key="idx"
            class="ldp-cell"
            :class="{
              outside: !cell.inMonth,
              today: cell.isToday,
              selected: cell.isSelected,
              weekend: cell.weekday === 0 || cell.weekday === 6,
              festival: cell.lunar.kind === 'festival',
              jieqi: cell.lunar.kind === 'jieqi'
            }"
            @click="pick(cell)"
          >
            <span class="ldp-num">{{ cell.day }}</span>
            <span class="ldp-lunar">{{ cell.lunar.text }}</span>
          </div>
        </div>

        <div class="ldp-foot">
          <span v-if="selectedLunar" class="ldp-tip">{{ selectedLunar }}</span>
          <div class="ldp-actions">
            <button type="button" class="ldp-btn primary" @click="pickToday">今天</button>
            <button v-if="clearable" type="button" class="ldp-btn" @click="clear">清除</button>
          </div>
        </div>
      </div>
    </template>

    <div
      class="ldp-input"
      :class="{ 'is-open': visible, 'is-empty': !modelValue, 'is-disabled': disabled }"
      @click="onTrigger"
    >
      <span v-if="modelValue" class="ldp-value">{{ displayText }}</span>
      <span v-else class="ldp-placeholder">{{ placeholder }}</span>
      <span class="ldp-suffix">
        <t-icon name="calendar" size="15px" />
      </span>
    </div>
  </t-popup>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { getLunarInfo, parseDate, toDateStr, WEEK_SHORT } from '../utils/lunar';

const props = defineProps({
  modelValue: { type: [String, Date], default: '' },
  placeholder: { type: String, default: '选择日期' },
  clearable: { type: Boolean, default: true },
  disabled: { type: Boolean, default: false }
});

const emit = defineEmits(['update:modelValue', 'change']);

const visible = ref(false);
const attachTarget = ref(document.body);

const today = new Date();
const todayKey = toDateStr(today);

const selectedDate = computed(() => parseDate(props.modelValue));

const viewYear = ref(selectedDate.value ? selectedDate.value.getFullYear() : today.getFullYear());
const viewMonth = ref(selectedDate.value ? selectedDate.value.getMonth() : today.getMonth());

watch(visible, (v) => {
  if (v) {
    const d = selectedDate.value || new Date();
    viewYear.value = d.getFullYear();
    viewMonth.value = d.getMonth();
  }
});

const displayText = computed(() => {
  const d = selectedDate.value;
  if (!d) return '';
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${week}`;
});

const selectedLunar = computed(() => {
  const d = selectedDate.value;
  if (!d) return '';
  const lunar = getLunarInfo(d);
  return `${lunar.full}　${lunar.lunarYear}年（${lunar.shengXiao}）`;
});

const viewLunarMonth = computed(() => {
  const d = new Date(viewYear.value, viewMonth.value, 15);
  return `${getLunarInfo(d).lunarMonth}月`;
});

const cells = computed(() => {
  const first = new Date(viewYear.value, viewMonth.value, 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());

  const list = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = toDateStr(d);
    list.push({
      date: d,
      key,
      day: d.getDate(),
      inMonth: d.getMonth() === viewMonth.value,
      weekday: d.getDay(),
      isToday: key === todayKey,
      isSelected: key === toDateStr(selectedDate.value),
      lunar: getLunarInfo(d)
    });
  }
  return list;
});

function onTrigger() {
  if (props.disabled) return;
  visible.value = !visible.value;
}

function shiftMonth(n) {
  const d = new Date(viewYear.value, viewMonth.value + n, 1);
  viewYear.value = d.getFullYear();
  viewMonth.value = d.getMonth();
}

function shiftYear(n) {
  viewYear.value += n;
}

function pick(cell) {
  emit('update:modelValue', cell.key);
  emit('change', cell.key);
  visible.value = false;
}

function pickToday() {
  const d = new Date();
  viewYear.value = d.getFullYear();
  viewMonth.value = d.getMonth();
  emit('update:modelValue', todayKey);
  emit('change', todayKey);
  visible.value = false;
}

function clear() {
  emit('update:modelValue', '');
  emit('change', '');
  visible.value = false;
}
</script>

<style scoped>
.ldp-input {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 10px;
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: 3px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
  box-sizing: border-box;
  width: 100%;
}

.ldp-input:hover {
  border-color: var(--td-brand-color);
}

.ldp-input.is-open {
  border-color: var(--td-brand-color);
  box-shadow: 0 0 0 2px rgba(0, 82, 217, 0.12);
}

.ldp-input.is-disabled {
  background: var(--app-bg-2);
  cursor: not-allowed;
  border-color: var(--app-border);
}

.ldp-input.is-disabled .ldp-value,
.ldp-input.is-disabled .ldp-placeholder {
  color: rgba(0, 0, 0, 0.26);
}

.ldp-value {
  flex: 1;
  color: rgba(0, 0, 0, 0.9);
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ldp-placeholder {
  flex: 1;
  color: rgba(0, 0, 0, 0.4);
  font-size: 14px;
}

.ldp-suffix {
  color: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

/* ---------- 面板 ---------- */
.ldp-panel {
  width: 288px;
  padding: 10px 12px 8px;
  background: var(--app-surface);
  user-select: none;
}

.ldp-head {
  display: flex;
  align-items: center;
  gap: 1px;
  margin-bottom: 8px;
}

.ldp-nav {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: rgba(0, 0, 0, 0.4);
  cursor: pointer;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s;
}

.ldp-nav:hover {
  background: var(--app-bg-2);
  color: var(--td-brand-color);
}

.ldp-title {
  flex: 1;
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 1px;
  font-size: 14px;
  color: rgba(0, 0, 0, 0.9);
  font-weight: 500;
}

.ldp-sep {
  font-weight: 400;
  color: rgba(0, 0, 0, 0.6);
  font-size: 12px;
}

.ldp-lmonth {
  margin-left: 6px;
  font-size: 11px;
  font-weight: 400;
  color: rgba(0, 0, 0, 0.4);
}

.ldp-week {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  border-bottom: 1px solid var(--app-border-2);
  padding-bottom: 5px;
  margin-bottom: 3px;
}

.ldp-week-item {
  text-align: center;
  font-size: 11px;
  color: rgba(0, 0, 0, 0.4);
  padding: 2px 0;
}

.ldp-week-item.weekend {
  color: var(--app-error);
}

.ldp-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 1px;
}

.ldp-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 40px;
  border-radius: 3px;
  cursor: pointer;
  transition: background 0.12s;
  border: 1px solid transparent;
}

.ldp-cell:hover {
  background: var(--td-brand-color-light);
}

.ldp-num {
  font-size: 13px;
  color: rgba(0, 0, 0, 0.9);
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}

.ldp-lunar {
  font-size: 9px;
  color: rgba(0, 0, 0, 0.4);
  line-height: 1.2;
  margin-top: 1px;
  white-space: nowrap;
  transform: scale(0.92);
}

.ldp-cell.outside {
  opacity: 0.3;
}

.ldp-cell.weekend .ldp-num {
  color: var(--app-error);
}

.ldp-cell.today {
  border-color: var(--td-brand-color);
}

.ldp-cell.today .ldp-num {
  color: var(--td-brand-color);
  font-weight: 500;
}

.ldp-cell.selected {
  background: var(--td-brand-color);
}

.ldp-cell.selected .ldp-num,
.ldp-cell.selected .ldp-lunar {
  color: #fff;
}

.ldp-cell.festival .ldp-lunar {
  color: var(--app-warning);
}

.ldp-cell.jieqi .ldp-lunar {
  color: var(--app-success);
}

.ldp-cell.selected .ldp-lunar {
  color: rgba(255, 255, 255, 0.85);
}

.ldp-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--app-border-2);
  min-height: 24px;
}

.ldp-tip {
  font-size: 10.5px;
  color: rgba(0, 0, 0, 0.4);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ldp-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.ldp-btn {
  border: 1px solid var(--app-border);
  background: var(--app-surface);
  color: rgba(0, 0, 0, 0.6);
  font-size: 11.5px;
  padding: 2px 9px;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.15s;
}

.ldp-btn:hover {
  color: var(--td-brand-color);
  border-color: var(--td-brand-color);
}

.ldp-btn.primary {
  color: var(--td-brand-color);
  border-color: rgba(0, 82, 217, 0.35);
  background: var(--td-brand-color-light);
}
</style>
