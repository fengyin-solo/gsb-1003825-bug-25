import { defineStore } from 'pinia'

// 检测室是固定的实验室角色；其余为各考古队/采样送检单位，退回时按单位鉴权。
export const LAB_UNIT = '科技考古室'

export const WORK_UNITS = [
  '第一考古队',
  '第二考古队',
  '联合发掘队',
  LAB_UNIT,
]

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '田野考古发掘数字化管理系统',
    unit: WORK_UNITS[0],
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    isLab: (state) => state.unit === LAB_UNIT,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setUnit(unit: string) {
      if (WORK_UNITS.includes(unit)) {
        this.unit = unit
      }
    },
    setOperator(name: string) {
      this.operator = name
    },
  },
})
