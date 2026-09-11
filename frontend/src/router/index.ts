import { createRouter, createWebHistory, START_LOCATION, type RouteRecordRaw, type Router } from 'vue-router'
import { cancelPendingReadRequests } from '../services/navigation-read-requests'
import { useSessionStore } from '../stores/session'
const HomeView = () => import('../views/HomeView.vue')
const LoginView = () => import('../views/LoginView.vue')
const UsersView = () => import('../views/UsersView.vue')
const PropertiesView = () => import('../views/PropertiesView.vue')
const TenantsView = () => import('../views/TenantsView.vue')
const TenantDetailView = () => import('../views/TenantDetailView.vue')
const ContractsView = () => import('../views/ContractsView.vue')
const ConcessionsPreviewView = () => import('../views/ConcessionsPreviewView.vue')
const ContractChangesView = () => import('../views/ContractChangesView.vue')
const PaymentCollectView = () => import('../views/payments/PaymentCollectView.vue')
const PaymentDetailView = () => import('../views/payments/PaymentDetailView.vue')
const PaymentReviewsView = () => import('../views/payments/PaymentReviewsView.vue')
const CheckoutView = () => import('../views/CheckoutView.vue')
const FinanceView = () => import('../views/FinanceView.vue')
const DashboardView = () => import('../views/DashboardView.vue')
const SystemManagementView = () => import('../views/SystemManagementView.vue')
const RoomDetailView = () => import('../views/RoomDetailView.vue')
const RentBillsView = () => import('../views/RentBillsView.vue')
const PropertyAffairsView = () => import('../views/PropertyAffairsView.vue')
const PropertyAffairFormView = () => import('../views/PropertyAffairFormView.vue')
const PropertyAffairDetailView = () => import('../views/PropertyAffairDetailView.vue')

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
    { path: '/tenants/:id', name: 'tenant-detail', component: TenantDetailView, meta: { requiresAuth: true, roles: ['SUPER_ADMIN', 'ADMIN'] } },
    { path: '/contracts', name: 'contracts', component: ContractsView, meta: { requiresAuth: true } },
    { path: '/property-affairs', name: 'property-affairs', component: PropertyAffairsView, meta: { requiresAuth: true, roles: ['SUPER_ADMIN', 'ADMIN'] } },
    { path: '/property-affairs/new', name: 'property-affair-create', component: PropertyAffairFormView, meta: { requiresAuth: true, roles: ['SUPER_ADMIN', 'ADMIN'] } },
    { path: '/property-affairs/recycle-bin', name: 'property-affairs-recycle-bin', component: PropertyAffairsView, meta: { requiresAuth: true, roles: ['SUPER_ADMIN', 'ADMIN'] } },
    { path: '/property-affairs/:id', name: 'property-affair-detail', component: PropertyAffairDetailView, meta: { requiresAuth: true, roles: ['SUPER_ADMIN', 'ADMIN'] } },
    { path: '/property-affairs/:id/edit', name: 'property-affair-edit', component: PropertyAffairFormView, meta: { requiresAuth: true, roles: ['SUPER_ADMIN', 'ADMIN'] } },
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

export function installNavigationRequestCleanup(targetRouter: Router) {
  targetRouter.afterEach((to, from, failure) => {
    const leftRenderedPage = from !== START_LOCATION && from.matched.length > 0
    if (!failure && leftRenderedPage && to.fullPath !== from.fullPath) cancelPendingReadRequests()
  })
}

installNavigationRequestCleanup(router)

router.beforeEach(async (to) => {
  const session = useSessionStore()
  await session.restore()
  return resolveRouteAccess(to, session)
})
