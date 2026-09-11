import type { GenericAbortSignal } from 'axios'

const pendingReadControllers = new Map<GenericAbortSignal, AbortController>()
const managedReadSignals = new WeakMap<GenericAbortSignal, { controller: AbortController; navigationGeneration: number }>()
let navigationGeneration = 0

export function createNavigationReadSignal() {
  const controller = new AbortController()
  managedReadSignals.set(controller.signal, { controller, navigationGeneration })
  pendingReadControllers.set(controller.signal, controller)
  return controller.signal
}

export function navigationReadSignalFor(signal?: GenericAbortSignal | null): GenericAbortSignal {
  if (!signal) return createNavigationReadSignal()
  const managed = managedReadSignals.get(signal)
  if (!managed || pendingReadControllers.has(signal)) return signal

  if (managed.navigationGeneration !== navigationGeneration) {
    managed.controller.abort()
    return signal
  }

  return createNavigationReadSignal()
}

export function releaseNavigationReadSignal(signal?: GenericAbortSignal | null) {
  if (signal) pendingReadControllers.delete(signal)
}

export function cancelPendingReadRequests() {
  navigationGeneration += 1
  const controllers = [...pendingReadControllers.values()]
  pendingReadControllers.clear()
  for (const controller of controllers) controller.abort()
}
