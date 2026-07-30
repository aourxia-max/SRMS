# SRMS Production Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy SRMS to `www.hetfw.cn` with HTTPS, internal-only database/API networking, and the approved ICP footer.

**Architecture:** Docker Compose runs MySQL, API and the static web application on a private network. Caddy is the sole public entry point, redirects the apex domain to `www`, terminates TLS and proxies web/API traffic. Production secrets are generated only on the server.

**Tech Stack:** Vue 3, NestJS, MySQL 8.4, Docker Compose, Caddy, GitHub, Tencent Cloud Lighthouse.

## Global Constraints

- Preserve frozen SRMS business requirements and data structures.
- Do not commit production passwords, tokens, private keys, uploads, database data or backups.
- Expose only SSH, HTTP and HTTPS publicly.
- Show `琼ICP备2026011136号-1` in the website footer, linking to `https://beian.miit.gov.cn/`.
- Canonical public address is `https://www.hetfw.cn`; `https://hetfw.cn` redirects to it.

---

### Task 1: Add the ICP footer and production reverse-proxy assets

**Files:**
- Modify: `frontend/src/App.vue`
- Create: `deploy/Caddyfile`
- Create: `deploy/docker-compose.production.yml`
- Modify: `deploy/.env.example`

**Interfaces:**
- Produces Caddy routes for `www.hetfw.cn`, `hetfw.cn`, `/api/*` and the web service.
- Produces the `.icp-footer` page element with the approved filing number.

- [ ] **Step 1: Add a footer after the application router view**

```vue
<footer v-if="!isPublicPage" class="icp-footer">
  <a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">琼ICP备2026011136号-1</a>
</footer>
```

- [ ] **Step 2: Add responsive footer CSS and run the frontend build**

Run: `npm --prefix frontend run build`
Expected: exit code 0.

- [ ] **Step 3: Create Caddy configuration**

```caddy
hetfw.cn { redir https://www.hetfw.cn{uri} permanent }
www.hetfw.cn {
  encode zstd gzip
  reverse_proxy web:80
}
```

- [ ] **Step 4: Create the production Compose override**

The override removes public `mysql`, `api` and `web` ports, adds a `caddy` service exposing `80:80` and `443:443`, and persists `/data` and `/config` in named volumes.

- [ ] **Step 5: Verify composition and commit**

Run: `docker compose --env-file deploy/.env -f deploy/docker-compose.yml -f deploy/docker-compose.production.yml config --quiet`

Commit: `git commit -m "feat: add production HTTPS deployment assets"`

### Task 2: Prepare the server and deploy the tagged source

**Files:**
- Create on server: `/opt/srms/deploy/.env`
- Create on server: `/opt/srms/deploy/production.env`

**Interfaces:**
- Consumes repository `main` and the Docker Compose production files from Task 1.
- Produces healthy `mysql`, `api`, `web`, and `caddy` containers.

- [ ] **Step 1: Install Docker Engine and Compose plugin using Ubuntu packages**

Run remotely: `sudo apt-get update && sudo apt-get install -y ca-certificates curl git docker.io docker-compose-v2`

- [ ] **Step 2: Create `/opt/srms`, clone the GitHub repository, and check out `main`**

Run remotely: `sudo git clone https://github.com/aourxia-max/SRMS.git /opt/srms`

- [ ] **Step 3: Generate production-only database, JWT and tenant-encryption secrets on the server**

Store them in `/opt/srms/deploy/.env` with owner-only permissions. Set `MYSQL_PORT`, `API_PORT` and `WEB_PORT` only in local development; leave them absent in production.

- [ ] **Step 4: Configure initial administrator settings privately on the server**

Set `INITIAL_SUPER_ADMIN_*` in the production environment file. Never echo their values or commit them.

- [ ] **Step 5: Start the stack and wait for API health**

Run remotely: `sudo docker compose --project-name srms_prod --env-file deploy/.env -f deploy/docker-compose.yml -f deploy/docker-compose.production.yml up --build -d`

Expected: API health endpoint returns HTTP 200 from within the host.

### Task 3: Configure DNS, firewall, TLS and release verification

**Files:**
- Modify: Cloudflare DNS zone for `hetfw.cn`
- Modify: Tencent Cloud Lighthouse firewall rules

**Interfaces:**
- Consumes the server public IP and Caddy service from Task 2.
- Produces live HTTPS entry points and a verified redirect.

- [ ] **Step 1: Add DNS records**

Create `A` records for `www` and `@` pointing to the Tencent Cloud public IPv4. Keep the records DNS-only until Caddy has issued the certificate.

- [ ] **Step 2: Restrict server firewall**

Allow TCP 22, 80 and 443 only. Remove public exposure of 3306, 3000, 13000, 5173 and 15173.

- [ ] **Step 3: Verify TLS and redirect**

Run: `curl -I https://www.hetfw.cn` and `curl -I https://hetfw.cn`
Expected: HTTP 200 for `www`; HTTP 308/301 from the apex to `www`.

- [ ] **Step 4: Verify production login and session**

Test `POST /api/auth/login`, the refresh-cookie header and `GET /api/auth/me`; do not print credentials or tokens.

- [ ] **Step 5: Run release checks, push source changes and report**

Run: `npm --prefix backend test -- --runInBand`, `npm --prefix backend run test:e2e -- --runInBand`, `npm --prefix backend run lint`, and `npm --prefix frontend run build`.

Commit and push the Task 1 source changes; report live address, tests, remaining compliance action (公安联网备案) and recovery commands.

## Self-Review

- Spec coverage: Tasks 1–3 cover ICP footer, canonical domain, Caddy, private services, secrets, firewall, TLS, health checks and verification.
- Placeholder scan: no unresolved placeholders.
- Consistency: all production service names (`mysql`, `api`, `web`, `caddy`) match the Compose design.
