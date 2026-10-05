import { beforeEach, describe, expect, it } from 'vitest'

// 每个用例前重置模块注册表：local-store 是模块级单例缓存，必须保证用例间互不串数据。
async function loadDomain(storage: Storage | null = null) {
  vi.resetModules()
  vi.stubGlobal('window', { localStorage: storage, addEventListener: () => undefined })
  return await import('@/api/flotation-domain')
}

class MemoryStorage {
  private map = new Map<string, string>()
  get length() {
    return this.map.size
  }
  clear() {
    this.map.clear()
  }
  getItem(key: string) {
    return this.map.has(key) ? (this.map.get(key) as string) : null
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.map.delete(key)
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value))
  }
}

/** 写入即抛错的存储，模拟配额超限/存储被禁，用于验证整体回滚。 */
class FailingStorage extends MemoryStorage {
  setItem() {
    throw new Error('QuotaExceededError')
  }
}

const UNIT_A = '第一考古队'
const UNIT_B = '第二考古队'
const UNIT_C = '联合发掘队'
const LAB = '科技考古室'

function row(domain: Awaited<ReturnType<typeof loadDomain>>, id: number) {
  const sample = domain.snapshotTables().flotation.find((item) => Number(item.id) === id)
  if (!sample) throw new Error(`sample ${id} not found`)
  return sample
}
function datingFor(domain: Awaited<ReturnType<typeof loadDomain>>, sampleId: number, round: number) {
  return domain.snapshotTables().dating.find(
    (item) => Number(item.来源样本ID) === sampleId && Number(item.检测轮次) === round,
  )
}

describe('浮选样本检测流转', () => {
  let domain: Awaited<ReturnType<typeof loadDomain>>
  let storage: MemoryStorage

  beforeEach(async () => {
    storage = new MemoryStorage()
    domain = await loadDomain(storage)
  })

  it('现场动作：已采集 → 已浮选 → 已分拣，再由采样单位送出检测并生成测年送检单', () => {
    expect(domain.executeFlotation(1, { operator: '李发掘', unit: UNIT_A }).ok).toBe(true)
    expect(domain.completeSorting(1, { operator: '李发掘', unit: UNIT_A }).ok).toBe(true)

    const wrong = domain.sendForTesting(1, { operator: '他队人', unit: UNIT_B })
    expect(wrong.ok).toBe(false)
    expect(wrong.message).toContain('采样单位')

    const sent = domain.sendForTesting(1, { operator: '李发掘', unit: UNIT_A })
    expect(sent.ok).toBe(true)
    const sample = row(domain, 1)
    expect(sample.status).toBe('已送检')
    expect(sample.送检单位).toBe(UNIT_A)
    expect(sample.检测轮次).toBe(1)
    const order = datingFor(domain, 1, 1)
    expect(order).toBeDefined()
    expect(order?.status).toBe('已送检')
    expect(order?.送检编号).toMatch(/^DATI-\d{4}$/)
  })

  it('检测室开始检测并提交结论：CAS 版本不匹配的并发第二个结论不生效', () => {
    // 种子里 FLOT-0003 处于检测中，版本 3
    const first = domain.submitLabResult(
      3,
      { operator: '赵检测', unit: LAB },
      { 检测编号: 'LAB-2026-0099', 初步结果: '结论A', 检测结论: '合格', expectedVersion: 3 },
    )
    expect(first.ok).toBe(true)
    expect(row(domain, 3).status).toBe('待复核')
    expect(row(domain, 3).version).toBe(4)

    const second = domain.submitLabResult(
      3,
      { operator: '钱检测', unit: LAB },
      { 检测编号: 'LAB-2026-0100', 初步结果: '结论B', 检测结论: '不合格', expectedVersion: 3 },
    )
    expect(second.ok).toBe(false)
    expect(second.message).toContain('先行提交')
    // 生效的仍是首个结论
    expect(row(domain, 3).检测结论).toBe('合格')
    expect(datingFor(domain, 3, 1)?.检测结论).toBe('合格')
  })

  it('非检测室身份不能登记检测结果', () => {
    const result = domain.submitLabResult(
      3,
      { operator: '李发掘', unit: UNIT_B },
      { 检测编号: 'X', 初步结果: 'Y', 检测结论: 'Z', expectedVersion: 3 },
    )
    expect(result.ok).toBe(false)
    expect(result.message).toContain('科技考古室')
  })

  it('复核通过：冻结报告入历史、清空本轮中间态，关联送检单回写已出结果', () => {
    // FLOT-0004 处于待复核
    const result = domain.approveReview(4, { operator: '周复核', unit: UNIT_B })
    expect(result.ok).toBe(true)
    const sample = row(domain, 4)
    expect(sample.status).toBe('已返回')
    expect(sample.pending).toBe(false)
    const reports = sample.检测历史报告 as { 轮次: number; 报告编号: string }[]
    expect(reports).toHaveLength(1)
    expect(reports[0].报告编号).toMatch(/^REP-/)
    // 中间态已清空，但历史报告保留结论
    const draft = sample.检测中间态 as { 检测结论: string }
    expect(draft.检测结论).toBe('')
    expect(sample.结果报告).toContain('粟黍混合')
    expect(datingFor(domain, 4, 1)?.status).toBe('已出结果')
  })

  it('复核退回：清空本次检测中间字段、旧送检单作废、生成跨业务面待补样事项', () => {
    const result = domain.returnSample(
      4,
      { operator: '王田野', unit: UNIT_B },
      { 退回原因: '样品量不足，需补样', expectedVersion: 4 },
    )
    expect(result.ok).toBe(true)
    const sample = row(domain, 4)
    expect(sample.status).toBe('已退回')
    expect(sample.abnormal).toBe(true)
    expect(sample.待补样原因).toBe('样品量不足，需补样')
    expect(sample.检测编号).toBe('')
    expect(sample.检测结论).toBe('')
    const draft = sample.检测中间态 as { 检测室: string; 检测编号: string; 检测结论: string }
    expect(draft.检测编号).toBe('')
    expect(draft.检测结论).toBe('')

    const order = datingFor(domain, 4, 1)
    expect(order?.status).toBe('已取消')
    expect(order?.检测结论).toBe('')

    const todos = domain.listResampleTodos(true)
    const todo = todos.find((item) => Number(item.样本ID) === 4)
    expect(todo).toBeDefined()
    expect(todo?.原送检单位).toBe(UNIT_B)
    expect(todo?.事项状态).toBe('待补样')
  })

  it('跨单位人员不能替代原送检单位退回', () => {
    // FLOT-0004 送检单位是第二考古队，第一考古队尝试退回
    const result = domain.returnSample(
      4,
      { operator: '李发掘', unit: UNIT_A },
      { 退回原因: '恶意退回', expectedVersion: 4 },
    )
    expect(result.ok).toBe(false)
    expect(result.message).toContain('原送检单位')
    expect(row(domain, 4).status).toBe('待复核')
  })

  it('退回原因必填，缺失时整单不动', () => {
    const result = domain.returnSample(
      4,
      { operator: '王田野', unit: UNIT_B },
      { 退回原因: '   ', expectedVersion: 4 },
    )
    expect(result.ok).toBe(false)
    expect(row(domain, 4).status).toBe('待复核')
  })

  it('补样重送：待补样事项闭环、轮次+1、生成新送检单且旧单保持作废，复检不带上次内容', () => {
    // FLOT-0005 已退回，种子存在打开的待补样事项 #1
    const wrongUnit = domain.resendFromTodo(1, { operator: '别队人', unit: UNIT_A }, { 土样重量: '9kg' })
    expect(wrongUnit.ok).toBe(false)

    const sent = domain.resendFromTodo(1, { operator: '孙联合', unit: UNIT_C }, { 土样重量: '9.0kg' })
    expect(sent.ok).toBe(true)
    const sample = row(domain, 5)
    expect(sample.status).toBe('已送检')
    expect(sample.检测轮次).toBe(2)
    expect(sample.abnormal).toBe(false)
    expect(sample.待补样原因).toBe('')
    const draft = sample.检测中间态 as Record<string, string>
    expect(draft.检测编号).toBe('')
    expect(draft.检测结论).toBe('')

    const oldOrder = datingFor(domain, 5, 1)
    expect(oldOrder?.status).toBe('已取消')
    const newOrder = datingFor(domain, 5, 2)
    expect(newOrder).toBeDefined()
    expect(newOrder?.status).toBe('已送检')

    const todo = domain.listResampleTodos().find((item) => Number(item.id) === 1)
    expect(todo?.事项状态).toBe('已重新送检')
    expect(todo?.新送检单ID).toBe(newOrder?.id)
  })

  it('历史已完成样本（已返回）仍按当时报告保留，不能退回', () => {
    const before = row(domain, 6)
    const beforeReport = JSON.stringify(before.检测历史报告)
    const result = domain.returnSample(
      6,
      { operator: '李发掘', unit: UNIT_A },
      { 退回原因: '想改历史', expectedVersion: 7 },
    )
    expect(result.ok).toBe(false)
    expect(result.message).toContain('历史报告')
    const after = row(domain, 6)
    expect(after.status).toBe('已返回')
    expect(JSON.stringify(after.检测历史报告)).toBe(beforeReport)
    expect(after.结果报告).toContain('REP-2026-0014')
  })

  it('已返回样本允许补样重开新一轮，历史报告不被改动', () => {
    const reportsBefore = (row(domain, 6).检测历史报告 as unknown[]).length
    const sent = domain.sendForTesting(6, { operator: '李发掘', unit: UNIT_A }, { 土样重量: '11kg' })
    expect(sent.ok).toBe(true)
    const sample = row(domain, 6)
    expect(sample.检测轮次).toBe(3)
    expect((sample.检测历史报告 as unknown[]).length).toBe(reportsBefore)
  })

  it('保存失败时三表整体回滚：样本、送检单、待补样事项均不改动', async () => {
    const failing = new FailingStorage()
    const failingDomain = await loadDomain(failing)
    const before = JSON.stringify(failingDomain.snapshotTables())
    const result = failingDomain.returnSample(
      4,
      { operator: '王田野', unit: UNIT_B },
      { 退回原因: '存储会失败', expectedVersion: 4 },
    )
    expect(result.ok).toBe(false)
    expect(result.message).toContain('整体回滚')
    // commit 失败不更新内存缓存，重读仍是原状态
    expect(JSON.stringify(failingDomain.snapshotTables())).toBe(before)
    expect(row(failingDomain, 4).status).toBe('待复核')
    expect(failingDomain.listResampleTodos(true).some((item) => Number(item.样本ID) === 4)).toBe(false)
  })

  it('复核通过同样事务化：报告号生成后若保存失败，不产生半成品报告', async () => {
    const failingDomain = await loadDomain(new FailingStorage())
    const before = JSON.stringify(row(failingDomain, 4).检测历史报告)
    const result = failingDomain.approveReview(4, { operator: '周复核', unit: UNIT_B })
    expect(result.ok).toBe(false)
    expect(JSON.stringify(row(failingDomain, 4).检测历史报告)).toBe(before)
    expect(row(failingDomain, 4).status).toBe('待复核')
  })

  it('旧版缓存迁移：缺少检测字段的老数据自动补齐，检测流程可正常进行', async () => {
    const legacy = new MemoryStorage()
    legacy.setItem(
      'field-archaeology-digital:entries',
      JSON.stringify({
        flotation: [
          {
            id: 1,
            status: '已分拣',
            pending: true,
            abnormal: false,
            样本编号: 'FLOT-OLD-1',
            采样单位: UNIT_A,
            采样层位: 'L9',
            土样重量: '5kg',
            浮选日期: '2026-09-01',
            轻浮物类型: '炭粒',
            操作人: '老数据',
            样本状态: '已分拣',
          },
        ],
        dating: [],
      }),
    )
    const migratedDomain = await loadDomain(legacy)
    const sample = row(migratedDomain, 1)
    expect(sample.检测轮次).toBe(0)
    expect(sample.送检单位).toBe('')
    const draft = sample.检测中间态 as Record<string, string>
    expect(draft.检测结论).toBe('')
    expect((sample.检测历史报告 as unknown[])).toEqual([])

    const sent = migratedDomain.sendForTesting(1, { operator: '李发掘', unit: UNIT_A })
    expect(sent.ok).toBe(true)
    expect(row(migratedDomain, 1).检测轮次).toBe(1)
  })
})
