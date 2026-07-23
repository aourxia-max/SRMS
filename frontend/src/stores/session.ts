import type { AxiosError, InternalAxiosRequestConfig } from 'axios'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { http } from '../services/http'

export type SessionUser = { id: number; username: string; displayName: string; role: 'SUPER_ADMIN' | 'ADMIN' | 'VISITOR' }
type AuthResponse = { code: number; message: string; data: { accessToken: string; user: SessionUser } }

export const useSessionStore = defineStore('session', () => {
  const accessToken = ref<string | null>(null)
  const user = ref<SessionUser | null>(null)
  const initialized = ref(false)
  const isAuthenticated = computed(() => Boolean(accessToken.value && user.value))
  let refreshPromise: Promise<boolean> | null = null

  function applySession(data: AuthResponse['data']) {
    accessToken.value = data.accessToken
    user.value = data.user
  }

  function clear() {
    accessToken.value = null
    user.value = null
  }

  async function login(username: string, password: string) {
    const response = await http.post<AuthResponse>('/auth/login', { username, password })
    applySession(response.data.data)
  }

  async function refresh() {
    if (!refreshPromise) {
      refreshPromise = http
        .post<AuthResponse>('/auth/refresh')
        .then((response) => {
          applySession(response.data.data)
          return true
        })
        .catch(() => {
          clear()
          return false
        })
        .finally(() => {
          refreshPromise = null
        })
    }
    return refreshPromise
  }

  async function restore() {
    if (!initialized.value) {
      await refresh()
      initialized.value = true
    }
  }

  async function logout(allDevices = false) {
    try {
      await http.post(allDevices ? '/auth/logout-all' : '/auth/logout')
    } finally {
      clear()
    }
  }

  function installInterceptors() {
    http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
      if (accessToken.value) config.headers.Authorization = `Bearer ${accessToken.value}`
      return config
    })
    http.interceptors.response.use(undefined, async (error: AxiosError) => {
      const request = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined
      if (error.response?.status !== 401 || !request || request._retried || request.url?.includes('/auth/')) {
        return Promise.reject(error)
      }
      request._retried = true
      if (await refresh()) {
        request.headers.Authorization = `Bearer ${accessToken.value}`
        return http(request)
      }
      return Promise.reject(error)
    })
  }

  return { accessToken, user, initialized, isAuthenticated, login, logout, restore, installInterceptors }
})
