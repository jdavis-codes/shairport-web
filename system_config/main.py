import asyncio
import os
import socket
import json
import base64
import struct
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

# State to hold current track info
current_state = {
    "title": "",
    "artist": "",
    "album": "",
    "progress": 0,
    "duration": 0,
    "cover_art": "",
    "playback_state": "stop"
}

def to_unicode(b):
    return b.decode('utf-8', errors='ignore')

def hex_bytes_to_int(b):
    return int.from_bytes(b, byteorder='big')

async def broadcast_state():
    if not active_connections:
        return
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
                updated = True
            else:
                current_state["cover_art"] = ""
                updated = True
        elif code == "prgr":
            # Progress: start, current, end (RTP timestamps)
            # Format is usually string "start/current/end"
            try:
                parts = data.decode('utf-8').split('/')
                if len(parts) == 3:
                    start = int(parts[0])
                    current = int(parts[1])
                    end = int(parts[2])
                    sample_rate = 44100 # Default, might need adjustment
                    
                    progress = max(0, (current - start) / sample_rate)
                    duration = max(0, (end - start) / sample_rate)
                    
                    current_state["progress"] = progress
                    current_state["duration"] = duration
                    updated = True
            except Exception as e:
                print(f"Error parsing progress: {e}")
        elif code == "pfls":
            current_state["playback_state"] = "pause"
            updated = True
        elif code == "prsm":
            current_state["playback_state"] = "play"
            updated = True
        elif code == "pend":
            current_state["playback_state"] = "stop"
            current_state["title"] = ""
            current_state["artist"] = ""
            current_state["album"] = ""
            current_state["cover_art"] = ""
            current_state["progress"] = 0
            current_state["duration"] = 0
            updated = True
            
    elif item_type == "core":
        # DMAP codes
        try:
            text_data = data.decode('utf-8')
            if code == "minm": # Title
                current_state["title"] = text_data
                updated = True
            elif code == "asar": # Artist
                current_state["artist"] = text_data
                updated = True
            elif code == "asal": # Album
                current_state["album"] = text_data
                updated = True
        except Exception:
            pass

    if updated:
        asyncio.create_task(broadcast_state())

async def udp_listener():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("127.0.0.1", 5555))
    sock.setblocking(False)
    
    loop = asyncio.get_running_loop()
    
    chunks = []
    chunk_count = 0
    chunks_received = 0

    print("Listening for UDP metadata on 127.0.0.1:5555...")

    while True:
        try:
            data, _ = await loop.sock_recvfrom(sock, 65000)
            
            if len(data) < 8:
                continue
                
            item_type = to_unicode(data[:4])
            code = to_unicode(data[4:8])

            if code == "chnk":
                # Handle chunked data (usually large cover art)
                chunks_received += 1
                chunk_index = hex_bytes_to_int(data[8:12])
                total_chunks = hex_bytes_to_int(data[12:16])
                
                if not chunks or chunk_count != total_chunks:
                    chunks = [b""] * total_chunks
                    chunk_count = total_chunks
                    chunks_received = 1
                    
                chunks[chunk_index] = data[24:]

                if chunks_received == chunk_count:
                    # All chunks received
                    actual_type = to_unicode(data[16:20])
                    actual_code = to_unicode(data[20:24])
                    full_data = b"".join(chunks)
                    process_metadata_item(actual_type, actual_code, full_data)
                    chunks = []
                    chunk_count = 0
                    chunks_received = 0
            else:
                # Normal message
                if chunks_received > 0:
                    chunks = []
                    chunk_count = 0
                    chunks_received = 0
                    
                payload = data[8:] if len(data) > 8 else None
                process_metadata_item(item_type, code, payload)
                
        except Exception as e:
            print(f"UDP Listener error: {e}")
            await asyncio.sleep(1)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(udp_listener())

@app.get("/")
async def get():
    with open("static/index.html", "r") as f:
        html = f.read()
    if _debug := os.getenv("DEBUG"):
        script = f'<script>{hot_reload.script("ws://localhost:8000/hot-reload")}</script>'
        html = html.replace("</body>", script + "\n</body>")
    return HTMLResponse(html)

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
