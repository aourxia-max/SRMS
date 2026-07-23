import { createRouter, createWebHistory } from 'vue-router'
import { useSessionStore } from '../stores/session'
import HomeView from '../views/HomeView.vue'
import LoginView from '../views/LoginView.vue'
import UsersView from '../views/UsersView.vue'
import PropertiesView from '../views/PropertiesView.vue'
import TenantsView from '../views/TenantsView.vue'
import ContractsView from '../views/ContractsView.vue'
import ConcessionsPreviewView from '../views/ConcessionsPreviewView.vue'
import ContractChangesView from '../views/ContractChangesView.vue'
import PaymentsView from '../views/PaymentsView.vue'
import PricingRebatesView from '../views/PricingRebatesView.vue'
import CheckoutView from '../views/CheckoutView.vue'
import FinanceView from '../views/FinanceView.vue'
import DashboardView from '../views/DashboardView.vue'
import SystemManagementView from '../views/SystemManagementView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'session',
      component: DashboardView,
      meta: { requiresAuth: true },
    },
    { path: '/admin/users', name: 'users', component: UsersView, meta: { requiresAuth: true } },
    { path: '/admin/system', name: 'system-management', component: SystemManagementView, meta: { requiresAuth: true } },
    { path: '/properties', name: 'properties', component: PropertiesView, meta: { requiresAuth: true } },
    { path: '/tenants', name: 'tenants', component: TenantsView, meta: { requiresAuth: true } },
    { path: '/contracts', name: 'contracts', component: ContractsView, meta: { requiresAuth: true } },
    { path: '/contracts/changes', name: 'contract-changes', component: ContractChangesView, meta: { requiresAuth: true } },
    { path: '/payments', name: 'payments', component: PaymentsView, meta: { requiresAuth: true } },
    { path: '/pricing-rebates', name: 'pricing-rebates', component: PricingRebatesView, meta: { requiresAuth: true } },
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
  ],
})

router.beforeEach(async (to) => {
  const session = useSessionStore()
  await session.restore()
  if (to.meta.requiresAuth && !session.isAuthenticated) return { name: 'login', query: { redirect: to.fullPath } }
  if (to.name === 'login' && session.isAuthenticated) return { name: 'session' }
  return true
})
