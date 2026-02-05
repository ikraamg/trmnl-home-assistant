# Changelog

All notable changes to the BYOS Terminus add-on will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-02-05

### Added

- Initial release of BYOS Terminus as Home Assistant add-on
- Full Terminus platform in single container (PostgreSQL, Valkey, Puma, Sidekiq)
- s6-overlay v3 for process management
- First-user registration token for security
- Hot backup support with `pg_backup_start/stop`
- Health check endpoint for HA watchdog
- Low-memory PostgreSQL configuration for RPi4
- Sidekiq-safe Valkey configuration with `noeviction`
- Ingress support for sidebar access
- Multi-architecture support (amd64, aarch64)

### Security

- Registration token required for first user creation
- Auto-generated APP_SECRET on first run
- PostgreSQL uses local trust authentication only
