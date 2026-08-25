/**
 * SemiLightroom - Monotone Cubic Spline RGB & S-Curve Tone Curve Editor
 * 자연스럽고 매끄러운 Fritsch-Carlson 모노톤 3차 스플라인 보간법 적용
 */

class ToneCurveUI {
  constructor(canvasId, engine) {
    this.canvas = document.getElementById(canvasId);
    this.engine = engine;
    this.channel = 'rgb'; // 'rgb', 'r', 'g', 'b'

    // 4개 채널별 제어점 리스트 (0.0 ~ 1.0)
    this.curves = {
      rgb: [{ x: 0.0, y: 0.0 }, { x: 1.0, y: 1.0 }],
      r: [{ x: 0.0, y: 0.0 }, { x: 1.0, y: 1.0 }],
      g: [{ x: 0.0, y: 0.0 }, { x: 1.0, y: 1.0 }],
      b: [{ x: 0.0, y: 0.0 }, { x: 1.0, y: 1.0 }]
    };

    this.activePointIndex = -1;
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

  // 매끄러운 S-Curve 프리셋
  setSCurve() {
    this.curves[this.channel] = [
      { x: 0.0, y: 0.0 },
      { x: 0.25, y: 0.18 }, // 섀도우 딥 블랙
      { x: 0.75, y: 0.82 }, // 하이라이트 펀치
      { x: 1.0, y: 1.0 }
    ];
    this.syncToEngine();
    this.render();
  }

  reset() {
    this.curves[this.channel] = [{ x: 0.0, y: 0.0 }, { x: 1.0, y: 1.0 }];
    this.syncToEngine();
    this.render();
  }

  resetAll() {
    this.curves = {
      rgb: [{ x: 0.0, y: 0.0 }, { x: 1.0, y: 1.0 }],
      r: [{ x: 0.0, y: 0.0 }, { x: 1.0, y: 1.0 }],
      g: [{ x: 0.0, y: 0.0 }, { x: 1.0, y: 1.0 }],
      b: [{ x: 0.0, y: 0.0 }, { x: 1.0, y: 1.0 }]
    };
    this.syncToEngine();
    this.render();
  }

  initEvents() {
    const canvas = this.canvas;

    document.querySelectorAll('.tc-channel-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tc-channel-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.setChannel(btn.getAttribute('data-channel'));
      });
    });

    document.getElementById('btn-scurve-preset')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setSCurve();
      if (this.engine && this.engine.params.toneCurve) {
        this.engine.params.toneCurve.enabled = true;
        document.querySelector('.module-power-btn[data-module="toneCurve"]')?.classList.add('active');
      }
    });

    document.getElementById('btn-reset-tonecurve')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.reset();
    });

    canvas.addEventListener('mousedown', (e) => {
      const pos = this.getNormPos(e);
      const pts = this.curves[this.channel];

      let hit = -1;
      for (let i = 0; i < pts.length; i++) {
        if (Math.hypot(pts[i].x - pos.x, pts[i].y - pos.y) < 0.06) {
          hit = i;
          break;
        }
      }

      if (hit !== -1) {
        this.activePointIndex = hit;
      } else {
        pts.push(pos);
        pts.sort((a, b) => a.x - b.x);
        this.activePointIndex = pts.indexOf(pos);
      }

      this.isDragging = true;
      if (this.engine && this.engine.params.toneCurve) {
        this.engine.params.toneCurve.enabled = true;
        document.querySelector('.module-power-btn[data-module="toneCurve"]')?.classList.add('active');
      }
      this.syncToEngine();
      this.render();
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging || this.activePointIndex === -1) return;
      const pos = this.getNormPos(e);
      const pts = this.curves[this.channel];

      if (this.activePointIndex === 0) {
        pts[0].y = pos.y;
      } else if (this.activePointIndex === pts.length - 1) {
        pts[pts.length - 1].y = pos.y;
      } else {
        pts[this.activePointIndex] = pos;
        pts.sort((a, b) => a.x - b.x);
        this.activePointIndex = pts.indexOf(pos);
      }

      this.syncToEngine();
      this.render();
    });

    // ── 모바일 터치 지원 ──
    const handleTouchStart = (e) => {
      if (e.touches.length > 0) {
        e.preventDefault();
        const touch = e.touches[0];
        const rect = canvas.getBoundingClientRect();
        const pos = {
          x: Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width)),
          y: Math.max(0, Math.min(1, 1.0 - (touch.clientY - rect.top) / rect.height))
        };
        const pts = this.curves[this.channel];

        let hit = -1;
        for (let i = 0; i < pts.length; i++) {
          if (Math.hypot(pts[i].x - pos.x, pts[i].y - pos.y) < 0.14) {
            hit = i;
            break;
          }
        }

        if (hit !== -1) {
          this.activePointIndex = hit;
        } else {
          pts.push(pos);
          pts.sort((a, b) => a.x - b.x);
          this.activePointIndex = pts.indexOf(pos);
        }

        this.isDragging = true;
        if (this.engine && this.engine.params.toneCurve) {
          this.engine.params.toneCurve.enabled = true;
          document.querySelector('.module-power-btn[data-module="toneCurve"]')?.classList.add('active');
        }
        this.syncToEngine();
        this.render();
      }
    };

    const handleTouchMove = (e) => {
      if (!this.isDragging || this.activePointIndex === -1 || e.touches.length === 0) return;
      e.preventDefault();
      const touch = e.touches[0];
      const rect = canvas.getBoundingClientRect();
      const pos = {
        x: Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, 1.0 - (touch.clientY - rect.top) / rect.height))
      };
      const pts = this.curves[this.channel];

      if (this.activePointIndex === 0) {
        pts[0].y = pos.y;
      } else if (this.activePointIndex === pts.length - 1) {
        pts[pts.length - 1].y = pos.y;
      } else {
        pts[this.activePointIndex] = pos;
        pts.sort((a, b) => a.x - b.x);
        this.activePointIndex = pts.indexOf(pos);
      }

      this.syncToEngine();
      this.render();
    };

    const handleTouchEnd = () => {
      this.isDragging = false;
      this.activePointIndex = -1;
    };

    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd);

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
      this.activePointIndex = -1;
    });

    canvas.addEventListener('dblclick', (e) => {
      const pos = this.getNormPos(e);
      const pts = this.curves[this.channel];
      for (let i = 1; i < pts.length - 1; i++) {
        if (Math.hypot(pts[i].x - pos.x, pts[i].y - pos.y) < 0.08) {
          pts.splice(i, 1);
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
    const y = Math.max(0, Math.min(1, 1.0 - (e.clientY - rect.top) / rect.height));
    return { x, y };
  }

  /**
   * 2. Fritsch-Carlson Monotone Cubic Spline (자연스럽고 부드러운 곡선)
   */
  evaluateCurve(channel) {
    const pts = this.curves[channel];
    const n = pts.length;
    const lut = new Float32Array(256);

    if (n === 2) {
      // 단순 직선
      for (let i = 0; i < 256; i++) {
        const t = i / 255;
        const y = pts[0].y + (pts[1].y - pts[0].y) * t;
        lut[i] = Math.max(0, Math.min(1, y));
      }
      return lut;
    }

    const x = pts.map(p => p.x);
    const y = pts.map(p => p.y);

    const d = new Float32Array(n - 1);
    const m = new Float32Array(n);

    for (let k = 0; k < n - 1; k++) {
      const dx = x[k + 1] - x[k];
      d[k] = dx > 0 ? (y[k + 1] - y[k]) / dx : 0;
    }

    m[0] = d[0];
    for (let k = 1; k < n - 1; k++) {
      if (d[k - 1] * d[k] <= 0) {
        m[k] = 0;
      } else {
        m[k] = (d[k - 1] + d[k]) * 0.5;
      }
    }
    m[n - 1] = d[n - 2];

    for (let k = 0; k < n - 1; k++) {
      if (d[k] === 0) {
        m[k] = 0;
        m[k + 1] = 0;
      } else {
        const alpha = m[k] / d[k];
        const beta = m[k + 1] / d[k];
        const sum = alpha * alpha + beta * beta;
        if (sum > 9) {
          const tau = 3 / Math.sqrt(sum);
          m[k] = tau * alpha * d[k];
          m[k + 1] = tau * beta * d[k];
        }
      }
    }

    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      let k = 0;
      for (let j = 0; j < n - 1; j++) {
        if (t >= x[j] && t <= x[j + 1]) {
          k = j;
          break;
        }
      }

      const h = x[k + 1] - x[k];
      const s = h > 0 ? (t - x[k]) / h : 0;
      const h00 = (1 + 2 * s) * (1 - s) * (1 - s);
      const h10 = s * (1 - s) * (1 - s);
      const h01 = s * s * (3 - 2 * s);
      const h11 = s * s * (s - 1);

      const val = h00 * y[k] + h10 * h * m[k] + h01 * y[k + 1] + h11 * h * m[k + 1];
      lut[i] = Math.max(0, Math.min(1, val));
    }

    return lut;
  }

  syncToEngine() {
    if (!this.engine) return;
    this.engine.params.toneCurveLut = {
      rgb: this.evaluateCurve('rgb'),
      r: this.evaluateCurve('r'),
      g: this.evaluateCurve('g'),
      b: this.evaluateCurve('b')
    };
    this.engine.render();
  }

  render() {
    if (!this.canvas || !this.ctx) return;
    const ctx = this.ctx;
    const w = this.canvas.width = this.canvas.clientWidth * (window.devicePixelRatio || 1);
    const h = this.canvas.height = this.canvas.clientHeight * (window.devicePixelRatio || 1);
    if (w === 0 || h === 0) return;

    ctx.fillStyle = '#141414';
    ctx.fillRect(0, 0, w, h);

    // 격자선
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo((w / 4) * i, 0); ctx.lineTo((w / 4) * i, h);
      ctx.moveTo(0, (h / 4) * i); ctx.lineTo(w, (h / 4) * i);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.beginPath();
    ctx.moveTo(0, h); ctx.lineTo(w, 0);
    ctx.stroke();

    // 자연스러운 곡선 그리기
    const lut = this.evaluateCurve(this.channel);
    let color = '#dca353';
    if (this.channel === 'r') color = '#e74c3c';
    if (this.channel === 'g') color = '#2ecc71';
    if (this.channel === 'b') color = '#3498db';

    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * w;
      const y = h - lut[i] * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 제어점 그리기
    const pts = this.curves[this.channel];
    pts.forEach((pt) => {
      const px = pt.x * w;
      const py = h - pt.y * h;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(px, py, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#121212';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
  }
}

window.ToneCurveUI = ToneCurveUI;
