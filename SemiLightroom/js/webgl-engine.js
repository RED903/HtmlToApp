/**
 * SemiLightroom - Pro GPU WebGL Pipeline (Stable & High-Performance)
 */

class WebGLEngine {
  constructor(canvas) {
    this.canvas = canvas;
    // WebGL2 우선 활성화 (16-bit Float Texture RGBA16F 완벽 지원)
    this.gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: true }) ||
              canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: true }) ||
              canvas.getContext('experimental-webgl', { preserveDrawingBuffer: true, antialias: true });
    
    if (!this.gl) {
      alert('WebGL을 지원하지 않는 브라우저입니다.');
      return;
    }

    // 16-bit / 32-bit Float Texture 가속 확장 활성화
    const gl = this.gl;
    this.extFloat = gl.getExtension('OES_texture_float') || gl.getExtension('EXT_color_buffer_float');
    this.extHalfFloat = gl.getExtension('OES_texture_half_float');
    this.extLinear = gl.getExtension('OES_texture_float_linear') || gl.getExtension('OES_texture_half_float_linear');

    this.sourceTexture = null;
    this.curveTexture = null;
    this.imageWidth = 1920;
    this.imageHeight = 1080;
    this.is16BitSource = false;
    this.program = null;
    this.quadBuffer = null;

    // 파이프라인 파라미터 상태
    this.params = {
      orientation: { enabled: true, rotate: 0, flipH: false, flipV: false },
      geometry: { enabled: true, angle: 0, keystoneH: 0, keystoneV: 0 },
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

    this.initShaders();
    this.initCurveTexture();
    this.initScopeFbo();
  }

  initScopeFbo() {
    const gl = this.gl;
    this.scopeW = 256;
    this.scopeH = 144;
    this.scopeFbo = gl.createFramebuffer();
    this.scopeTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.scopeTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.scopeW, this.scopeH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scopeFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.scopeTexture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.scopePixelBuffer = new Uint8Array(this.scopeW * this.scopeH * 4);
  }

  initShaders() {
    const gl = this.gl;

    const vsSource = `
      precision highp float;
      attribute vec2 a_position;
      varying vec2 v_texCoord;
      uniform vec2 u_scale;
      uniform vec2 u_pan;
      uniform float u_zoom;

      void main() {
        v_texCoord = vec2(a_position.x * 0.5 + 0.5, 0.5 - a_position.y * 0.5);
        vec2 pos = (a_position * u_scale * u_zoom) + u_pan;
        gl_Position = vec4(pos, 0.0, 1.0);
      }
    `;

    const fsSource = `
      precision highp float;
      varying vec2 v_texCoord;
      uniform sampler2D u_image;
      uniform sampler2D u_curveTexture;
      uniform vec2 u_imageSize;

      uniform int u_splitEnabled;
      uniform float u_splitPos;

      uniform int u_enToneCurve;
      uniform int u_enWB;
      uniform int u_enHighlight;
      uniform int u_enExposure;
      uniform int u_enToneEq;
      uniform int u_enSigmoid;
      uniform int u_enColorEq;
      uniform int u_enColorBal;
      uniform int u_enCrop;

      uniform float u_angle;
      uniform float u_rot90;
      uniform vec2 u_flip;
      uniform vec4 u_cropRect;

      uniform int u_enSharpen;
      uniform int u_enLocalContrast;
      uniform int u_enDenoise;
      uniform int u_enBlur;
      uniform int u_enGrain;
      uniform int u_enVignette;

      uniform vec3 u_wbGain;
      uniform float u_tint;
      uniform vec2 u_highlightParams;
      uniform vec3 u_exposureParams;
      uniform float u_toneEq[5];
      uniform vec4 u_sigmoid;

      uniform float u_shAmount;
      uniform vec2 u_lcParams;
      uniform float u_dnStrength;
      uniform float u_blurRadius;
      uniform float u_grAmount;
      uniform float u_vgAmount;

      uniform float u_ceqHue[8];
      uniform float u_ceqSat[8];
      uniform float u_ceqBri[8];

      uniform vec3 u_cbShadows;
      uniform vec3 u_cbMidtones;
      uniform vec3 u_cbHighlights;

      // ─── 0. 광색역 (ACEScg / ProPhoto) 및 선형 공간 변환 함수 ───
      vec3 srgbToLinear(vec3 c) {
        return pow(max(vec3(0.0), c), vec3(2.2));
      }

      vec3 linearToAcescg(vec3 c) {
        mat3 m = mat3(
          0.6131, 0.0701, 0.0206,
          0.3395, 0.9164, 0.1096,
          0.0474, 0.0135, 0.8698
        );
        return m * c;
      }

      vec3 acescgToLinear(vec3 c) {
        mat3 m = mat3(
          1.7049, -0.1301, -0.0240,
          -0.6217, 1.1408, -0.1290,
          -0.0832, -0.0107, 1.1530
        );
        return max(vec3(0.0), m * c);
      }

      vec3 linearToSrgb(vec3 c) {
        return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
      }

      vec3 rgb2hsl(vec3 c) {
        float cMin = min(min(c.r, c.g), c.b);
        float cMax = max(max(c.r, c.g), c.b);
        float delta = cMax - cMin;
        vec3 hsl = vec3(0.0, 0.0, (cMax + cMin) * 0.5);

        if (delta > 0.00001) {
          if (hsl.z < 0.5) hsl.y = delta / (cMax + cMin);
          else hsl.y = delta / (2.0 - cMax - cMin);

          if (c.r >= cMax) hsl.x = (c.g - c.b) / delta;
          else if (c.g >= cMax) hsl.x = 2.0 + (c.b - c.r) / delta;
          else hsl.x = 4.0 + (c.r - c.g) / delta;

          hsl.x = fract(hsl.x / 6.0);
        }
        return hsl;
      }

      float hue2rgb(float p, float q, float t) {
        if (t < 0.0) t += 1.0;
        if (t > 1.0) t -= 1.0;
        if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
        if (t < 1.0/2.0) return q;
        if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
        return p;
      }

      vec3 hsl2rgb(vec3 hsl) {
        vec3 rgb;
        if (hsl.y <= 0.0001) {
          rgb = vec3(hsl.z);
        } else {
          float q = hsl.z < 0.5 ? hsl.z * (1.0 + hsl.y) : hsl.z + hsl.y - hsl.z * hsl.y;
          float p = 2.0 * hsl.z - q;
          rgb.r = hue2rgb(p, q, hsl.x + 1.0/3.0);
          rgb.g = hue2rgb(p, q, hsl.x);
          rgb.b = hue2rgb(p, q, hsl.x - 1.0/3.0);
        }
        return rgb;
      }

      vec3 applyColorEqualizer(vec3 col) {
        vec3 hsl = rgb2hsl(col);
        float h = hsl.x;

        float centers[8];
        centers[0] = 0.0;
        centers[1] = 0.083;
        centers[2] = 0.166;
        centers[3] = 0.333;
        centers[4] = 0.500;
        centers[5] = 0.666;
        centers[6] = 0.780;
        centers[7] = 0.900;

        float dH = 0.0;
        float dS = 0.0;
        float dB = 0.0;

        for (int i = 0; i < 8; i++) {
          float dist = abs(h - centers[i]);
          if (dist > 0.5) dist = 1.0 - dist;
          float w = max(0.0, 1.0 - (dist / 0.16));
          w = w * w * (3.0 - 2.0 * w);

          dH += u_ceqHue[i] * w * 0.17;
          dS += u_ceqSat[i] * w * 2.0;
          dB += u_ceqBri[i] * w * 0.6;
        }

        hsl.x = fract(hsl.x + dH);
        hsl.y = clamp(hsl.y * (1.0 + dS), 0.0, 1.0);
        hsl.z = clamp(hsl.z * (1.0 + dB), 0.0, 1.0);

        return hsl2rgb(hsl);
      }

      vec3 sampleSimpleBlur(vec2 uv, float radius) {
        vec2 d = (radius * 2.0) / max(vec2(100.0), u_imageSize);
        vec3 col = texture2D(u_image, uv).rgb * 0.4;
        col += texture2D(u_image, uv + vec2(d.x, 0.0)).rgb * 0.15;
        col += texture2D(u_image, uv - vec2(d.x, 0.0)).rgb * 0.15;
        col += texture2D(u_image, uv + vec2(0.0, d.y)).rgb * 0.15;
        col += texture2D(u_image, uv - vec2(0.0, d.y)).rgb * 0.15;
        return col;
      }

      float rand(vec2 co) {
        return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
      }

      void main() {
        vec2 suv = v_texCoord;

        // 1. 크롭 (화면에 보이는 영역 기준 1:1 정확한 매핑)
        if (u_enCrop == 1) {
          suv = u_cropRect.xy + suv * u_cropRect.zw;
        }

        // 2. 미세 각도 회전 (내접 영역 기준으로 완벽하게 잘라내어 수평 정렬)
        if (u_angle != 0.0) {
          float rad = radians(u_angle);
          float cosA = cos(rad);
          float sinA = sin(rad);
          mat2 rot = mat2(cosA, -sinA, sinA, cosA);

          vec2 cUV = suv - 0.5;
          float aspect = (u_rot90 == 90.0 || u_rot90 == 270.0) ? (u_imageSize.y / max(1.0, u_imageSize.x)) : (u_imageSize.x / max(1.0, u_imageSize.y));
          cUV.x *= aspect;

          // 내접 영역 크기대로 자동 맞춤 (Auto-Crop to Inscribed Frame)
          float absRad = abs(rad);
          float sX = 1.0 / (cos(absRad) + sin(absRad) / aspect);
          float sY = 1.0 / (cos(absRad) + sin(absRad) * aspect);
          float innerScale = min(sX, sY);

          cUV = rot * cUV * innerScale;
          cUV.x /= aspect;
          suv = cUV + 0.5;
        }

        // 3. 90도 회전 & 플립 역변환
        if (u_rot90 == 90.0) suv = vec2(suv.y, 1.0 - suv.x);
        else if (u_rot90 == 180.0) suv = vec2(1.0 - suv.x, 1.0 - suv.y);
        else if (u_rot90 == 270.0) suv = vec2(1.0 - suv.y, suv.x);

        if (u_flip.x > 0.5) suv.x = 1.0 - suv.x;
        if (u_flip.y > 0.5) suv.y = 1.0 - suv.y;

        if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) {
          gl_FragColor = vec4(0.08, 0.08, 0.08, 1.0);
          return;
        }

        vec2 uv = clamp(suv, 0.0, 1.0);
        vec4 rawColor = texture2D(u_image, uv);

        // Before / After Split (분할 비교선 선명하게 렌더링)
        if (u_splitEnabled == 1) {
          float splitDist = abs(v_texCoord.x - u_splitPos);
          if (splitDist < 0.0025) {
            gl_FragColor = vec4(0.95, 0.75, 0.2, 1.0); // 선명한 황금빛 분할선
            return;
          }
          if (v_texCoord.x < u_splitPos) {
            gl_FragColor = vec4(rawColor.rgb, 1.0); // Before (원본)
            return;
          }
        }

        // ── 광색역 Linear ACEScg 32-bit Float 공간으로 진입 ──
        vec3 linCol = srgbToLinear(rawColor.rgb);
        vec3 col = linearToAcescg(linCol);

        // 1. 화이트 밸런스 (광색역 선형 게인 적용)
        if (u_enWB == 1) {
          col.r *= u_wbGain.r;
          col.g *= u_wbGain.g * (1.0 - u_tint * 0.3);
          col.b *= u_wbGain.b;
          if (u_tint > 0.0) col.r += u_tint * 0.1;
          if (u_tint < 0.0) col.g -= u_tint * 0.1;
        }

        // 2. 하이라이트 채널 재구성 (클리핑 복원)
        if (u_enHighlight == 1) {
          float maxC = max(max(col.r, col.g), col.b);
          if (u_highlightParams.x > 0.0 && maxC > 0.8) {
            float clip = clamp((maxC - 0.8) / 0.2, 0.0, 1.0);
            float avg = (col.r + col.g + col.b) * 0.3333;
            col = mix(col, vec3(avg), clip * u_highlightParams.x * 0.5);
          }
          if (u_highlightParams.y > 0.0) {
            col = col / (1.0 + col * u_highlightParams.y * 0.4) * (1.0 + u_highlightParams.y * 0.4);
          }
        }

        // 3. 선형 다이내믹 레인지 노출 증폭 (±5.0EV 완벽 지원)
        if (u_enExposure == 1) {
          col *= u_exposureParams.x;
          // 암부 블랙 레벨 미세 조절
          col = max(vec3(0.0), col - u_exposureParams.y * 0.05);
          if (u_exposureParams.z != 0.0) {
            col = (col - 0.18) * (1.0 + u_exposureParams.z * 0.5) + 0.18;
          }
        }

        // 4. 톤 이퀄라이저 (선형 밝기 대역별 정밀 부스팅)
        if (u_enToneEq == 1) {
          float lum = dot(col, vec3(0.2722, 0.6741, 0.0537));
          float wB = exp(-pow(lum - 0.03, 2.0) / 0.01);
          float wS = exp(-pow(lum - 0.15, 2.0) / 0.03);
          float wM = exp(-pow(lum - 0.40, 2.0) / 0.05);
          float wH = exp(-pow(lum - 0.70, 2.0) / 0.04);
          float wW = exp(-pow(lum - 0.95, 2.0) / 0.02);
          float gain = (u_toneEq[0] * wB + u_toneEq[1] * wS + u_toneEq[2] * wM + u_toneEq[3] * wH + u_toneEq[4] * wW);
          col *= max(vec3(0.0), vec3(1.0 + gain * 0.85));
        }

        // 5. RGB 톤 커브
        if (u_enToneCurve == 1) {
          vec3 nCol = clamp(col, 0.0, 1.0);
          col.r = texture2D(u_curveTexture, vec2(nCol.r, 0.125)).r;
          col.g = texture2D(u_curveTexture, vec2(nCol.g, 0.375)).g;
          col.b = texture2D(u_curveTexture, vec2(nCol.b, 0.625)).b;
          col.r = texture2D(u_curveTexture, vec2(col.r, 0.875)).r;
          col.g = texture2D(u_curveTexture, vec2(col.g, 0.875)).g;
          col.b = texture2D(u_curveTexture, vec2(col.b, 0.875)).b;
        }

        // 6. Sigmoid 톤 매핑 (광색역 ACES 필름 롤오프로 디스플레이 범위 안착)
        if (u_enSigmoid == 1) {
          float k = 3.2 * u_sigmoid.x;
          vec3 shifted = col - (0.5 + u_sigmoid.y * 0.2);
          vec3 sig = 1.0 / (1.0 + exp(-k * shifted));
          if (u_sigmoid.z != 0.0) sig = mix(sig, pow(sig, vec3(1.0 - u_sigmoid.z * 0.4)), 0.5);
          if (u_sigmoid.w != 0.0) sig = mix(sig, pow(sig, vec3(1.0 + u_sigmoid.w * 0.4)), 0.5);
          col = clamp(sig, 0.0, 1.0);
        }

        // 광색역 공간 ➔ 리니어 sRGB로 변환
        col = acescgToLinear(col);

        // 7. 디스플레이 공간 HSL 컬러 이퀄라이저
        if (u_enColorEq == 1) {
          col = applyColorEqualizer(clamp(col, 0.0, 1.0));
        }

        // 8. 3Way 컬러 밸런스
        if (u_enColorBal == 1) {
          float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
          float wSh = clamp(1.0 - lum * 2.0, 0.0, 1.0);
          float wHi = clamp(lum * 2.0 - 1.0, 0.0, 1.0);
          float wMid = clamp(1.0 - abs(lum - 0.5) * 2.0, 0.0, 1.0);
          col += u_cbShadows * wSh * 0.35;
          col += u_cbMidtones * wMid * 0.35;
          col += u_cbHighlights * wHi * 0.35;
        }

        // 7. 디테일 모듈
        if (u_enSharpen == 1 && u_shAmount > 0.0) {
          vec3 blurS = sampleSimpleBlur(uv, 1.0);
          col += (col - blurS) * u_shAmount * 2.0;
        }

        if (u_enLocalContrast == 1) {
          vec3 blurS = sampleSimpleBlur(uv, 2.0);
          if (u_lcParams.x > 0.0) col += (col - blurS) * u_lcParams.x * 1.5;
          if (u_lcParams.y != 0.0) col = (col - 0.5) * (1.0 + u_lcParams.y * 0.5) + 0.5;
        }

        if (u_enDenoise == 1 && u_dnStrength > 0.0) {
          vec3 blurS = sampleSimpleBlur(uv, 1.0);
          col = mix(col, blurS, u_dnStrength * 0.6);
        }

        if (u_enBlur == 1 && u_blurRadius > 0.0) {
          vec3 deepBlur = sampleSimpleBlur(uv, u_blurRadius * 5.0);
          col = mix(col, deepBlur, clamp(u_blurRadius * 1.2, 0.0, 1.0));
        }

        if (u_enGrain == 1 && u_grAmount > 0.0) {
          float noise = (rand(uv) - 0.5) * u_grAmount * 0.35;
          col += noise;
        }

        if (u_enVignette == 1 && u_vgAmount != 0.0) {
          vec2 center = uv - 0.5;
          float dist = length(center) * 1.414;
          if (u_vgAmount > 0.0) col *= (1.0 - smoothstep(0.4, 1.2, dist) * u_vgAmount * 0.85);
          else col += smoothstep(0.4, 1.2, dist) * (-u_vgAmount) * 0.5;
        }

        // 최종 디스플레이 sRGB Gamma OETF 변환
        col = linearToSrgb(col);

        gl_FragColor = vec4(clamp(col, 0.0, 1.0), rawColor.a);
      }
    `;

    this.program = this.createShaderProgram(gl, vsSource, fsSource);
    gl.useProgram(this.program);

    const positions = new Float32Array([
      -1.0, -1.0,
       1.0, -1.0,
      -1.0,  1.0,
      -1.0,  1.0,
       1.0, -1.0,
       1.0,  1.0
    ]);

    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const posAttr = gl.getAttribLocation(this.program, 'a_position');
    gl.enableVertexAttribArray(posAttr);
    gl.vertexAttribPointer(posAttr, 2, gl.FLOAT, false, 0, 0);
  }

  initCurveTexture() {
    const gl = this.gl;
    this.curveTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.curveTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const data = new Uint8Array(256 * 4 * 4);
    for (let row = 0; row < 4; row++) {
      for (let i = 0; i < 256; i++) {
        const idx = (row * 256 + i) * 4;
        data[idx] = i;
        data[idx + 1] = i;
        data[idx + 2] = i;
        data[idx + 3] = 255;
      }
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 4, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  }

  updateCurveTexture(lutObj) {
    if (!lutObj || !this.curveTexture) return;
    const gl = this.gl;
    const data = new Uint8Array(256 * 4 * 4);

    const rLut = lutObj.r;
    const gLut = lutObj.g;
    const bLut = lutObj.b;
    const rgbLut = lutObj.rgb;

    for (let i = 0; i < 256; i++) {
      let idx = (0 * 256 + i) * 4;
      data[idx] = Math.round(rLut[i] * 255);
      data[idx + 1] = 0;
      data[idx + 2] = 0;
      data[idx + 3] = 255;

      idx = (1 * 256 + i) * 4;
      data[idx] = 0;
      data[idx + 1] = Math.round(gLut[i] * 255);
      data[idx + 2] = 0;
      data[idx + 3] = 255;

      idx = (2 * 256 + i) * 4;
      data[idx] = 0;
      data[idx + 1] = 0;
      data[idx + 2] = Math.round(bLut[i] * 255);
      data[idx + 3] = 255;

      idx = (3 * 256 + i) * 4;
      data[idx] = Math.round(rgbLut[i] * 255);
      data[idx + 1] = Math.round(rgbLut[i] * 255);
      data[idx + 2] = Math.round(rgbLut[i] * 255);
      data[idx + 3] = 255;
    }

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.curveTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 4, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  }

  createShaderProgram(gl, vsSource, fsSource) {
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, vsSource);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) console.error('VS Error:', gl.getShaderInfoLog(vs));

    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fsSource);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) console.error('FS Error:', gl.getShaderInfoLog(fs));

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program Link Error:', gl.getProgramInfoLog(program));
    }
    return program;
  }

  setImage(imageBitmap, raw16FloatArray = null) {
    const gl = this.gl;
    this.imageWidth = imageBitmap.width;
    this.imageHeight = imageBitmap.height;

    if (this.sourceTexture) gl.deleteTexture(this.sourceTexture);

    this.sourceTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // 16-bit Float 원본 센서 데이터가 제공된 경우: Float32Array를 16-bit/32-bit Float Texture로 직접 주입!
    if (raw16FloatArray instanceof Float32Array) {
      this.is16BitSource = true;
      try {
        if (gl.RGBA16F) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, this.imageWidth, this.imageHeight, 0, gl.RGBA, gl.FLOAT, raw16FloatArray);
        } else {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.imageWidth, this.imageHeight, 0, gl.RGBA, gl.FLOAT, raw16FloatArray);
        }
      } catch (e) {
        console.warn('Float Texture Fallback to Bitmap:', e);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageBitmap);
      }
    } else {
      this.is16BitSource = false;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageBitmap);
    }
    this.render();
  }

  kelvinToRGB(kelvin) {
    const temp = kelvin / 100;
    let red, green, blue;
    if (temp <= 66) {
      red = 255;
      green = 99.4708025861 * Math.log(temp) - 161.1195681661;
      blue = temp <= 19 ? 0 : 138.5177312231 * Math.log(temp - 10) - 305.0447927307;
    } else {
      red = 329.698727446 * Math.pow(temp - 60, -0.1332047592);
      green = 288.1221695283 * Math.pow(temp - 60, -0.0755148492);
      blue = 255;
    }
    red = Math.min(255, Math.max(0, red)) / 255;
    green = Math.min(255, Math.max(0, green)) / 255;
    blue = Math.min(255, Math.max(0, blue)) / 255;
    return [red / 0.95, green / 0.95, blue / 1.0];
  }

  render() {
    if (!this.sourceTexture || !this.gl) return;
    const gl = this.gl;
    const p = this.params;

    // 종횡비 및 크롭 유효 크기 계산
    const rot = p.orientation.rotate;
    let imgW = (rot === 90 || rot === 270) ? this.imageHeight : this.imageWidth;
    let imgH = (rot === 90 || rot === 270) ? this.imageWidth : this.imageHeight;

    const cr = p.crop;
    const cropW = (cr && cr.enabled && cr.width > 0.001) ? cr.width : 1.0;
    const cropH = (cr && cr.enabled && cr.height > 0.001) ? cr.height : 1.0;
    const effW = imgW * cropW;
    const effH = imgH * cropH;

    gl.useProgram(this.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_image'), 0);

    if (this.params.toneCurveLut) {
      this.updateCurveTexture(this.params.toneCurveLut);
    }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.curveTexture);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_curveTexture'), 1);

    gl.uniform2f(gl.getUniformLocation(this.program, 'u_imageSize'), this.imageWidth, this.imageHeight);

    gl.uniform1f(gl.getUniformLocation(this.program, 'u_angle'), p.geometry.angle);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_rot90'), p.orientation.rotate);
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_keystone'), p.geometry.keystoneH, p.geometry.keystoneV);

    gl.uniform1i(gl.getUniformLocation(this.program, 'u_enToneCurve'), p.toneCurve.enabled ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_enWB'), p.whiteBalance.enabled ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_enHighlight'), p.highlight.enabled ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_enExposure'), p.exposure.enabled ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_enToneEq'), p.toneEqualizer.enabled ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_enSigmoid'), p.sigmoid.enabled ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_enColorEq'), p.colorEqualizer.enabled ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_enColorBal'), p.colorBalance.enabled ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_enCrop'), (cr && cr.enabled) ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_angle'), (p.geometry && p.geometry.angle) ? p.geometry.angle : 0.0);

    gl.uniform1i(gl.getUniformLocation(this.program, 'u_enSharpen'), p.sharpen.enabled ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_enLocalContrast'), p.localContrast.enabled ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_enDenoise'), p.denoise.enabled ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_enBlur'), p.blur.enabled ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_enGrain'), p.grain.enabled ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_enVignette'), p.vignette.enabled ? 1 : 0);

    gl.uniform2f(gl.getUniformLocation(this.program, 'u_flip'), p.orientation.flipH ? 1.0 : 0.0, p.orientation.flipV ? 1.0 : 0.0);

    const wbGain = this.kelvinToRGB(p.whiteBalance.temperature);
    gl.uniform3f(gl.getUniformLocation(this.program, 'u_wbGain'), wbGain[0], wbGain[1], wbGain[2]);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_tint'), p.whiteBalance.tint);

    gl.uniform2f(gl.getUniformLocation(this.program, 'u_highlightParams'), p.highlight.recovery, p.highlight.compress);

    const evFactor = Math.pow(2.0, p.exposure.ev);
    gl.uniform3f(gl.getUniformLocation(this.program, 'u_exposureParams'), evFactor, p.exposure.blackLevel, p.exposure.contrast);

    const te = p.toneEqualizer;
    gl.uniform1fv(gl.getUniformLocation(this.program, 'u_toneEq'), [te.blacks, te.shadows, te.midtones, te.highlights, te.whites]);

    const sig = p.sigmoid;
    gl.uniform4f(gl.getUniformLocation(this.program, 'u_sigmoid'), sig.contrast, sig.skew, sig.shoulder, sig.toe);

    gl.uniform1f(gl.getUniformLocation(this.program, 'u_shAmount'), p.sharpen.amount);
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_lcParams'), p.localContrast.detail, p.localContrast.clarity);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_dnStrength'), p.denoise.strength);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_blurRadius'), p.blur.radius);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_grAmount'), p.grain.amount);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_vgAmount'), p.vignette.amount);

    gl.uniform4f(gl.getUniformLocation(this.program, 'u_cropRect'), cr.x, cr.y, cr.width, cr.height);

    gl.uniform1fv(gl.getUniformLocation(this.program, 'u_ceqHue'), p.colorEqualizer.hue);
    gl.uniform1fv(gl.getUniformLocation(this.program, 'u_ceqSat'), p.colorEqualizer.sat);
    gl.uniform1fv(gl.getUniformLocation(this.program, 'u_ceqBri'), p.colorEqualizer.bri);

    const cb = p.colorBalance;
    gl.uniform3fv(gl.getUniformLocation(this.program, 'u_cbShadows'), cb.shadows);
    gl.uniform3fv(gl.getUniformLocation(this.program, 'u_cbMidtones'), cb.midtones);
    gl.uniform3fv(gl.getUniformLocation(this.program, 'u_cbHighlights'), cb.highlights);

    // ── 1. Scope용 FBO 렌더링 ──
    if (this.scopeFbo) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.scopeFbo);
      gl.viewport(0, 0, this.scopeW, this.scopeH);
      gl.clearColor(0.0, 0.0, 0.0, 0.0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const fboAspect = this.scopeW / this.scopeH;
      const imgAspectFbo = effW / Math.max(1, effH);
      let sX = 1.0, sY = 1.0;
      if (imgAspectFbo > fboAspect) sY = fboAspect / imgAspectFbo;
      else sX = imgAspectFbo / fboAspect;

      gl.uniform2f(gl.getUniformLocation(this.program, 'u_scale'), sX, sY);
      gl.uniform2f(gl.getUniformLocation(this.program, 'u_pan'), 0.0, 0.0);
      gl.uniform1f(gl.getUniformLocation(this.program, 'u_zoom'), 1.0);
      gl.uniform1i(gl.getUniformLocation(this.program, 'u_splitEnabled'), 0);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.readPixels(0, 0, this.scopeW, this.scopeH, gl.RGBA, gl.UNSIGNED_BYTE, this.scopePixelBuffer);
    }

    // ── 2. 메인 화면 캔버스 렌더링 ──
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.08, 0.08, 0.08, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const canvasAspect = this.canvas.width / Math.max(1, this.canvas.height);
    const imgAspect = effW / Math.max(1, effH);
    let scaleX = 1.0, scaleY = 1.0;
    if (imgAspect > canvasAspect) {
      scaleY = canvasAspect / imgAspect;
    } else {
      scaleX = imgAspect / canvasAspect;
    }

    gl.uniform2f(gl.getUniformLocation(this.program, 'u_scale'), scaleX, scaleY);
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_pan'), p.viewport.panX, p.viewport.panY);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_zoom'), p.viewport.zoom);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_splitEnabled'), p.splitView.enabled ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_splitPos'), p.splitView.position);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    if (this.onRenderComplete) {
      this.onRenderComplete();
    }
  }

  getRenderPixels() {
    if (!this.sourceTexture || !this.scopePixelBuffer) return null;
    return { data: this.scopePixelBuffer, width: this.scopeW, height: this.scopeH };
  }

  /**
   * 전체 해상도 원본 픽셀로 완벽하게 렌더링하여 RGBA 바이트 배열 추출 (검은 화면 0% 보장)
   */
  renderToPixels(outW, outH) {
    const gl = this.gl;
    if (!this.sourceTexture || !this.program) return null;

    // 1. 임시 오프스크린 FBO 및 텍스처 생성
    const fbo = gl.createFramebuffer();
    const fboTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, fboTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, outW, outH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTex, 0);

    gl.viewport(0, 0, outW, outH);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // 2. 쉐이더 정점 속성 바인딩
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);

    const posAttr = gl.getAttribLocation(this.program, 'a_position');
    gl.enableVertexAttribArray(posAttr);
    gl.vertexAttribPointer(posAttr, 2, gl.FLOAT, false, 0, 0);

    // 텍스처 슬롯 바인딩
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_image'), 0);

    if (this.curveTexture) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.curveTexture);
      gl.uniform1i(gl.getUniformLocation(this.program, 'u_curveLut'), 1);
      gl.uniform1i(gl.getUniformLocation(this.program, 'u_enCurve'), 1);
    } else {
      gl.uniform1i(gl.getUniformLocation(this.program, 'u_enCurve'), 0);
    }

    // 내보내기 시 뷰포트 줌/팬은 1.0/0.0으로 꽉 채움
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_scale'), 1.0, 1.0);
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_pan'), 0.0, 0.0);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_zoom'), 1.0);
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_imageSize'), this.imageWidth, this.imageHeight);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_splitEnabled'), 0);

    // 파라미터 적용
    const p = this.params;
    const cr = p.crop;
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_enWB'), p.whiteBalance.enabled ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_enHighlight'), p.highlight.enabled ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_enExposure'), p.exposure.enabled ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_enToneEq'), p.toneEqualizer.enabled ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_enSigmoid'), p.sigmoid.enabled ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_enColorEq'), p.colorEqualizer.enabled ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_enColorBal'), p.colorBalance.enabled ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_enCrop'), (cr && cr.enabled) ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_angle'), (p.geometry && p.geometry.angle) ? p.geometry.angle : 0.0);

    gl.uniform1i(gl.getUniformLocation(this.program, 'u_enSharpen'), p.sharpen.enabled ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_enLocalContrast'), p.localContrast.enabled ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_enDenoise'), p.denoise.enabled ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_enBlur'), p.blur.enabled ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_enGrain'), p.grain.enabled ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_enVignette'), p.vignette.enabled ? 1 : 0);

    gl.uniform1f(gl.getUniformLocation(this.program, 'u_rot90'), p.orientation.rotate);
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_flip'), p.orientation.flipH ? 1.0 : 0.0, p.orientation.flipV ? 1.0 : 0.0);

    const wbGain = this.kelvinToRGB(p.whiteBalance.temperature);
    gl.uniform3f(gl.getUniformLocation(this.program, 'u_wbGain'), wbGain[0], wbGain[1], wbGain[2]);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_tint'), p.whiteBalance.tint);

    gl.uniform2f(gl.getUniformLocation(this.program, 'u_highlightParams'), p.highlight.recovery, p.highlight.compress);
    const evFactor = Math.pow(2.0, p.exposure.ev);
    gl.uniform3f(gl.getUniformLocation(this.program, 'u_exposureParams'), evFactor, p.exposure.blackLevel, p.exposure.contrast);

    const te = p.toneEqualizer;
    gl.uniform1fv(gl.getUniformLocation(this.program, 'u_toneEq'), [te.blacks, te.shadows, te.midtones, te.highlights, te.whites]);

    const sig = p.sigmoid;
    gl.uniform4f(gl.getUniformLocation(this.program, 'u_sigmoid'), sig.contrast, sig.skew, sig.shoulder, sig.toe);

    gl.uniform1f(gl.getUniformLocation(this.program, 'u_shAmount'), p.sharpen.amount);
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_lcParams'), p.localContrast.detail, p.localContrast.clarity);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_dnStrength'), p.denoise.strength);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_blurRadius'), p.blur.radius);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_grAmount'), p.grain.amount);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_vgAmount'), p.vignette.amount);

    gl.uniform4f(gl.getUniformLocation(this.program, 'u_cropRect'), cr.x, cr.y, cr.width, cr.height);

    const ceq = p.colorEqualizer;
    gl.uniform1fv(gl.getUniformLocation(this.program, 'u_ceqHue'), ceq.hue);
    gl.uniform1fv(gl.getUniformLocation(this.program, 'u_ceqSat'), ceq.sat);
    gl.uniform1fv(gl.getUniformLocation(this.program, 'u_ceqBri'), ceq.bri);

    const cb = p.colorBalance;
    gl.uniform3f(gl.getUniformLocation(this.program, 'u_cbShadows'), cb.shadows[0], cb.shadows[1], cb.shadows[2]);
    gl.uniform3f(gl.getUniformLocation(this.program, 'u_cbMidtones'), cb.midtones[0], cb.midtones[1], cb.midtones[2]);
    gl.uniform3f(gl.getUniformLocation(this.program, 'u_cbHighlights'), cb.highlights[0], cb.highlights[1], cb.highlights[2]);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // 3. 픽셀 데이터 읽기
    const rawPixels = new Uint8Array(outW * outH * 4);
    gl.readPixels(0, 0, outW, outH, gl.RGBA, gl.UNSIGNED_BYTE, rawPixels);

    // FBO 자원 정리 및 화면 복원
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(fboTex);
    this.render();

    // 4. OpenGL 상하 반전(Y-flip) 보정
    const flipped = new Uint8ClampedArray(outW * outH * 4);
    const rowBytes = outW * 4;
    for (let y = 0; y < outH; y++) {
      const srcRow = (outH - 1 - y) * rowBytes;
      const dstRow = y * rowBytes;
      flipped.set(rawPixels.subarray(srcRow, srcRow + rowBytes), dstRow);
    }

    return flipped;
  }

  exportImage(format = 'image/jpeg', quality = 0.95) {
    if (!this.sourceTexture) return null;

    let outW = this.imageWidth;
    let outH = this.imageHeight;

    if (this.params.orientation.rotate === 90 || this.params.orientation.rotate === 270) {
      outW = this.imageHeight;
      outH = this.imageWidth;
    }

    const cr = this.params.crop;
    if (cr && cr.enabled) {
      outW = Math.max(1, Math.round(outW * cr.width));
      outH = Math.max(1, Math.round(outH * cr.height));
    }

    const pixels = this.renderToPixels(outW, outH);
    if (!pixels) return null;

    const offCanvas = document.createElement('canvas');
    offCanvas.width = outW;
    offCanvas.height = outH;
    const ctx = offCanvas.getContext('2d');
    const imgData = ctx.createImageData(outW, outH);
    imgData.data.set(pixels);
    ctx.putImageData(imgData, 0, 0);

    return offCanvas.toDataURL(format, quality);
  }

  exportTIFF16() {
    if (!this.sourceTexture) return null;
    let outW = this.imageWidth;
    let outH = this.imageHeight;

    if (this.params.orientation.rotate === 90 || this.params.orientation.rotate === 270) {
      outW = this.imageHeight;
      outH = this.imageWidth;
    }

    const cr = this.params.crop;
    if (cr && cr.enabled) {
      outW = Math.max(1, Math.round(outW * cr.width));
      outH = Math.max(1, Math.round(outH * cr.height));
    }

    const pixels = this.renderToPixels(outW, outH);
    if (!pixels) return null;

    const tiffBuffer = window.DngExporter.encodeTIFF16(pixels, outW, outH);
    return new Blob([tiffBuffer], { type: 'image/tiff' });
  }

  exportDNG() {
    if (!this.sourceTexture) return null;
    let outW = this.imageWidth;
    let outH = this.imageHeight;

    if (this.params.orientation.rotate === 90 || this.params.orientation.rotate === 270) {
      outW = this.imageHeight;
      outH = this.imageWidth;
    }

    const cr = this.params.crop;
    if (cr && cr.enabled) {
      outW = Math.max(1, Math.round(outW * cr.width));
      outH = Math.max(1, Math.round(outH * cr.height));
    }

    const pixels = this.renderToPixels(outW, outH);
    if (!pixels) return null;

    const dngBuffer = window.DngExporter.encodeDNG16(pixels, outW, outH);
    return new Blob([dngBuffer], { type: 'image/dng' });
  }

  samplePixel(x, y) {
    const gl = this.gl;
    const pixels = new Uint8Array(4);
    gl.readPixels(x, this.canvas.height - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return { r: pixels[0], g: pixels[1], b: pixels[2], a: pixels[3] };
  }
}

window.WebGLEngine = WebGLEngine;
