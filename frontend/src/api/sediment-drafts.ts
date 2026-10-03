import { listRows, saveRows } from '@/data/local-store'
import {
  getDraft,
  listDrafts,
  listReviewBatches,
  removeDraft,
  saveDraft,
  saveReviewBatch,
} from '@/data/sediment-drafts'
import type {
  EntryRow,
  SedimentDraft,
  SedimentDraftSample,
  SedimentReviewBatch,
  SedimentSubmitResult,
} from '@/data/types'

// 已归档样本：复核已通过的记录。暂存与提交都不允许覆盖它。
const ARCHIVED_STATUS = '已通过'
// 草稿提交复核后，样本在主表里进入的状态。
const REVIEW_STATUS = '待审核'
// 不完整样本的判定：缺了这些字段，提交会停在这一条，补全后从断点继续。
const REQUIRED_FIELDS = ['记录编号', '站点编号', '采样时间', '含沙量']

export type ShiftInfo = { operator: string; shiftLabel: string }

function now(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function seqKey(prefix: string, taken: string[]): string {
  const day = now().slice(0, 10).replace(/-/g, '')
  let seq = taken.filter((id) => id.startsWith(`${prefix}-${day}`)).length + 1
  let candidate = `${prefix}-${day}-${String(seq).padStart(2, '0')}`
  while (taken.includes(candidate)) {
    seq += 1
    candidate = `${prefix}-${day}-${String(seq).padStart(2, '0')}`
  }
  return candidate
}

function emptySample(): SedimentDraftSample {
  return {
    key: `S${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    记录编号: '',
    站点编号: '',
    采样时间: '',
    含沙量: '',
    输沙率: '',
    颗粒级配: '',
    采样人: '',
  }
}

function nextRowId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

/** 与已归档样本冲突的草稿样本记录编号：暂存时提示，提交时强制跳过。 */
function archivedConflicts(samples: SedimentDraftSample[]): string[] {
  const archivedIds = new Set(
    listRows('sediment')
      .filter((row) => row.status === ARCHIVED_STATUS)
      .map((row) => String(row['记录编号'])),
  )
  return samples
    .filter((sample) => archivedIds.has(sample.记录编号.trim()))
    .map((sample) => sample.记录编号.trim())
}

export function listSedimentDrafts(): SedimentDraft[] {
  return listDrafts()
}

export function loadSedimentDraft(id: string): SedimentDraft | null {
  return getDraft(id)
}

export function createSedimentDraft(): SedimentDraft {
  const draft: SedimentDraft = {
    id: seqKey('SEDD', listDrafts().map((item) => item.id)),
    createdAt: now(),
    updatedAt: now(),
    samples: [emptySample()],
    submit: {
      status: 'editing',
      batchId: null,
      doneKeys: [],
      recordIds: [],
      conflicts: [],
      backfilled: [],
      lastError: '',
    },
  }
  saveDraft(draft)
  return draft
}

export function blankSedimentSample(): SedimentDraftSample {
  return emptySample()
}

/** 暂存草稿：只写草稿存储，不碰主表；已提交的草稿锁定，只能新建草稿再录。 */
export function saveSedimentDraftSamples(
  draftId: string,
  samples: SedimentDraftSample[],
): { ok: boolean; message: string } {
  const draft = getDraft(draftId)
  if (!draft) {
    return { ok: false, message: `没有找到草稿 ${draftId}` }
  }
  if (draft.submit.status === 'submitted') {
    return { ok: false, message: `草稿 ${draftId} 已提交复核（批次 ${draft.submit.batchId}），不能再改，请新建草稿` }
  }
  draft.samples = samples
  draft.updatedAt = now()
  // 样本被删掉后，断点里对应的主键一并清掉，避免续传时漏处理
  const alive = new Set(samples.map((sample) => sample.key))
  draft.submit.doneKeys = draft.submit.doneKeys.filter((key) => alive.has(key))
  saveDraft(draft)
  const archived = archivedConflicts(samples)
  const message = archived.length
    ? `草稿已暂存；样本 ${archived.join('、')} 与已归档记录冲突，提交时将保留已归档记录`
    : '草稿已暂存，重新进入可继续录入'
  return { ok: true, message }
}

/** 删除草稿：已提交的草稿删除后复核批次仍然保留，整编清单不受影响。 */
export function discardSedimentDraft(draftId: string): { ok: boolean; message: string } {
  const draft = getDraft(draftId)
  if (!draft) {
    return { ok: false, message: `没有找到草稿 ${draftId}` }
  }
  removeDraft(draftId)
  const message = draft.submit.batchId
    ? `草稿 ${draftId} 已删除，复核批次 ${draft.submit.batchId} 保留在整编清单里`
    : `草稿 ${draftId} 已删除`
  return { ok: true, message }
}

/**
 * 一次性提交复核。规则：
 * - 幂等：同一草稿重复提交只形成第一次的复核批次，不重复建批；
 * - 断点续传：提交失败（样本不完整）后，已写入的样本跳过，从断点继续；
 * - 冲突裁决：已归档样本以既有复核结果为准；未归档的既有记录以草稿为准；
 * - 缺采样人的样本按设备班次回填。
 */
export function submitSedimentDraft(draftId: string, shift: ShiftInfo): SedimentSubmitResult {
  const draft = getDraft(draftId)
  if (!draft) {
    return { ok: false, message: `没有找到草稿 ${draftId}`, batch: null, resumedFrom: 0 }
  }
  if (draft.submit.status === 'submitted' && draft.submit.batchId) {
    const batch = listReviewBatches().find((item) => item.batchId === draft.submit.batchId) ?? null
    return {
      ok: true,
      message: `草稿 ${draft.id} 已提交过，复核批次 ${draft.submit.batchId} 不变，未重复建批`,
      batch,
      resumedFrom: draft.samples.length,
    }
  }
  if (draft.samples.length === 0) {
    return { ok: false, message: '草稿里没有样本，先录入再提交复核', batch: null, resumedFrom: 0 }
  }

  // 批次号在第一次提交时生成并固定：失败续传、重复提交都沿用这一个批次
  if (!draft.submit.batchId) {
    draft.submit.batchId = seqKey('SEDR', listReviewBatches().map((item) => item.batchId))
  }

  const rows = [...listRows('sediment')]
  const done = new Set(draft.submit.doneKeys)
  const firstPending = draft.samples.findIndex((sample) => !done.has(sample.key))
  const resumedFrom = firstPending < 0 ? draft.samples.length : firstPending

  for (const sample of draft.samples) {
    if (done.has(sample.key)) {
      continue
    }
    const missing = REQUIRED_FIELDS.filter((field) => !String(sample[field as keyof SedimentDraftSample] ?? '').trim())
    if (missing.length > 0) {
      // 中断前把已处理的样本落库：断点续传时这些样本才算真正完成
      saveRows('sediment', rows)
      draft.submit.status = 'failed'
      draft.submit.lastError = `样本「${sample.记录编号.trim() || sample.key}」缺少${missing.join('、')}`
      draft.submit.doneKeys = [...done]
      saveDraft(draft)
      return {
        ok: false,
        message: `提交中断：${draft.submit.lastError}。已处理 ${done.size} 条，补全后重新提交将从这条继续`,
        batch: null,
        resumedFrom,
      }
    }

    const recordId = sample.记录编号.trim()
    const index = rows.findIndex((row) => String(row['记录编号']) === recordId)

    // 冲突裁决一：既有记录已归档，以既有复核结果为准，草稿样本不写入
    if (index >= 0 && rows[index].status === ARCHIVED_STATUS) {
      draft.submit.conflicts.push({ 记录编号: recordId, resolution: '与已归档样本冲突，保留已归档记录，草稿样本未写入' })
      done.add(sample.key)
      continue
    }

    // 旧记录缺采样人：按设备班次回填
    let sampler = sample.采样人.trim()
    if (!sampler) {
      sampler = `${shift.operator}（${shift.shiftLabel}）`
      draft.submit.backfilled.push(recordId)
    }

    // 冲突裁决二：既有记录未归档，以野外终端最新草稿为准
    if (index >= 0 && rows[index].status !== REVIEW_STATUS) {
      draft.submit.conflicts.push({ 记录编号: recordId, resolution: `覆盖主表中「${String(rows[index].status)}」记录，以草稿为准` })
    }

    const row: EntryRow =
      index >= 0
        ? { ...rows[index] }
        : { id: nextRowId(rows), status: REVIEW_STATUS, pending: true, abnormal: false }
    row['记录编号'] = recordId
    row['站点编号'] = sample.站点编号.trim()
    row['采样时间'] = sample.采样时间.trim()
    row['含沙量'] = sample.含沙量.trim()
    row['输沙率'] = sample.输沙率.trim()
    row['颗粒级配'] = sample.颗粒级配.trim()
    row['采样人'] = sampler
    row['记录状态'] = REVIEW_STATUS
    row.status = REVIEW_STATUS
    row.pending = true
    row.abnormal = false

    if (index >= 0) {
      rows[index] = row
    } else {
      rows.push(row)
    }
    draft.submit.recordIds.push(recordId)
    done.add(sample.key)
  }

  saveRows('sediment', rows)

  const batch: SedimentReviewBatch = {
    batchId: draft.submit.batchId,
    draftId: draft.id,
    submittedAt: now(),
    total: draft.samples.length,
    written: draft.submit.recordIds.length,
    recordIds: [...draft.submit.recordIds],
    conflicts: [...draft.submit.conflicts],
    backfilled: [...draft.submit.backfilled],
  }
  saveReviewBatch(batch)
  draft.submit.status = 'submitted'
  draft.submit.doneKeys = [...done]
  draft.submit.lastError = ''
  draft.updatedAt = now()
  saveDraft(draft)

  return {
    ok: true,
    message: `复核批次 ${batch.batchId} 提交完成：写入 ${batch.written} 条，冲突裁决 ${batch.conflicts.length} 条，班次回填 ${batch.backfilled.length} 条`,
    batch,
    resumedFrom,
  }
}

/** 整编清单读取的复核批次：只含提交后的结果，未提交的草稿不出现。 */
export function listSedimentReviewBatches(): SedimentReviewBatch[] {
  return listReviewBatches()
}
