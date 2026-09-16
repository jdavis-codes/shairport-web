const ws = new WebSocket(`ws://${window.location.host}/ws`);

const titleEl = document.getElementById('title');
const artistEl = document.getElementById('artist');
const albumEl = document.getElementById('album');
const coverArtEl = document.getElementById('cover-art');
const noArtworkEl = document.getElementById('no-artwork');
const pauseOverlayEl = document.getElementById('pause-overlay');
const progressFillEl = document.getElementById('progress-fill');
const timeCurrentEl = document.getElementById('time-current');
const timeTotalEl = document.getElementById('time-total');

let currentState = null;
let progressInterval = null;
let localProgress = 0;

// Cache for persisting data across stop/pause
let cachedCoverArt = null;
let cachedTitle = null;
let cachedArtist = null;
let cachedAlbum = null;

function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function updateUI(state) {
    console.log('[UI] updateUI called with state:', state.playback_state, 'title:', state.title);
    
    // Handle pause/stop states - show pause overlay over the track
    if (state.playback_state === 'pause' || state.playback_state === 'stop') {
        console.log('[UI] Handling PAUSE/STOP state');
        
        // Use state data if present, otherwise show placeholder
        const hasTrackInfo = state.title || state.artist || state.cover_art;
        
        if (hasTrackInfo) {
            titleEl.textContent = state.title || "Unknown Title";
            artistEl.textContent = state.artist || "Unknown Artist";
            albumEl.textContent = state.album || "";
            
            if (state.cover_art) {
                coverArtEl.src = state.cover_art;
                coverArtEl.style.display = 'block';
                noArtworkEl.style.display = 'none';
                pauseOverlayEl.style.display = 'flex';
            } else {
                coverArtEl.style.display = 'none';
                noArtworkEl.style.display = 'block';
                pauseOverlayEl.style.display = 'none';
            }
            
            timeTotalEl.textContent = formatTime(state.duration);
            localProgress = state.progress;
            updateProgressUI();
        } else {
            // No track info available
            titleEl.textContent = "~";
            artistEl.textContent = "";
            albumEl.textContent = "";
            coverArtEl.style.display = 'none';
            noArtworkEl.style.display = 'block';
            pauseOverlayEl.style.display = 'none';
            progressFillEl.style.width = '0%';
            timeCurrentEl.textContent = "0:00";
            timeTotalEl.textContent = "0:00";
        }
        
        stopProgressTimer();
        return;
    }

    console.log('[UI] Handling PLAY state');
    
    // Cache the current track info
    cachedTitle = state.title || "Unknown Title";
    cachedArtist = state.artist || "Unknown Artist";
    cachedAlbum = state.album || "";
    if (state.cover_art) {
        cachedCoverArt = state.cover_art;
    }
    
    titleEl.textContent = cachedTitle;
    artistEl.textContent = cachedArtist;
    albumEl.textContent = cachedAlbum;

    if (state.cover_art) {
        coverArtEl.src = state.cover_art;
        coverArtEl.style.display = 'block';
        noArtworkEl.style.display = 'none';
        pauseOverlayEl.style.display = 'none';
    } else if (cachedCoverArt) {
        coverArtEl.src = cachedCoverArt;
        coverArtEl.style.display = 'block';
        noArtworkEl.style.display = 'none';
        pauseOverlayEl.style.display = 'none';
    } else {
        coverArtEl.style.display = 'none';
        noArtworkEl.style.display = 'block';
        pauseOverlayEl.style.display = 'none';
    }

    timeTotalEl.textContent = formatTime(state.duration);
    
    // Sync local progress with server progress
    localProgress = state.progress;
    updateProgressUI();

    if (state.playback_state === 'play') {
        startProgressTimer();
    } else {
        stopProgressTimer();
    }
}

function updateProgressUI() {
    if (!currentState || !currentState.duration) return;
    
    timeCurrentEl.textContent = formatTime(localProgress);
    const percent = Math.min(100, (localProgress / currentState.duration) * 100);
    progressFillEl.style.width = `${percent}%`;
}

function startProgressTimer() {
    stopProgressTimer();
    progressInterval = setInterval(() => {
        if (currentState && currentState.duration && localProgress < currentState.duration) {
            localProgress += 0.1; // Update every 100ms
            updateProgressUI();
        }
    }, 100);
}

function stopProgressTimer() {
    if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
    }
}

ws.onmessage = function(event) {
    try {
        const state = JSON.parse(event.data);
        console.log('[WS] Received state:', {
            playback_state: state.playback_state,
            title: state.title,
            artist: state.artist,
            has_cover: !!state.cover_art,
            progress: state.progress,
            duration: state.duration
        });
        currentState = state;
        updateUI(state);
        window.dispatchEvent(new CustomEvent('playback:state', { detail: state.playback_state }));
    } catch (e) {
        console.error("Error parsing websocket message:", e);
    }
};

ws.onclose = function() {
    console.log("WebSocket connection closed. Reconnecting in 3s...");
    setTimeout(() => {
        window.location.reload();
    }, 3000);
};