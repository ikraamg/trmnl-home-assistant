# BYOS Terminus - Home Assistant Add-on

Self-hosted TRMNL device management platform for Home Assistant.

## Features

- **Full BYOS Platform** - Complete Terminus backend with user management, device provisioning, playlists, and scheduling
- **Single Container** - PostgreSQL, Valkey, Puma, and Sidekiq bundled with s6-overlay process management
- **HA Integration** - Sidebar access via Ingress, automatic backups, watchdog monitoring
- **RPi4 Optimized** - Tuned for Raspberry Pi 4 with 4GB+ RAM

## Quick Start

1. Add this repository to Home Assistant
2. Install "BYOS Terminus" from the add-on store
3. Start the add-on
4. Check the logs for your **registration token**
5. Open the web UI from the sidebar and register your first user
6. Point your TRMNL devices to `http://[YOUR-HA-IP]:2300`

## Requirements

- Home Assistant OS or Supervised
- 4GB+ RAM recommended (2GB minimum)
- ~2GB disk space

## Security Notice

**Port 2300** is exposed for TRMNL device connectivity. Do not expose this port to the internet without additional security measures (VPN, reverse proxy with authentication).

## Configuration

| Option | Description | Default |
|--------|-------------|---------|
| `timezone` | Container timezone | System default |
| `log_level` | Logging verbosity (debug/info/warn/error) | `info` |
| `api_uri` | External API URL for device callbacks | Auto-detected |

## Documentation

See [DOCS.md](DOCS.md) for detailed setup and troubleshooting.

## Support

- [GitHub Issues](https://github.com/usetrmnl/home-assistant-addons/issues)
- [TRMNL Community](https://usetrmnl.com)
