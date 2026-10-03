/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 泥沙采样草稿里的单条样本：野外终端录一行存一行，采样人允许留空。 */
export type SedimentDraftSample = {
  key: string
  记录编号: string
  站点编号: string
  采样时间: string
  含沙量: string
  输沙率: string
  颗粒级配: string
  采样人: string
}

/** 采样批次草稿：一次野外连续录沙的中间态，提交复核前可反复暂存、重新进入继续。 */
export type SedimentDraft = {
  id: string
  createdAt: string
  updatedAt: string
  samples: SedimentDraftSample[]
  submit: {
    status: 'editing' | 'failed' | 'submitted'
    batchId: string | null
    doneKeys: string[]
    recordIds: string[]
    conflicts: { 记录编号: string; resolution: string }[]
    backfilled: string[]
    lastError: string
  }
}

/** 复核批次：草稿一次性提交的结果，整编清单按它读取提交后的泥沙数据。 */
export type SedimentReviewBatch = {
  batchId: string
  draftId: string
  submittedAt: string
  total: number
  written: number
  recordIds: string[]
  conflicts: { 记录编号: string; resolution: string }[]
  backfilled: string[]
}

export type SedimentSubmitResult = {
  ok: boolean
  message: string
  batch: SedimentReviewBatch | null
  resumedFrom: number
}
