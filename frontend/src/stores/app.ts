import { defineStore } from 'pinia'
import { ref } from 'vue'
import { http } from '../services/http'

export const useAppStore = defineStore('app', () => {
  const projectName = ref('SRMS 房屋租赁管理系统')
  async function loadProjectName() {
    const result = await http.get('/system/public').catch(() => null)
    const name = result?.data?.data?.projectName
    if (typeof name === 'string' && name.trim()) {
      projectName.value = name
      document.title = name
    }
  }

  return { projectName, loadProjectName }
})
