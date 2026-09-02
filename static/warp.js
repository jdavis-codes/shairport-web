const el = document.getElementById('target');
const handles = [...document.querySelectorAll('.handle')];

// Center the player first by setting left/top
const centerX = window.innerWidth / 2;
const centerY = window.innerHeight / 2;
// Width is 350 + 60 padding = 410
// Height varies but approximate with content
el.style.left = (centerX - 205) + 'px';
el.style.top = (centerY - 230) + 'px';

// Now get the actual rendered dimensions of the player
const playerBox = el.getBoundingClientRect();
const rect = { 
  x: playerBox.left, 
  y: playerBox.top, 
  w: playerBox.width, 
  h: playerBox.height 
};

// Perimeter order: TL, TR, BR, BL
const base = [
  {x: rect.x,         y: rect.y},         // 0: TL
  {x: rect.x+rect.w,  y: rect.y},         // 1: TR
  {x: rect.x+rect.w,  y: rect.y+rect.h},  // 2: BR
  {x: rect.x,         y: rect.y+rect.h},  // 3: BL
];

// Load cached corners and rect position from localStorage
const cached = localStorage.getItem('warpState');
let corners;
if (cached) {
  try {
    const state = JSON.parse(cached);
    corners = state.corners || base.map(p => ({...p}));
    if (state.rect) {
      rect.x = state.rect.x;
      rect.y = state.rect.y;
    }
  } catch(e) {
    corners = base.map(p => ({...p}));
  }
} else {
  corners = base.map(p => ({...p}));
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
  localStorage.setItem('warpState', JSON.stringify({
    corners,
    rect: { x: rect.x, y: rect.y }
  }));
}

handles.forEach(h => {
  h.addEventListener('pointerdown', e => {
    e.stopPropagation();
    const i = +h.dataset.i;
    h.setPointerCapture(e.pointerId);
    const move = ev => {
      corners[i] = { x: ev.clientX, y: ev.clientY };
      render();
    };
    const up = () => {
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
  
  const move = ev => {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    
    corners = startCorners.map(c => ({
      x: c.x + dx,
      y: c.y + dy
    }));
    
    rect.x = playerBox.left + dx;
    rect.y = playerBox.top + dy;
    
    render();
  };
  
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
});

render();
