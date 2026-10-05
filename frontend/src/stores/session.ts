import { defineStore } from 'pinia'

// 与示例数据保持一致的可切换单位，用来演示「跨单位人员不能替代原送检单位退回」。
export const UNIT_OPTIONS = ['第一考古队', '第二考古队', '碳十四实验室']

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    unit: '第一考古队',
    shiftLabel: '白班 08:00-20:00',
    scope: '田野考古发掘数字化管理系统',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setUnit(unit: string) {
      this.unit = unit
    },
  },
})
