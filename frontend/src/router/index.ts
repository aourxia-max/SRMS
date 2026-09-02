import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useSessionStore } from '../stores/session'
import HomeView from '../views/HomeView.vue'
import LoginView from '../views/LoginView.vue'
import UsersView from '../views/UsersView.vue'
import PropertiesView from '../views/PropertiesView.vue'
import TenantsView from '../views/TenantsView.vue'
import ContractsView from '../views/ContractsView.vue'
import ConcessionsPreviewView from '../views/ConcessionsPreviewView.vue'
import ContractChangesView from '../views/ContractChangesView.vue'
import PaymentCollectView from '../views/payments/PaymentCollectView.vue'
import PaymentDetailView from '../views/payments/PaymentDetailView.vue'
import PaymentReviewsView from '../views/payments/PaymentReviewsView.vue'
import CheckoutView from '../views/CheckoutView.vue'
import FinanceView from '../views/FinanceView.vue'
import DashboardView from '../views/DashboardView.vue'
import SystemManagementView from '../views/SystemManagementView.vue'
import RoomDetailView from '../views/RoomDetailView.vue'
import RentBillsView from '../views/RentBillsView.vue'

type RouteAccessTarget = {
  fullPath: string
  name: string | symbol | null | undefined
  meta: Record<string, unknown>
}

type RouteAccessSession = {
  isAuthenticated: boolean
  user: { role: string } | null
}

export function resolveRouteAccess(to: RouteAccessTarget, session: RouteAccessSession) {
  if (to.meta.requiresAuth && !session.isAuthenticated) return { name: 'login', query: { redirect: to.fullPath } }
  if (to.name === 'login' && session.isAuthenticated) return { name: 'session' }
  const roles = to.meta.roles as string[] | undefined
  if (roles && !roles.includes(session.user?.role ?? '')) return { name: 'session' }
  return true
}
export const routes: RouteRecordRaw[] = [
    {
      path: '/',
      name: 'session',
      component: DashboardView,
      meta: { requiresAuth: true },
    },
    { path: '/admin/users', name: 'users', component: UsersView, meta: { requiresAuth: true } },
    { path: '/admin/system', name: 'system-management', component: SystemManagementView, meta: { requiresAuth: true } },
    { path: '/properties', name: 'properties', component: PropertiesView, meta: { requiresAuth: true } },
    { path: '/properties/:id', name: 'room-detail', component: RoomDetailView, meta: { requiresAuth: true } },
    { path: '/tenants', name: 'tenants', component: TenantsView, meta: { requiresAuth: true } },
    { path: '/contracts', name: 'contracts', component: ContractsView, meta: { requiresAuth: true } },
    {
      path: '/pricing-rebates',
      redirect: (to) => ({ name: 'contracts', query: { ...to.query, tab: 'fixed-rebate' } }),
    },
    { path: '/contracts/changes', name: 'contract-changes', component: ContractChangesView, meta: { requiresAuth: true } },
    { path: '/payments', redirect: (to) => ({ path: '/payments/collect', query: to.query }) },
    { path: '/payments/collect', name: 'payment-collect', component: PaymentCollectView, meta: { requiresAuth: true } },
    { path: '/payments/detail/:id?', name: 'payment-detail', component: PaymentDetailView, meta: { requiresAuth: true } },
    { path: '/payments/reviews', name: 'payment-reviews', component: PaymentReviewsView, meta: { requiresAuth: true } },
    { path: '/rent-bills', name: 'rent-bills', component: RentBillsView, meta: { requiresAuth: true } },
    { path: '/checkout', name: 'checkout', component: CheckoutView, meta: { requiresAuth: true } },
    { path: '/finance', name: 'finance', component: FinanceView, meta: { requiresAuth: true } },
    { path: '/contracts/concessions-preview', name: 'concessions-preview', component: ConcessionsPreviewView, meta: { requiresAuth: true } },
    {
      path: '/login',
      name: 'login',
      component: LoginView,
    },
    {
      path: '/task001-preview',
      name: 'task001-preview',
      component: HomeView,
    },
  ]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach(async (to) => {
  const session = useSessionStore()
  await session.restore()
  return resolveRouteAccess(to, session)
})
