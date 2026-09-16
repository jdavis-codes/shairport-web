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
└──────┬───────┘                        │  │ Chromium   │  │
       │ tap (asound.conf "multi")      │  │ (kiosk)    │  │
       ▼                                │  └────────────┘  │
┌──────────────┐                        └──────────────────┘
│ snd-aloop    │  hw:loopback,1,0 (capture) — for FFT/amplitude visualizer
│ (loopback)   │
└──────────────┘

   ┌──────────┐
   │  nqptp   │
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
| `/etc/asound.conf` | ALSA "tap" devices — duplicate playback to the real DAC/HDMI output **and** a loopback capture device, for the FFT/amplitude visualizer |
| `/etc/modprobe.d/snd-aloop.conf` | `snd-aloop` module options (card index `7`, id `loopback`) |
| `/etc/modules-load.d/snd-aloop.conf` | Loads `snd-aloop` at boot |
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
make scan            # List available ALSA audio devices
make hdmi1           # Switch to HDMI 1 (vc4hdmi0), tapped for FFT
make hdmi2           # Switch to HDMI 2 (vc4hdmi1), tapped for FFT
make hifiberry       # Switch to HifiBerry Digi (S/PDIF), tapped for FFT
make asound-install  # (Re)install /etc/asound.conf from system_config/asound.conf
```

Each output target now points shairport-sync at a `tap_*_out` ALSA device (defined in `system_config/asound.conf`) instead of the raw hardware device. These duplicate the stereo stream to the real output **and** to `hw:loopback,0,0` (a `snd-aloop` virtual card), so a separate process can read the live audio from `hw:loopback,1,0` for real-time analysis — without touching the playback path.

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
| `card 7` | `hw:loopback` | `snd-aloop` virtual loopback — not a real output; DEV=0 is the tap's write side, DEV=1 is where the visualizer reads captured audio from |

## Audio Tap (for the FFT/Amplitude Visualizer)

shairport-sync only ever writes to one ALSA device at a time, so `system_config/asound.conf` defines a `multi`+`route` device per output (`tap_hifiberry_out`, `tap_hdmi1_out`, `tap_hdmi2_out`) that fans the stereo stream out to both the real hardware **and** `hw:loopback,0,0`. Whichever output is active (`make hdmi1`/`hdmi2`/`hifiberry`), the same audio is always readable live from `hw:loopback,1,0` at 48kHz stereo, for a separate process to run FFT/amplitude analysis on without touching playback.

Sanity check the tap is working:
```bash
timeout 4 arecord -D hw:loopback,1,0 -f S16_LE -r 48000 -c 2 /tmp/tap_test.wav &
sleep 1 && timeout 3 speaker-test -D tap_hifiberry_out -c2 -r 48000 -t sine -f 440 -l 1
```
The resulting WAV should have non-trivial peak/RMS amplitude, not silence.

## Web UI

The web UI shows:
- **Cover art** from the currently playing track
- **Track title, artist, album**
- **Progress bar** with real-time position
- **Play/pause/stop state**

It listens for Shairport Sync's UDP metadata broadcast on `127.0.0.1:5555`.

## HDMI Hotplug Recovery

A udev rule (`/etc/udev/rules.d/99-hdmi-hotplug.rules`) automatically restarts Shairport Sync when an HDMI display is connected or reconnected after power-off.
