/**
 * SemiLightroom - Application Main Controller
 * 1. 완벽한 프리셋 저장 / 불러오기 / JSON 파일 내보내기 & 가져오기
 * 2. 다중 사진 로드 / 필름스트립 / 원클릭 일괄 동기화 (Batch Sync) & 일괄 내보내기
 */

class SemiLightroomApp {
  constructor() {
    this.canvas = document.getElementById('gl-canvas');
    this.scopeCanvas = document.getElementById('scope-canvas');
    this.viewportContainer = document.getElementById('viewport-container');

    this.engine = new WebGLEngine(this.canvas);
    this.scope = new ScopeMonitor(this.scopeCanvas, this.engine);
    this.colorEqualizer = new ColorEqualizerUI('ceq-canvas', this.engine);
    this.toneCurve = new ToneCurveUI('tc-canvas', this.engine);

    // 자율 크롭 & 2점 수평 도구
    this.cropHorizon = new CropHorizonController(
      this.viewportContainer,
      this.engine,
      (angleDeg) => this.setControlValue('geo-angle', angleDeg),
      (cropRect) => this.onCropApplied(cropRect)
    );

    this.currentImageInfo = null;
    this.activeTab = 'all';
    this.currentLang = 'ko';
    this.isEyedropperActive = false;

    // Undo / Redo 스택
    this.historyStack = [];
    this.redoStack = [];
    this.isHistoryAction = false;

    // 마우스 줌 / 패닝
    this.isDragging = false;
    this.lastMousePos = { x: 0, y: 0 };

    // ── 다중 사진 큐 (Filmstrip Queue) ──
    this.photos = [];
    this.activePhotoIndex = -1;
    this.copiedParams = null;

    // ── 프리셋 라이브러리 ──
    this.builtInPresets = this.getBuiltInPresets();
    this.userPresets = this.loadUserPresetsFromStorage();

    this.init();
  }

  init() {
    this.setupEventListeners();
    this.setupModuleControls();
    this.setupViewportEvents();
    this.setupShortcuts();
    this.setupSigmoidCanvas();
    this.setupLanguageToggle();
    this.setupPresetManager();
    this.setupFilmstripEvents();
    this.resetAllToDefault();

    this.engine.onRenderComplete = () => {
      this.scope.update();
      this.drawSigmoidCurve();
    };

    window.addEventListener('resize', () => {
      this.resizeCanvas();
      this.scope.resize();
      this.colorEqualizer.render();
      this.toneCurve?.render();
      this.engine.render();
    });

    this.resizeCanvas();
  }

  resizeCanvas() {
    const rect = this.viewportContainer.getBoundingClientRect();
    this.canvas.width = rect.width * (window.devicePixelRatio || 1);
    this.canvas.height = rect.height * (window.devicePixelRatio || 1);
  }

  pushHistoryState() {
    if (this.isHistoryAction) return;
    const snapshot = JSON.stringify(this.engine.params);
    if (this.historyStack.length > 0 && this.historyStack[this.historyStack.length - 1] === snapshot) return;

    this.historyStack.push(snapshot);
    if (this.historyStack.length > 50) this.historyStack.shift();
    this.redoStack = [];

    // 현재 활성 사진의 파라미터도 실시간 갱신
    if (this.activePhotoIndex >= 0 && this.photos[this.activePhotoIndex]) {
      this.photos[this.activePhotoIndex].params = JSON.parse(snapshot);
    }
  }

  undo() {
    if (this.historyStack.length <= 1) return;
    this.isHistoryAction = true;
    const current = this.historyStack.pop();
    this.redoStack.push(current);
    const prev = JSON.parse(this.historyStack[this.historyStack.length - 1]);
    this.engine.params = JSON.parse(JSON.stringify(prev));
    this.syncUIWithParams();
    this.engine.render();
    this.isHistoryAction = false;
  }

  redo() {
    if (this.redoStack.length === 0) return;
    this.isHistoryAction = true;
    const nextState = this.redoStack.pop();
    this.historyStack.push(nextState);
    const parsed = JSON.parse(nextState);
    this.engine.params = JSON.parse(JSON.stringify(parsed));
    this.syncUIWithParams();
    this.engine.render();
    this.isHistoryAction = false;
  }

  syncUIWithParams() {
    const p = this.engine.params;
    this.setSliderUI('exp-ev', p.exposure.ev);
    this.setSliderUI('exp-black', p.exposure.blackLevel);
    this.setSliderUI('exp-contrast', p.exposure.contrast);

    this.setSliderUI('sig-contrast', p.sigmoid.contrast);
    this.setSliderUI('sig-skew', p.sigmoid.skew);
    this.setSliderUI('sig-shoulder', p.sigmoid.shoulder);
    this.setSliderUI('sig-toe', p.sigmoid.toe);

    this.setSliderUI('wb-temp', p.whiteBalance.temperature);
    this.setSliderUI('wb-tint', p.whiteBalance.tint);

    this.setSliderUI('geo-angle', (p.geometry && p.geometry.angle) ? p.geometry.angle : 0.0);
    this.setSliderUI('sh-amount', p.sharpen.amount);
    this.setSliderUI('lc-detail', p.localContrast.detail);
    this.setSliderUI('lc-clarity', p.localContrast.clarity);
    this.setSliderUI('dn-strength', p.denoise.strength);
    this.setSliderUI('bl-radius', p.blur.radius);
    this.setSliderUI('gr-amount', p.grain.amount);
    this.setSliderUI('vg-amount', p.vignette.amount);

    document.querySelectorAll('.module-power-btn').forEach(btn => {
      const modKey = btn.getAttribute('data-module');
      if (modKey && p[modKey]) {
        btn.classList.toggle('active', !!p[modKey].enabled);
      }
    });

    this.toneCurve?.render();
    this.colorEqualizer?.render();
  }

  setSliderUI(id, val) {
    const slider = document.getElementById(id);
    const numInput = document.getElementById(`${id}-val`);
    if (slider) slider.value = val;
    if (numInput) numInput.value = val;
  }

  setupLanguageToggle() {
    const btn = document.getElementById('btn-lang-toggle');
    if (!btn) return;

    btn.addEventListener('click', () => {
      this.currentLang = (this.currentLang === 'ko') ? 'en' : 'ko';
      btn.textContent = (this.currentLang === 'ko') ? '🇰🇷 KO' : '🇺🇸 EN';

      document.querySelectorAll('.i18n-text').forEach(el => {
        const text = el.getAttribute(`data-${this.currentLang}`);
        if (text) el.textContent = text;
      });
    });
  }

  setupEventListeners() {
    document.getElementById('btn-open')?.addEventListener('click', () => {
      document.getElementById('file-input').click();
    });

    document.getElementById('file-input')?.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        this.handleFiles(Array.from(e.target.files));
      }
    });

    document.getElementById('btn-sample')?.addEventListener('click', () => {
      this.loadSampleImage();
    });

    document.getElementById('btn-undo')?.addEventListener('click', () => this.undo());
    document.getElementById('btn-redo')?.addEventListener('click', () => this.redo());

    document.getElementById('btn-split')?.addEventListener('click', () => {
      this.engine.params.splitView.enabled = !this.engine.params.splitView.enabled;
      document.getElementById('btn-split').classList.toggle('active', this.engine.params.splitView.enabled);
      this.engine.render();
    });

    document.getElementById('btn-camera-look')?.addEventListener('click', () => {
      if (!this.currentImageInfo || !this.currentImageInfo.cameraJpegBitmap) {
        alert('카메라 내장 원본 JPEG 룩 데이터가 없습니다.');
        return;
      }
      this.resetAllToDefault();
      this.engine.setImage(this.currentImageInfo.cameraJpegBitmap);
      this.pushHistoryState();
      this.engine.render();
    });

    // 90도 회전 및 플립
    document.getElementById('btn-rotate-cw')?.addEventListener('click', () => {
      this.engine.params.orientation.rotate = (this.engine.params.orientation.rotate + 90) % 360;
      this.pushHistoryState();
      this.engine.render();
    });

    document.getElementById('btn-rotate-ccw')?.addEventListener('click', () => {
      this.engine.params.orientation.rotate = (this.engine.params.orientation.rotate + 270) % 360;
      this.pushHistoryState();
      this.engine.render();
    });

    document.getElementById('btn-flip-h')?.addEventListener('click', () => {
      this.engine.params.orientation.flipH = !this.engine.params.orientation.flipH;
      this.pushHistoryState();
      this.engine.render();
    });

    document.getElementById('btn-flip-v')?.addEventListener('click', () => {
      this.engine.params.orientation.flipV = !this.engine.params.orientation.flipV;
      this.pushHistoryState();
      this.engine.render();
    });

    document.getElementById('module-search-input')?.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase().trim();
      document.querySelectorAll('.module-card').forEach(mod => {
        const title = mod.getAttribute('data-module-name') || '';
        const tags = mod.getAttribute('data-tags') || '';
        mod.style.display = (title.toLowerCase().includes(term) || tags.toLowerCase().includes(term)) ? 'block' : 'none';
      });
    });

    document.querySelectorAll('.tab-icon-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-icon-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.filterModulesByTab(btn.getAttribute('data-tab'));
      });
    });

    document.querySelectorAll('.scope-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.scope-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.scope.setMode(btn.getAttribute('data-mode'));
      });
    });

    const btnEyedropper = document.getElementById('wb-eyedropper');
    if (btnEyedropper) {
      btnEyedropper.addEventListener('click', () => {
        this.isEyedropperActive = !this.isEyedropperActive;
        btnEyedropper.classList.toggle('active', this.isEyedropperActive);
        this.canvas.style.cursor = this.isEyedropperActive ? 'cell' : 'crosshair';
      });
    }

    document.getElementById('btn-export')?.addEventListener('click', () => this.showExportModal());
    document.querySelectorAll('.modal-close-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('show'));
      });
    });

    document.getElementById('export-format')?.addEventListener('change', (e) => {
      const qRow = document.getElementById('row-quality');
      if (qRow) qRow.style.display = (e.target.value === 'image/dng' || e.target.value === 'image/png') ? 'none' : 'flex';
    });

    document.getElementById('btn-do-export')?.addEventListener('click', () => this.executeExport());

    // 크롭 조작
    document.querySelectorAll('.btn-crop-aspect').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.btn-crop-aspect').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const aspect = btn.getAttribute('data-aspect');
        const ratio = aspect === 'free' ? null : parseFloat(aspect);
        this.cropHorizon.setCropMode(true);
        this.cropHorizon.setAspectRatio(ratio);
      });
    });

    document.getElementById('btn-crop-apply')?.addEventListener('click', () => {
      this.cropHorizon.applyCrop();
    });

    document.getElementById('btn-crop-cancel')?.addEventListener('click', () => {
      this.cropHorizon.setCropMode(false);
    });

    document.getElementById('btn-crop-reset')?.addEventListener('click', () => {
      this.cropHorizon.resetCrop();
    });

    document.getElementById('btn-draw-horizon')?.addEventListener('click', () => {
      this.cropHorizon.setHorizonMode(true);
    });
  }

  onCropApplied(cropRect) {
    this.pushHistoryState();
  }

  filterModulesByTab(tab) {
    this.activeTab = tab;
    document.querySelectorAll('.module-card').forEach(mod => {
      if (tab === 'all') mod.style.display = 'block';
      else if (tab === 'active') {
        const isEnabled = mod.querySelector('.module-power-btn')?.classList.contains('active');
        mod.style.display = isEnabled ? 'block' : 'none';
      } else {
        mod.style.display = (mod.getAttribute('data-category') === tab) ? 'block' : 'none';
      }
    });

    setTimeout(() => {
      this.toneCurve?.render();
      this.colorEqualizer?.render();
      this.drawSigmoidCurve();
    }, 50);
  }

  setupModuleControls() {
    // 0. 아코디언 모듈 헤더 클릭 시 열기 / 닫기
    document.querySelectorAll('.module-header').forEach(header => {
      header.addEventListener('click', (e) => {
        if (e.target.closest('.module-power-btn') || e.target.closest('.mod-action-btn')) return;
        const card = header.closest('.module-card');
        if (card) {
          card.classList.toggle('expanded');
          if (card.classList.contains('expanded')) {
            setTimeout(() => {
              this.toneCurve?.render();
              this.colorEqualizer?.render();
              this.drawSigmoidCurve();
            }, 40);
          }
        }
      });
    });

    document.querySelectorAll('.module-power-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const modKey = btn.getAttribute('data-module');
        if (this.engine.params[modKey]) {
          this.engine.params[modKey].enabled = !this.engine.params[modKey].enabled;
          btn.classList.toggle('active', this.engine.params[modKey].enabled);
          this.pushHistoryState();
          this.engine.render();
        }
      });
    });

    document.querySelectorAll('.mod-reset-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const modKey = btn.getAttribute('data-module');
        this.resetModule(modKey);
      });
    });

    // 슬라이더 바인딩
    this.bindSlider('exp-ev', (v) => {
      this.engine.params.exposure.ev = v;
      this.autoEnableModule('exposure');
    });
    this.bindSlider('exp-black', (v) => {
      this.engine.params.exposure.blackLevel = v;
      this.autoEnableModule('exposure');
    });
    this.bindSlider('exp-contrast', (v) => {
      this.engine.params.exposure.contrast = v;
      this.autoEnableModule('exposure');
    });

    this.bindSlider('sig-contrast', (v) => {
      this.engine.params.sigmoid.contrast = v;
      this.autoEnableModule('sigmoid');
      this.drawSigmoidCurve();
    });
    this.bindSlider('sig-skew', (v) => {
      this.engine.params.sigmoid.skew = v;
      this.autoEnableModule('sigmoid');
      this.drawSigmoidCurve();
    });
    this.bindSlider('sig-shoulder', (v) => {
      this.engine.params.sigmoid.shoulder = v;
      this.autoEnableModule('sigmoid');
      this.drawSigmoidCurve();
    });
    this.bindSlider('sig-toe', (v) => {
      this.engine.params.sigmoid.toe = v;
      this.autoEnableModule('sigmoid');
      this.drawSigmoidCurve();
    });

    this.bindSlider('te-blacks', (v) => {
      this.engine.params.toneEqualizer.blacks = v;
      this.autoEnableModule('toneEqualizer');
    });
    this.bindSlider('te-shadows', (v) => {
      this.engine.params.toneEqualizer.shadows = v;
      this.autoEnableModule('toneEqualizer');
    });
    this.bindSlider('te-midtones', (v) => {
      this.engine.params.toneEqualizer.midtones = v;
      this.autoEnableModule('toneEqualizer');
    });
    this.bindSlider('te-highlights', (v) => {
      this.engine.params.toneEqualizer.highlights = v;
      this.autoEnableModule('toneEqualizer');
    });
    this.bindSlider('te-whites', (v) => {
      this.engine.params.toneEqualizer.whites = v;
      this.autoEnableModule('toneEqualizer');
    });

    this.bindSlider('geo-angle', (v) => {
      if (!this.engine.params.geometry) this.engine.params.geometry = { enabled: true, angle: 0.0 };
      this.engine.params.geometry.angle = v;
    });

    this.bindSlider('hl-recovery', (v) => {
      this.engine.params.highlight.recovery = v;
      this.autoEnableModule('highlight');
    });
    this.bindSlider('hl-compress', (v) => {
      this.engine.params.highlight.compress = v;
      this.autoEnableModule('highlight');
    });

    this.bindSlider('wb-temp', (v) => {
      this.engine.params.whiteBalance.temperature = v;
      this.autoEnableModule('whiteBalance');
    });
    this.bindSlider('wb-tint', (v) => {
      this.engine.params.whiteBalance.tint = v;
      this.autoEnableModule('whiteBalance');
    });

    this.bindSlider('sh-amount', (v) => {
      this.engine.params.sharpen.amount = v;
      this.autoEnableModule('sharpen');
    });
    this.bindSlider('lc-detail', (v) => {
      this.engine.params.localContrast.detail = v;
      this.autoEnableModule('localContrast');
    });
    this.bindSlider('lc-clarity', (v) => {
      this.engine.params.localContrast.clarity = v;
      this.autoEnableModule('localContrast');
    });
    this.bindSlider('dn-strength', (v) => {
      this.engine.params.denoise.strength = v;
      this.autoEnableModule('denoise');
    });
    this.bindSlider('bl-radius', (v) => {
      this.engine.params.blur.radius = v;
      this.autoEnableModule('blur');
    });
    this.bindSlider('gr-amount', (v) => {
      this.engine.params.grain.amount = v;
      this.autoEnableModule('grain');
    });
    this.bindSlider('vg-amount', (v) => {
      this.engine.params.vignette.amount = v;
      this.autoEnableModule('vignette');
    });

    // 컬러 밸런스 3Way
    this.bindSlider('cb-sh-r', (v) => { this.engine.params.colorBalance.shadows[0] = v; this.autoEnableModule('colorBalance'); });
    this.bindSlider('cb-sh-g', (v) => { this.engine.params.colorBalance.shadows[1] = v; this.autoEnableModule('colorBalance'); });
    this.bindSlider('cb-sh-b', (v) => { this.engine.params.colorBalance.shadows[2] = v; this.autoEnableModule('colorBalance'); });
    this.bindSlider('cb-mid-r', (v) => { this.engine.params.colorBalance.midtones[0] = v; this.autoEnableModule('colorBalance'); });
    this.bindSlider('cb-mid-g', (v) => { this.engine.params.colorBalance.midtones[1] = v; this.autoEnableModule('colorBalance'); });
    this.bindSlider('cb-mid-b', (v) => { this.engine.params.colorBalance.midtones[2] = v; this.autoEnableModule('colorBalance'); });
    this.bindSlider('cb-hi-r', (v) => { this.engine.params.colorBalance.highlights[0] = v; this.autoEnableModule('colorBalance'); });
    this.bindSlider('cb-hi-g', (v) => { this.engine.params.colorBalance.highlights[1] = v; this.autoEnableModule('colorBalance'); });
    this.bindSlider('cb-hi-b', (v) => { this.engine.params.colorBalance.highlights[2] = v; this.autoEnableModule('colorBalance'); });
  }

  autoEnableModule(modKey) {
    if (this.engine.params[modKey] && !this.engine.params[modKey].enabled) {
      this.engine.params[modKey].enabled = true;
      const btn = document.querySelector(`.module-power-btn[data-module="${modKey}"]`);
      if (btn) btn.classList.add('active');
    }
  }

  bindSlider(id, callback) {
    const slider = document.getElementById(id);
    const numInput = document.getElementById(`${id}-val`);
    if (!slider) return;

    slider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      if (numInput) numInput.value = val;
      callback(val);
      this.engine.render();
    });

    slider.addEventListener('change', () => {
      this.pushHistoryState();
    });

    if (numInput) {
      numInput.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value) || 0;
        slider.value = val;
        callback(val);
        this.engine.render();
      });
      numInput.addEventListener('change', () => {
        this.pushHistoryState();
      });
    }

    slider.addEventListener('dblclick', () => {
      const defaultVal = parseFloat(slider.getAttribute('data-default') || 0);
      slider.value = defaultVal;
      if (numInput) numInput.value = defaultVal;
      callback(defaultVal);
      this.pushHistoryState();
      this.engine.render();
    });
  }

  setControlValue(id, value) {
    const slider = document.getElementById(id);
    const numInput = document.getElementById(`${id}-val`);
    if (slider) slider.value = value;
    if (numInput) numInput.value = value;
    slider?.dispatchEvent(new Event('input'));
  }

  resetModule(modKey) {
    switch (modKey) {
      case 'whiteBalance':
        this.setControlValue('wb-temp', 6500);
        this.setControlValue('wb-tint', 0);
        break;
      case 'exposure':
        this.setControlValue('exp-ev', 0);
        this.setControlValue('exp-black', 0);
        this.setControlValue('exp-contrast', 0);
        break;
      case 'sigmoid':
        this.setControlValue('sig-contrast', 1.0);
        this.setControlValue('sig-skew', 0);
        this.setControlValue('sig-shoulder', 0);
        this.setControlValue('sig-toe', 0);
        break;
      case 'toneEqualizer':
        this.setControlValue('te-blacks', 0);
        this.setControlValue('te-shadows', 0);
        this.setControlValue('te-midtones', 0);
        this.setControlValue('te-highlights', 0);
        this.setControlValue('te-whites', 0);
        break;
      case 'toneCurve':
        this.toneCurve.resetAll();
        break;
      case 'sharpen':
        this.setControlValue('sh-amount', 0);
        break;
      case 'localContrast':
        this.setControlValue('lc-detail', 0);
        this.setControlValue('lc-clarity', 0);
        break;
      case 'denoise':
        this.setControlValue('dn-strength', 0);
        break;
      case 'blur':
        this.setControlValue('bl-radius', 0);
        break;
      case 'grain':
        this.setControlValue('gr-amount', 0);
        break;
      case 'vignette':
        this.setControlValue('vg-amount', 0);
        break;
      case 'highlight':
        this.setControlValue('hl-recovery', 0);
        this.setControlValue('hl-compress', 0);
        break;
      case 'geometry':
        this.setControlValue('geo-angle', 0);
        break;
      case 'orientation':
        this.engine.params.orientation = { enabled: true, rotate: 0, flipH: false, flipV: false };
        this.engine.render();
        break;
      case 'colorEqualizer':
        this.colorEqualizer.reset();
        break;
      case 'colorBalance':
        this.setControlValue('cb-sh-r', 0);
        this.setControlValue('cb-mid-g', 0);
        this.setControlValue('cb-mid-b', 0);
        this.setControlValue('cb-hi-r', 0);
        break;
      case 'crop':
        this.cropHorizon.resetCrop();
        break;
    }
    this.pushHistoryState();
  }

  resetAllToDefault() {
    this.engine.params = {
      orientation: { enabled: true, rotate: 0, flipH: false, flipV: false },
      geometry: { enabled: true, angle: 0 },
      crop: { enabled: false, x: 0.0, y: 0.0, width: 1.0, height: 1.0 },

      toneCurve: { enabled: false },
      toneCurveLut: null,
      exposure: { enabled: false, ev: 0.0, blackLevel: 0.0, contrast: 0.0 },
      sigmoid: { enabled: false, contrast: 1.0, skew: 0.0, shoulder: 0.0, toe: 0.0 },
      toneEqualizer: { enabled: false, blacks: 0.0, shadows: 0.0, midtones: 0.0, highlights: 0.0, whites: 0.0 },
      highlight: { enabled: false, recovery: 0.0, compress: 0.0 },

      whiteBalance: { enabled: false, temperature: 6500, tint: 0 },
      colorEqualizer: {
        enabled: false,
        hue: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        sat: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        bri: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
      },
      colorBalance: {
        enabled: false,
        shadows: [0.0, 0.0, 0.0],
        midtones: [0.0, 0.0, 0.0],
        highlights: [0.0, 0.0, 0.0]
      },

      sharpen: { enabled: false, amount: 0.0 },
      localContrast: { enabled: false, detail: 0.0, clarity: 0.0 },
      denoise: { enabled: false, strength: 0.0 },
      blur: { enabled: false, radius: 0.0 },
      grain: { enabled: false, amount: 0.0 },
      vignette: { enabled: false, amount: 0.0 },

      viewport: { zoom: 1.0, panX: 0, panY: 0 },
      splitView: { enabled: false, position: 0.5 }
    };

    this.syncUIWithParams();
  }

  setupViewportEvents() {
    const vp = this.viewportContainer;

    vp.addEventListener('dragover', (e) => {
      e.preventDefault();
      vp.classList.add('drag-over');
    });

    vp.addEventListener('dragleave', () => {
      vp.classList.remove('drag-over');
    });

    vp.addEventListener('drop', (e) => {
      e.preventDefault();
      vp.classList.remove('drag-over');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        this.handleFiles(Array.from(e.dataTransfer.files));
      }
    });

    vp.addEventListener('wheel', (e) => {
      if (this.cropHorizon.cropActive) return;
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      let newZoom = this.engine.params.viewport.zoom * zoomFactor;
      newZoom = Math.max(0.1, Math.min(10.0, newZoom));
      this.engine.params.viewport.zoom = newZoom;
      this.updateZoomDisplay();
      this.engine.render();
      this.cropHorizon.draw();
    });

    vp.addEventListener('mousedown', (e) => {
      if (this.cropHorizon.cropActive || this.cropHorizon.horizonActive) return;
      if (this.isEyedropperActive) {
        this.sampleWB(e);
        return;
      }
      this.isDragging = true;
      this.lastMousePos = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging || this.cropHorizon.cropActive) return;
      const dx = (e.clientX - this.lastMousePos.x) / (this.canvas.width / 2);
      const dy = (e.clientY - this.lastMousePos.y) / (this.canvas.height / 2);

      this.engine.params.viewport.panX += dx;
      this.engine.params.viewport.panY -= dy;
      this.lastMousePos = { x: e.clientX, y: e.clientY };
      this.engine.render();
      this.cropHorizon.draw();
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    vp.addEventListener('dblclick', () => {
      if (this.cropHorizon.cropActive) return;
      this.engine.params.viewport = { zoom: 1.0, panX: 0, panY: 0 };
      this.updateZoomDisplay();
      this.engine.render();
      this.cropHorizon.draw();
    });
  }

  updateZoomDisplay() {
    const tag = document.getElementById('tag-zoom');
    if (tag) {
      tag.textContent = `${Math.round(this.engine.params.viewport.zoom * 100)}%`;
    }
  }

  sampleWB(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) * (this.canvas.width / rect.width));
    const y = Math.floor((e.clientY - rect.top) * (this.canvas.height / rect.height));

    const p = this.engine.samplePixel(x, y);
    if (p) {
      const avg = (p.r + p.g + p.b) / 3;
      const rRatio = p.r / Math.max(1, avg);
      const bRatio = p.b / Math.max(1, avg);

      let temp = 6500 / (rRatio / Math.max(0.1, bRatio));
      temp = Math.max(2000, Math.min(12000, Math.round(temp)));

      this.setControlValue('wb-temp', temp);
      this.isEyedropperActive = false;
      document.getElementById('wb-eyedropper')?.classList.remove('active');
      this.canvas.style.cursor = 'default';
    }
  }

  // ─── 다중 파일 처리 및 필름스트립 큐 관리 ───

  async handleFiles(files) {
    const dropZone = document.getElementById('drop-zone-overlay');
    if (dropZone) dropZone.style.display = 'none';

    for (const file of files) {
      try {
        const parsed = await window.rawParser.parseFile(file);

        // 세로 사진 자동 회전 감지 (ARW / RAW / JPEG EXIF 회전 완벽 보정)
        let initialRotate = 0;
        if (parsed.imageBitmap.width < parsed.imageBitmap.height) {
          initialRotate = 0;
        } else if (parsed.orientation) {
          initialRotate = parsed.orientation;
        }

        // 회전 상태가 반영된 썸네일 캔버스 생성
        const thumbCanvas = document.createElement('canvas');
        const isRot = (initialRotate === 90 || initialRotate === 270);
        thumbCanvas.width = isRot ? 68 : 90;
        thumbCanvas.height = isRot ? 90 : 68;
        const tCtx = thumbCanvas.getContext('2d');

        if (initialRotate !== 0) {
          tCtx.save();
          tCtx.translate(thumbCanvas.width / 2, thumbCanvas.height / 2);
          tCtx.rotate((initialRotate * Math.PI) / 180);
          const dw = isRot ? thumbCanvas.height : thumbCanvas.width;
          const dh = isRot ? thumbCanvas.width : thumbCanvas.height;
          tCtx.drawImage(parsed.imageBitmap, -dw / 2, -dh / 2, dw, dh);
          tCtx.restore();
        } else {
          tCtx.drawImage(parsed.imageBitmap, 0, 0, thumbCanvas.width, thumbCanvas.height);
        }
        const thumbUrl = thumbCanvas.toDataURL('image/jpeg', 0.8);

        const photoParams = JSON.parse(JSON.stringify(this.engine.params));
        photoParams.orientation.rotate = initialRotate;

        const photoObj = {
          id: 'photo_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
          name: file.name,
          width: parsed.width,
          height: parsed.height,
          type: parsed.type,
          imageBitmap: parsed.imageBitmap,
          cameraJpegBitmap: parsed.cameraJpegBitmap || parsed.imageBitmap,
          orientation: initialRotate,
          exif: parsed.exif || {},
          params: photoParams,
          thumbnailUrl: thumbUrl
        };

        this.photos.push(photoObj);
      } catch (err) {
        console.error('파일 파싱 실패:', file.name, err);
      }
    }

    if (this.photos.length > 0) {
      this.renderFilmstrip();
      this.selectPhoto(this.photos.length - 1);
    }
  }

  renderFilmstrip() {
    const list = document.getElementById('filmstrip-list');
    const countEl = document.getElementById('filmstrip-count');
    if (!list) return;

    countEl.textContent = this.photos.length;
    list.innerHTML = '';

    this.photos.forEach((photo, idx) => {
      const item = document.createElement('div');
      item.className = `filmstrip-item ${idx === this.activePhotoIndex ? 'active' : ''}`;
      item.title = `${photo.name} (${photo.width}×${photo.height})`;

      item.innerHTML = `
        <img src="${photo.thumbnailUrl}" alt="${photo.name}">
        <div class="item-label">${photo.name}</div>
        <button class="btn-remove-item" title="제거">&times;</button>
      `;

      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('btn-remove-item')) {
          e.stopPropagation();
          this.removePhoto(idx);
        } else {
          this.selectPhoto(idx);
        }
      });

      list.appendChild(item);
    });
  }

  selectPhoto(idx) {
    if (idx < 0 || idx >= this.photos.length) return;

    // 현재 작업 중이던 사진의 설정 백업
    if (this.activePhotoIndex >= 0 && this.photos[this.activePhotoIndex]) {
      this.photos[this.activePhotoIndex].params = JSON.parse(JSON.stringify(this.engine.params));
    }

    this.activePhotoIndex = idx;
    const photo = this.photos[idx];
    this.currentImageInfo = photo;

    this.engine.setImage(photo.imageBitmap);
    this.engine.params = JSON.parse(JSON.stringify(photo.params));

    const mp = ((photo.width * photo.height) / 1000000).toFixed(1);
    document.getElementById('status-camera').textContent = photo.exif.Camera || photo.type;
    document.getElementById('status-res').textContent = `${photo.width} × ${photo.height} (${mp} MP)`;
    document.getElementById('tag-filename').textContent = photo.name;
    document.getElementById('tag-format').textContent = photo.type;

    this.syncUIWithParams();
    this.renderFilmstrip();
    this.engine.render();
  }

  removePhoto(idx) {
    this.photos.splice(idx, 1);
    if (this.photos.length === 0) {
      this.activePhotoIndex = -1;
      this.currentImageInfo = null;
      document.getElementById('drop-zone-overlay').style.display = 'flex';
      this.renderFilmstrip();
    } else {
      const nextIdx = Math.min(idx, this.photos.length - 1);
      this.selectPhoto(nextIdx);
    }
  }

  setupFilmstripEvents() {
    // 0. 필름스트립 접기 / 펼치기 토글
    const toggleBtn = document.getElementById('btn-toggle-filmstrip');
    const container = document.getElementById('filmstrip-container');
    const icon = document.getElementById('filmstrip-toggle-icon');

    toggleBtn?.addEventListener('click', () => {
      container.classList.toggle('collapsed');
      const isCollapsed = container.classList.contains('collapsed');
      if (icon) icon.textContent = isCollapsed ? '▲' : '▼';
    });

    // 1. 설정 복사
    document.getElementById('btn-copy-settings')?.addEventListener('click', () => {
      this.copiedParams = JSON.parse(JSON.stringify(this.engine.params));
      alert('📋 현재 사진의 모든 편집 설정(톤, 색상, 커브 등)이 복사되었습니다.');
    });

    // 2. 붙여넣기
    document.getElementById('btn-paste-settings')?.addEventListener('click', () => {
      if (!this.copiedParams) {
        alert('먼저 복사할 설정이 없습니다. [설정 복사]를 눌러주세요.');
        return;
      }
      this.engine.params = JSON.parse(JSON.stringify(this.copiedParams));
      this.syncUIWithParams();
      this.pushHistoryState();
      this.engine.render();
      alert('📥 현재 사진에 복사된 설정이 적용되었습니다.');
    });

    // 3. 전체 사진에 일괄 적용 (Batch Sync All)
    document.getElementById('btn-sync-all')?.addEventListener('click', () => {
      if (this.photos.length <= 1) {
        alert('일괄 적용할 사진이 2장 이상 있어야 합니다.');
        return;
      }
      const currentParams = JSON.parse(JSON.stringify(this.engine.params));
      this.photos.forEach(p => {
        // 크롭 및 회전은 각 사진 고유 구도에 맞게 보존하고, 전체 톤/색상/수평 레시피를 일괄 동기화
        const oldCrop = p.params.crop;
        const oldRot = p.params.orientation;
        p.params = JSON.parse(JSON.stringify(currentParams));
        if (oldCrop && oldCrop.enabled) p.params.crop = oldCrop;
        if (oldRot) p.params.orientation = oldRot;
      });
      alert(`⚡ 큐에 있는 ${this.photos.length}장의 모든 사진에 현재 편집 설정이 일괄 적용되었습니다!`);
    });

    // 4. 전체 일괄 내보내기 (Batch Export All)
    document.getElementById('btn-batch-export')?.addEventListener('click', async () => {
      if (this.photos.length === 0) {
        alert('내보낼 사진이 없습니다.');
        return;
      }
      if (!confirm(`큐에 있는 ${this.photos.length}장의 사진을 현재 편집 설정으로 모두 내보내시겠습니까?`)) return;

      const format = document.getElementById('export-format')?.value || 'image/jpeg';
      const quality = parseFloat(document.getElementById('export-quality')?.value || 0.95);
      const ext = format === 'image/png' ? 'png' : (format === 'image/webp' ? 'webp' : (format === 'image/dng' ? 'dng' : 'jpg'));

      for (let i = 0; i < this.photos.length; i++) {
        this.selectPhoto(i);
        await new Promise(r => setTimeout(r, 80));

        let link = document.createElement('a');
        const origName = this.photos[i].name.replace(/\.[^/.]+$/, "");
        link.download = `${origName}_edited.${ext}`;

        if (format === 'image/dng') {
          const blob = this.engine.exportDNG();
          if (blob) {
            link.href = URL.createObjectURL(blob);
            link.click();
            URL.revokeObjectURL(link.href);
          }
        } else {
          const dataUrl = this.engine.exportImage(format, quality);
          if (dataUrl) {
            link.href = dataUrl;
            link.click();
          }
        }
        await new Promise(r => setTimeout(r, 150));
      }
      alert('📦 전체 사진 일괄 내보내기가 완료되었습니다!');
    });
  }

  // ─── 프리셋 관리자 (Preset Manager) ───

  getBuiltInPresets() {
    return [
      {
        id: 'modern-film',
        name: '🎞️ Modern Film (필름 룩)',
        desc: '부드러운 하이라이트 페이드 + 따뜻한 골드 섀도우',
        params: {
          exposure: { enabled: true, ev: 0.15, blackLevel: 0.05, contrast: 0.1 },
          sigmoid: { enabled: true, contrast: 1.15, skew: 0.1, shoulder: 0.2, toe: 0.15 },
          whiteBalance: { enabled: true, temperature: 6200, tint: 4 },
          colorBalance: { enabled: true, shadows: [0.08, 0.04, -0.02], midtones: [0.02, 0.0, 0.0], highlights: [-0.02, 0.01, 0.04] },
          grain: { enabled: true, amount: 0.18 },
          vignette: { enabled: true, amount: 0.2 }
        }
      },
      {
        id: 'cinematic-moody',
        name: '🎬 Cinematic Moody (시네마틱)',
        desc: '깊은 섀도우 틸/오렌지 색감 + 짙은 분위기',
        params: {
          exposure: { enabled: true, ev: -0.2, blackLevel: 0.08, contrast: 0.25 },
          sigmoid: { enabled: true, contrast: 1.3, skew: -0.1, shoulder: 0.1, toe: 0.2 },
          whiteBalance: { enabled: true, temperature: 5800, tint: -2 },
          colorBalance: { enabled: true, shadows: [-0.15, 0.02, 0.12], midtones: [0.08, 0.03, -0.05], highlights: [0.12, 0.06, -0.08] },
          localContrast: { enabled: true, detail: 0.2, clarity: 0.25 },
          vignette: { enabled: true, amount: 0.35 }
        }
      },
      {
        id: 'warm-portrait',
        name: '🌸 Warm Portrait (인물 웜톤)',
        desc: '자연스럽고 화사한 스킨톤 + 부드러운 하이라이트',
        params: {
          exposure: { enabled: true, ev: 0.3, blackLevel: -0.02, contrast: -0.05 },
          sigmoid: { enabled: true, contrast: 1.05, skew: 0.15, shoulder: 0.35, toe: 0.05 },
          whiteBalance: { enabled: true, temperature: 6600, tint: 6 },
          colorEqualizer: {
            enabled: true,
            hue: [0.0, 0.03, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            sat: [0.05, 0.12, 0.05, 0.0, 0.0, 0.0, 0.0, 0.0],
            bri: [0.05, 0.08, 0.03, 0.0, 0.0, 0.0, 0.0, 0.0]
          },
          highlight: { enabled: true, recovery: 0.3, compress: 0.2 }
        }
      },
      {
        id: 'vivid-landscape',
        name: '🌲 Vivid Landscape (풍경 비비드)',
        desc: '푸른 하늘과 싱그러운 자연의 생생한 색감',
        params: {
          exposure: { enabled: true, ev: 0.0, blackLevel: 0.02, contrast: 0.2 },
          sigmoid: { enabled: true, contrast: 1.25, skew: 0.0, shoulder: 0.15, toe: 0.1 },
          colorEqualizer: {
            enabled: true,
            hue: [0.0, 0.0, 0.0, 0.04, 0.02, -0.03, 0.0, 0.0],
            sat: [0.1, 0.15, 0.2, 0.3, 0.35, 0.4, 0.1, 0.1],
            bri: [0.0, 0.0, 0.05, 0.05, 0.08, -0.05, 0.0, 0.0]
          },
          localContrast: { enabled: true, detail: 0.35, clarity: 0.3 },
          sharpen: { enabled: true, amount: 0.4 }
        }
      },
      {
        id: 'bw-fineart',
        name: '🖤 B&W Fine Art (흑백 파인아트)',
        desc: '강렬한 대비와 깊은 톤의 클래식 흑백',
        params: {
          exposure: { enabled: true, ev: 0.1, blackLevel: 0.06, contrast: 0.35 },
          sigmoid: { enabled: true, contrast: 1.4, skew: 0.0, shoulder: 0.2, toe: 0.2 },
          colorEqualizer: {
            enabled: true,
            hue: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            sat: [-1.0, -1.0, -1.0, -1.0, -1.0, -1.0, -1.0, -1.0],
            bri: [0.1, 0.05, 0.0, -0.05, -0.1, -0.15, 0.0, 0.05]
          },
          grain: { enabled: true, amount: 0.25 },
          vignette: { enabled: true, amount: 0.3 }
        }
      }
    ];
  }

  loadUserPresetsFromStorage() {
    try {
      const saved = localStorage.getItem('semiLightroom_user_presets');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  }

  saveUserPresetsToStorage() {
    try {
      localStorage.setItem('semiLightroom_user_presets', JSON.stringify(this.userPresets));
    } catch (e) {
      console.error('프리셋 저장 실패:', e);
    }
  }

  setupPresetManager() {
    document.getElementById('btn-presets')?.addEventListener('click', () => {
      this.renderPresetModal();
      document.getElementById('preset-modal').classList.add('show');
    });

    document.getElementById('btn-save-current-preset')?.addEventListener('click', () => {
      const nameInput = document.getElementById('preset-name-input');
      const name = nameInput.value.trim() || `나만의 프리셋 ${this.userPresets.length + 1}`;

      const presetObj = {
        id: 'user_preset_' + Date.now(),
        name: name,
        desc: `${new Date().toLocaleDateString()} 저장됨`,
        params: JSON.parse(JSON.stringify(this.engine.params))
      };

      this.userPresets.push(presetObj);
      this.saveUserPresetsToStorage();
      nameInput.value = '';
      this.renderPresetModal();
      alert(`💾 '${name}' 프리셋이 저장되었습니다!`);
    });

    document.getElementById('btn-import-preset-file')?.addEventListener('click', () => {
      document.getElementById('preset-file-input').click();
    });

    document.getElementById('preset-file-input')?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const imported = JSON.parse(evt.target.result);
          const presetObj = {
            id: 'imported_' + Date.now(),
            name: imported.name || file.name.replace(/\.[^/.]+$/, ""),
            desc: '외부 파일에서 불러옴',
            params: imported.params || imported
          };
          this.userPresets.push(presetObj);
          this.saveUserPresetsToStorage();
          this.renderPresetModal();
          this.applyPreset(presetObj.params);
          alert(`📥 프리셋 '${presetObj.name}'을 성공적으로 불러와 적용했습니다!`);
        } catch {
          alert('올바른 프리셋 파일(JSON) 형식이 아닙니다.');
        }
      };
      reader.readAsText(file);
    });
  }

  renderPresetModal() {
    // 1. 내장 프리셋 렌더링
    const builtInList = document.getElementById('built-in-presets-list');
    builtInList.innerHTML = '';
    this.builtInPresets.forEach(preset => {
      const card = document.createElement('div');
      card.className = 'preset-card';
      card.innerHTML = `
        <div>
          <div class="preset-name">${preset.name}</div>
          <div class="preset-desc">${preset.desc}</div>
        </div>
      `;
      card.addEventListener('click', () => {
        this.applyPreset(preset.params);
        document.getElementById('preset-modal').classList.remove('show');
      });
      builtInList.appendChild(card);
    });

    // 2. 사용자 저장 프리셋 렌더링
    const userList = document.getElementById('user-presets-list');
    userList.innerHTML = '';

    if (this.userPresets.length === 0) {
      userList.innerHTML = `<div style="color:#666; font-size:12px; text-align:center; padding:12px;">저장된 사용자 프리셋이 없습니다.</div>`;
      return;
    }

    this.userPresets.forEach((preset, idx) => {
      const card = document.createElement('div');
      card.className = 'preset-card';
      card.innerHTML = `
        <div style="flex:1;">
          <div class="preset-name">${preset.name}</div>
          <div class="preset-desc">${preset.desc}</div>
        </div>
        <div style="display:flex; gap:4px;" onclick="event.stopPropagation();">
          <button class="btn-studio" style="font-size:10px; padding:2px 6px;" title="파일로 내보내기" id="btn-export-preset-${idx}">📤</button>
          <button class="btn-studio" style="font-size:10px; padding:2px 6px;" title="삭제" id="btn-del-preset-${idx}">&times;</button>
        </div>
      `;

      card.addEventListener('click', () => {
        this.applyPreset(preset.params);
        document.getElementById('preset-modal').classList.remove('show');
      });

      card.querySelector(`#btn-export-preset-${idx}`).addEventListener('click', () => {
        const jsonStr = JSON.stringify(preset, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.download = `${preset.name}.slpreset`;
        a.href = url;
        a.click();
        URL.revokeObjectURL(url);
      });

      card.querySelector(`#btn-del-preset-${idx}`).addEventListener('click', () => {
        if (confirm(`'${preset.name}' 프리셋을 삭제하시겠습니까?`)) {
          this.userPresets.splice(idx, 1);
          this.saveUserPresetsToStorage();
          this.renderPresetModal();
        }
      });

      userList.appendChild(card);
    });
  }

  applyPreset(presetParams) {
    // 톤, 색상, 커브 등 레시피 적용 (크롭과 회전은 사용자 사진 원본 구도에 맞게 보존)
    const oldCrop = this.engine.params.crop;
    const oldRot = this.engine.params.orientation;
    const oldGeo = this.engine.params.geometry;

    for (const key in presetParams) {
      if (presetParams[key] && typeof presetParams[key] === 'object') {
        this.engine.params[key] = JSON.parse(JSON.stringify(presetParams[key]));
      }
    }

    if (oldCrop) this.engine.params.crop = oldCrop;
    if (oldRot) this.engine.params.orientation = oldRot;
    if (oldGeo) this.engine.params.geometry = oldGeo;

    this.syncUIWithParams();
    this.pushHistoryState();
    this.engine.render();
  }

  loadSampleImage() {
    this.resetAllToDefault();

    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = 3840;
    sampleCanvas.height = 2160;
    const ctx = sampleCanvas.getContext('2d');

    const sky = ctx.createLinearGradient(0, 0, 0, 2160 * 0.7);
    sky.addColorStop(0, '#1a365d');
    sky.addColorStop(0.4, '#c05621');
    sky.addColorStop(0.7, '#dd6b20');
    sky.addColorStop(1, '#ecc94b');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 3840, 2160);

    const sunGrad = ctx.createRadialGradient(1920, 1100, 10, 1920, 1100, 600);
    sunGrad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    sunGrad.addColorStop(0.2, 'rgba(255, 230, 150, 0.9)');
    sunGrad.addColorStop(0.8, 'rgba(255, 120, 50, 0.2)');
    sunGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = sunGrad;
    ctx.beginPath();
    ctx.arc(1920, 1100, 600, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#171923';
    ctx.beginPath();
    ctx.moveTo(0, 1300);
    for (let x = 0; x <= 3840; x += 40) {
      const y = 1300 - Math.sin(x * 0.003) * 200 - Math.sin(x * 0.01) * 80 - Math.sin(x * 0.05) * 30;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(3840, 2160);
    ctx.lineTo(0, 2160);
    ctx.closePath();
    ctx.fill();

    createImageBitmap(sampleCanvas).then(bmp => {
      const samplePhoto = {
        id: 'sample_sunset_4k',
        name: 'sample_sunset_4k.dng',
        width: 3840,
        height: 2160,
        type: 'DNG RAW',
        imageBitmap: bmp,
        cameraJpegBitmap: bmp,
        orientation: 0,
        exif: { Camera: 'Sony Alpha 7R V / DNG 4K Demo', Resolution: '3840 x 2160' },
        params: JSON.parse(JSON.stringify(this.engine.params)),
        thumbnailUrl: sampleCanvas.toDataURL('image/jpeg', 0.8)
      };

      this.photos.push(samplePhoto);
      this.renderFilmstrip();
      this.selectPhoto(this.photos.length - 1);
      document.getElementById('drop-zone-overlay').style.display = 'none';
    });
  }

  setupShortcuts() {
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        this.undo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault();
        this.redo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        document.getElementById('file-input').click();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        this.showExportModal();
      }
      if (e.key.toLowerCase() === 'b' && !['input', 'textarea'].includes(e.target.tagName.toLowerCase())) {
        document.getElementById('btn-split').click();
      }
    });
  }

  setupSigmoidCanvas() {
    this.sigmoidCanvas = document.getElementById('sigmoid-canvas');
    if (this.sigmoidCanvas) {
      this.sigCtx = this.sigmoidCanvas.getContext('2d');
    }
  }

  drawSigmoidCurve() {
    if (!this.sigmoidCanvas || !this.sigCtx) return;
    const ctx = this.sigCtx;
    const W = this.sigmoidCanvas.width;
    const H = this.sigmoidCanvas.height;

    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, W, H);

    ctx.strokeStyle = '#333';
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2);
    ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H);
    ctx.stroke();
    ctx.setLineDash([]);

    const p = this.engine.params.sigmoid;
    const contrast = p.contrast;
    const skew = p.skew;

    ctx.strokeStyle = '#dca353';
    ctx.lineWidth = 2;
    ctx.beginPath();

    for (let i = 0; i <= W; i++) {
      const x = i / W;
      const centered = (x - 0.5) * contrast;
      let y = 1.0 / (1.0 + Math.exp(-centered * 5.0 - skew));
      y = Math.max(0.0, Math.min(1.0, y));
      const canvasY = H - y * H;

      if (i === 0) ctx.moveTo(i, canvasY);
      else ctx.lineTo(i, canvasY);
    }
    ctx.stroke();
  }

  showExportModal() {
    if (!this.engine.sourceTexture) {
      alert('편집할 이미지를 먼저 로드해주세요.');
      return;
    }
    document.getElementById('export-modal').classList.add('show');
  }

  executeExport() {
    const format = document.getElementById('export-format').value;
    const quality = parseFloat(document.getElementById('export-quality')?.value || 0.95);
    const originalName = this.currentImageInfo ? this.currentImageInfo.name.replace(/\.[^/.]+$/, "") : "photo";

    if (format === 'image/dng') {
      const dngBlob = this.engine.exportDNG();
      if (!dngBlob) return;
      const url = URL.createObjectURL(dngBlob);
      const link = document.createElement('a');
      link.download = `${originalName}_edited.dng`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
    } else {
      const dataUrl = this.engine.exportImage(format, quality);
      if (!dataUrl) return;
      const ext = format === 'image/png' ? 'png' : (format === 'image/webp' ? 'webp' : 'jpg');
      const link = document.createElement('a');
      link.download = `${originalName}_edited.${ext}`;
      link.href = dataUrl;
      link.click();
    }

    document.getElementById('export-modal').classList.remove('show');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new SemiLightroomApp();
});
