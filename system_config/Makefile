.PHONY: scan hdmi1 hdmi2 hifiberry restart status web web-start web-stop web-logs

SHAIRPORT_CONF = /usr/local/etc/shairport-sync.conf
WEB_DIR = /home/ada/shairport-web

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
