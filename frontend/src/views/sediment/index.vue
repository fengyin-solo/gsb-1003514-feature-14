<template>
  <section class="page" data-module="sediment">
    <header class="page-head">
      <div>
        <h2>泥沙监测管理</h2>
        <p class="page-desc">维护泥沙监测记录，围绕记录编号、站点编号、采样时间、含沙量做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="startDraft">新建采样批次</button>
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
      <header class="panel-head">
        <div>
          <h3 class="panel-title">采样批次暂存</h3>
          <p class="panel-desc">
            野外终端可先暂存含沙量、输沙率、颗粒级配草稿，连续录完后重新进入继续，再一次性提交复核；
            同一草稿重复提交只形成一个复核批次，已归档样本不被草稿覆盖。
          </p>
        </div>
        <button class="btn" type="button" @click="startDraft">新建采样批次</button>
      </header>

      <table class="data-table">
        <thead>
          <tr>
            <th>草稿编号</th>
            <th>样本数</th>
            <th>草稿状态</th>
            <th>复核批次</th>
            <th>最近暂存时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="draft in drafts" :key="draft.id">
            <td>{{ draft.id }}</td>
            <td>{{ draft.samples.length }}</td>
            <td>{{ draft.status }}</td>
            <td>{{ draft.submitBatchId ?? '—' }}</td>
            <td>{{ draft.updatedAt }}</td>
            <td class="row-actions">
              <button v-if="draft.status === '暂存中'" class="link" type="button" @click="resumeDraft(draft)">
                继续录入
              </button>
              <button v-if="draft.status === '暂存中'" class="link" type="button" @click="submitById(draft.id)">
                提交复核
              </button>
              <button v-if="draft.status === '暂存中'" class="link" type="button" @click="dropDraft(draft.id)">
                删除草稿
              </button>
              <span v-if="draft.status === '已提交'">已入复核批次 {{ draft.submitBatchId }}</span>
            </td>
          </tr>
          <tr v-if="!drafts.length">
            <td colspan="6" class="empty-state">暂无暂存草稿，点「新建采样批次」开始野外录入</td>
          </tr>
        </tbody>
      </table>

      <div v-if="activeDraft" class="draft-editor">
        <h4 class="panel-title">批次 {{ activeDraft.id }} 样本录入（{{ activeDraft.status }}）</h4>
        <table class="data-table">
          <thead>
            <tr>
              <th>样本序号</th>
              <th>站点编号</th>
              <th>采样时间</th>
              <th>含沙量</th>
              <th>输沙率</th>
              <th>颗粒级配</th>
              <th>采样人（空缺按设备班次回填）</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="sample in activeDraft.samples" :key="sample.sampleNo">
              <td>{{ sample.sampleNo }}</td>
              <td><input v-model="sample.站点编号" :disabled="activeDraft.status === '已提交'" placeholder="如 SEDI-0001" @change="persistActive" /></td>
              <td><input v-model="sample.采样时间" :disabled="activeDraft.status === '已提交'" placeholder="如 2026-10-03 08:00" @change="persistActive" /></td>
              <td><input v-model="sample.含沙量" :disabled="activeDraft.status === '已提交'" placeholder="kg/m³" @change="persistActive" /></td>
              <td><input v-model="sample.输沙率" :disabled="activeDraft.status === '已提交'" placeholder="kg/s" @change="persistActive" /></td>
              <td><input v-model="sample.颗粒级配" :disabled="activeDraft.status === '已提交'" placeholder="粒径级配描述" @change="persistActive" /></td>
              <td><input v-model="sample.采样人" :disabled="activeDraft.status === '已提交'" placeholder="可留空" @change="persistActive" /></td>
              <td>
                <button
                  v-if="activeDraft.status === '暂存中'"
                  class="link"
                  type="button"
                  @click="dropSample(sample.sampleNo)"
                >
                  移除
                </button>
              </td>
            </tr>
            <tr v-if="!activeDraft.samples.length">
              <td colspan="8" class="empty-state">批次还没有样本，点「添加样本」开始录入</td>
            </tr>
          </tbody>
        </table>
        <div v-if="activeDraft.status === '暂存中'" class="editor-actions">
          <button class="btn" type="button" @click="appendSample">添加样本</button>
          <button class="btn" type="button" @click="persistActive">保存暂存</button>
          <button class="btn primary" type="button" @click="submitActive">一次性提交复核</button>
        </div>
      </div>

      <div v-if="submitResult" class="submit-result">
        <p>{{ submitResult.message }}</p>
        <ul v-if="submitResult.skipped.length">
          <li v-for="item in submitResult.skipped" :key="item.sampleNo">
            样本 {{ item.sampleNo }} 未提交：{{ item.reason }}
          </li>
        </ul>
        <ul v-if="submitResult.conflicts.length">
          <li v-for="(text, index) in submitResult.conflicts" :key="index">{{ text }}</li>
        </ul>
      </div>
      <p v-if="notice" class="notice-text">{{ notice }}</p>
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
  addSample,
  createDraft,
  listDrafts,
  removeDraft,
  removeSample,
  saveDraft,
  submitDraft,
  type SubmitResult,
} from '@/api/sediment-draft-service'
import type { SedimentDraft } from '@/data/sediment-draft'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('sediment')
const columns = ["记录编号", "站点编号", "采样时间", "含沙量", "输沙率", "颗粒级配", "采样人", "记录状态"]
const actions = ["提交审核", "确认通过", "标记异常"]
const statuses = ["已采集", "待审核", "已通过", "异常值"]
const stats = [{"label": "本月采样次数", "value": 0}, {"label": "待审核记录", "value": 0}, {"label": "异常记录数", "value": 0}]

const session = useSessionStore()

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const drafts = ref<SedimentDraft[]>([])
const activeDraftId = ref('')
const notice = ref('')
const submitResult = ref<SubmitResult | null>(null)
const activeDraft = computed(
  () => drafts.value.find((draft) => draft.id === activeDraftId.value) ?? null,
)

function refreshDrafts() {
  drafts.value = listDrafts()
}

function startDraft() {
  const draft = createDraft()
  refreshDrafts()
  activeDraftId.value = draft.id
  submitResult.value = null
  notice.value = `已新建批次草稿 ${draft.id}，可连续录入样本，随时离开再进入继续`
}

function resumeDraft(draft: SedimentDraft) {
  activeDraftId.value = draft.id
  submitResult.value = null
  notice.value = `已恢复批次草稿 ${draft.id}，从上次暂存处继续录入`
}

function persistActive() {
  const draft = activeDraft.value
  if (!draft || draft.status !== '暂存中') {
    return
  }
  saveDraft(draft)
  refreshDrafts()
  notice.value = `批次草稿 ${draft.id} 已暂存`
}

function appendSample() {
  const draft = activeDraft.value
  if (!draft) {
    return
  }
  addSample(draft.id)
  refreshDrafts()
  notice.value = `批次草稿 ${draft.id} 已添加样本并暂存`
}

function dropSample(sampleNo: string) {
  const draft = activeDraft.value
  if (!draft) {
    return
  }
  removeSample(draft.id, sampleNo)
  refreshDrafts()
  notice.value = `批次草稿 ${draft.id} 已移除样本 ${sampleNo}`
}

function dropDraft(draftId: string) {
  const result = removeDraft(draftId)
  notice.value = result.message
  if (activeDraftId.value === draftId) {
    activeDraftId.value = ''
  }
  refreshDrafts()
}

function submitById(draftId: string) {
  submitResult.value = submitDraft(draftId, {
    operator: session.operator,
    shiftLabel: session.shiftLabel,
  })
  notice.value = ''
  refreshDrafts()
  reload()
}

function submitActive() {
  const draft = activeDraft.value
  if (!draft) {
    return
  }
  persistActive()
  submitById(draft.id)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '泥沙监测列表读取失败'
  }
}

onMounted(() => {
  refreshDrafts()
  reload()
})
</script>
