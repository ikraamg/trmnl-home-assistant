# BYOS Terminus Documentation

Complete documentation for the BYOS Terminus Home Assistant add-on.

## Table of Contents

- [Installation](#installation)
- [First-Run Setup](#first-run-setup)
- [Configuration](#configuration)
- [Connecting Devices](#connecting-devices)
- [Backup & Restore](#backup--restore)
- [Troubleshooting](#troubleshooting)
- [Security](#security)
- [Architecture](#architecture)

## Installation

### Prerequisites

- Home Assistant OS or Supervised installation
- Minimum 2GB RAM (4GB recommended for smooth operation)
- ~2GB available disk space

### Adding the Repository

1. Navigate to **Settings** > **Add-ons** > **Add-on Store**
2. Click the three dots (⋮) in the top right
3. Select **Repositories**
4. Add: `https://github.com/usetrmnl/home-assistant-addons`
5. Click **Add**

### Installing the Add-on

1. Find "BYOS Terminus" in the add-on store
2. Click **Install**
3. Wait for installation to complete (this may take several minutes)
4. Do not start the add-on yet - review the configuration first

## First-Run Setup

### Initial Configuration

1. Go to the add-on **Configuration** tab
2. Set your timezone (optional but recommended)
3. Set the `api_uri` if your HA is behind a reverse proxy

### Starting for the First Time

1. Go to the **Info** tab and click **Start**
2. Switch to the **Log** tab
3. Look for the registration token:

```
==========================================
  FIRST-RUN SETUP - IMPORTANT!
==========================================

  Registration Token: abc123def456...

  Use this token when registering your first user.
==========================================
```

4. **Copy this token** - you'll need it to create your admin account

### Creating Your Admin Account

1. Click "Open Web UI" in the sidebar or navigate to `http://[YOUR-HA-IP]:2300`
2. Click "Register"
3. Enter the registration token from the logs
4. Create your username and password
5. Your admin account is now created

> **Security Note:** The registration token is only valid for the first user. After registration, the token file is not deleted automatically - this is intentional for debugging. However, subsequent registrations will require admin approval.

## Configuration

### Add-on Options

| Option | Description | Default |
|--------|-------------|---------|
| `timezone` | Container timezone (e.g., `America/New_York`) | System default |
| `log_level` | Logging verbosity | `info` |
| `api_uri` | External API URL for device callbacks | Auto-detected |

### Example Configuration

```yaml
timezone: "America/New_York"
log_level: "info"
api_uri: "https://ha.example.com:2300"
```

### When to Set api_uri

Set `api_uri` when:
- Your Home Assistant is behind a reverse proxy
- You're accessing HA via a custom domain
- Devices connect from a different network

Leave empty to auto-detect from the incoming request.

## Connecting Devices

### Network Requirements

TRMNL devices need direct access to port **2300**. Ensure:
- Port 2300 is accessible on your local network
- Your devices can reach your Home Assistant IP

### Device Configuration

1. In Terminus, create a new device or use an existing one
2. Configure your TRMNL device to point to:
   ```
   http://[YOUR-HA-IP]:2300
   ```
3. The device should appear in Terminus after first check-in

### Troubleshooting Device Connectivity

If devices can't connect:
1. Verify port 2300 is open: `curl http://[HA-IP]:2300/up`
2. Check firewall rules
3. Ensure devices are on the same network or have routing

## Backup & Restore

### Automatic Backups

BYOS Terminus integrates with Home Assistant's backup system. When you create an HA backup:
1. PostgreSQL enters backup mode
2. Valkey persistence is flushed
3. All data in `/data` is included
4. PostgreSQL backup mode ends

### Creating a Backup

1. Go to **Settings** > **System** > **Backups**
2. Click **Create Backup**
3. Select "BYOS Terminus" (or do a full backup)
4. Wait for completion

### Restoring from Backup

1. Stop the BYOS Terminus add-on
2. Restore the backup via HA's backup manager
3. Start the add-on
4. Verify data by logging into the web UI

### Manual Backup (Advanced)

If you need to backup just the database:

```bash
# Access the container
docker exec -it addon_local_byos_terminus bash

# Dump PostgreSQL
pg_dump -U postgres terminus > /data/backup.sql

# Copy to host
docker cp addon_local_byos_terminus:/data/backup.sql .
```

## Troubleshooting

### Add-on Won't Start

**Check the logs** for specific errors:
- "PostgreSQL not ready" - Database initialization failed
- "Valkey not responding" - Cache service failed
- "Migration failed" - Database schema issue

**Common fixes:**
1. Ensure sufficient RAM (2GB minimum)
2. Check disk space (2GB needed)
3. Try removing `/data/postgres` and restarting (data loss!)

### Web UI Not Loading

1. Check if Puma is running in logs
2. Verify port 2300 is not in use by another service
3. Try accessing directly: `http://[HA-IP]:2300`

### "Registration Token Invalid"

The token is case-sensitive. Copy it exactly from the logs:
1. Go to add-on **Log** tab
2. Search for "Registration Token"
3. Copy the full token string

### Database Issues

If migrations fail or data is corrupted:

```bash
# Reset database (DATA LOSS!)
rm -rf /data/postgres
# Restart add-on
```

### Memory Issues on RPi4

If the add-on is slow or crashing:
1. Check available memory: `free -h`
2. Ensure no other heavy add-ons are running
3. Consider disabling debug logging

## Security

### Network Security

**CRITICAL:** Port 2300 exposes the full Terminus API and web interface.

**DO NOT:**
- Expose port 2300 directly to the internet
- Use without authentication from untrusted networks

**DO:**
- Use VPN for remote access
- Put behind a reverse proxy with authentication for internet access
- Restrict firewall to trusted networks

### First-User Security

The registration token prevents unauthorized users from creating admin accounts on first boot. After your first user is created, additional users require admin approval.

### Data Security

All data is stored in `/data`:
- Database credentials (auto-generated)
- App secrets
- User data
- Device configurations

Treat HA backups as sensitive - they contain credentials.

## Architecture

### Container Services

| Service | Port | Purpose |
|---------|------|---------|
| PostgreSQL 16 | Internal | Database |
| Valkey | Unix Socket | Job queue, sessions |
| Puma | 2300 | Web server |
| Sidekiq | - | Background jobs |

### Data Locations

| Path | Contents |
|------|----------|
| `/data/postgres` | PostgreSQL data |
| `/data/valkey` | Valkey AOF persistence |
| `/data/uploads` | User-uploaded images |
| `/data/logs` | Application logs |

### Resource Usage

Typical idle usage on RPi4:
- Memory: ~1.5GB
- CPU: <5%
- Disk: ~500MB (varies with data)

Active usage (device updates, image processing):
- Memory: ~1.7GB
- CPU: 20-50%

## Support

- **Issues:** [GitHub Issues](https://github.com/usetrmnl/home-assistant-addons/issues)
- **Community:** [TRMNL](https://usetrmnl.com)
- **Documentation:** [Terminus Docs](https://docs.usetrmnl.com)
