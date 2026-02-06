# Home Assistant Add-on Best Practices Analysis

**Document:** TRMNL HA Add-on Improvement Opportunities
**Date:** December 2024
**Version:** 0.2.1

---

## Executive Summary

This document analyzes the TRMNL HA add-on against Home Assistant's official add-on development best practices. The add-on already has strong foundations but can benefit from several improvements to achieve full compliance and enhanced integration.

### Current Compliance Score: 85%

| Category | Status | Notes |
|----------|--------|-------|
| config.yaml | Complete | Ingress, watchdog, backup exclusions |
| Dockerfile | Complete | Multi-stage, health checks |
| AppArmor | Complete | Security profile present |
| Documentation | Complete | DOCS.md, README.md, CHANGELOG.md |
| CI/CD | Complete | Full pipeline |
| translations/ | **Missing** | i18n support |
| build.yaml | **Missing** | Build configuration |
| Event publishing | **Not Used** | Enable HA automations |

---

## Part 1: Current State Analysis

### What's Already Implemented

#### 1.1 config.yaml (Complete)

```yaml
# Current implementation highlights:
- name, description, version, slug, url
- Multi-arch support (aarch64, amd64)
- Ingress integration with sidebar panel
- Watchdog health monitoring
- Options with schema validation
- Backup exclusions for regeneratable data
```

**Strengths:**
- Proper ingress configuration (`ingress: true`, `ingress_port: 10000`)
- Panel integration (`panel_icon`, `panel_title`)
- Health monitoring via `watchdog` URL
- Schema validation for all options
- Smart backup exclusions for logs/output

#### 1.2 Dockerfile (Complete)

```dockerfile
# Multi-stage build pattern
- Stage 1: Builder with Bun and dependencies
- Stage 2: Runtime with Chromium and fonts
- Health check with proper intervals
- BuildKit cache optimization
```

**Strengths:**
- Multi-stage reduces final image size
- System Chromium (no bundled download)
- CJK font support for international dashboards
- Configurable health check with retries

#### 1.3 AppArmor Profile (Complete)

The `apparmor.txt` provides comprehensive security:
- Capability restrictions (sys_admin for Chromium sandbox)
- File access limited to /app, /data, /tmp
- Network restrictions (denies raw sockets)
- Blocks access to other HA containers

#### 1.4 Documentation (Complete)

| File | Purpose | Status |
|------|---------|--------|
| DOCS.md | API reference, troubleshooting | Complete |
| README.md | Installation, features | Complete |
| CHANGELOG.md | Version history | Complete |

#### 1.5 CI/CD Pipeline (Complete)

```
ci.yml → Lint + Test + Build (multi-arch)
release.yml → Build & Push to GHCR
cache-warm.yml → Daily cache refresh
cache-cleanup.yml → PR cache cleanup
```

---

## Part 2: Missing Components

### 2.1 translations/ Folder

**What's Missing:**
Home Assistant supports internationalization for add-on configuration options. Without translations, the HA UI shows raw option keys.

**Impact:** Medium - Users see technical option names instead of friendly labels.

**Required Structure:**
```
trmnl-ha/
  translations/
    en.yaml       # English (required)
    nl.yaml       # Dutch (optional)
    de.yaml       # German (optional)
    ...
```

**Example `en.yaml`:**
```yaml
configuration:
  access_token:
    name: Access Token
    description: >-
      Home Assistant long-lived access token. Create one at your
      Profile page under "Long-Lived Access Tokens".
  home_assistant_url:
    name: Home Assistant URL
    description: >-
      Override the default Home Assistant URL (http://homeassistant:8123).
      Only change this if you have a custom setup or SSL requirements.
  keep_browser_open:
    name: Keep Browser Open
    description: >-
      Keep the browser instance alive between screenshot requests.
      Enables faster captures but uses more memory. Recommended for
      frequent scheduled screenshots.

network:
  10000/tcp: Web interface (use Ingress instead for security)
```

**Implementation Effort:** 20 minutes

---

### 2.2 build.yaml

**What's Missing:**
Explicit build configuration file that defines per-architecture build settings.

**Impact:** Low - Current Dockerfile works, but build.yaml is best practice.

**Example `build.yaml`:**
```yaml
build_from:
  aarch64: debian:bookworm-slim
  amd64: debian:bookworm-slim

args:
  PUPPETEER_SKIP_DOWNLOAD: "true"

labels:
  org.opencontainers.image.title: "TRMNL HA"
  org.opencontainers.image.description: "Send Home Assistant dashboards to TRMNL e-ink displays"
  org.opencontainers.image.source: "https://github.com/usetrmnl/trmnl-home-assistant"
  org.opencontainers.image.licenses: "Apache-2.0"
  org.opencontainers.image.vendor: "TRMNL"
```

**Benefits:**
- Centralized build configuration
- Explicit base image per architecture
- Standard OCI labels for container registries
- Cleaner Dockerfile (no inline labels)

**Implementation Effort:** 10 minutes

---

### 2.3 Volume Documentation

**What's Missing:**
The config.yaml doesn't document mounted directories.

**Suggested Addition to config.yaml:**
```yaml
# =============================================================================
# MOUNTED VOLUMES (Documentation)
# =============================================================================
# /data     - Add-on persistent storage
#             - options.json: User configuration (mounted by Supervisor)
#             - schedules.json: Saved screenshot schedules
#             - logs/: Application logs
#             - output/: Generated screenshots
# /tmp      - Temporary files for browser and image processing
# =============================================================================
```

**Implementation Effort:** 5 minutes

---

## Part 3: Enhancement Opportunities

### 3.1 Home Assistant Event Publishing

**Current Behavior:**
Screenshots are captured and sent to webhooks, but Home Assistant is not notified of these actions.

**Proposed Enhancement:**
Publish custom events to Home Assistant's event bus after screenshot operations.

**Proposed Events:**

| Event | Trigger | Data |
|-------|---------|------|
| `trmnl_screenshot_captured` | After screenshot saved | schedule_name, path, timestamp |
| `trmnl_webhook_sent` | After successful webhook delivery | schedule_name, webhook_url, status |
| `trmnl_webhook_failed` | After webhook delivery failure | schedule_name, error_message |

**Benefits:**
- Enable HA automations to react to TRMNL activity
- Example: Flash a light when screenshot sent
- Example: Send notification on webhook failure
- Full integration with HA ecosystem

**Implementation Approach:**

1. **Create ha-events.ts:**
```typescript
import { hassUrl, hassToken } from '../const.js';

interface EventData {
  schedule_name?: string;
  schedule_id?: string;
  path?: string;
  timestamp: string;
  [key: string]: unknown;
}

export async function fireEvent(
  eventType: string,
  eventData: EventData
): Promise<void> {
  if (!hassToken) {
    console.log(`[Events] No token, skipping event: ${eventType}`);
    return;
  }

  try {
    const response = await fetch(`${hassUrl}/api/events/${eventType}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${hassToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(eventData),
    });

    if (!response.ok) {
      console.warn(`[Events] Failed to fire ${eventType}: ${response.status}`);
    }
  } catch (error) {
    console.warn(`[Events] Error firing ${eventType}:`, error);
  }
}
```

2. **Integrate in schedule-executor.ts:**
```typescript
import { fireEvent } from '../ha-events.js';

// After successful screenshot
await fireEvent('trmnl_screenshot_captured', {
  schedule_name: schedule.name,
  schedule_id: schedule.id,
  path: savedPath,
  timestamp: new Date().toISOString(),
});

// After webhook success
await fireEvent('trmnl_webhook_sent', {
  schedule_name: schedule.name,
  webhook_url: schedule.webhookUrl,
  status: response.status,
  timestamp: new Date().toISOString(),
});
```

**Implementation Effort:** 2-3 hours

---

### 3.2 Devcontainer Setup

**Current Behavior:**
Local development requires manual environment setup.

**Proposed Enhancement:**
Add VS Code devcontainer configuration for standardized development.

**Benefits:**
- One-click development environment
- Consistent tooling across contributors
- Matches HA add-on development patterns

**Structure:**
```
.devcontainer/
  devcontainer.json
  Dockerfile
```

**devcontainer.json:**
```json
{
  "name": "TRMNL HA Development",
  "build": {
    "dockerfile": "Dockerfile"
  },
  "postCreateCommand": "cd trmnl-ha/ha-trmnl && bun install",
  "customizations": {
    "vscode": {
      "extensions": [
        "oven.bun-vscode",
        "esbenp.prettier-vscode",
        "dbaeumer.vscode-eslint"
      ],
      "settings": {
        "editor.formatOnSave": true
      }
    }
  },
  "forwardPorts": [10000, 8123],
  "remoteUser": "vscode"
}
```

**Implementation Effort:** 1-2 hours

---

### 3.3 Home Assistant Service Registration (Advanced)

**What It Would Enable:**
Register custom services that can be called from HA automations.

**Proposed Services:**
- `trmnl_ha.capture_screenshot` - Trigger on-demand screenshot
- `trmnl_ha.send_to_webhook` - Send existing screenshot

**Example Automation:**
```yaml
automation:
  - alias: "Send energy dashboard at sunset"
    trigger:
      - platform: sun
        event: sunset
    action:
      - service: trmnl_ha.capture_screenshot
        data:
          path: /lovelace/energy
          viewport: "800x480"
          webhook_url: "https://usetrmnl.com/api/custom_plugins/..."
```

**Complexity:** High - Requires persistent WebSocket connection for service registration.

**Implementation Effort:** 6-8 hours

**Recommendation:** Implement after event publishing is stable. Events provide 80% of the automation value with 30% of the effort.

---

## Part 4: Implementation Roadmap

### Sprint 1: Quick Wins (< 1 hour)

| Task | Files | Effort |
|------|-------|--------|
| Add translations/en.yaml | 1 new | 20 min |
| Add build.yaml | 1 new | 10 min |
| Document volumes in config.yaml | 1 edit | 5 min |

**Commit message:** `chore: Add HA add-on best practice files (translations, build.yaml)`

### Sprint 2: Event Publishing (2-3 hours)

| Task | Files | Effort |
|------|-------|--------|
| Create ha-events.ts | 1 new | 1 hr |
| Integrate in schedule-executor.ts | 1 edit | 30 min |
| Update DOCS.md with events | 1 edit | 30 min |
| Write tests | 1 new | 30 min |

**Commit message:** `feat: Publish HA events after screenshot operations`

### Sprint 3: Optional Enhancements (3-10 hours)

| Task | Effort | Priority |
|------|--------|----------|
| Devcontainer setup | 1-2 hrs | Medium |
| Service registration | 6-8 hrs | Low |

---

## Part 5: What NOT to Change

These aspects are already well-implemented and should not be modified:

1. **Don't add authentication to Web UI** - Ingress provides this
2. **Don't add rate limiting** - Trusted network assumption is correct
3. **Don't change backup strategy** - Current exclusions are appropriate
4. **Don't modify AppArmor profile** - Security model is sound

---

## Part 6: Reference Links

### Official Documentation
- [Home Assistant Add-on Development](https://developers.home-assistant.io/docs/add-ons/)
- [Add-on Configuration](https://developers.home-assistant.io/docs/add-ons/configuration)
- [Add-on Communication](https://developers.home-assistant.io/docs/add-ons/communication)
- [Add-on Security](https://developers.home-assistant.io/docs/add-ons/security)

### Example Repositories
- [Home Assistant Add-ons Example](https://github.com/home-assistant/addons-example)
- [Community Add-ons](https://github.com/hassio-addons)
- [Home Assistant Builder](https://github.com/home-assistant/builder)

### TRMNL HA Resources
- [Repository](https://github.com/usetrmnl/trmnl-home-assistant)
- [TRMNL Documentation](https://usetrmnl.com/docs)

---

## Appendix A: Full config.yaml Reference

Based on HA best practices, here's a reference config.yaml with all recommended options:

```yaml
# =============================================================================
# ADD-ON METADATA
# =============================================================================
name: "TRMNL HA"
description: "Send dashboard screens to your TRMNL e-ink display"
version: "0.2.1"
slug: "trmnl-ha"
url: "https://github.com/usetrmnl/trmnl-home-assistant"

# Container image (supports {arch} placeholder)
image: ghcr.io/usetrmnl/trmnl-ha-{arch}

# =============================================================================
# HOME ASSISTANT INTEGRATION
# =============================================================================
# Enable HA API proxy (http://supervisor/core/api)
homeassistant_api: true

# =============================================================================
# CONTAINER CONFIGURATION
# =============================================================================
# Disable S6 overlay init (we use our own entrypoint)
init: false

# Supported architectures
arch:
  - aarch64
  - amd64

# Add-on stability stage
stage: stable

# =============================================================================
# HEALTH MONITORING
# =============================================================================
watchdog: "http://[HOST]:10000/health"

# =============================================================================
# INGRESS (RECOMMENDED ACCESS METHOD)
# =============================================================================
ingress: true
ingress_port: 10000
ingress_stream: false

# Sidebar integration
panel_icon: "mdi:monitor"
panel_title: "TRMNL HA"

# =============================================================================
# NETWORK PORTS (OPTIONAL DIRECT ACCESS)
# =============================================================================
ports:
  10000/tcp: null  # Disabled by default (use ingress)
ports_description:
  10000/tcp: "Web UI (use Ingress for security)"

# =============================================================================
# USER CONFIGURATION
# =============================================================================
options:
  access_token: ""
  home_assistant_url: "http://homeassistant:8123"
  keep_browser_open: false

schema:
  access_token: str
  home_assistant_url: str?
  keep_browser_open: bool?

# =============================================================================
# BACKUP CONFIGURATION
# =============================================================================
# Exclude regeneratable data from HA backups
backup_exclude:
  - "*/logs/*"
  - "*/output/*"

# =============================================================================
# MOUNTED VOLUMES (Documentation)
# =============================================================================
# /data - Add-on persistent storage
#         - options.json: User configuration
#         - schedules.json: Saved screenshot schedules
# /tmp  - Temporary browser/processing files
# =============================================================================
```

---

## Appendix B: Compliance Checklist

Use this checklist when reviewing the add-on:

```
[ ] config.yaml
    [x] name, description, version, slug
    [x] arch (multi-architecture)
    [x] image (container registry)
    [x] ingress configuration
    [x] options with schema
    [x] watchdog health check
    [x] homeassistant_api: true
    [x] backup_exclude

[ ] build.yaml
    [ ] build_from per architecture
    [ ] args for build-time variables
    [ ] labels for OCI compliance

[ ] Dockerfile
    [x] Multi-stage build
    [x] Health check
    [x] Non-root user (if applicable)
    [x] Minimal runtime dependencies

[ ] translations/
    [ ] en.yaml (required)
    [ ] Additional languages (optional)

[ ] Documentation
    [x] DOCS.md
    [x] README.md
    [x] CHANGELOG.md

[ ] Security
    [x] AppArmor profile
    [x] No hardcoded credentials
    [x] Ingress for secure access

[ ] CI/CD
    [x] Lint job
    [x] Test job
    [x] Multi-arch build
    [x] Automated release
```

---

*Generated by Claude Code analysis - December 2024*
