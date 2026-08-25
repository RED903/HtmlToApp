/**
 * SemiLightroom - Interactive Crop & Horizon Controller
 * 1. 크롭과 회전이 서로 간섭 없이 완벽하게 공존하는 비파괴 파이프라인
 * 2. 2점 클릭 실시간 점선 가이드라인 기반 수평선 자동 맞춤
 */

class CropHorizonController {
  constructor(viewportContainer, engine, onAngleChange, onCropApplied) {
    this.container = viewportContainer;
    this.engine = engine;
    this.onAngleChange = onAngleChange;
    this.onCropApplied = onCropApplied;

    this.cropActive = false;
    this.horizonActive = false;
    this.horizonPoints = [];
    this.currentMousePos = null;

    // cropRect는 회전된 이미지 기준 정규화 좌표 [0.0 ~ 1.0]
    this.cropRect = { x: 0.0, y: 0.0, w: 1.0, h: 1.0 };
    this.aspectRatio = null; // null: 자율(Free), 1.0(1:1), 1.5(3:2), 1.333(4:3), 1.777(16:9)
    this.dragTarget = null;
    this.dragStartPos = { x: 0, y: 0 };
    this.initialRect = null;

    this.initOverlay();
  }

  initOverlay() {
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.id = 'crop-horizon-overlay';
    this.overlayCanvas.style.position = 'absolute';
    this.overlayCanvas.style.top = '0';
    this.overlayCanvas.style.left = '0';
    this.overlayCanvas.style.width = '100%';
    this.overlayCanvas.style.height = '100%';
    this.overlayCanvas.style.pointerEvents = 'none';
    this.overlayCanvas.style.zIndex = '40';
    this.container.appendChild(this.overlayCanvas);

    this.ctx = this.overlayCanvas.getContext('2d');
    this.resize();

    window.addEventListener('resize', () => this.resize());
    this.setupEvents();
  }

  resize() {
    const rect = this.container.getBoundingClientRect();
    this.overlayCanvas.width = rect.width;
    this.overlayCanvas.height = rect.height;
    this.draw();
  }

  /**
   * 화면 상에서 원본 회전 이미지가 차지하고 있는 픽셀 바운딩 박스 계산
   */
  getImageBoundsOnScreen() {
    const W = this.overlayCanvas.width;
    const H = this.overlayCanvas.height;
    if (!this.engine || !this.engine.sourceTexture) {
      return { x: 0, y: 0, w: W, h: H, imgW: W, imgH: H };
    }

    const rot = this.engine.params.orientation.rotate;
    let imgW = (rot === 90 || rot === 270) ? this.engine.imageHeight : this.engine.imageWidth;
    let imgH = (rot === 90 || rot === 270) ? this.engine.imageWidth : this.engine.imageHeight;

    const canvasAspect = W / Math.max(1, H);
    const imgAspect = imgW / Math.max(1, imgH);

    let scaleX = 1.0;
    let scaleY = 1.0;
    if (imgAspect > canvasAspect) {
      scaleX = 1.0;
      scaleY = canvasAspect / imgAspect;
    } else {
      scaleX = imgAspect / canvasAspect;
      scaleY = 1.0;
    }

    const zoom = this.engine.params.viewport.zoom || 1.0;
    const panX = this.engine.params.viewport.panX || 0.0;
    const panY = this.engine.params.viewport.panY || 0.0;

    const drawW = scaleX * zoom * W;
    const drawH = scaleY * zoom * H;

    const centerX = (W / 2) + panX * (W / 2);
    const centerY = (H / 2) - panY * (H / 2);

    const drawX = centerX - drawW / 2;
    const drawY = centerY - drawH / 2;

    return { x: drawX, y: drawY, w: drawW, h: drawH, imgW, imgH };
  }

  /**
   * 2점 수평선 맞춤 모드 활성화/비활성화
   */
  setHorizonMode(active) {
    this.horizonActive = active;
    this.cropActive = false;
    this.horizonPoints = [];
    this.currentMousePos = null;
    this.overlayCanvas.style.pointerEvents = active ? 'auto' : 'none';
    this.overlayCanvas.style.cursor = active ? 'crosshair' : 'default';
    this.draw();
  }

  /**
   * 크롭 모드 진입/해제 (회전 각도는 온전히 유지한 채 크롭 편집)
   */
  setCropMode(active) {
    this.cropActive = active;
    this.horizonActive = false;
    this.overlayCanvas.style.pointerEvents = active ? 'auto' : 'none';
    this.overlayCanvas.style.cursor = active ? 'crosshair' : 'default';

    if (active) {
      // 크롭 편집 중에는 회전된 전체 사진을 보며 크롭 박스를 조절
      const cr = this.engine.params.crop;
      if (cr && cr.enabled && cr.width > 0.01) {
        this.cropRect = { x: cr.x, y: cr.y, w: cr.width, h: cr.height };
      } else {
        this.cropRect = { x: 0.0, y: 0.0, w: 1.0, h: 1.0 };
      }
      this.engine.params.crop.enabled = false;
      this.engine.render();
    } else {
      const cr = this.engine.params.crop;
      if (cr && (cr.width < 0.999 || cr.height < 0.999 || cr.x > 0.001 || cr.y > 0.001)) {
        cr.enabled = true;
      }
      this.engine.render();
    }
    this.draw();
  }

  /**
   * 비율 선택 시 완벽한 1:1, 16:9, 3:2 비율 창 생성
   */
  setAspectRatio(ratio) {
    this.aspectRatio = ratio;

    if (ratio === null) {
      this.cropRect = { x: 0.0, y: 0.0, w: 1.0, h: 1.0 };
    } else {
      const bounds = this.getImageBoundsOnScreen();

      let w = 0.85;
      let h = (w * bounds.w) / (bounds.h * ratio);

      if (h > 0.85) {
        h = 0.85;
        w = (h * bounds.h * ratio) / bounds.w;
      }

      this.cropRect = {
        x: Math.max(0.0, (1.0 - w) / 2),
        y: Math.max(0.0, (1.0 - h) / 2),
        w: Math.min(1.0, w),
        h: Math.min(1.0, h)
      };
    }
    this.draw();
  }

  applyCrop() {
    const cr = this.engine.params.crop;
    cr.enabled = true;
    cr.x = this.cropRect.x;
    cr.y = this.cropRect.y;
    cr.width = this.cropRect.w;
    cr.height = this.cropRect.h;

    this.cropActive = false;
    this.overlayCanvas.style.pointerEvents = 'none';
    this.overlayCanvas.style.cursor = 'default';

    if (this.onCropApplied) {
      this.onCropApplied(this.cropRect);
    }
    this.engine.render();
    this.draw();
  }

  resetCrop() {
    const cr = this.engine.params.crop;
    cr.enabled = false;
    cr.x = 0.0;
    cr.y = 0.0;
    cr.width = 1.0;
    cr.height = 1.0;

    this.cropRect = { x: 0.0, y: 0.0, w: 1.0, h: 1.0 };
    this.aspectRatio = null;
    this.cropActive = false;
    this.overlayCanvas.style.pointerEvents = 'none';
    this.overlayCanvas.style.cursor = 'default';

    if (this.onCropApplied) {
      this.onCropApplied(null);
    }
    this.engine.render();
    this.draw();
  }

  setupEvents() {
    this.overlayCanvas.addEventListener('mousedown', (e) => {
      const pos = this.getCanvasPos(e);

      // 1. 2점 수평선 측정 모드
      if (this.horizonActive) {
        this.horizonPoints.push(pos);

        if (this.horizonPoints.length === 2) {
          const p1 = this.horizonPoints[0];
          const p2 = this.horizonPoints[1];
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;

          // 두 점을 이은 선분이 수평선(0도)이 되도록 회전각 계산
          let angleDeg = -(Math.atan2(dy, dx) * 180 / Math.PI);
          if (angleDeg > 90) angleDeg -= 180;
          if (angleDeg < -90) angleDeg += 180;

          angleDeg = parseFloat(angleDeg.toFixed(1));
          
          if (!this.engine.params.geometry) {
            this.engine.params.geometry = { enabled: true, angle: 0.0 };
          }
          this.engine.params.geometry.angle = angleDeg;

          if (this.onAngleChange) {
            this.onAngleChange(angleDeg);
          }

          this.engine.render();
          this.draw();

          setTimeout(() => this.setHorizonMode(false), 300);
        } else {
          this.draw();
        }
        return;
      }

      // 2. 크롭 조작 모드
      if (this.cropActive) {
        const hit = this.hitTestCrop(pos.x, pos.y);
        if (hit) {
          this.dragTarget = hit;
          this.dragStartPos = pos;
          this.initialRect = { ...this.cropRect };
        }
      }
    });

    window.addEventListener('mousemove', (e) => {
      const pos = this.getCanvasPos(e);

      // 수평선 점 1 찍힌 후 마우스 커서와 실시간 점선 연결
      if (this.horizonActive && this.horizonPoints.length === 1) {
        this.currentMousePos = pos;
        this.draw();
        return;
      }

      if (!this.cropActive || !this.dragTarget) return;

      const bounds = this.getImageBoundsOnScreen();

      const dx = (pos.x - this.dragStartPos.x) / Math.max(1, bounds.w);
      const dy = (pos.y - this.dragStartPos.y) / Math.max(1, bounds.h);
      const init = this.initialRect;
      let r = { ...init };

      const normRatio = this.aspectRatio ? this.aspectRatio * (bounds.h / bounds.w) : null;

      if (this.dragTarget === 'move') {
        r.x = Math.max(0.0, Math.min(1.0 - r.w, init.x + dx));
        r.y = Math.max(0.0, Math.min(1.0 - r.h, init.y + dy));

      } else if (this.dragTarget === 'br') {
        const anchorX = init.x;
        const anchorY = init.y;
        let newW = Math.max(0.05, Math.min(1.0 - anchorX, init.w + dx));
        let newH = normRatio ? newW / normRatio : Math.max(0.05, Math.min(1.0 - anchorY, init.h + dy));

        if (normRatio && anchorY + newH > 1.0) {
          newH = 1.0 - anchorY;
          newW = newH * normRatio;
        }

        r.x = anchorX;
        r.y = anchorY;
        r.w = Math.max(0.05, Math.min(1.0 - anchorX, newW));
        r.h = Math.max(0.05, Math.min(1.0 - anchorY, newH));

      } else if (this.dragTarget === 'tl') {
        const anchorX = init.x + init.w;
        const anchorY = init.y + init.h;
        let newW = Math.max(0.05, Math.min(anchorX, init.w - dx));
        let newH = normRatio ? newW / normRatio : Math.max(0.05, Math.min(anchorY, init.h - dy));

        if (normRatio && anchorY - newH < 0.0) {
          newH = anchorY;
          newW = newH * normRatio;
        }

        r.x = Math.max(0.0, anchorX - newW);
        r.y = Math.max(0.0, anchorY - newH);
        r.w = anchorX - r.x;
        r.h = anchorY - r.y;

      } else if (this.dragTarget === 'tr') {
        const anchorX = init.x;
        const anchorY = init.y + init.h;
        let newW = Math.max(0.05, Math.min(1.0 - anchorX, init.w + dx));
        let newH = normRatio ? newW / normRatio : Math.max(0.05, Math.min(anchorY, init.h - dy));

        if (normRatio && anchorY - newH < 0.0) {
          newH = anchorY;
          newW = newH * normRatio;
        }

        r.x = anchorX;
        r.y = Math.max(0.0, anchorY - newH);
        r.w = Math.max(0.05, Math.min(1.0 - anchorX, newW));
        r.h = anchorY - r.y;

      } else if (this.dragTarget === 'bl') {
        const anchorX = init.x + init.w;
        const anchorY = init.y;
        let newW = Math.max(0.05, Math.min(anchorX, init.w - dx));
        let newH = normRatio ? newW / normRatio : Math.max(0.05, Math.min(1.0 - anchorY, init.h + dy));

        if (normRatio && anchorY + newH > 1.0) {
          newH = 1.0 - anchorY;
          newW = newH * normRatio;
        }

        r.x = Math.max(0.0, anchorX - newW);
        r.y = anchorY;
        r.w = anchorX - r.x;
        r.h = Math.max(0.05, Math.min(1.0 - anchorY, newH));
      }

      this.cropRect = r;
      this.draw();
    });

    window.addEventListener('mouseup', () => {
      this.dragTarget = null;
    });
  }

  getCanvasPos(e) {
    const rect = this.overlayCanvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  getCropBoxPixels() {
    const bounds = this.getImageBoundsOnScreen();
    return {
      x: bounds.x + this.cropRect.x * bounds.w,
      y: bounds.y + this.cropRect.y * bounds.h,
      w: this.cropRect.w * bounds.w,
      h: this.cropRect.h * bounds.h,
      bounds
    };
  }

  hitTestCrop(px, py) {
    const box = this.getCropBoxPixels();
    const x = box.x;
    const y = box.y;
    const w = box.w;
    const h = box.h;

    const threshold = 18;
    if (Math.hypot(px - x, py - y) < threshold) return 'tl';
    if (Math.hypot(px - (x + w), py - y) < threshold) return 'tr';
    if (Math.hypot(px - x, py - (y + h)) < threshold) return 'bl';
    if (Math.hypot(px - (x + w), py - (y + h)) < threshold) return 'br';

    if (px >= x && px <= x + w && py >= y && py <= y + h) return 'move';
    return null;
  }

  draw() {
    const ctx = this.ctx;
    const W = this.overlayCanvas.width;
    const H = this.overlayCanvas.height;
    ctx.clearRect(0, 0, W, H);

    // 1. 2점 수평선 가이드라인 렌더링
    if (this.horizonActive) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(0, 0, W, H);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 13px sans-serif';
      ctx.fillText('📏 수평선(기준선)이 될 두 점을 차례로 클릭하세요', 24, 36);

      if (this.horizonPoints.length >= 1) {
        const p1 = this.horizonPoints[0];
        ctx.fillStyle = '#dca353';
        ctx.beginPath();
        ctx.arc(p1.x, p1.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        const p2 = (this.horizonPoints.length === 2) ? this.horizonPoints[1] : this.currentMousePos;
        if (p2) {
          ctx.strokeStyle = '#dca353';
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 6]);
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      if (this.horizonPoints.length === 2) {
        const p2 = this.horizonPoints[1];
        ctx.fillStyle = '#2ecc71';
        ctx.beginPath();
        ctx.arc(p2.x, p2.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      return;
    }

    // 2. 크롭 마스크 및 조절 프레임 (화면 사진에 정확히 1:1 밀착)
    if (this.cropActive) {
      const box = this.getCropBoxPixels();
      const bounds = box.bounds;
      const x = box.x;
      const y = box.y;
      const w = box.w;
      const h = box.h;

      // 화면 전체 어둡게 마스킹
      ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
      ctx.fillRect(0, 0, W, y);
      ctx.fillRect(0, y + h, W, H - (y + h));
      ctx.fillRect(0, y, x, h);
      ctx.fillRect(x + w, y, W - (x + w), h);

      // 사진 바운딩 박스 외곽 얇은 안내선
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1;
      ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);

      // 크롭 박스 외곽 테두리
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, w, h);

      // 3등분선 격자 (Rule of Thirds)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x + w / 3, y); ctx.lineTo(x + w / 3, y + h);
      ctx.moveTo(x + (w * 2) / 3, y); ctx.lineTo(x + (w * 2) / 3, y + h);
      ctx.moveTo(x, y + h / 3); ctx.lineTo(x + w, y + h / 3);
      ctx.moveTo(x, y + (h * 2) / 3); ctx.lineTo(x + w, y + (h * 2) / 3);
      ctx.stroke();
      ctx.setLineDash([]);

      // 4개 코너 핸들
      const drawHandle = (hx, hy) => {
        ctx.fillStyle = '#dca353';
        ctx.fillRect(hx - 6, hy - 6, 12, 12);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(hx - 6, hy - 6, 12, 12);
      };

      drawHandle(x, y);
      drawHandle(x + w, y);
      drawHandle(x, y + h);
      drawHandle(x + w, y + h);
    }
  }
}

window.CropHorizonController = CropHorizonController;
