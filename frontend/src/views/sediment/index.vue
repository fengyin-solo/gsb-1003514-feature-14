<template>
  <section class="page" data-module="sediment">
    <header class="page-head">
      <div>
        <h2>泥沙监测管理</h2>
        <p class="page-desc">维护泥沙监测记录，围绕记录编号、站点编号、采样时间、含沙量做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="startNewDraft">新建采样批次草稿</button>
        <button class="btn" type="button" @click="exportRows">导出泥沙监测清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <section class="panel">
      <h3 class="panel-title">采样批次草稿（野外终端暂存）</h3>
      <p class="panel-desc">
        含沙量、输沙率、颗粒级配可先暂存，连续录完后重新进入继续，再一次提交复核；提交后的结果进入主表并供数据整编读取。
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th>草稿号</th>
            <th>样本数</th>
            <th>最近暂存</th>
            <th>提交状态</th>
            <th>复核批次</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="draft in drafts" :key="draft.id">
            <td>{{ draft.id }}</td>
            <td>{{ draft.samples.length }}</td>
            <td>{{ draft.updatedAt }}</td>
            <td>{{ submitStatusText(draft) }}</td>
            <td>{{ draft.submit.batchId ?? '—' }}</td>
            <td class="row-actions">
              <button
                class="link"
                type="button"
                :disabled="draft.submit.status === 'submitted'"
                @click="resumeDraft(draft.id)"
              >
                继续录入
              </button>
              <button
                class="link"
                type="button"
                :disabled="draft.submit.status === 'submitted'"
                @click="submitDraftById(draft.id)"
              >
                提交复核
              </button>
              <button class="link" type="button" @click="discardDraft(draft.id)">删除</button>
            </td>
          </tr>
          <tr v-if="!drafts.length">
            <td colspan="6" class="empty-state">暂无采样批次草稿，点「新建采样批次草稿」开始录入</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="editingId" class="panel draft-editor">
      <h3 class="panel-title">正在录入：{{ editingId }}</h3>
      <p class="panel-desc">采样人可留空，提交复核时按当前设备班次（{{ store.operator }} · {{ store.shiftLabel }}）回填。</p>
      <table class="data-table">
        <thead>
          <tr>
            <th>记录编号</th>
            <th>站点编号</th>
            <th>采样时间</th>
            <th>含沙量</th>
            <th>输沙率</th>
            <th>颗粒级配</th>
            <th>采样人</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(sample, index) in editingSamples" :key="sample.key">
            <td><input v-model="sample.记录编号" placeholder="如 SEDI-0004" /></td>
            <td><input v-model="sample.站点编号" placeholder="站点编号" /></td>
            <td><input v-model="sample.采样时间" type="date" /></td>
            <td><input v-model="sample.含沙量" placeholder="kg/m³" /></td>
            <td><input v-model="sample.输沙率" placeholder="kg/s" /></td>
            <td><input v-model="sample.颗粒级配" placeholder="级配描述" /></td>
            <td><input v-model="sample.采样人" placeholder="留空按班次回填" /></td>
            <td><button class="link" type="button" @click="removeSample(index)">移除</button></td>
          </tr>
        </tbody>
      </table>
      <div class="editor-actions">
        <button class="btn" type="button" @click="addSample">添加样本</button>
        <button class="btn" type="button" @click="saveEditing">暂存草稿</button>
        <button class="btn primary" type="button" @click="saveAndSubmit">暂存并提交复核</button>
        <button class="btn ghost" type="button" @click="closeEditor">收起</button>
      </div>
    </section>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无泥沙监测数据，可先登记泥沙监测记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条泥沙监测记录</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  blankSedimentSample,
  createSedimentDraft,
  discardSedimentDraft,
  listSedimentDrafts,
  loadSedimentDraft,
  saveSedimentDraftSamples,
  submitSedimentDraft,
} from '@/api/sediment-drafts'
import type { EntryRow, SedimentDraft, SedimentDraftSample } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('sediment')
const columns = ["记录编号", "站点编号", "采样时间", "含沙量", "输沙率", "颗粒级配", "采样人", "记录状态"]
const actions = ["提交审核", "确认通过", "标记异常"]
const statuses = ["已采集", "待审核", "已通过", "异常值"]
const stats = [{"label": "本月采样次数", "value": 0}, {"label": "待审核记录", "value": 0}, {"label": "异常记录数", "value": 0}]

const store = useSessionStore()
const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const drafts = ref<SedimentDraft[]>([])
const editingId = ref('')
const editingSamples = ref<SedimentDraftSample[]>([])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function submitStatusText(draft: SedimentDraft): string {
  if (draft.submit.status === 'submitted') {
    return '已提交复核'
  }
  if (draft.submit.status === 'failed') {
    return `提交中断（已处理 ${draft.submit.doneKeys.length}/${draft.samples.length} 条）`
  }
  return '录入中'
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function startNewDraft() {
  errorMessage.value = ''
  noticeMessage.value = ''
  const draft = createSedimentDraft()
  refreshDrafts()
  openEditor(draft.id)
  noticeMessage.value = `草稿 ${draft.id} 已建好，录完点「暂存草稿」随时可退出`
}

function resumeDraft(id: string) {
  errorMessage.value = ''
  noticeMessage.value = ''
  openEditor(id)
}

function openEditor(id: string) {
  const draft = loadSedimentDraft(id)
  if (!draft) {
    errorMessage.value = `没有找到草稿 ${id}`
    return
  }
  if (draft.submit.status === 'submitted') {
    errorMessage.value = `草稿 ${id} 已提交复核，不能再改，请新建草稿`
    return
  }
  editingId.value = id
  editingSamples.value = draft.samples.map((sample) => ({ ...sample }))
}

function closeEditor() {
  editingId.value = ''
  editingSamples.value = []
}

function addSample() {
  editingSamples.value.push(blankSedimentSample())
}

function removeSample(index: number) {
  editingSamples.value.splice(index, 1)
}

function saveEditing(): boolean {
  const result = saveSedimentDraftSamples(editingId.value, editingSamples.value)
  if (!result.ok) {
    errorMessage.value = result.message
    return false
  }
  errorMessage.value = ''
  noticeMessage.value = result.message
  refreshDrafts()
  return true
}

function saveAndSubmit() {
  if (!saveEditing()) {
    return
  }
  submitDraftById(editingId.value)
}

function submitDraftById(id: string) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = submitSedimentDraft(id, {
    operator: store.operator,
    shiftLabel: store.shiftLabel,
  })
  if (!result.ok) {
    errorMessage.value = result.message
  } else {
    noticeMessage.value = result.message
    if (editingId.value === id && result.batch) {
      closeEditor()
    }
  }
  refreshDrafts()
  reload()
}

function discardDraft(id: string) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = discardSedimentDraft(id)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  if (editingId.value === id) {
    closeEditor()
  }
  refreshDrafts()
}

function refreshDrafts() {
  drafts.value = listSedimentDrafts()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '泥沙监测列表读取失败'
  }
}

onMounted(() => {
  reload()
  refreshDrafts()
})
</script>
