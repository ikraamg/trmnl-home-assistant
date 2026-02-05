# Brainstorm: BYOS Terminus as Home Assistant Add-on

**Date:** 2026-02-05
**Status:** All Questions Resolved - Ready for Planning
**Participants:** Developer + Claude

---

## What We're Building

A Home Assistant add-on that packages the full **BYOS Terminus** platform (from `byos_hanami`) as a single-container installation. This gives HA users a complete self-hosted TRMNL management platform without needing to run separate docker-compose infrastructure.

### Core Requirements

1. **Full BYOS functionality** - All Terminus features: user management, device provisioning, playlists, scheduling, webhooks, image processing
2. **Single container** - Bundle web app, background worker, PostgreSQL, and Valkey in one HA add-on
3. **S6-Overlay process management** - HA-native init system for service orchestration
4. **CI/CD sync with upstream** - Automated builds when `byos_hanami` updates
5. **Same repository** - Lives in `home-assistant-addons` alongside `trmnl-ha`

### User Experience Goals

- One-click install from HA add-on store
- Ingress support (accessible via HA sidebar)
- Configuration via HA add-on options (no manual ENV editing)
- Data persistence in `/data` volume (survives updates)
- Health monitoring visible in HA

---

## Why This Approach

### Single Mega-Container vs Multiple Add-ons

**Chose:** Single container with s6-overlay managing multiple processes

**Rationale:**
- Simpler user experience (one install, not four)
- Atomic updates (all services update together)
- Easier networking (localhost communication)
- Proven pattern in HA ecosystem (MariaDB, ESPHome do similar)

**Trade-offs accepted:**
- Larger container size (~1GB+)
- Higher memory footprint (recommend 2GB+ RAM)
- All-or-nothing updates (can't update just postgres)

### S6-Overlay vs Supervisord

**Chose:** S6-overlay

**Rationale:**
- HA ecosystem standard (official add-ons use it)
- Native bashio integration for HA config access
- Strong service dependency handling (postgres before puma)
- Built-in logging patterns
- Community familiarity

**Trade-offs accepted:**
- Steeper initial learning curve
- Directory-based config vs simple INI files

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Process manager | S6-overlay | HA ecosystem alignment, bashio integration |
| Database | PostgreSQL (bundled) | Required by Terminus, embedded in container |
| Cache | Valkey (bundled) | Required for Sidekiq, embedded in container |
| Data location | `/data` volume | Standard HA add-on pattern, survives updates |
| Ingress | Enabled | Sidebar access without port exposure |
| Repository | Same as trmnl-ha | Shared CI/CD, single add-on repo |
| Upstream sync | GitHub Actions | Auto-build on byos_hanami releases |

---

## Architecture Overview

```
byos-terminus/
├── config.yaml                    # HA add-on manifest
├── Dockerfile                     # Multi-stage build
├── CHANGELOG.md
├── README.md
└── rootfs/
    └── etc/
        ├── s6-overlay/
        │   └── s6-rc.d/
        │       ├── init-terminus/      # One-shot: DB migrations, setup
        │       ├── postgres/           # Long-run: PostgreSQL
        │       ├── valkey/             # Long-run: Valkey (Redis)
        │       ├── puma/               # Long-run: Web server
        │       ├── sidekiq/            # Long-run: Background jobs
        │       └── user/
        │           └── contents.d/     # Service dependencies
        └── terminus/
            └── config/                 # App configuration templates
```

### Service Startup Order

```
init-terminus (one-shot)
    ↓
postgres → valkey (parallel, long-run)
    ↓
puma + sidekiq (after deps ready)
```

### Data Persistence

| Data Type | Location | Purpose |
|-----------|----------|---------|
| PostgreSQL data | `/data/postgres/` | All application data |
| Valkey data | `/data/valkey/` | Session cache, job queues |
| Uploaded files | `/data/uploads/` | User-uploaded images |
| Logs | `/data/logs/` | Application logs |

---

## Resolved Questions

| Question | Decision | Notes |
|----------|----------|-------|
| **Upstream tracking** | Pin to releases | GitHub Actions triggers on byos_hanami releases only |
| **Resource limits** | RPi4 optimized | 2GB RAM min, tuned postgres/valkey for low memory |
| **SSL/TLS** | HA reverse proxy | Ingress handles SSL, add-on serves HTTP internally |
| **First-run setup** | Web wizard | Use Terminus's existing registration flow on first visit |
| **Backup integration** | Standard /data | HA's built-in backup captures volume, ensure clean shutdown |

### Resource Tuning for RPi4

```yaml
# PostgreSQL (low memory)
shared_buffers: 128MB
work_mem: 4MB
maintenance_work_mem: 64MB
effective_cache_size: 512MB

# Valkey
maxmemory: 128mb
maxmemory-policy: allkeys-lru

# Puma
workers: 2
threads: 2
```

---

## Next Steps

1. Run `/workflows:plan` to create implementation plan
2. Set up Dockerfile with s6-overlay base
3. Create service definitions for each process
4. Configure HA add-on manifest (config.yaml)
5. Set up GitHub Actions for upstream sync

---

## References

- [S6-Overlay Documentation](https://github.com/just-containers/s6-overlay)
- [HA Add-on Development](https://developers.home-assistant.io/docs/add-ons)
- [Official MariaDB Add-on](https://github.com/home-assistant/addons/tree/master/mariadb) (reference for multi-process)
- [Bashio Library](https://github.com/hassio-addons/bashio)
- [byos_hanami Repository](/Users/ikraam/Documents/GitHub/home-assistant/byos_hanami)
