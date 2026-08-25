/**
 * SemiLightroom - Scopes Monitor (Waveform, Parade, Accurate Histogram, Vectorscope)
 */

class ScopeMonitor {
  constructor(canvas, engine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.engine = engine;
    this.mode = 'waveform';

    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * (window.devicePixelRatio || 1);
    this.canvas.height = rect.height * (window.devicePixelRatio || 1);
  }

  setMode(mode) {
    this.mode = mode;
    this.update();
  }

  update() {
    if (!this.engine || !this.engine.sourceTexture) return;

    const w = this.canvas.width;
    const h = this.canvas.height;
    const ctx = this.ctx;

    ctx.fillStyle = '#141414';
    ctx.fillRect(0, 0, w, h);

    this.drawGrid(w, h);

    const pixelInfo = this.engine.getRenderPixels();
    if (!pixelInfo || !pixelInfo.data || pixelInfo.data.length === 0) return;

    const pixels = pixelInfo.data;
    const sw = pixelInfo.width;
    const sh = pixelInfo.height;

    switch (this.mode) {
      case 'waveform':
        this.renderWaveform(pixels, sw, sh, w, h);
        break;
      case 'parade':
        this.renderParade(pixels, sw, sh, w, h);
        break;
      case 'histogram':
        this.renderHistogram(pixels, sw, sh, w, h);
        break;
      case 'vectorscope':
        this.renderVectorscope(pixels, sw, sh, w, h);
        break;
    }
  }

  drawGrid(w, h) {
    const ctx = this.ctx;

    // 20%, 40%, 60%, 80% 로주 방향 흐리면 배경 바
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0.0, '#2a2a2a');
    bg.addColorStop(0.5, '#1c1c1c');
    bg.addColorStop(1.0, '#111111');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    for (let i = 1; i <= 4; i++) {
      const y = (h / 5) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    // 수직 5등분 선
    for (let i = 1; i <= 4; i++) {
      const x = (w / 5) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  renderWaveform(pixels, sw, sh, w, h) {
    const ctx = this.ctx;
    const scopeImg = ctx.createImageData(w, h);
    const buf = scopeImg.data;

    // 웨이브폼 배경: 수평 톤 바 (어두운 톤)
    for (let py = 0; py < h; py++) {
      const v = Math.floor(255 * (1.0 - py / h));
      for (let px = 0; px < w; px++) {
        const idx = (py * w + px) * 4;
        buf[idx]     = v * 0.12;
        buf[idx + 1] = v * 0.12;
        buf[idx + 2] = v * 0.15;
        buf[idx + 3] = 255;
      }
    }

    // 1. 세로 사진/다양한 비율에서도 좌우 끝에 꽉 차도록 유효 X 범위(minX, maxX) 탐색
    let minX = sw, maxX = 0;
    for (let y = 0; y < sh; y += 4) {
      for (let x = 0; x < sw; x += 4) {
        const idx = (y * sw + x) * 4;
        if (pixels[idx + 3] > 10) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
    }
    if (minX >= maxX) { minX = 0; maxX = sw - 1; }
    const spanX = Math.max(1, maxX - minX);

    const scaleY = (h - 6) / 255;
    const rAcc = new Float32Array(w * h);
    const gAcc = new Float32Array(w * h);
    const bAcc = new Float32Array(w * h);

    const stepY = Math.max(1, Math.floor(sh / 150));
    const stepX = Math.max(1, Math.floor(spanX / 250));

    for (let y = 0; y < sh; y += stepY) {
      for (let x = minX; x <= maxX; x += stepX) {
        const idx = (y * sw + x) * 4;
        if (pixels[idx + 3] <= 10) continue;

        const r = pixels[idx];
        const g = pixels[idx + 1];
        const b = pixels[idx + 2];

        // 좌우 끝(0 ~ w - 1)에 무조건 100% 꽉 채워 매핑
        const targetX = Math.floor(((x - minX) / spanX) * (w - 1));
        const targetYr = Math.floor(h - 3 - r * scaleY);
        const targetYg = Math.floor(h - 3 - g * scaleY);
        const targetYb = Math.floor(h - 3 - b * scaleY);

        if (targetX >= 0 && targetX < w) {
          if (targetYr >= 0 && targetYr < h) rAcc[targetYr * w + targetX] += 0.35;
          if (targetYg >= 0 && targetYg < h) gAcc[targetYg * w + targetX] += 0.35;
          if (targetYb >= 0 && targetYb < h) bAcc[targetYb * w + targetX] += 0.35;
        }
      }
    }

    const total = w * h;
    for (let i = 0; i < total; i++) {
      const r = Math.min(255, rAcc[i] * 255 * 0.5);
      const g = Math.min(255, gAcc[i] * 255 * 0.5);
      const b = Math.min(255, bAcc[i] * 255 * 0.5);

      if (r > 0 || g > 0 || b > 0) {
        const outIdx = i * 4;
        buf[outIdx] = Math.min(255, buf[outIdx] + r);
        buf[outIdx + 1] = Math.min(255, buf[outIdx + 1] + g);
        buf[outIdx + 2] = Math.min(255, buf[outIdx + 2] + b);
        buf[outIdx + 3] = 255;
      }
    }

    ctx.putImageData(scopeImg, 0, 0);

    // 0% / 50% / 100% 레이블
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = `${Math.floor(h * 0.08)}px monospace`;
    ctx.fillText('100', 4, 12);
    ctx.fillText(' 50', 4, h / 2 + 4);
    ctx.fillText('  0', 4, h - 2);
  }

  renderParade(pixels, sw, sh, w, h) {
    const ctx = this.ctx;
    const thirdW = Math.floor(w / 3);

    // 세로 사진에서도 좌우 꽉 차도록 유효 범위 탐색
    let minX = sw, maxX = 0;
    for (let y = 0; y < sh; y += 4) {
      for (let x = 0; x < sw; x += 4) {
        const idx = (y * sw + x) * 4;
        if (pixels[idx + 3] > 10) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
    }
    if (minX >= maxX) { minX = 0; maxX = sw - 1; }
    const spanX = Math.max(1, maxX - minX);

    const stepY = Math.max(1, Math.floor(sh / 150));
    const stepX = Math.max(1, Math.floor(spanX / 250));

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (let y = 0; y < sh; y += stepY) {
      for (let x = minX; x <= maxX; x += stepX) {
        const idx = (y * sw + x) * 4;
        if (pixels[idx + 3] <= 10) continue;

        const r = pixels[idx];
        const g = pixels[idx + 1];
        const b = pixels[idx + 2];
        const normX = (x - minX) / spanX;

        ctx.fillStyle = 'rgba(255, 60, 60, 0.4)';
        ctx.fillRect(normX * thirdW, h - (r / 255) * h, 1.5, 1.5);

        ctx.fillStyle = 'rgba(60, 255, 60, 0.4)';
        ctx.fillRect(thirdW + normX * thirdW, h - (g / 255) * h, 1.5, 1.5);

        ctx.fillStyle = 'rgba(80, 150, 255, 0.4)';
        ctx.fillRect(thirdW * 2 + normX * thirdW, h - (b / 255) * h, 1.5, 1.5);
      }
    }
    ctx.restore();
  }

  renderHistogram(pixels, sw, sh, w, h) {
    const rCount = new Float32Array(256);
    const gCount = new Float32Array(256);
    const bCount = new Float32Array(256);

    const step = 4;
    let validPixels = 0;

    for (let i = 0; i < pixels.length; i += step * 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const a = pixels[i + 3];

      if (a > 10) {
        rCount[r]++;
        gCount[g]++;
        bCount[b]++;
        validPixels++;
      }
    }

    if (validPixels === 0) return;

    const smoothR = new Float32Array(256);
    const smoothG = new Float32Array(256);
    const smoothB = new Float32Array(256);

    for (let i = 0; i < 256; i++) {
      const prev = Math.max(0, i - 1);
      const next = Math.min(255, i + 1);
      smoothR[i] = (rCount[prev] + rCount[i] * 2 + rCount[next]) / 4;
      smoothG[i] = (gCount[prev] + gCount[i] * 2 + gCount[next]) / 4;
      smoothB[i] = (bCount[prev] + bCount[i] * 2 + bCount[next]) / 4;
    }

    let maxVal = 1;
    for (let i = 1; i < 255; i++) {
      const logR = Math.log1p(smoothR[i]);
      const logG = Math.log1p(smoothG[i]);
      const logB = Math.log1p(smoothB[i]);
      if (logR > maxVal) maxVal = logR;
      if (logG > maxVal) maxVal = logG;
      if (logB > maxVal) maxVal = logB;
    }

    const ctx = this.ctx;

    // 히스토그램 배경: 톤 인디케이터 바
    const bgGrad = ctx.createLinearGradient(0, 0, w, 0);
    bgGrad.addColorStop(0,    'rgba(0,0,0,0.9)');
    bgGrad.addColorStop(0.25, 'rgba(30,30,30,0.9)');
    bgGrad.addColorStop(0.5,  'rgba(60,60,60,0.9)');
    bgGrad.addColorStop(0.75, 'rgba(35,35,35,0.9)');
    bgGrad.addColorStop(1,    'rgba(10,10,10,0.9)');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Shadows / Midtones / Highlights 영역 표시
    ctx.fillStyle = 'rgba(80, 120, 200, 0.08)';
    ctx.fillRect(0, 0, w * 0.33, h);
    ctx.fillStyle = 'rgba(200, 200, 200, 0.05)';
    ctx.fillRect(w * 0.33, 0, w * 0.34, h);
    ctx.fillStyle = 'rgba(220, 180, 80, 0.08)';
    ctx.fillRect(w * 0.67, 0, w * 0.33, h);

    // 영역 레이블
    ctx.fillStyle = 'rgba(120,160,255,0.45)';
    ctx.font = `${Math.floor(h * 0.09)}px monospace`;
    ctx.fillText('S', 4, h - 4);
    ctx.fillStyle = 'rgba(200,200,200,0.45)';
    ctx.fillText('M', w / 2 - 5, h - 4);
    ctx.fillStyle = 'rgba(255,210,80,0.45)';
    ctx.fillText('H', w - 14, h - 4);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    const drawChannel = (arr, fillColor, strokeColor) => {
      ctx.fillStyle = fillColor;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, h);

      for (let i = 0; i < 256; i++) {
        const x = (i / 255) * w;
        const normH = Math.min(1.0, Math.log1p(arr[i]) / maxVal);
        const y = h - normH * (h - 8);
        ctx.lineTo(x, y);
      }

      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    };

    drawChannel(smoothR, 'rgba(235, 75, 75, 0.45)', 'rgba(255, 90, 90, 0.9)');
    drawChannel(smoothG, 'rgba(46, 204, 113, 0.45)', 'rgba(60, 225, 125, 0.9)');
    drawChannel(smoothB, 'rgba(52, 152, 219, 0.45)', 'rgba(75, 175, 255, 0.9)');

    ctx.restore();
  }

  renderVectorscope(pixels, sw, sh, w, h) {
    const ctx = this.ctx;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(cx, cy) - 10;

    // 콼러 휴 배경 이미지 (원형 HSL 바퀴)
    const bgData = ctx.createImageData(w, h);
    const buf = bgData.data;
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const dx = (px - cx) / radius;
        const dy = (py - cy) / radius;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= 1.0) {
          const angle = Math.atan2(dy, dx);
          const hue = ((angle / (Math.PI * 2)) + 1) % 1;
          const sat = dist;
          const [r, g, b] = this.hslToRgb(hue, sat, 0.45);
          const idx = (py * w + px) * 4;
          buf[idx]     = r;
          buf[idx + 1] = g;
          buf[idx + 2] = b;
          buf[idx + 3] = Math.round(180 * (1 - dist * 0.5));
        }
      }
    }
    ctx.putImageData(bgData, 0, 0);

    // 외곽 원
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    // 중심 4방향 가이드선
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius);
    ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy);
    ctx.stroke();
    ctx.setLineDash([]);

    // 콼러 마커 (R, G, B, Y, Cy, Mg)
    const markerColors = [
      { angle: 0,   label: 'R',  col: 'red' },
      { angle: 120, label: 'G',  col: 'lime' },
      { angle: 240, label: 'B',  col: 'dodgerblue' },
      { angle: 60,  label: 'Y',  col: 'yellow' },
      { angle: 180, label: 'Cy', col: 'cyan' },
      { angle: 300, label: 'Mg', col: 'magenta' },
    ];
    markerColors.forEach(({ angle, label, col }) => {
      const rad = (angle / 360) * Math.PI * 2;
      const mx = cx + Math.cos(rad) * radius * 0.88;
      const my = cy + Math.sin(rad) * radius * 0.88;
      ctx.fillStyle = col;
      ctx.font = '10px monospace';
      ctx.fillText(label, mx - 5, my + 4);
    });

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255, 230, 100, 0.3)';

    const step = Math.max(1, Math.floor(pixels.length / (10000 * 4)));
    for (let i = 0; i < pixels.length; i += step * 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];

      const cb = -0.168736 * r - 0.331264 * g + 0.5 * b;
      const cr = 0.5 * r - 0.418688 * g - 0.081312 * b;

      const px = cx + (cb / 128) * radius;
      const py = cy - (cr / 128) * radius;

      ctx.fillRect(px, py, 1.5, 1.5);
    }
    ctx.restore();
  }

  // HSL 변환 헬퍼
  hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1; if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }
}

window.ScopeMonitor = ScopeMonitor;
