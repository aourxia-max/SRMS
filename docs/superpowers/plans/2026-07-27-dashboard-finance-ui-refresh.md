# Dashboard Finance UI Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the dashboard and finance center UI to match the supplied SRMS prototypes while preserving existing backend business rules and data contracts.

**Architecture:** Keep the change in the Vue view layer. `DashboardView.vue` renders the operating cockpit from `/dashboard` and `/properties/buildings`; `FinanceView.vue` renders finance summaries from the existing finance, commission, contract, and export-task endpoints.

**Tech Stack:** Vue 3, TypeScript, Element Plus, existing Axios service, existing Vue Router.

## Global Constraints

- Do not change backend calculation rules, database schema, or frozen business process.
- Do not introduce fake business data in UI totals.
- Keep date picker locale Chinese through the existing Element Plus locale setup.
- Use existing API responses and existing role/session behavior.

---

### Task 1: Dashboard Cockpit Layout

**Files:**
- Modify: `frontend/src/views/DashboardView.vue`

**Interfaces:**
- Consumes: `GET /dashboard`, `GET /properties/buildings`
- Produces: Prototype-style cockpit UI with metrics, room status map, todo panel, reminders, arrears, expiring contracts, and vacancy warning.

- [ ] Replace the current stacked card layout with the prototype-inspired cockpit grid.
- [ ] Add room status filtering without changing API behavior.
- [ ] Add formatting helpers for money, dates, status labels, and grouped room floors.
- [ ] Verify with frontend build.

### Task 2: Finance Center Layout

**Files:**
- Modify: `frontend/src/views/FinanceView.vue`

**Interfaces:**
- Consumes: existing finance, commission, contract, and export-task endpoints.
- Produces: Prototype-style finance center with KPI cards, compact filters, report tabs, export task panel, cash-flow table, rent collection table, and commission ledger.

- [ ] Replace the current stacked finance page with high-density sections.
- [ ] Preserve export task creation and download behavior.
- [ ] Preserve commission create/delete behavior.
- [ ] Verify with frontend build.
