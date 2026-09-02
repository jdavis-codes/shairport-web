.PHONY: help scan hdmi1 hdmi2 hifiberry restart status web web-start web-stop web-logs web-reopen cron-install cron-show projector-on projector-once projector-boot-enable projector-boot-disable projector-boot-run projector-boot-status ir-status ir-scan

SHAIRPORT_CONF = /usr/local/etc/shairport-sync.conf
WEB_DIR = /home/ada/shairport-web
CRON_FILE = $(WEB_DIR)/system_config/ada.crontab

help:
	@echo "Available targets:"
	@echo ""
	@echo "Audio output:"
	@echo "  make scan                # List ALSA devices + active Shairport config"
	@echo "  make hdmi1               # Switch output to HDMI 1"
	@echo "  make hdmi2               # Switch output to HDMI 2"
	@echo "  make hifiberry           # Switch output to HifiBerry Digi (S/PDIF)"
	@echo ""
	@echo "Shairport service:"
	@echo "  make restart             # Restart Shairport Sync"
	@echo "  make status              # Show service status + active output"
	@echo ""
	@echo "Web UI:"
	@echo "  make web                 # Run web UI in foreground"
	@echo "  make web-start           # Run web UI in background"
	@echo "  make web-stop            # Stop web UI"
	@echo "  make web-logs            # Tail web UI logs"
	@echo "  make web-reopen          # Open web UI in browser"
	@echo ""
	@echo "Projector power (IR TX):"
	@echo "  make projector-on        # Send projector power code 3x"
	@echo "  make projector-once      # Send projector power code once"
	@echo "  make projector-boot-enable  # Enable boot-time projector wake service"
	@echo "  make projector-boot-disable # Disable boot-time projector wake service"
	@echo "  make projector-boot-run     # Trigger boot-time service now"
	@echo "  make projector-boot-status  # Show boot-time service status"
	@echo ""
	@echo "IR scan (receiver):"
	@echo "  make ir-status           # Show rc3 receiver + lirc0 transmitter details"
	@echo "  make ir-scan             # Live scan of remote button presses"


# --- Audio Device Switching ---

scan:
	@echo "=== ALSA Hardware Devices ==="
	@aplay -l 2>/dev/null
	@echo ""
	@echo "=== ALSA Device Names ==="
	@aplay -L 2>/dev/null | grep -v '^$$'
	@echo ""
	@echo "=== Shairport Sync Active Config ==="
	@shairport-sync -X 2>&1 | grep -A5 "^Configuration File Settings:"

hdmi1:
	@echo "Switching to HDMI 1 (vc4hdmi0)..."
	@sudo sed -i 's/output_device = ".*";/output_device = "hdmi:vc4hdmi0";/' $(SHAIRPORT_CONF)
	@sudo systemctl restart shairport-sync
	@echo "Done. Active config:"
	@shairport-sync -X 2>&1 | grep output_device

hdmi2:
	@echo "Switching to HDMI 2 (vc4hdmi1)..."
	@sudo sed -i 's/output_device = ".*";/output_device = "hdmi:vc4hdmi1";/' $(SHAIRPORT_CONF)
	@sudo systemctl restart shairport-sync
	@echo "Done. Active config:"
	@shairport-sync -X 2>&1 | grep output_device

hifiberry:
	@echo "Switching to HifiBerry Digi (S/PDIF)..."
	@sudo sed -i 's|output_device = ".*";|output_device = "iec958:CARD=sndrpihifiberry,DEV=0";|' $(SHAIRPORT_CONF)
	@sudo systemctl restart shairport-sync
	@echo "Done. Active config:"
	@shairport-sync -X 2>&1 | grep output_device

# --- Shairport Sync Service ---

restart:
	@echo "Restarting Shairport Sync..."
	@sudo systemctl restart shairport-sync
	@sudo systemctl status shairport-sync --no-pager -l | head -5

status:
	@sudo systemctl status shairport-sync --no-pager -l | head -10
	@echo ""
	@echo "--- Active Audio Output ---"
	@shairport-sync -X 2>&1 | grep output_device

# --- Web UI ---

web:
	@echo "Starting Shairport Web UI at http://localhost:8000"
	@cd $(WEB_DIR) && DEBUG=true uv run uvicorn main:app --reload --reload-include "*.html" --reload-include "*.css" --reload-include "*.js" --host 0.0.0.0 --port 8000

web-start:
	@echo "Starting Shairport Web UI in background..."
	@cd $(WEB_DIR) && nohup DEBUG=true uv run uvicorn main:app --reload --reload-include "*.html" --reload-include "*.css" --reload-include "*.js" --host 0.0.0.0 --port 8000 > /tmp/shairport-web.log 2>&1 &
	@echo "Web UI started. PID: $$!"
	@sleep 1
	@echo "Access at http://localhost:8000"

web-stop:
	@echo "Stopping Shairport Web UI..."
	@pkill -f "uvicorn main:app" 2>/dev/null && echo "Stopped." || echo "Not running."

web-logs:
	@tail -f /tmp/shairport-web.log

web-reopen:
	@xdg-open http://localhost:8000 2>/dev/null || echo "Open http://localhost:8000 in your browser"

# --- Cron Schedule ---

cron-install:
	@echo "Installing crontab from $(CRON_FILE)..."
	@crontab $(CRON_FILE)
	@echo "Installed. Active crontab:"
	@crontab -l

cron-show:
	@echo "Source file: $(CRON_FILE)"
	@sed -n '1,200p' $(CRON_FILE)

# --- IR Projector Power ---

projector-on:
	@echo "Sending projector power IR code 3x..."
	@sudo /home/ada/bin/projector-ir-wake.sh 3

projector-once:
	@echo "Sending projector power IR code once..."
	@sudo /home/ada/bin/projector-ir-wake.sh 1

projector-boot-enable:
	@echo "Enabling boot-time projector IR wake service..."
	@sudo systemctl daemon-reload
	@sudo systemctl enable projector-ir-wake.service

projector-boot-disable:
	@echo "Disabling boot-time projector IR wake service..."
	@sudo systemctl disable projector-ir-wake.service

projector-boot-run:
	@echo "Running boot-time projector IR wake service now..."
	@sudo systemctl start projector-ir-wake.service

projector-boot-status:
	@sudo systemctl status projector-ir-wake.service --no-pager -l | head -30

# --- IR Remote Scan ---

ir-status:
	@echo "=== IR Receiver (rc3) ==="
	@sudo ir-keytable -s rc3
	@echo ""
	@echo "=== IR Transmitter (/dev/lirc0) Features ==="
	@sudo ir-ctl -d /dev/lirc0 --features

ir-scan:
	@echo "Enabling all rc3 decode protocols and starting live scan..."
	@echo "Press remote buttons. Use Ctrl+C to stop."
	@sudo ir-keytable -s rc3 -p all
	@sudo ir-keytable -s rc3 -t
