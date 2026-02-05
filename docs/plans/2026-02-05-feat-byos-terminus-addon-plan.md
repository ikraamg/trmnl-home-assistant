---
title: "feat: BYOS Terminus Home Assistant Add-on"
type: feat
date: 2026-02-05
brainstorm: docs/brainstorms/2026-02-05-byos-terminus-addon-brainstorm.md
deepened: 2026-02-05
---

# feat: BYOS Terminus Home Assistant Add-on

## Enhancement Summary

**Deepened on:** 2026-02-05
**Research agents used:** 10 (s6-overlay, HA add-ons, architecture, security, performance, simplicity, data integrity, deployment, PostgreSQL tuning, Valkey tuning)

### Key Improvements from Research

1. **Simplified service architecture** - Reduced from 8 to 4 s6-rc services by merging readiness checks
2. **Critical security fix** - First-user registration token to prevent unauthorized admin takeover
3. **PostgreSQL tuning** - Complete low-memory config with `synchronous_commit=off` for SD card longevity
4. **Valkey config** - AOF with `everysec`, Unix socket, `noeviction` for Sidekiq safety
5. **Hot backup safety** - Added `pg_backup_start/stop` for consistent backups
6. **Deployment checklist** - Go/No-Go criteria with rollback procedures

### Critical Security Finding

**HIGH RISK:** First-user auto-verification allows network attackers to register before legitimate user. **MUST implement registration token** displayed in HA logs on first boot.

### Memory Budget Validated

| Component | Allocation | Notes |
|-----------|------------|-------|
| PostgreSQL | 350-400MB | shared_buffers=384MB + overhead |
| Valkey | 150MB | 128MB max + overhead |
| Puma | 400-500MB | 2 workers x 200MB |
| Sidekiq | 250-300MB | 1 worker, 3 threads |
| Chromium (Ferrum) | 300MB | When active for screenshots |
| **Total** | ~1.5-1.7GB | Within 2GB budget |

---

## Overview

Package the full BYOS Terminus platform (`byos_hanami`) as a single Home Assistant add-on container. This gives HA users a complete self-hosted TRMNL device management platform without needing separate docker-compose infrastructure.

**Key Challenge:** Bundle 4 services (PostgreSQL, Valkey, Puma, Sidekiq) into one container using s6-overlay process management while maintaining data integrity, proper startup ordering, and graceful shutdown.

## Problem Statement

Currently, running BYOS Terminus requires:
1. Docker Compose knowledge
2. Managing 5 containers (init, web, worker, database, cache)
3. Manual networking and volume configuration
4. No integration with HA's backup/restore system

HA users want one-click installation with sidebar access, automatic backups, and seamless updates.

## Proposed Solution

Create `byos-terminus/` add-on in the existing `home-assistant-addons` repository using:
- **s6-overlay v3** for multi-process management
- **Bundled PostgreSQL 16** with low-memory tuning
- **Bundled Valkey** (Redis fork) for job queues
- **bashio** for HA configuration integration
- **GitHub Actions** for CI/CD synced to upstream releases

## Technical Approach

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  HA Add-on Container                     │
│  ┌─────────────────────────────────────────────────────┐│
│  │                    s6-overlay                        ││
│  │  ┌─────────────┐  ┌─────────────┐                   ││
│  │  │  postgres   │  │   valkey    │  (parallel start) ││
│  │  │  :5432      │  │   :6379     │                   ││
│  │  └──────┬──────┘  └──────┬──────┘                   ││
│  │         │                │                           ││
│  │         └───────┬────────┘                           ││
│  │                 ▼                                    ││
│  │  ┌─────────────────────────────────────────┐        ││
│  │  │  init-terminus (one-shot)               │        ││
│  │  │  - DB migrations                        │        ││
│  │  │  - Secret generation (first run)        │        ││
│  │  └─────────────────────────────────────────┘        ││
│  │                 │                                    ││
│  │         ┌───────┴───────┐                           ││
│  │         ▼               ▼                           ││
│  │  ┌─────────────┐  ┌─────────────┐                   ││
│  │  │    puma     │  │  sidekiq    │  (parallel start) ││
│  │  │   :2300     │  │  (worker)   │                   ││
│  │  └─────────────┘  └─────────────┘                   ││
│  └─────────────────────────────────────────────────────┘│
│                         │                               │
│  Ports: 2300 (API/UI)   │   Volume: /data              │
└─────────────────────────┼───────────────────────────────┘
                          │
            ┌─────────────┴─────────────┐
            ▼                           ▼
    HA Ingress (UI)            TRMNL Devices (API)
    (sidebar access)           (direct port 2300)
```

### Directory Structure (Simplified)

**Research insight:** Reduced from 8 to 4 s6-rc services by using `s6-notifyoncheck` for readiness instead of separate `-ready` services.

```
byos-terminus/
├── config.yaml                     # HA add-on manifest
├── Dockerfile                      # Multi-stage build
├── CHANGELOG.md
├── DOCS.md                         # User documentation
├── README.md
├── apparmor.txt                    # Security profile
├── .dockerignore
└── rootfs/
    ├── etc/
    │   ├── s6-overlay/
    │   │   └── s6-rc.d/
    │   │       ├── postgres/           # Long-run: PostgreSQL 16
    │   │       │   ├── type            # "longrun"
    │   │       │   ├── run             # s6-notifyoncheck with pg_isready
    │   │       │   ├── finish          # Graceful shutdown
    │   │       │   ├── notification-fd # "3"
    │   │       │   ├── timeout-up      # "30000"
    │   │       │   └── data/
    │   │       │       └── check       # pg_isready health check
    │   │       ├── valkey/             # Long-run: Valkey (Redis)
    │   │       │   ├── type
    │   │       │   ├── run             # s6-notifyoncheck with redis-cli ping
    │   │       │   ├── finish
    │   │       │   ├── notification-fd
    │   │       │   └── data/
    │   │       │       └── check       # valkey-cli ping
    │   │       ├── puma/               # Long-run: Web server
    │   │       │   ├── type
    │   │       │   ├── run             # Includes DB migrations inline
    │   │       │   ├── finish
    │   │       │   └── dependencies.d/
    │   │       │       ├── postgres
    │   │       │       └── valkey
    │   │       ├── sidekiq/            # Long-run: Background jobs
    │   │       │   ├── type
    │   │       │   ├── run
    │   │       │   ├── finish
    │   │       │   └── dependencies.d/
    │   │       │       ├── postgres
    │   │       │       └── valkey
    │   │       └── user/
    │   │           └── contents.d/
    │   │               ├── postgres
    │   │               ├── valkey
    │   │               ├── puma
    │   │               └── sidekiq
    │   ├── cont-init.d/
    │   │   ├── 00-banner.sh            # Startup banner with version
    │   │   └── 01-init-data.sh         # Create /data dirs, generate secrets
    │   ├── terminus/
    │   │   ├── postgresql.conf         # Low-memory postgres config
    │   │   └── valkey.conf             # Valkey config (AOF, noeviction)
    │   └── services.d/                 # (legacy, if needed)
    └── usr/
        └── local/
            └── bin/
                ├── healthcheck.sh      # Combined health check
                ├── backup-pre.sh       # pg_backup_start + BGSAVE
                └── backup-post.sh      # pg_backup_stop
```

### Implementation Phases (Simplified)

From simplicity review - merged phases for faster shipping.

#### Phase 1: MVP (Working Add-on)

**Goal:** Complete working add-on with all core functionality. Ship first, optimize later.

**Tasks:**

- [x] **1.1 Create add-on scaffold** (`byos-terminus/`)
  - Copy structure from trmnl-ha as reference
  - Create `config.yaml` with backup hooks (see Appendix B)
  - Create `.dockerignore`
  - Add to `repository.json`

- [x] **1.2 Create multi-stage Dockerfile**
  - Stage 1: Build s6-overlay base with PostgreSQL 16 + Valkey
  - Stage 2: Ruby 3.3 with bundled gems (from byos_hanami)
  - Stage 3: Production runtime image
  - Target architectures: amd64, aarch64
  - Use STOPSIGNAL SIGINT for PostgreSQL

- [x] **1.3 Implement s6-rc services (4 total)**
  - `postgres`: With `s6-notifyoncheck` and `data/check` for readiness
  - `valkey`: With `s6-notifyoncheck` and `data/check` for readiness
  - `puma`: Depends on postgres + valkey, runs migrations inline
  - `sidekiq`: Depends on postgres + valkey

- [x] **1.4 Implement cont-init.d scripts**
  - `00-banner.sh`: Version display
  - `01-init-data.sh`: Create dirs, generate secrets, **registration token**

- [x] **1.5 Security: First-user registration token**
  - Generate token on first run, display in HA logs
  - App validates token for first registration
  - Token deleted after first user created

- [x] **1.6 Add configuration files**
  - `postgresql.conf` (see Appendix A.1)
  - `valkey.conf` (see Appendix A.2)

- [x] **1.7 Add backup scripts**
  - `backup-pre.sh` with `pg_backup_start` (see Appendix A.5)
  - `backup-post.sh` with `pg_backup_stop`

- [x] **1.8 Add health check**
  - `healthcheck.sh` (see Appendix A.6)
  - Configure `watchdog` in config.yaml

- [ ] **1.9 Integration testing**
  - Fresh install flow (token, DB init, migrations, first user)
  - Restart flow (data persistence)
  - Backup/restore cycle
  - Test on aarch64 (RPi4 emulation)

**Success criteria:** One-click install works, first user can register with token, devices connect.

**Files to create:**
- `byos-terminus/config.yaml`
- `byos-terminus/Dockerfile`
- `byos-terminus/.dockerignore`
- `byos-terminus/rootfs/etc/s6-overlay/s6-rc.d/postgres/*`
- `byos-terminus/rootfs/etc/s6-overlay/s6-rc.d/valkey/*`
- `byos-terminus/rootfs/etc/s6-overlay/s6-rc.d/puma/*`
- `byos-terminus/rootfs/etc/s6-overlay/s6-rc.d/sidekiq/*`
- `byos-terminus/rootfs/etc/cont-init.d/00-banner.sh`
- `byos-terminus/rootfs/etc/cont-init.d/01-init-data.sh`
- `byos-terminus/rootfs/etc/terminus/postgresql.conf`
- `byos-terminus/rootfs/etc/terminus/valkey.conf`
- `byos-terminus/rootfs/usr/local/bin/healthcheck.sh`
- `byos-terminus/rootfs/usr/local/bin/backup-pre.sh`
- `byos-terminus/rootfs/usr/local/bin/backup-post.sh`

**Estimated effort:** 5-7 days (combined from original phases 1-3)

---

#### Phase 2: CI/CD and Release

**Goal:** Automated builds synced with upstream releases.

From simplicity review - single workflow instead of three.

**Tasks:**

- [x] **2.1 Create single GitHub Actions workflow**
  - Trigger on push to main AND byos_hanami releases
  - Multi-arch build (amd64, aarch64)
  - Push to GHCR
  - Add `bundle audit` for security scanning

- [x] **2.2 Version synchronization**
  - Extract version from upstream release tag
  - Update add-on version automatically

- [x] **2.3 Documentation**
  - README.md with feature overview
  - DOCS.md with detailed setup guide (including security warning about port 2300)
  - CHANGELOG.md

**Success criteria:** Push to main triggers build, new upstream release triggers add-on update.

**Files to create:**
- `.github/workflows/byos-terminus.yml` (single combined workflow)
- `byos-terminus/README.md`
- `byos-terminus/DOCS.md`
- `byos-terminus/CHANGELOG.md`

**Estimated effort:** 1-2 days

---

### Total Estimated Effort (Simplified)

| Phase | Original Estimate | Simplified Estimate |
|-------|-------------------|---------------------|
| Phase 1: MVP | 7-10 days (phases 1-3) | **5-7 days** |
| Phase 2: CI/CD | 1-2 days | **1-2 days** |
| **Total** | **8-12 days** | **6-9 days** |

**Key simplifications:**
- Merged 8 services → 4 services
- Merged 3 phases → 2 phases
- Merged 3 CI workflows → 1 workflow
- Deferred advanced features until user feedback

---

## Alternative Approaches Considered

### 1. Separate Add-ons for Each Service

**Approach:** Create `terminus-db`, `terminus-cache`, `terminus-app` as independent add-ons.

**Pros:**
- Cleaner separation of concerns
- Independent scaling/updates
- Users could use existing HA PostgreSQL add-on

**Cons:**
- Complex user setup (install 3-4 add-ons)
- Cross-add-on networking complexity
- Version compatibility matrix nightmare

**Rejected because:** User experience is paramount. One-click install wins.

### 2. Supervisord Instead of s6-overlay

**Approach:** Use supervisord (Python-based) for process management.

**Pros:**
- Simpler INI-based configuration
- More familiar to general Docker users

**Cons:**
- Not HA ecosystem standard
- No native bashio integration
- Weaker dependency handling

**Rejected because:** s6-overlay is the HA standard, and we want native integration.

### 3. External Database Requirement

**Approach:** Require users to run separate PostgreSQL (e.g., HA MariaDB add-on or external).

**Pros:**
- Smaller container
- Database can be shared with other apps

**Cons:**
- MariaDB is not PostgreSQL (Terminus requires PostgreSQL)
- No official HA PostgreSQL add-on
- User must manage connection strings

**Rejected because:** No good PostgreSQL option in HA ecosystem; bundling is simpler.

## Acceptance Criteria

### Functional Requirements

- [ ] Fresh installation completes in under 5 minutes
- [ ] Web UI accessible via HA sidebar (Ingress)
- [ ] TRMNL devices can connect via direct port 2300
- [ ] First user registration works (auto-verified)
- [ ] Background jobs process (Sidekiq functional)
- [ ] Container survives restart with data intact
- [ ] HA backup captures all data
- [ ] HA restore restores functional state
- [ ] Upgrade from vX to vY runs migrations automatically

### Non-Functional Requirements

- [ ] Memory usage under 2GB on idle RPi4
- [ ] Container image under 1.5GB compressed
- [ ] Cold start time under 60 seconds
- [ ] Health check responds within 3 seconds
- [ ] Graceful shutdown completes within 15 seconds

### Quality Gates

- [ ] CI passes (lint, build, health check)
- [ ] Multi-arch builds succeed (amd64, aarch64)
- [ ] Tested on actual RPi4 4GB hardware
- [ ] Documentation complete (DOCS.md)
- [ ] CHANGELOG updated

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Installation success rate | > 95% | GitHub issues tagged "install-failure" |
| Memory usage (idle) | < 1.5GB | `docker stats` on RPi4 |
| Backup/restore reliability | 100% | Manual testing + user reports |
| Upstream sync latency | < 48 hours | Time from upstream release to add-on release |

## Dependencies & Prerequisites

### Technical Dependencies

- s6-overlay v3.x
- PostgreSQL 16.x
- Valkey 9.x (Redis 7 compatible)
- Ruby 3.3.x
- bashio library
- HA Supervisor API

### External Dependencies

- `byos_hanami` repository releases
- GHCR for container registry
- GitHub Actions for CI/CD

### Blocking Issues

None identified.

## Risk Analysis & Mitigation (Enhanced)

From security and architecture reviews:

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **First-user hijacking** | Medium | **CRITICAL** | Registration token displayed in HA logs |
| PostgreSQL OOM on RPi4 2GB | Medium | High | Memory tuning (384MB shared_buffers), 4GB min requirement |
| Upstream breaking changes | Medium | Medium | Pin to releases, delay sync 24h for stability |
| Migration failure corrupts data | Low | Critical | Pre-migration backup + lock file, transaction wrapping |
| Hot backup inconsistency | Medium | High | Use `pg_backup_start/stop`, not just CHECKPOINT |
| SD card wear | Medium | Medium | `synchronous_commit=off`, AOF everysec, disable RDB |
| s6-overlay learning curve | Medium | Low | Use official add-ons as reference, use s6-notifyoncheck |
| Container image too large | Low | Medium | Multi-stage build, target <1.5GB |

## Resource Requirements

### Development

- 1 developer, 2-3 weeks
- Access to RPi4 4GB for testing
- GHCR write access

### Infrastructure

- GitHub Actions minutes (CI/CD)
- GHCR storage (~2GB per multi-arch release)

## Future Considerations

### Potential Enhancements

- SQLite mode for low-resource environments
- Prometheus metrics export
- HA entity integration (device count, job queue length)
- Automatic SSL certificate generation

### Not In Scope

- Multi-instance support
- Horizontal scaling
- External database support
- Custom plugin installation

## Documentation Plan

| Document | Purpose | Priority |
|----------|---------|----------|
| README.md | Quick start, features | P0 |
| DOCS.md | Full setup guide, troubleshooting | P0 |
| CHANGELOG.md | Version history | P0 |
| Architecture diagram | Developer reference | P1 |

## References & Research

### Internal References

- trmnl-ha config.yaml: `trmnl-ha/config.yaml`
- trmnl-ha Dockerfile: `trmnl-ha/Dockerfile`
- CI workflow: `.github/workflows/ci.yml`
- Release workflow: `.github/workflows/release.yml`

### External References

- [s6-overlay Documentation](https://github.com/just-containers/s6-overlay)
- [HA Add-on Development](https://developers.home-assistant.io/docs/add-ons)
- [Official MariaDB Add-on](https://github.com/home-assistant/addons/tree/master/mariadb) (multi-process reference)
- [bashio Library](https://github.com/hassio-addons/bashio)
- [byos_hanami Repository](https://github.com/usetrmnl/byos_hanami)

### Related Work

- Brainstorm: `docs/brainstorms/2026-02-05-byos-terminus-addon-brainstorm.md`

---

## Appendix A: Research-Enhanced Configurations

### A.1 PostgreSQL 16 Configuration (RPi4 Optimized)

From performance research - complete low-memory config for SD card longevity:

```conf
# postgresql.conf - RPi4 2GB container budget

# Memory (350-400MB total footprint)
shared_buffers = 384MB
work_mem = 4MB
maintenance_work_mem = 64MB
effective_cache_size = 1GB
huge_pages = off
max_connections = 20

# WAL - Minimize SD card writes
wal_level = minimal
max_wal_senders = 0
wal_compression = zstd
synchronous_commit = off          # Trade durability for SD lifespan
commit_delay = 10000
wal_buffers = 12MB
max_wal_size = 256MB
min_wal_size = 64MB
checkpoint_timeout = 15min
checkpoint_completion_target = 0.9

# Autovacuum - Gentle on resources
autovacuum_max_workers = 2
autovacuum_naptime = 1min
autovacuum_vacuum_cost_delay = 20ms
autovacuum_vacuum_cost_limit = 200

# Query planner - SD card aware
random_page_cost = 2.0
effective_io_concurrency = 1
```

### A.2 Valkey Configuration (Sidekiq-Safe)

From Valkey research - AOF persistence with noeviction for job queue safety:

```conf
# valkey.conf - Sidekiq job queue

# Unix socket (50% faster than TCP localhost)
unixsocket /var/run/valkey/valkey.sock
unixsocketperm 770
port 0

# Memory - CRITICAL: noeviction for Sidekiq
maxmemory 128mb
maxmemory-policy noeviction

# Persistence - AOF only, SD-friendly
appendonly yes
appendfsync everysec
no-appendfsync-on-rewrite yes
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 32mb
aof-use-rdb-preamble yes
save ""                            # Disable RDB snapshots

# Shutdown
shutdown-timeout 10
shutdown-on-sigterm save
```

### A.3 s6-rc Service Example (PostgreSQL with Readiness)

From s6-overlay research - use `s6-notifyoncheck` instead of separate ready services:

```bash
#!/command/execlineb -P
# /etc/s6-overlay/s6-rc.d/postgres/run

with-contenv
fdmove -c 2 1

# Use s6-notifyoncheck for readiness (PostgreSQL doesn't support notification-fd natively)
s6-notifyoncheck -d -n 60 -s 1000 -w 2000

s6-setuidgid postgres
exec postgres -D /var/lib/postgresql/data
```

```bash
#!/bin/bash
# /etc/s6-overlay/s6-rc.d/postgres/data/check
exec pg_isready -h localhost -U postgres -q
```

### A.4 First-User Security Token

From security research - **CRITICAL** to prevent unauthorized admin registration:

```bash
#!/bin/bash
# /etc/cont-init.d/01-init-data.sh

# Generate first-user registration token
if [ ! -f /data/.initialized ]; then
    ADMIN_TOKEN=$(head -c 16 /dev/urandom | xxd -p)
    echo "$ADMIN_TOKEN" > /data/.admin_token
    chmod 600 /data/.admin_token

    bashio::log.info "=========================================="
    bashio::log.info "FIRST-RUN SETUP"
    bashio::log.info "Registration token: $ADMIN_TOKEN"
    bashio::log.info "Use this at: http://[HOST]:2300/register?token=$ADMIN_TOKEN"
    bashio::log.info "Token expires after first user registration."
    bashio::log.info "=========================================="
fi
```

### A.5 Hot Backup Scripts (Data Integrity Safe)

From data integrity research - must use `pg_backup_start/stop`:

```bash
#!/bin/bash
# /usr/local/bin/backup-pre.sh

exec &> /proc/1/fd/1
bashio::log.info "Starting hot backup preparation..."

# 1. PostgreSQL backup mode
psql -U postgres -c "SELECT pg_backup_start('ha_backup', fast => true)"

# 2. Valkey persistence flush
valkey-cli -s /var/run/valkey/valkey.sock BGSAVE
LAST_SAVE=$(valkey-cli -s /var/run/valkey/valkey.sock LASTSAVE)
while [ "$(valkey-cli -s /var/run/valkey/valkey.sock LASTSAVE)" == "$LAST_SAVE" ]; do
    sleep 0.1
done

bashio::log.info "Backup preparation complete"
```

```bash
#!/bin/bash
# /usr/local/bin/backup-post.sh

exec &> /proc/1/fd/1
bashio::log.info "Completing hot backup..."

# CRITICAL: Must call this or WAL accumulates forever
psql -U postgres -c "SELECT pg_backup_stop()"

bashio::log.info "Backup complete"
```

### A.6 Combined Health Check

From deployment research - check all components:

```bash
#!/bin/bash
# /usr/local/bin/healthcheck.sh

set -e

# PostgreSQL
pg_isready -U postgres -q || exit 1

# Valkey
valkey-cli -s /var/run/valkey/valkey.sock ping | grep -q PONG || exit 1

# Puma
curl -sf http://localhost:2300/up > /dev/null || exit 1

exit 0
```

---

## Appendix B: config.yaml Draft (Enhanced)

From HA add-on research - added backup hooks and proper schema:

```yaml
name: "BYOS Terminus"
description: "Self-hosted TRMNL device management platform"
version: "0.1.0"
slug: "byos-terminus"
url: "https://github.com/usetrmnl/home-assistant-addons"
arch:
  - amd64
  - aarch64
image: "ghcr.io/usetrmnl/byos-terminus-{arch}"
init: false
homeassistant_api: false
ingress: true
ingress_port: 2300
ingress_stream: true
panel_icon: "mdi:devices"
panel_title: "BYOS Terminus"

ports:
  2300/tcp: 2300
ports_description:
  2300/tcp: "API for TRMNL devices (required for device connectivity)"

watchdog: "http://[HOST]:2300/health"

backup: hot
backup_pre: /usr/local/bin/backup-pre.sh
backup_post: /usr/local/bin/backup-post.sh
backup_exclude:
  - "*/logs/*"

map:
  - share:rw
  - ssl:ro

options:
  timezone: ""
  log_level: "info"
  api_uri: ""

schema:
  timezone: str?
  log_level: list(debug|info|warn|error)?
  api_uri: str?

stage: experimental
```

## Appendix B: Key Environment Variables

| Variable | Source | Default | Purpose |
|----------|--------|---------|---------|
| `HANAMI_ENV` | Hardcoded | `production` | Runtime environment |
| `RACK_ENV` | Hardcoded | `production` | Rack environment |
| `HANAMI_PORT` | Hardcoded | `2300` | Web server port |
| `APP_SECRET` | Generated | (64-char hex) | Session/crypto secret |
| `DATABASE_URL` | Constructed | `postgres://terminus:pass@localhost/terminus` | PostgreSQL connection |
| `REDIS_URL` | Constructed | `redis://localhost:6379/0` | Valkey connection |
| `TZ` | HA options | `UTC` | Timezone |
| `LOG_LEVEL` | HA options | `info` | Log verbosity |
| `API_URI` | HA options | Auto-detect | External API URL for devices |

## Appendix D: Service Dependency Graph (Simplified)

From simplicity review - reduced from 8 to 4 services:

```mermaid
graph TD
    A[cont-init.d<br/>01-init-data.sh] --> B[postgres<br/>s6-notifyoncheck]
    A --> C[valkey<br/>s6-notifyoncheck]
    B --> D[puma<br/>includes migrations]
    C --> D
    B --> E[sidekiq]
    C --> E
```

**Key insight:** `s6-notifyoncheck` eliminates need for separate `-ready` services. Readiness is built into the service definition via `data/check` scripts.

---

## Appendix E: Deployment Go/No-Go Checklist

From deployment verification research:

### GREEN - Proceed

All must be true:

- [ ] `curl -sf http://[HOST]:2300/health` returns HTTP 200
- [ ] `pg_isready -U postgres` returns 0
- [ ] `valkey-cli ping` returns PONG
- [ ] Puma homepage loads in browser
- [ ] Sidekiq has 1+ worker registered
- [ ] No pending database migrations
- [ ] No error logs in last 5 minutes

### RED - Rollback Immediately

Any of these:

- [ ] Health endpoint returns non-200
- [ ] PostgreSQL fails to start
- [ ] Database migration errors
- [ ] Container crash loop (3+ restarts in 5 min)

### Rollback Procedure

```bash
# 1. Stop add-on
ha addons stop local_byos_terminus

# 2. Restore from backup
BACKUP="/backup/terminus-YYYYMMDD"
cp -a "$BACKUP/postgres" /data/postgres
cp -a "$BACKUP/valkey" /data/valkey
cp -a "$BACKUP/uploads" /data/uploads

# 3. Restart
ha addons start local_byos_terminus
```

---

## Appendix F: Security Remediation Roadmap

From security review - prioritized fixes:

### Priority 1 - Before Release (CRITICAL)

| Issue | Fix | Effort |
|-------|-----|--------|
| First-user vulnerability | Registration token in HA logs | 4-8 hours |
| Static DB password | Generate per-installation | 2-4 hours |

### Priority 2 - Before Stable

| Issue | Fix | Effort |
|-------|-----|--------|
| APP_SECRET generation | Use `/dev/urandom` CSPRNG | 1 hour |
| Network exposure docs | Warn against internet exposure | 2 hours |
| Dependency scanning | Add `bundle audit` to CI | 1 hour |
