# Shairport Sync — Evil Pi

AirPlay 2 multiroom audio receiver with a web-based Now Playing display on a Raspberry Pi 5.

## Overview

This project sets up a **Raspberry Pi 5** as an AirPlay 2 receiver using [Shairport Sync](https://github.com/mikebrady/shairport-sync) built from source with AirPlay 2 support. It includes:

- AirPlay 2 playback with **multiroom sync** (nqptp timing)
- Switchable **audio output** between HDMI 1, HDMI 2, and HifiBerry Digi (S/PDIF)
- **Now Playing web UI** with cover art and progress bar
- **Fullscreen kiosk** display on boot (HDMI-connected display)

## System Architecture

```
┌──────────────┐     UDP metadata      ┌──────────────────┐
│              │ ◄──── port 5555 ────── │                  │
│ Shairport    │                        │  FastAPI Web UI  │
│ Sync 5.0.4   │     ALSA audio         │  (port 8000)     │
│ (AirPlay 2)  │ ───────────────────►   │                  │
│              │    HDMI / S/PDIF       │  ┌────────────┐  │
└──────────────┘                        │  │ Chromium   │  │
                                        │  │ (kiosk)    │  │
   ┌──────────┐                         │  └────────────┘  │
   │  nqptp   │                         └──────────────────┘
   │ (timing) │
   └──────────┘
```

## Services

| Service | File | Description |
|---|---|---|
| `shairport-sync.service` | `/etc/systemd/system/shairport-sync.service` | AirPlay 2 receiver — built from source v5.0.4 |
| `nqptp.service` | `/etc/systemd/system/nqptp.service` | Precision timing for AirPlay 2 multiroom |
| `shairport-web.service` | `/etc/systemd/system/shairport-web.service` | FastAPI web server for Now Playing display |

## Configuration Files

| File | Description |
|---|---|
| `/usr/local/etc/shairport-sync.conf` | Main Shairport Sync config — output device, metadata, DSP |
| `/etc/systemd/system/shairport-sync.service` | Systemd service for Shairport Sync |
| `/etc/systemd/system/nqptp.service` | Systemd service for NQPTP timing |
| `/etc/systemd/system/shairport-web.service` | Systemd service for web UI |
| `/etc/udev/rules.d/99-hdmi-hotplug.rules` | Auto-restart shairport-sync when HDMI display reconnects |
| `~/.config/labwc/autostart` | Opens Chromium in fullscreen kiosk at boot |
| `~/Makefile` | Quick commands for switching audio outputs + managing web UI |

## Project Structure (`~/shairport-web/`)

```
shairport-web/
├── main.py              # FastAPI server — UDP metadata listener + WebSocket
├── pyproject.toml        # Python project config (UV-based)
├── uv.lock              # Locked dependencies
├── static/
│   ├── index.html       # Now Playing page
│   ├── style.css        # Dark theme styling
│   └── app.js           # WebSocket client + real-time UI updates
└── .venv/               # Virtual environment
```

## Quick Reference

### Switching Audio Outputs

```bash
make scan        # List available ALSA audio devices
make hdmi1       # Switch to HDMI 1 (vc4hdmi0)
make hdmi2       # Switch to HDMI 2 (vc4hdmi1)
make hifiberry   # Switch to HifiBerry Digi (S/PDIF)
```

### Service Management

```bash
make restart     # Restart Shairport Sync
make status      # Check service status + active audio output
```

### Web UI

```bash
make web         # Start in foreground (Ctrl+C to stop)
make web-start   # Start in background
make web-stop    # Stop web UI
make web-logs    # Follow logs
make web-reopen  # Open in browser
```

## Building from Source

Shairport Sync and NQPTP are built from source on this Pi to get AirPlay 2 support. See `~/shairport-sync/` and `~/nqptp/` for the build trees.

**Configure flags used:**
```bash
./configure --sysconfdir=/etc --with-alsa --with-soxr --with-avahi \
  --with-ssl=openssl --with-systemd-startup --with-airplay-2 \
  --with-metadata --with-dbus-interface
```

## Audio Output Devices

From `aplay -l`:
| Card | Device | Description |
|---|---|---|
| `card 0` | `hdmi:vc4hdmi0` | HDMI 1 (vc4-hdmi-0) |
| `card 1` | `hdmi:vc4hdmi1` | HDMI 2 (vc4-hdmi-1) |
| `card 2` | `iec958:CARD=sndrpihifiberry,DEV=0` | HifiBerry Digi (S/PDIF) |

## Web UI

The web UI shows:
- **Cover art** from the currently playing track
- **Track title, artist, album**
- **Progress bar** with real-time position
- **Play/pause/stop state**

It listens for Shairport Sync's UDP metadata broadcast on `127.0.0.1:5555`.

## HDMI Hotplug Recovery

A udev rule (`/etc/udev/rules.d/99-hdmi-hotplug.rules`) automatically restarts Shairport Sync when an HDMI display is connected or reconnected after power-off.
