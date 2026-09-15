const el = document.getElementById('target');
const handles = [...document.querySelectorAll('.handle')];

if (!el || handles.length !== 4) {
  throw new Error('warp.js: missing #target or .handle elements');
}

const viewName = document.body?.dataset?.view || 'classic';
const storageKey = `warpState:${viewName}`;
const legacyStorageKey = 'warpState';

function readCachedState() {
  const primary = localStorage.getItem(storageKey);
  const legacy = localStorage.getItem(legacyStorageKey);
  const raw = primary || legacy;
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function writeCachedState(state) {
  const payload = JSON.stringify(state);
  localStorage.setItem(storageKey, payload);
  if (viewName === 'classic') {
    // Keep backward compatibility with existing saved calibrations.
    localStorage.setItem(legacyStorageKey, payload);
  }
}

// Measure size with no transform so we can place a true centered default.
el.style.transform = 'none';
el.style.left = '0px';
el.style.top = '0px';
const measuredBox = el.getBoundingClientRect();

const rect = {
  x: (window.innerWidth - measuredBox.width) / 2,
  y: (window.innerHeight - measuredBox.height) / 2,
  w: measuredBox.width,
  h: measuredBox.height,
};

const base = [
  { x: rect.x, y: rect.y },
  { x: rect.x + rect.w, y: rect.y },
  { x: rect.x + rect.w, y: rect.y + rect.h },
  { x: rect.x, y: rect.y + rect.h },
];

let corners = base.map((p) => ({ ...p }));
const cached = readCachedState();
if (cached) {
  if (cached.rect && Number.isFinite(cached.rect.x) && Number.isFinite(cached.rect.y)) {
    rect.x = cached.rect.x;
    rect.y = cached.rect.y;
  }
  if (Array.isArray(cached.corners) && cached.corners.length === 4) {
    const validCorners = cached.corners.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (validCorners) {
      corners = cached.corners.map((p) => ({ x: p.x, y: p.y }));
    }
  }
}

function logWarpCorners(label) {
  console.log(`[WARP] ${label} ${corners.map((p, i) => `${i}:(${p.x.toFixed(1)},${p.y.toFixed(1)})`).join(' ')}`);
}

function cornerPin(el, w, h, pts) {
  const [ {x:x0,y:y0}, {x:x1,y:y1}, {x:x2,y:y2}, {x:x3,y:y3} ] = pts;
  const dx1=x1-x2, dx2=x3-x2, dx3=x0-x1+x2-x3;
  const dy1=y1-y2, dy2=y3-y2, dy3=y0-y1+y2-y3;
  const den = dx1*dy2 - dx2*dy1;
  const g = (dx3*dy2 - dx2*dy3) / den;
  const h_ = (dx1*dy3 - dx3*dy1) / den;
  const a=x1-x0+g*x1, b=x3-x0+h_*x3, c=x0;
  const d=y1-y0+g*y1, e=y3-y0+h_*y3, f=y0;

  const m = [a/w,d/w,0,g/w, b/h,e/h,0,h_/h, 0,0,1,0, c,f,0,1];
  el.style.transform = `matrix3d(${m.map(n=>n.toFixed(5)).join(',')})`;
  return m;
}

function render() {
  const local = corners.map(p => ({x: p.x - rect.x, y: p.y - rect.y}));
  cornerPin(el, rect.w, rect.h, local);
  el.style.left = rect.x + 'px';
  el.style.top = rect.y + 'px';
  handles.forEach((h,i) => {
    h.style.left = corners[i].x + 'px';
    h.style.top  = corners[i].y + 'px';
  });
  
  // Save state to localStorage
  writeCachedState({
    corners,
    rect: { x: rect.x, y: rect.y }
  });
}

function emitWarpReady() {
  window.dispatchEvent(new CustomEvent('warp:ready', {
    detail: {
      view: viewName,
      rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
      corners: corners.map((p) => ({ x: p.x, y: p.y })),
    },
  }));
}

handles.forEach(h => {
  h.addEventListener('pointerdown', e => {
    e.stopPropagation();
    const i = +h.dataset.i;
    let moved = false;
    h.setPointerCapture(e.pointerId);
    const move = ev => {
      moved = true;
      corners[i] = { x: ev.clientX, y: ev.clientY };
      render();
    };
    const up = () => {
      if (moved) logWarpCorners('corner_released');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
});

// Allow dragging the entire player by clicking inside it
el.addEventListener('pointerdown', e => {
  const startX = e.clientX;
  const startY = e.clientY;
  const startCorners = corners.map(c => ({...c}));
  const startRectX = rect.x;
  const startRectY = rect.y;
  let moved = false;
  
  const move = ev => {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    moved = true;
    
    corners = startCorners.map(c => ({
      x: c.x + dx,
      y: c.y + dy
    }));
    
    rect.x = startRectX + dx;
    rect.y = startRectY + dy;
    
    render();
  };
  
  const up = () => {
    if (moved) logWarpCorners('frame_drag_released');
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
});

render();
emitWarpReady();
