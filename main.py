import asyncio
import os
import socket
import json
import base64
import struct
import threading
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# Serve static files (HTML, JS, CSS)
app.mount("/static", StaticFiles(directory="static"), name="static")

# Hot-reload support for kiosk browser (CSS/HTML/JS)
if _debug := os.getenv("DEBUG"):
    import arel
    hot_reload = arel.HotReload(
        paths=[arel.Path("static/"), arel.Path("main.py")],
    )
    app.add_websocket_route("/hot-reload", route=hot_reload, name="hot-reload")
    app.add_event_handler("startup", hot_reload.startup)
    app.add_event_handler("shutdown", hot_reload.shutdown)

# Store active websocket connections
active_connections = []

# Path for persisting state and active view across reloads
STATE_FILE = Path("/tmp/shairport-web-state.json")
VIEW_FILE = Path("/tmp/shairport-web-view.txt")
STATIC_DIR = Path(__file__).parent / "static"
VIEWS_DIR = STATIC_DIR / "views"

def get_active_view_name() -> str:
    """Return currently active view name ('vector', 'classic', etc.)."""
    try:
        if VIEW_FILE.exists():
            v = VIEW_FILE.read_text().strip()
            if v:
                return v
    except Exception:
        pass
    return "vector"

def set_active_view_name(name: str):
    """Set and persist active view name."""
    try:
        VIEW_FILE.write_text(name.strip())
    except Exception:
        pass

# Known metadata codes we care about (everything else is noise)
KNOWN_CODES = {"PICT", "prgr", "pfls", "prsm", "pend", "minm", "asar", "asal"}

def load_persisted_state():
    """Restore last known state from disk (survives hot-reload)."""
    try:
        if STATE_FILE.exists():
            raw = STATE_FILE.read_text()
            saved = json.loads(raw)
            # Validate it has the expected shape
            if all(k in saved for k in ("title", "artist", "album", "progress", "duration", "cover_art", "playback_state")):
                return saved
    except Exception:
        pass
    return {
        "title": "",
        "artist": "",
        "album": "",
        "progress": 0,
        "duration": 0,
        "cover_art": "",
        "playback_state": "stop"
    }

# State to hold current track info — restored from disk on startup
current_state = load_persisted_state()
print(f"[STATE] Restored from disk: title='{current_state['title']}', artist='{current_state['artist']}', state={current_state['playback_state']}", flush=True)

def save_persisted_state():
    """Write current_state to disk so it survives hot-reload."""
    try:
        STATE_FILE.write_text(json.dumps(current_state))
    except Exception:
        pass

def to_unicode(b):
    return b.decode('utf-8', errors='ignore')

def hex_bytes_to_int(b):
    return int.from_bytes(b, byteorder='big')

async def broadcast_state():
    if not active_connections:
        return
    print(f"[BROADCAST] Sending state to {len(active_connections)} clients: playback_state={current_state['playback_state']}, title='{current_state['title']}'", flush=True)
    message = json.dumps(current_state)
    for connection in active_connections:
        try:
            await connection.send_text(message)
        except Exception:
            pass

def process_metadata_item(item_type, code, data):
    global current_state
    updated = False

    if item_type == "ssnc":
        if code == "PICT":
            if data:
                # Convert binary image data to base64 for the frontend
                b64_img = base64.b64encode(data).decode('utf-8')
                current_state["cover_art"] = f"data:image/jpeg;base64,{b64_img}"
                print(f"[METADATA] Cover art updated ({len(data)} bytes)", flush=True)
                updated = True
            else:
                current_state["cover_art"] = ""
                print(f"[METADATA] Cover art cleared", flush=True)
                updated = True
        elif code == "prgr":
            # Progress: start, current, end (RTP timestamps)
            # Format is usually string "start/current/end"
            # Only update progress during active playback
            if current_state["playback_state"] == "play":
                try:
                    parts = data.decode('utf-8').split('/')
                    if len(parts) == 3:
                        start = int(parts[0])
                        current = int(parts[1])
                        end = int(parts[2])
                        sample_rate = 44100 # Default, might need adjustment
                        
                        progress = max(0, (current - start) / sample_rate)
                        duration = max(0, (end - start) / sample_rate)
                        
                        # Only update if we have valid progress (not zero at start)
                        if progress > 0 or duration > 0:
                            current_state["progress"] = progress
                            current_state["duration"] = duration
                            # Don't log every progress update (too verbose)
                            updated = True
                except Exception as e:
                    print(f"[METADATA] Error parsing progress: {e}", flush=True)
        elif code == "pfls":
            current_state["playback_state"] = "pause"
            print(f"[METADATA] *** Playback PAUSED *** state={current_state['playback_state']}", flush=True)
            updated = True
        elif code == "prsm":
            current_state["playback_state"] = "play"
            print(f"[METADATA] *** Playback RESUMED/PLAYING *** state={current_state['playback_state']}", flush=True)
            updated = True
        elif code == "pend":
            current_state["playback_state"] = "stop"
            print(f"[METADATA] *** Playback ENDED (stop) *** Keeping metadata and progress for display. state={current_state['playback_state']}", flush=True)
            # Don't clear metadata or progress - let the UI show paused state
            updated = True
            
    elif item_type == "core":
        # DMAP codes
        try:
            text_data = data.decode('utf-8')
            if code == "minm": # Title
                current_state["title"] = text_data
                print(f"[METADATA] Title: {text_data}", flush=True)
                updated = True
            elif code == "asar": # Artist
                current_state["artist"] = text_data
                print(f"[METADATA] Artist: {text_data}", flush=True)
                updated = True
            elif code == "asal": # Album
                current_state["album"] = text_data
                print(f"[METADATA] Album: {text_data}", flush=True)
                updated = True
        except Exception:
            pass

    if updated:
        save_persisted_state()
        asyncio.create_task(broadcast_state())

# --- UDP listener: thread-based socket + asyncio queue ---
# The thread owns the socket lifecycle independently of the event loop.
# This survives hot-reload cleanly because the thread is a daemon and
# the socket is closed via a shutdown Event, not via CancelledError.

udp_queue = asyncio.Queue(maxsize=256)
_udp_stop = threading.Event()
_udp_thread = None

def _udp_thread_worker():
    """Runs in a daemon thread. Blocks on recvfrom, pushes to async queue."""
    sock = None
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("127.0.0.1", 5555))
        sock.settimeout(0.5)  # wake every 0.5s to check stop flag
        print("[UDP] Connected to 127.0.0.1:5555", flush=True)

        while not _udp_stop.is_set():
            try:
                data, _addr = sock.recvfrom(65000)
                if len(data) >= 8:
                    # Put on queue; drop if full (non-blocking)
                    try:
                        udp_queue.put_nowait(data)
                    except asyncio.QueueFull:
                        pass
            except socket.timeout:
                continue  # just check stop flag
            except OSError:
                break  # socket closed or error
    except OSError as e:
        print(f"[UDP] Socket bind error: {e}", flush=True)
    finally:
        if sock:
            try:
                sock.close()
            except Exception:
                pass
        print("[UDP] Socket closed", flush=True)

async def udp_processor():
    """Async task: reads raw packets from queue, parses, updates state."""
    chunks = []
    chunk_count = 0
    chunks_received = 0

    while True:
        try:
            # Wait for next packet with a timeout so we can check for shutdown
            data = await asyncio.wait_for(udp_queue.get(), timeout=1.0)
        except asyncio.TimeoutError:
            continue
        except asyncio.CancelledError:
            break

        try:
            item_type = to_unicode(data[:4])
            code = to_unicode(data[4:8])

            if code == "chnk":
                chunks_received += 1
                chunk_index = hex_bytes_to_int(data[8:12])
                total_chunks = hex_bytes_to_int(data[12:16])

                if not chunks or chunk_count != total_chunks:
                    chunks = [b""] * total_chunks
                    chunk_count = total_chunks
                    chunks_received = 1

                chunks[chunk_index] = data[24:]

                if chunks_received == chunk_count:
                    actual_type = to_unicode(data[16:20])
                    actual_code = to_unicode(data[20:24])
                    full_data = b"".join(chunks)
                    process_metadata_item(actual_type, actual_code, full_data)
                    chunks = []
                    chunk_count = 0
                    chunks_received = 0
            else:
                if chunks_received > 0:
                    chunks = []
                    chunk_count = 0
                    chunks_received = 0

                payload = data[8:] if len(data) > 8 else None
                process_metadata_item(item_type, code, payload)
        except Exception as e:
            print(f"[UDP] Parse error: {type(e).__name__}: {e}", flush=True)

udp_task = None

@app.on_event("startup")
async def startup_event():
    global udp_task, _udp_thread
    # Start the UDP reader thread
    _udp_stop.clear()
    _udp_thread = threading.Thread(target=_udp_thread_worker, daemon=True)
    _udp_thread.start()
    # Start the async processor
    udp_task = asyncio.create_task(udp_processor())

@app.on_event("shutdown")
async def shutdown_event():
    global udp_task, _udp_thread
    # Signal thread to stop
    _udp_stop.set()
    # Cancel async processor
    if udp_task:
        udp_task.cancel()
        try:
            await udp_task
        except asyncio.CancelledError:
            pass
    # Wait for thread to finish (with timeout)
    if _udp_thread and _udp_thread.is_alive():
        _udp_thread.join(timeout=2)

def render_view_html(view_name: str) -> str:
    """Load HTML file for a view, falling back to static/views/vector.html or static/index.html."""
    view_path = VIEWS_DIR / f"{view_name}.html"
    if not view_path.exists():
        view_path = VIEWS_DIR / "vector.html"
    if not view_path.exists():
        view_path = STATIC_DIR / "index.html"
    
    html = view_path.read_text(encoding="utf-8")
    if _debug := os.getenv("DEBUG"):
        script = hot_reload.script("ws://localhost:8000/hot-reload")
        html = html.replace("</body>", script + "\n</body>")
    return html

@app.get("/")
async def get(view: str = None):
    if view:
        set_active_view_name(view)
    active_view = get_active_view_name()
    return HTMLResponse(render_view_html(active_view))

@app.get("/view/{name}")
async def switch_view_api(name: str):
    set_active_view_name(name)
    # Touch main.py or reload trigger so kiosk auto-reloads via hot_reload
    try:
        touch_file = STATIC_DIR / "index.html"
        if touch_file.exists():
            touch_file.touch()
    except Exception:
        pass
    return {"status": "ok", "active_view": name}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_connections.append(websocket)
    # Send current state immediately upon connection
    await websocket.send_text(json.dumps(current_state))
    try:
        while True:
            # Keep connection alive
            await websocket.receive_text()
    except WebSocketDisconnect:
        active_connections.remove(websocket)
