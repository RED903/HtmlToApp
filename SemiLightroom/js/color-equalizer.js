/**
 * SemiLightroom - Interactive 8-Band Color Equalizer UI
 */

class ColorEqualizerUI {
  constructor(canvasId, engine) {
    this.canvas = document.getElementById(canvasId);
    this.engine = engine;
    this.channel = 'hue'; // 'hue', 'saturation', 'brightness'

    // 8개 색상 대역 노드 (0 = neutral)
    this.nodes = {
      hue: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
      saturation: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
      brightness: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
    };

    // 8개 색상 대역의 중심 X 좌표 (0~1)
    this.centers = [
      0.0625, // Red
      0.1875, // Orange
      0.3125, // Yellow
      0.4375, // Green
      0.5625, // Cyan
      0.6875, // Blue
      0.8125, // Violet
      0.9375  // Magenta
    ];

    this.activeNodeIndex = -1;
    this.isDragging = false;

    if (this.canvas) {
      this.ctx = this.canvas.getContext('2d');
      this.initEvents();
      this.render();
    }
  }

  setChannel(ch) {
    this.channel = ch;
    this.render();
  }

  reset() {
    this.nodes[this.channel] = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
    this.syncToEngine();
    this.render();
  }

  resetAll() {
    this.nodes = {
      hue: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
      saturation: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
      brightness: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
    };
    this.syncToEngine();
    this.render();
  }

  initEvents() {
    const canvas = this.canvas;

    document.querySelectorAll('.ceq-subtab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.ceq-subtab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.setChannel(btn.getAttribute('data-channel'));
      });
    });

    canvas.addEventListener('mousedown', (e) => {
      const pos = this.getNormPos(e);
      let closest = 0;
      let minDist = 999;

      for (let i = 0; i < 8; i++) {
        const d = Math.abs(pos.x - this.centers[i]);
        if (d < minDist) {
          minDist = d;
          closest = i;
        }
      }

      this.activeNodeIndex = closest;
      this.isDragging = true;
      this.nodes[this.channel][closest] = Math.max(-1.0, Math.min(1.0, pos.y));

      // 3. 컬러 이퀄라이저 즉시 활성화 및 렌더링
      if (this.engine && this.engine.params.colorEqualizer) {
        this.engine.params.colorEqualizer.enabled = true;
        document.querySelector('.module-power-btn[data-module="colorEqualizer"]')?.classList.add('active');
      }

      this.syncToEngine();
      this.render();
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging || this.activeNodeIndex === -1) return;
      const pos = this.getNormPos(e);
      this.nodes[this.channel][this.activeNodeIndex] = Math.max(-1.0, Math.min(1.0, pos.y));
      this.syncToEngine();
      this.render();
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
      this.activeNodeIndex = -1;
    });

    canvas.addEventListener('dblclick', (e) => {
      const pos = this.getNormPos(e);
      for (let i = 0; i < 8; i++) {
        if (Math.abs(pos.x - this.centers[i]) < 0.08) {
          this.nodes[this.channel][i] = 0.0;
          this.syncToEngine();
          this.render();
          break;
        }
      }
    });
  }

  getNormPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    // y는 -1.0(아래) ~ +1.0(위)
    const rawY = 1.0 - ((e.clientY - rect.top) / rect.height);
    const y = (rawY - 0.5) * 2.0;
    return { x, y };
  }

  syncToEngine() {
    if (!this.engine || !this.engine.params.colorEqualizer) return;
    const ceq = this.engine.params.colorEqualizer;

    for (let i = 0; i < 8; i++) {
      ceq.hue[i] = this.nodes.hue[i];
      ceq.sat[i] = this.nodes.saturation[i];
      ceq.bri[i] = this.nodes.brightness[i];
    }

    this.engine.render();
  }

  /**
   * 8개 노드의 정확한 위치와 색상에 1:1로 매칭되는 Base Hue 보간
   */
  getBaseHue(normX) {
    const centers = [0.0625, 0.1875, 0.3125, 0.4375, 0.5625, 0.6875, 0.8125, 0.9375];
    const hues    = [0,      35,     60,     120,    180,    240,    280,    325];

    if (normX <= centers[0]) {
      const t = normX / centers[0];
      return (340 + t * 20) % 360;
    }
    if (normX >= centers[7]) {
      const t = (normX - centers[7]) / (1.0 - centers[7]);
      return (325 + t * 20) % 360;
    }

    for (let i = 0; i < 7; i++) {
      if (normX >= centers[i] && normX <= centers[i + 1]) {
        const t = (normX - centers[i]) / (centers[i + 1] - centers[i]);
        return hues[i] + t * (hues[i + 1] - hues[i]);
      }
    }
    return normX * 360;
  }

  drawBackground(ctx, w, h) {
    const ch = this.channel;
    const imageData = ctx.createImageData(w, h);
    const buf = imageData.data;

    for (let px = 0; px < w; px++) {
      const normX = px / w;
      const baseHue = this.getBaseHue(normX);

      for (let py = 0; py < h; py++) {
        const normY = py / h; // 0(위) ~ 1(아래)
        let r, g, b;

        if (ch === 'hue') {
          // 중앙선(normY = 0.5)에서 각 노드의 정확한 원래 색상과 일치!
          const hueShift = (0.5 - normY) * 110;
          const currentHue = ((baseHue + hueShift) % 360 + 360) % 360;
          const lightness = 0.54 + (0.5 - normY) * 0.12;
          [r, g, b] = this.hslToRgb(currentHue / 360, 0.85, lightness);

        } else if (ch === 'saturation') {
          const sat = Math.max(0.02, Math.min(1.0, 1.0 - normY * 0.95));
          [r, g, b] = this.hslToRgb(baseHue / 360, sat, 0.52);

        } else {
          const light = Math.max(0.05, Math.min(0.95, 0.94 - normY * 0.85));
          [r, g, b] = this.hslToRgb(baseHue / 360, 0.70, light);
        }

        const idx = (py * w + px) * 4;
        buf[idx]     = r;
        buf[idx + 1] = g;
        buf[idx + 2] = b;
        buf[idx + 3] = 235;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }

  // HSL → RGB 변환 헬퍼
  hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) {
      r = g = b = l;
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
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

  render() {
    if (!this.canvas || !this.ctx) return;
    const ctx = this.ctx;
    const w = this.canvas.width = this.canvas.clientWidth * (window.devicePixelRatio || 1);
    const h = this.canvas.height = this.canvas.clientHeight * (window.devicePixelRatio || 1);
    if (w === 0 || h === 0) return;

    // 1. 채널별 대각선 HSL 배경 그라디언트
    this.drawBackground(ctx, w, h);

    // 2. 8개 대역 구분 점선 격자
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    for (let col = 1; col < 8; col++) {
      const cx = (col / 8) * w;
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, h);
      ctx.stroke();
    }
    for (let row = 1; row <= 3; row++) {
      const ry = (row / 4) * h;
      ctx.beginPath();
      ctx.moveTo(0, ry);
      ctx.lineTo(w, ry);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // 3. 중앙 기준선 (Y = 0)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    // 4. 부드러운 스플라인 조절선
    const arr = this.nodes[this.channel];

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 3;
    ctx.beginPath();

    for (let x = 0; x <= w; x += 2) {
      const normX = x / w;
      let val = 0;
      for (let i = 0; i < 8; i++) {
        let dist = Math.abs(normX - this.centers[i]);
        if (dist > 0.5) dist = 1.0 - dist;
        let weight = Math.max(0, 1.0 - (dist / 0.16));
        weight = weight * weight * (3 - 2 * weight);
        val += arr[i] * weight;
      }
      val = Math.max(-1.0, Math.min(1.0, val));
      const py = (h / 2) - (val * (h * 0.42));

      if (x === 0) ctx.moveTo(x, py);
      else ctx.lineTo(x, py);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // 5. 8개 노드 점 그리기 (배경과 1:1 일치하는 각 대역 색상)
    const nodeColors = [
      '#ff3b30', // Red (0°)
      '#ff9500', // Orange (35°)
      '#ffd60a', // Yellow (60°)
      '#30d158', // Green (120°)
      '#64d2ff', // Cyan (180°)
      '#0a84ff', // Blue (240°)
      '#bf5af2', // Violet (280°)
      '#ff375f'  // Magenta (325°)
    ];

    for (let i = 0; i < 8; i++) {
      const cx = this.centers[i] * w;
      const cy = (h / 2) - (arr[i] * (h * 0.42));

      // 외곽 그림자
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 4;

      // 컬러 채우기
      ctx.fillStyle = nodeColors[i];
      ctx.beginPath();
      ctx.arc(cx, cy, 6.5, 0, Math.PI * 2);
      ctx.fill();

      // 흰 테두리
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // 중심 점
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.arc(cx, cy, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

}

window.ColorEqualizerUI = ColorEqualizerUI;
