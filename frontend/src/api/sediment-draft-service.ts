import { listRows, saveRows } from '@/data/local-store'
import {
  loadDraftState,
  saveDraftState,
  type SedimentDraft,
  type SedimentDraftSample,
  type SedimentReviewBatch,
} from '@/data/sediment-draft'
import type { ActionResult, EntryRow } from '@/data/types'

// 设备班次：野外终端当前值班信息，缺采样人的记录按它回填。
export type ShiftInfo = {
  operator: string
  shiftLabel: string
}

export type SubmitResult = {
  ok: boolean
  batchId: string
  created: number
  updated: number
  keptArchived: number
  backfilled: number
  skipped: { sampleNo: string; reason: string }[]
  conflicts: string[]
  message: string
}

// 样本进入复核前必须齐全的字段；采样人缺失不按不完整处理，提交时按设备班次回填。
const REQUIRED_SAMPLE_FIELDS = ['站点编号', '采样时间', '含沙量', '输沙率', '颗粒级配'] as const

// 已归档（复核通过）的状态：草稿一律不得覆盖。
const ARCHIVED_STATUS = '已通过'

function nowText(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

export function samplerFromShift(shift: ShiftInfo): string {
  return `${shift.operator}（${shift.shiftLabel}）`
}

function nextSeq(ids: string[], prefix: string): number {
  return (
    ids.reduce((max, id) => {
      const num = Number(id.replace(prefix, ''))
      return Number.isFinite(num) ? Math.max(max, num) : max
    }, 0) + 1
  )
}

function recordNoFor(draft: SedimentDraft, sample: SedimentDraftSample): string {
  return `SEDI-D${draft.id.replace('DRAFT-', '')}-${sample.sampleNo}`
}

export function listDrafts(): SedimentDraft[] {
  // 新建的在后面，页面倒序展示，最近暂存的批次排最前。
  return [...loadDraftState().drafts].reverse()
}

export function createDraft(): SedimentDraft {
  const state = loadDraftState()
  const id = `DRAFT-${String(nextSeq(state.drafts.map((d) => d.id), 'DRAFT-')).padStart(4, '0')}`
  const draft: SedimentDraft = {
    id,
    status: '暂存中',
    createdAt: nowText(),
    updatedAt: nowText(),
    submitBatchId: null,
    samples: [],
  }
  state.drafts.push(draft)
  saveDraftState(state)
  return draft
}

export function saveDraft(draft: SedimentDraft): void {
  const state = loadDraftState()
  const index = state.drafts.findIndex((item) => item.id === draft.id)
  draft.updatedAt = nowText()
  if (index >= 0) {
    state.drafts[index] = draft
  } else {
    state.drafts.push(draft)
  }
  saveDraftState(state)
}

export function removeDraft(draftId: string): ActionResult {
  const state = loadDraftState()
  const draft = state.drafts.find((item) => item.id === draftId)
  if (!draft) {
    return { ok: false, message: `没有找到批次草稿 ${draftId}` }
  }
  if (draft.status === '已提交') {
    return { ok: false, message: `批次草稿 ${draftId} 已提交复核，复核批次 ${draft.submitBatchId} 已生效，不能删除` }
  }
  state.drafts = state.drafts.filter((item) => item.id !== draftId)
  saveDraftState(state)
  return { ok: true, message: `批次草稿 ${draftId} 已删除` }
}

export function addSample(draftId: string): SedimentDraft | null {
  const state = loadDraftState()
  const draft = state.drafts.find((item) => item.id === draftId)
  if (!draft || draft.status === '已提交') {
    return null
  }
  const no = nextSeq(draft.samples.map((s) => s.sampleNo), 'S')
  draft.samples.push({
    sampleNo: `S${String(no).padStart(2, '0')}`,
    站点编号: '',
    采样时间: '',
    含沙量: '',
    输沙率: '',
    颗粒级配: '',
    采样人: '',
  })
  draft.updatedAt = nowText()
  saveDraftState(state)
  return draft
}

export function removeSample(draftId: string, sampleNo: string): SedimentDraft | null {
  const state = loadDraftState()
  const draft = state.drafts.find((item) => item.id === draftId)
  if (!draft || draft.status === '已提交') {
    return null
  }
  draft.samples = draft.samples.filter((sample) => sample.sampleNo !== sampleNo)
  draft.updatedAt = nowText()
  saveDraftState(state)
  return draft
}

/**
 * 一次性提交复核。规则：
 * - 同一草稿只形成一个复核批次，重复提交直接返回既有批次，不重复生成记录；
 * - 不完整样本（缺站点、时间或三项测验值）跳过，批次内已提交的样本不再重复，
 *   补录后重新提交即从断点继续；
 * - 与既有记录同站点同采样时间冲突时：已归档（已通过）的以既有复核结果为准，
 *   未归档的以草稿（最新野外数据）为准并重新进入待审核；
 * - 草稿样本与旧记录缺少采样人的，一律按设备班次回填。
 */
export function submitDraft(draftId: string, shift: ShiftInfo): SubmitResult {
  const state = loadDraftState()
  const draft = state.drafts.find((item) => item.id === draftId)
  const empty: SubmitResult = {
    ok: false,
    batchId: '',
    created: 0,
    updated: 0,
    keptArchived: 0,
    backfilled: 0,
    skipped: [],
    conflicts: [],
    message: '',
  }
  if (!draft) {
    return { ...empty, message: `没有找到批次草稿 ${draftId}` }
  }

  let batch = state.batches.find((item) => item.draftId === draft.id)
  if (draft.status === '已提交' && batch) {
    return {
      ...empty,
      ok: true,
      batchId: batch.id,
      message: `批次草稿 ${draft.id} 已提交过，复核批次 ${batch.id} 保持不变，未重复生成`,
    }
  }
  if (draft.samples.length === 0) {
    return { ...empty, message: `批次草稿 ${draft.id} 还没有样本，请先录入再提交复核` }
  }
  if (!batch) {
    batch = {
      id: `REV-${String(nextSeq(state.batches.map((b) => b.id), 'REV-')).padStart(4, '0')}`,
      draftId: draft.id,
      createdAt: nowText(),
      updatedAt: nowText(),
      submittedSampleNos: [],
      recordIds: [],
    }
    state.batches.push(batch)
  }

  const rows = listRows('sediment').map((row) => ({ ...row }))
  const sampler = samplerFromShift(shift)
  const result: SubmitResult = { ...empty, ok: true, batchId: batch.id }

  // 旧记录缺少采样人按设备班次回填。
  for (const row of rows) {
    if (!String(row['采样人'] ?? '').trim()) {
      row['采样人'] = sampler
      result.backfilled += 1
    }
  }

  let nextRowId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1

  for (const sample of draft.samples) {
    // 断点续传：批次里已登记提交的样本直接跳过。
    if (batch.submittedSampleNos.includes(sample.sampleNo)) {
      continue
    }

    const missing = REQUIRED_SAMPLE_FIELDS.filter((field) => !String(sample[field] ?? '').trim())
    if (missing.length > 0) {
      result.skipped.push({ sampleNo: sample.sampleNo, reason: `缺少${missing.join('、')}` })
      continue
    }

    if (!String(sample['采样人'] ?? '').trim()) {
      sample['采样人'] = sampler
    }

    const recordNo = recordNoFor(draft, sample)
    const ownRecord = rows.find((row) => row['记录编号'] === recordNo)
    if (ownRecord) {
      // 兜底幂等：记录编号已存在说明该样本入过复核，只登记不重建。
      batch.submittedSampleNos.push(sample.sampleNo)
      if (!batch.recordIds.includes(Number(ownRecord.id))) {
        batch.recordIds.push(Number(ownRecord.id))
      }
      continue
    }

    const conflict = rows.find(
      (row) =>
        row['站点编号'] === sample['站点编号'] &&
        row['采样时间'] === sample['采样时间'] &&
        row['来源批次'] !== batch.id,
    )
    if (conflict && String(conflict.status) === ARCHIVED_STATUS) {
      // 已归档样本：暂存不得覆盖，以既有复核结果为准。
      result.keptArchived += 1
      result.conflicts.push(
        `样本 ${sample.sampleNo} 与已归档记录 ${conflict['记录编号']} 冲突，以既有复核结果为准，草稿未写入`,
      )
      batch.submittedSampleNos.push(sample.sampleNo)
      continue
    }

    const existing =
      conflict ??
      rows.find(
        (row) =>
          row['站点编号'] === sample['站点编号'] &&
          row['采样时间'] === sample['采样时间'] &&
          row['来源批次'] === batch.id,
      )
    if (existing) {
      // 未归档记录（或本批次此前写入的记录）：以草稿最新数据为准，重新进入待审核。
      existing['含沙量'] = sample['含沙量']
      existing['输沙率'] = sample['输沙率']
      existing['颗粒级配'] = sample['颗粒级配']
      existing['采样人'] = sample['采样人']
      existing['记录状态'] = '待审核'
      existing['来源批次'] = batch.id
      existing.status = '待审核'
      existing.pending = true
      existing.abnormal = false
      result.updated += 1
      if (conflict) {
        result.conflicts.push(
          `样本 ${sample.sampleNo} 覆盖未归档记录 ${existing['记录编号']}，以草稿为准重新进入待审核`,
        )
      }
      if (!batch.recordIds.includes(Number(existing.id))) {
        batch.recordIds.push(Number(existing.id))
      }
    } else {
      const row: EntryRow = {
        id: nextRowId,
        status: '待审核',
        pending: true,
        abnormal: false,
        记录编号: recordNo,
        站点编号: sample['站点编号'],
        采样时间: sample['采样时间'],
        含沙量: sample['含沙量'],
        输沙率: sample['输沙率'],
        颗粒级配: sample['颗粒级配'],
        采样人: sample['采样人'],
        记录状态: '待审核',
        来源批次: batch.id,
      }
      nextRowId += 1
      rows.push(row)
      batch.recordIds.push(Number(row.id))
      result.created += 1
    }
    batch.submittedSampleNos.push(sample.sampleNo)
  }

  saveRows('sediment', rows)

  const remaining = draft.samples.filter((sample) => !batch.submittedSampleNos.includes(sample.sampleNo))
  draft.status = remaining.length === 0 ? '已提交' : '暂存中'
  draft.submitBatchId = batch.id
  draft.updatedAt = nowText()
  batch.updatedAt = nowText()
  saveDraftState(state)

  const parts = [
    `复核批次 ${batch.id}`,
    `新增 ${result.created} 条`,
    `草稿覆盖 ${result.updated} 条`,
    `保留已归档 ${result.keptArchived} 条`,
    `回填采样人 ${result.backfilled} 条`,
  ]
  if (remaining.length > 0) {
    result.ok = false
    result.message = `${parts.join('，')}；${remaining.length} 条样本不完整未提交，补录后重新提交可从断点继续`
  } else {
    result.message = `${parts.join('，')}，草稿 ${draft.id} 已全部提交复核`
  }
  return result
}

export function listReviewBatches(): SedimentReviewBatch[] {
  return [...loadDraftState().batches].reverse()
}
