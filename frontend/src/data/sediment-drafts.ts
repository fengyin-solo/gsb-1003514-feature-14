import type { SedimentDraft, SedimentReviewBatch } from './types'

// 采样批次草稿与复核批次单独持久化，不混进主表：未提交的草稿对整编清单、运营概览不可见。
const DRAFT_KEY = 'hydrology-monitor-station:sediment-drafts'
const BATCH_KEY = 'hydrology-monitor-station:sediment-review-batches'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readList<T>(key: string): T[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  const raw = window.localStorage.getItem(key)
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as T[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeList<T>(key: string, items: T[]): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(key, JSON.stringify(items))
  }
}

export function listDrafts(): SedimentDraft[] {
  return readList<SedimentDraft>(DRAFT_KEY)
}

export function getDraft(id: string): SedimentDraft | null {
  const found = listDrafts().find((draft) => draft.id === id)
  return found ? clone(found) : null
}

export function saveDraft(draft: SedimentDraft): void {
  const drafts = listDrafts()
  const index = drafts.findIndex((item) => item.id === draft.id)
  if (index >= 0) {
    drafts[index] = clone(draft)
  } else {
    drafts.push(clone(draft))
  }
  writeList(DRAFT_KEY, drafts)
}

export function removeDraft(id: string): void {
  writeList(
    DRAFT_KEY,
    listDrafts().filter((draft) => draft.id !== id),
  )
}

export function listReviewBatches(): SedimentReviewBatch[] {
  return readList<SedimentReviewBatch>(BATCH_KEY)
}

export function saveReviewBatch(batch: SedimentReviewBatch): void {
  const batches = listReviewBatches()
  const index = batches.findIndex((item) => item.batchId === batch.batchId)
  if (index >= 0) {
    batches[index] = clone(batch)
  } else {
    batches.push(clone(batch))
  }
  writeList(BATCH_KEY, batches)
}
