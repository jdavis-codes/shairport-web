(function() {
  const canvas = document.getElementById('shader-bg');
  const player = document.getElementById('target');
  
  if (!canvas || !player) {
    console.error('Shader: canvas or player not found');
    return;
  }
  
  const ctx = canvas.getContext('2d');

  // Get colors from CSS variables
  function getShaderColors() {
    const style = getComputedStyle(document.documentElement);
    const hexToRgb = hex => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
      } : { r: 255, g: 0, b: 255 };
    };
    
    return [
      hexToRgb(style.getPropertyValue('--shader-color-1').trim()),
      hexToRgb(style.getPropertyValue('--shader-color-2').trim()),
      hexToRgb(style.getPropertyValue('--shader-color-3').trim())
    ];
  }

  let colors = getShaderColors();

  function resize() {
    const rect = player.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
  }

  let t = 0;
  function render() {
  const w = canvas.width;
  const h = canvas.height;
  const id = ctx.createImageData(w, h);
  const d = id.data;
  
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const u = x / w - 0.5;
      const v = y / h - 0.5;
      
      const r = Math.sqrt(u*u + v*v);
      const a = Math.atan2(v, u);
      
      const s = Math.sin(r * 8 + t) * Math.cos(a * 3 + t * 0.7);
      const c = Math.cos(r * 12 - t * 1.3) * Math.sin(a * 5 - t * 0.5);
      const m = s * c;
      
      // Blend the three colors using the wave values
      const w1 = (s + 1) * 0.5;
      const w2 = (c + 1) * 0.5;
      const w3 = (m + 1) * 0.5;
      
      d[i]     = colors[0].r * w1 * 0.6 + colors[1].r * w2 * 0.5 + colors[2].r * w3 * 0.4;
      d[i + 1] = colors[0].g * w1 * 0.6 + colors[1].g * w2 * 0.5 + colors[2].g * w3 * 0.4;
      d[i + 2] = colors[0].b * w1 * 0.6 + colors[1].b * w2 * 0.5 + colors[2].b * w3 * 0.4;
      d[i + 3] = 255;
    }
  }
  
  ctx.putImageData(id, 0, 0);
  t += 0.02;
  requestAnimationFrame(render);
}

  resize();
  render();

  new ResizeObserver(resize).observe(player);
})();
