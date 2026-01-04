# TRMNL HA Documentation

Complete documentation for the TRMNL Home Assistant add-on.

## How It Works

The add-on runs inside your Home Assistant instance as a supervised Docker container. It:

1. **Authenticates** using a Home Assistant long-lived access token
2. **Navigates** to your dashboards using headless Chromium
3. **Captures** screenshots with configurable viewport, theme, and wait times
4. **Processes** images with e-ink optimized dithering via ImageMagick
5. **Uploads** via webhooks at scheduled times

The add-on persists schedules and configuration in the `/data` directory (mounted by Home Assistant Supervisor).

## Standalone Mode

This add-on can capture screenshots from **any website**, not just Home Assistant. Use it to convert any web content to e-ink optimized images.

> **Pull vs Push:** Pull (displays request images on-demand) and Push (scheduled webhooks POST images to displays). See [Pull vs Push Architecture](#pull-vs-push-architecture) for details.

### Quick Start (Docker)

```bash
cd trmnl-ha

# 1. Create configuration
cp ha-trmnl/options-dev.json.example ha-trmnl/options-dev.json
```

Edit `options-dev.json`:
```json
{
  "home_assistant_url": "https://your-website.com",
  "keep_browser_open": true
}
```

> **Note:** Despite the name, `home_assistant_url` is just the base URL and works with any website.
> The `access_token` field is only needed for Home Assistant authentication - omit it for other sites.

```bash
# 2. Build and run (choose one)

# Development mode (hot-reload, logs to terminal)
./ha-trmnl/scripts/docker-dev.sh

# Production mode (runs in background like HA add-on)
./ha-trmnl/scripts/docker-build.sh && ./ha-trmnl/scripts/docker-run.sh
```

```bash
# 3. Capture screenshots
curl "http://localhost:10000/path/to/page?viewport=800x480"
curl "http://localhost:10000/?viewport=800x480&dithering&dither_method=floyd-steinberg"

# Or use the Web UI
open http://localhost:10000/
```

### Quick Start (Bun)

```bash
cd trmnl-ha/ha-trmnl
bun install

# Create and edit configuration
cp options-dev.json.example options-dev.json

# Run
bun run dev
```

### Use Cases

- **Monitoring dashboards** - Grafana, Datadog, custom dashboards
- **Status pages** - Service health, CI/CD pipelines
- **Information displays** - Weather, calendars, news feeds
- **Any public webpage** - Convert any URL to e-ink format

### Authentication Notes

- **Public pages**: No configuration needed beyond the URL
- **Cookie-based auth**: Not currently supported (browser sessions don't persist)
- **Home Assistant**: Use `access_token` field with a long-lived token

## Configuration

### Required Options

| Option | Type | Description |
|--------|------|-------------|
| `access_token` | string | Home Assistant long-lived access token |

Create a token in Home Assistant: **Profile** → **Long-Lived Access Tokens** → **Create Token**

```yaml
access_token: "your-long-lived-token-here"
```

### Optional Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `home_assistant_url` | string | `http://homeassistant:8123` | Override HA URL (for SSL/custom hostname) |
| `keep_browser_open` | bool | `false` | Keep browser alive between requests (faster, more memory) |

```yaml
home_assistant_url: "https://ha.example.com:8123"
keep_browser_open: true
```

## Web UI

Access the Web UI to configure and preview screenshots:

- **Via Ingress (recommended):** Click **Open Web UI** on the add-on page in Home Assistant
- **Direct access (local only):** `http://homeassistant.local:10000/`

The UI provides:

- Interactive screenshot preview with timing information
- Schedule management (create/edit/delete cron schedules)
- Device preset picker (TRMNL OG, etc.)
- Manual "Send Now" trigger

### Home Assistant Mode Toggle

When Home Assistant is connected, a **Home Assistant Mode** toggle appears in the Screenshot settings:

| Mode | Description |
|------|-------------|
| **HA Mode ON** | Captures Home Assistant dashboards with theme, language, and dark mode support |
| **HA Mode OFF** | Captures any URL (generic mode, no HA-specific features) |

This allows you to use the same add-on for both Home Assistant dashboards and external websites. When HA Mode is off, you'll see a **Full URL** input field instead of the dashboard path selector.

## API Reference

### Screenshot Endpoint

Request any Home Assistant dashboard path with viewport dimensions:

```
GET /<dashboard-path>?<parameters>
```

Or capture any URL directly using the `url` parameter:

```
GET /?url=<full-url>&<parameters>
```

### Examples

```bash
# Basic HA screenshot
http://localhost:10000/lovelace/0?viewport=800x480

# E-ink optimized (recommended)
http://localhost:10000/lovelace/0?viewport=800x480&dithering&dither_method=floyd-steinberg

# With theme
http://localhost:10000/lovelace/0?viewport=800x480&theme=Graphite%20E-ink%20Light

# Dark mode with rotation
http://localhost:10000/lovelace/energy?viewport=480x800&rotate=90&dark

# Generic URL (any website)
http://localhost:10000/?url=https://grafana.local/dashboard&viewport=800x480&dithering

# External status page
http://localhost:10000/?url=https://status.github.com&viewport=800x480
```

### Parameters

| Parameter | Required | Values | Description |
|-----------|----------|--------|-------------|
| `viewport` | Yes | `WxH` | Viewport dimensions (e.g., `800x480`) |
| `url` | No | URL | Full URL to capture (overrides dashboard path) |
| `dithering` | No | flag | Enable advanced dithering for e-ink |
| `dither_method` | No | `floyd-steinberg`, `ordered`, `none` | Dithering algorithm (default: `floyd-steinberg`) |
| `palette` | No | `bw`, `gray-4`, `gray-16`, `gray-256` | Color palette for dithering |
| `compression_level` | No | `1-9` | PNG compression level (default: `9`, max compression) |
| `levels_enabled` | No | flag | Enable manual black/white level adjustments |
| `black_level` | No | `0-100` | Black point (requires `levels_enabled`) |
| `white_level` | No | `0-100` | White point (requires `levels_enabled`) |
| `format` | No | `png`, `jpeg`, `bmp` | Output format (default: `png`) |
| `rotate` | No | `90`, `180`, `270` | Rotation in degrees |
| `theme` | No | string | Home Assistant theme name (HA mode only) |
| `wait` | No | number | Wait time in ms after page load (default: `750`) |
| `zoom` | No | number | Page zoom level (default: `1.0`) |
| `lang` | No | string | UI language code (HA mode only) |
| `dark` | No | flag | Enable dark mode (HA mode only) |
| `invert` | No | flag | Invert colors (swap black/white) |

### HA Mode vs Generic Mode

The add-on supports two screenshot modes:

| Mode | Path | Auth | Theme/Lang/Dark |
|------|------|------|-----------------|
| **HA Mode** | `/lovelace/0?viewport=...` | HA token injected | Supported |
| **Generic Mode** | `/?url=https://...&viewport=...` | None (public sites only) | Not applicable |

**HA Mode** (default): Uses the configured Home Assistant URL and token to capture authenticated dashboards with theme, language, and dark mode support.

**Generic Mode**: Uses the `url` parameter to capture any public website. No authentication is injected, so it works with any publicly accessible URL.

#### Pull vs Push Architecture

Both modes support pull and push architectures:

| Architecture | How it works | Example |
|--------------|--------------|---------|
| **Pull** | Display requests image on-demand via HTTP GET | `curl "http://localhost:10000/lovelace/0?viewport=800x480"` |
| **Push** | Add-on captures on schedule and POSTs to webhook | Cron schedule with webhook URL configured |

#### Example: Pull Architecture

Capture an HA dashboard on-demand:
```bash
curl "http://localhost:10000/lovelace/0?viewport=800x480&dithering" --output dashboard.png
```

Capture an external image and convert to e-ink format:
```bash
curl "http://localhost:10000/?url=https://images.unsplash.com/photo-example&viewport=800x480&dithering&dither_method=floyd-steinberg&palette=bw" --output dithered.png
```

Pull is useful for:
- Displays that poll for images (ESPHome, custom e-ink setups)
- One-off image conversions
- Testing dithering settings

## Device Presets

The Web UI includes presets for 24+ common e-ink displays, including:

- TRMNL OG (800x480)
- Waveshare displays (various sizes)
- Generic e-paper panels

Select a preset to automatically configure viewport, rotation, dithering, and format settings optimized for that device.

## Scheduled Captures

Use the Web UI to create cron-based schedules for automatic dashboard captures.

### Schedule Storage

Schedules are stored in `/data/schedules.json` and persist across container restarts.

### Manual Trigger

Click **Send Now** next to any schedule to execute immediately without waiting for the next cron interval.

### Cron Syntax

Standard cron expressions are supported:

```
┌───────────── minute (0-59)
│ ┌───────────── hour (0-23)
│ │ ┌───────────── day of month (1-31)
│ │ │ ┌───────────── month (1-12)
│ │ │ │ ┌───────────── day of week (0-6, Sunday=0)
│ │ │ │ │
* * * * *
```

Examples:
- `*/15 * * * *` - Every 15 minutes
- `0 * * * *` - Every hour
- `0 6-22 * * *` - Every hour from 6 AM to 10 PM
- `0 8,18 * * *` - At 8 AM and 6 PM

## Troubleshooting

### Proxmox VM Settings

If running Home Assistant OS in Proxmox, set the VM host type to `host` for Chromium to work properly. The default `kvm64` CPU type may cause issues with the browser sandbox.

### Chrome Crashes

If the browser crashes repeatedly:

1. Check the add-on logs for error messages
2. Ensure `keep_browser_open: false` to allow automatic recovery
3. Verify sufficient memory is available (recommended: 512MB+ for the add-on)

The add-on includes automatic crash detection and two-stage recovery:
- Stage 1: Restart the browser process
- Stage 2: Full container restart if Stage 1 fails repeatedly

### Image Quality Issues

For best e-ink results:

1. **Use an e-ink optimized theme** - [Graphite](https://github.com/TilmanGriesel/graphite) is recommended
2. **Enable dithering** - Add `dithering&dither_method=floyd-steinberg&bit_depth=2`
3. **Set proper viewport** - Match your display's exact dimensions
4. **Adjust wait time** - Increase if icons/images don't load: `wait=2000`

### Dashboard Not Loading

1. Verify the access token is valid and not expired
2. Check that the dashboard path is correct
3. Increase the `wait` parameter if the dashboard has many dynamic elements

### HA Connection Issues

When Home Assistant is not connected, the Web UI displays a diagnostic banner showing:

- **Status**: Why the connection failed (e.g., "Network error", "401 Unauthorized")
- **URL**: The configured Home Assistant URL
- **Token**: First 4 characters of your token (masked) for verification

If the connection data seems stale, add `?refresh=1` to the URL to force a fresh connection attempt.

## Security Considerations

### Network Isolation

- The add-on is designed for trusted home networks only
- Port 10000 has **no built-in authentication**
- Always use **Ingress** (sidebar integration) for access
- Never expose port 10000 directly to the internet

### Access Token Handling

- Tokens are stored securely in Home Assistant's add-on configuration
- Tokens are passed to the browser in memory, not written to disk
- Use a dedicated token for this add-on (revoke it to disable access)

### AppArmor Profile (TODO)

The add-on includes an AppArmor security profile that:

- Restricts file access to `/app`, `/data`, and `/tmp` only
- Allows network access for HTTP server and webhooks
- Blocks raw sockets and packet capture
- Prevents kernel module loading and mounting

## Local Development

### Requirements

- [Bun](https://bun.sh) 1.3.5 or later
- Docker (for container testing)

### Configuration

```bash
cd trmnl-ha/ha-trmnl
cp options-dev.json.example options-dev.json
# Edit options-dev.json with your target URL
```

### Development Workflow (Hot-Reload)

For active development with automatic restarts on file changes:

```bash
# Option 1: Docker with hot-reload (recommended)
./scripts/docker-dev.sh --build    # First time: builds image + starts
./scripts/docker-dev.sh            # After: just starts (Ctrl+C to stop)

# Option 2: Native Bun (faster, requires local Chrome)
bun install
bun run dev
```

- Edit any `.ts` file → server auto-restarts
- Edit `html/` files → refresh browser to see changes
- Logs stream directly to terminal

### Production-Like Testing

To test the actual Docker image as it runs in Home Assistant:

```bash
./scripts/docker-build.sh    # Build the production image
./scripts/docker-run.sh      # Run in background (like HA add-on)
```

This builds the full image with files baked in (no hot-reload). Use this to verify changes work in the real container environment before committing.

### Docker Scripts

| Script | Purpose |
|--------|---------|
| `docker-dev.sh` | Development with hot-reload (foreground) |
| `docker-build.sh` | Build production image |
| `docker-run.sh` | Run production image (background) |
| `docker-stop.sh` | Stop running container |
| `docker-health.sh` | Check container health |
| `docker-logs.sh` | View container logs |

### Testing Commands

```bash
bun test                 # Run all tests
bun test --coverage      # Tests with coverage
bun run lint             # ESLint
```

**Data persistence:** Schedules and configuration persist in `/tmp/trmnl-data/` across container rebuilds.

## Health Monitoring

### Health Endpoint

```bash
curl http://localhost:10000/health | jq
```

### Response

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

### Health Status

| Field | Description |
|-------|-------------|
| `status` | `ok` or `error` |
| `uptime` | Seconds since container start |
| `browser.healthy` | Whether Chromium is responding |
| `browser.consecutiveFailures` | Failed health checks in a row |
| `browser.totalRecoveries` | Total browser restarts since startup |

## Enhancements from Upstream

This add-on is based on the [puppet](https://github.com/balloob/home-assistant-addons/tree/main/puppet) add-on with major enhancements:

- **TypeScript Rewrite:** Full rewrite with strict typing and modern ES modules
- **Runtime Migration:** Migrated from Node.js to Bun for improved performance
- **Image Processing Rewrite:** Replaced Sharp with ImageMagick, implementing strategy pattern for dithering algorithms
- **Scheduler System:** Added cron-based automation with Web UI management and webhook integration
- **Browser Health & Recovery:** Automatic crash detection and two-stage recovery system
- **Comprehensive Testing:** Unit and integration tests
- **Expanded Device Support:** Grew from 1 to 24+ device presets
