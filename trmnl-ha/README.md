# TRMNL HA

Send Home Assistant dashboard screenshots to your TRMNL e-ink display with advanced dithering optimized for e-paper screens.

![TRMNL HA Logo](logo.svg)

## What is it?

TRMNL HA is a Home Assistant add-on that captures screenshots of your dashboards and sends them to TRMNL e-ink displays. It uses advanced dithering algorithms (Floyd-Steinberg, Ordered) via GraphicsMagick to optimize images for e-paper displays.

**Key features:**

- **E-ink optimized dithering** - Multiple algorithms and bit depths for crisp e-paper rendering
- **TRMNL webhook integration** - Upload dashboards to TRMNL devices (via HTTP POST)
- **Scheduled captures** - Cron-based automation with Web UI management
- **Device presets** - Pre-configured settings for popular e-ink displays
- **Crash recovery** - Automatic browser recovery and process supervision
- **High performance** - Powered by Bun runtime for fast startup and low memory usage

## How it works with Home Assistant

The add-on runs inside your Home Assistant instance as a supervised Docker container. It:

1. **Authenticates** using a Home Assistant long-lived access token
2. **Navigates** to your dashboards using headless Chromium
3. **Captures** screenshots with configurable viewport, theme, and wait times
4. **Processes** images with e-ink optimized dithering
5. **Uploads** via webhooks at scheduled times

The add-on persists schedules and configuration in the `/data` directory (mounted by Home Assistant Supervisor).

## Installation

### As a Home Assistant Add-on

1. Add this repository to Home Assistant:
   - Go to **Supervisor** → **Add-on Store** → **⋮** → **Repositories**
   - Add: `https://github.com/usetrmnl/trmnl-home-assistant`

2. Install the **TRMNL HA** add-on

3. Configure your access token (see Configuration below)

4. Start the add-on

### Proxmox Users

If running Home Assistant OS in Proxmox, set the VM host type to `host` for Chromium to work properly.

## Configuration

The add-on requires a Home Assistant long-lived access token:

1. In Home Assistant: **Profile** → **Long-Lived Access Tokens** → **Create Token**
2. Copy the token
3. Add to the add-on configuration:

```yaml
access_token: "your-long-lived-token-here"
```

### Optional Configuration

```yaml
home_assistant_url: "http://homeassistant:8123"  # Override HA URL (for SSL/custom hostname)
keep_browser_open: false                         # Keep browser alive between requests (faster, more memory)
```

**Security:** The add-on web interface (port 10000) has no built-in authentication - it's designed to run on your Home Assistant internal network. Do not expose this port directly to the internet.

## Usage

### Web UI

Access the Web UI to configure and preview screenshots:

- From Home Assistant Supervisor: Click **Open Web UI** on the add-on page
- Or navigate to: `http://homeassistant.local:10000/`

The UI provides:

- Interactive screenshot preview with timing information
- Schedule management (create/edit/delete cron schedules)
- Device preset picker (TRMNL OG, etc.)
- Manual "Send Now" trigger

### API Endpoint

Request any Home Assistant dashboard path with viewport dimensions:

```bash
# Basic screenshot
http://homeassistant.local:10000/lovelace/0?viewport=800x480

# E-ink optimized (recommended)
http://homeassistant.local:10000/lovelace/0?viewport=800x480&dithering&dither_method=floyd-steinberg&bit_depth=2

# With theme
http://homeassistant.local:10000/lovelace/0?viewport=800x480&theme=Graphite%20E-ink%20Light
```

**Key Parameters:**

- `viewport=WxH` - Required. Viewport dimensions (e.g., `800x480`)
- `dithering` - Enable advanced dithering for e-ink
- `dither_method` - `floyd-steinberg` (default), `ordered`, or `none`
- `bit_depth` - `1`, `2`, `4`, or `8` bits per pixel
- `format` - `png` (default), `jpeg`, or `bmp`
- `rotate` - `90`, `180`, or `270` degrees
- `theme` - Home Assistant theme name
- `wait` - Wait time in ms after page load (default: 750ms)
- `zoom` - Page zoom level (default: 1.0)
- `lang` - UI language code (e.g., `nl`)
- `dark` - Enable dark mode

Recommended: Use an e-ink optimized theme like [Graphite](https://github.com/TilmanGriesel/graphite).

### Device Presets

The Web UI includes presets for common e-ink displays.

Select a preset to automatically configure viewport, rotation, dithering, and format settings.

### Scheduled Captures

Use the Web UI to create cron-based schedules.
Schedules are stored in `/data/schedules.json` and persist across container restarts.

**Manual trigger:** Click **Send Now** next to any schedule to execute immediately.

## Local Development

For local testing and development, use the Docker helper scripts for validation before deploying to production.
It is however, more convenient to navigate to the `ha-trmnl` directory and run the Bun scripts directly.

**Requirements**: [Bun](https://bun.sh) 1.3.5 or later

```bash
cd trmnl-ha/ha-trmnl
bun install
bun run dev
```

### Quick Start

```bash
./scripts/docker-build.sh    # Build Docker image
./scripts/docker-run.sh       # Run container with volume mount
./scripts/docker-health.sh    # Check health status
./scripts/docker-logs.sh      # View logs
./scripts/docker-rebuild.sh   # Stop → Remove → Build → Run
./scripts/docker-stop.sh      # Stop container
```

### Configuration for Local Dev

1. Copy `options-dev.json.sample` to `options-dev.json`
2. Add your Home Assistant URL and access token
3. Run `./scripts/docker-run.sh`

**Data persistence:** Schedules and configuration persist in `/tmp/trmnl-data/` across container rebuilds.

**Log rotation:** Built-in log rotation (10MB max, 7 files retention, gzip compression).

### Development Commands

```bash
bun run dev              # Development mode with hot reload
bun run main.js          # Production mode
bun test                 # Run all tests
bun test --coverage      # Tests with coverage
bun run lint             # ESLint
```

### Health Monitoring

Check system health:

```bash
curl http://localhost:10000/health | jq
```

Response:
```json
{
  "status": "ok",
  "uptime": 3600,
  "browser": {
    "healthy": true,
    "consecutiveFailures": 0,
    "totalRecoveries": 0
  }
}
```

## Recommended Setup

For best e-ink results:

1. **Use an e-ink optimized theme** - [Graphite](https://github.com/TilmanGriesel/graphite) is recommended
2. **Enable dithering** - `dithering&dither_method=floyd-steinberg&bit_depth=2`
3. **Set proper viewport** - Match your display dimensions
4. **Adjust wait time** - Increase if icons/images don't load: `wait=2000`

## Attribution

This project is based on the [puppet](https://github.com/balloob/home-assistant-addons/tree/main/puppet) Home Assistant add-on by [Paulus Schoutsen](https://github.com/balloob).

**Upstream Project:** https://github.com/balloob/home-assistant-addons

**Major Enhancements in TRMNL HA:**

- **Runtime Migration:** Migrated from Node.js to Bun for improved performance
- **Image Processing Rewrite:** Replaced Sharp with GraphicsMagick, implementing strategy pattern for dithering algorithms
- **Scheduler System:** Added cron-based automation with Web UI management and webhook integration
- **Browser Health & Recovery:** Automatic crash detection and two-stage recovery system
- **Process Supervision:** Built-in log rotation and memory monitoring with automatic restart
- **Comprehensive Testing:** 90%+ test coverage with unit and integration tests
- **Expanded Device Support:** Grew from 1 to 38+ device presets

See the [NOTICE](../NOTICE) file for complete attribution and modification details.

## License

Copyright (c) Paulus Schoutsen (original work)
Copyright (c) 2024-2025 TRMNL (enhancements and modifications)

Licensed under the [Apache License 2.0](../LICENSE)

## Links

- [TRMNL](https://usetrmnl.com)
- [Upstream Project (puppet)](https://github.com/balloob/home-assistant-addons)
