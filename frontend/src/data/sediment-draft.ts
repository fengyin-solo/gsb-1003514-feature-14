// 泥沙采样批次草稿与复核批次的本地持久化。
// 野外终端的暂存、重新进入恢复、一次性提交复核都读写这里；与 entries 主存储分开，
// 草稿未提交前不进泥沙监测记录，整编等其它入口也就读不到半成品。

export type SedimentDraftSample = {
  sampleNo: string
  站点编号: string
  采样时间: string
  含沙量: string
  输沙率: string
  颗粒级配: string
  采样人: string
}

export type SedimentDraft = {
  id: string
  status: '暂存中' | '已提交'
  createdAt: string
  updatedAt: string
  submitBatchId: string | null
  samples: SedimentDraftSample[]
}

export type SedimentReviewBatch = {
  id: string
  draftId: string
  createdAt: string
  updatedAt: string
  submittedSampleNos: string[]
  recordIds: number[]
}

export type SedimentDraftState = {
  drafts: SedimentDraft[]
  batches: SedimentReviewBatch[]
}

const STORAGE_KEY = 'hydrology-monitor-station:sediment-drafts'

// 示例草稿：一份暂存中的批次，S01 完整但缺采样人（提交时按设备班次回填），
// S02 缺输沙率、颗粒级配（不完整样本，提交会被跳过，补录后可从断点继续）。
const SEED_STATE: SedimentDraftState = {
  drafts: [
    {
      id: 'DRAFT-0001',
      status: '暂存中',
      createdAt: '2026-09-28 08:30',
      updatedAt: '2026-09-28 09:10',
      submitBatchId: null,
      samples: [
        {
          sampleNo: 'S01',
          站点编号: 'SEDI-0001',
          采样时间: '2026-09-28 08:40',
          含沙量: '12.6',
          输沙率: '45.2',
          颗粒级配: '<0.062mm 占 78%',
          采样人: '',
        },
        {
          sampleNo: 'S02',
          站点编号: 'SEDI-0001',
          采样时间: '2026-09-28 09:00',
          含沙量: '13.1',
          输沙率: '',
          颗粒级配: '',
          采样人: '',
        },
      ],
    },
  ],
  batches: [],
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): SedimentDraftState {
  const fallback = clone(SEED_STATE)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Partial<SedimentDraftState>
    return {
      drafts: Array.isArray(parsed.drafts) ? parsed.drafts : [],
      batches: Array.isArray(parsed.batches) ? parsed.batches : [],
    }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: SedimentDraftState | null = null

export function loadDraftState(): SedimentDraftState {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function saveDraftState(state: SedimentDraftState): void {
  cache = state
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }
}

export function draftStorageKey(): string {
  return STORAGE_KEY
}
