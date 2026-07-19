import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { gsap } from 'gsap';

// ============ 粒子纹理生成 ============
function createGlowTexture(size, color1, color2) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, color1);
  g.addColorStop(0.2, color1);
  g.addColorStop(0.5, color2);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

// ============ 部位名称 ============
export const PART_NAMES = ['head', 'heart', 'body', 'hands', 'feet'];

// ============ 默认部位颜色 ============
const DEFAULT_COLORS = {
  head: '#88bbff',
  heart: '#88bbff',
  body: '#88bbff',
  hands: '#88bbff',
  feet: '#88bbff',
};

// ============ 顶点分类（独立导出，供 model-demo 和 debug 页面复用） ============
export function classifyVertices(allVerts) {
  const n = allVerts.length / 3;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = allVerts[i * 3], y = allVerts[i * 3 + 1], z = allVerts[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const height = maxY - minY, width = maxX - minX, depth = maxZ - minZ;
  const midX = (minX + maxX) / 2, midZ = (minZ + maxZ) / 2;

  // 阈值计算
  const headY = maxY - height * 0.14;
  const shoulderY = maxY - height * 0.15;
  const kneeY = minY + height * 0.16;
  const handX = width * 0.08;
  const footX = width * 0.17;
  const handsLowerY = minY + height * 0.33;

  // 躯干排除区
  const excludeCY = minY + height * 0.61;
  const excludeRX = width * 1.0, excludeRY = height * 0.98, excludeRZ = depth * 0.46;

  const bins = {};
  for (const name of PART_NAMES) bins[name] = [];
  const classified = new Set();

  // 噪声哈希
  const hash = (seed) => {
    let h = seed * 2654435761;
    h = ((h >> 16) ^ h) * 0x45d9f3b;
    return ((h >> 16) ^ h) / 0x7fffffff;
  };
  const bw = height * 0.15;

  for (let i = 0; i < n; i++) {
    const x = allVerts[i * 3], y = allVerts[i * 3 + 1], z = allVerts[i * 3 + 2];
    const noiseY = (hash(i * 3) - 0.5) * bw;
    const noiseX = (hash(i * 3 + 1) - 0.5) * bw * 0.80;
    const noiseZ = (hash(i * 3 + 2) - 0.5) * bw * 0.80;

    // heart（椭圆体）
    const hcy = minY + height * 0.71 + noiseY * 0.45;
    const hrx = width * 0.3, hry = height * 0.05, hrz = depth * 0.17;
    if (((x - midX) ** 2 / hrx ** 2 + (y - hcy) ** 2 / hry ** 2 + (z - (midZ + depth * 0)) ** 2 / hrz ** 2) <= 2.5) {
      bins['heart'].push(i); classified.add(i); continue;
    }

    // head
    const myHeadY = headY + noiseY * 1.0;
    if (y > myHeadY) { bins['head'].push(i); classified.add(i); continue; }

    // hands（含躯干排除区）
    const myShoulderY = shoulderY + noiseY * 1.45;
    const myHandsLowerY = handsLowerY + noiseY * 1.45;
    const myHandX = handX + noiseX * 1.65;
    if (Math.abs(x - midX) > myHandX && y > myHandsLowerY && y < myShoulderY) {
      const exRZ = Math.max(0.001, excludeRZ + noiseZ * 0.8);
      const exRX = Math.max(0.001, excludeRX + noiseX * 1.2);
      const exRY = Math.max(0.001, excludeRY + noiseY * 0.9);
      if (!(((x - midX) ** 2 / exRX ** 2 + (y - excludeCY) ** 2 / exRY ** 2 + (z - midZ) ** 2 / exRZ ** 2) <= 1.0)) {
        bins['hands'].push(i); classified.add(i); continue;
      }
    }

    // feet
    const myKneeY = kneeY + noiseY * 3;
    const myFootX = footX + noiseX * 2.7;
    if (Math.abs(x - midX) > myFootX && y < myKneeY) {
      bins['feet'].push(i); classified.add(i); continue;
    }
  }

  // body = 未被 head/heart/hands/feet 分类的所有剩余顶点
  for (let i = 0; i < n; i++) {
    if (!classified.has(i)) bins['body'].push(i);
  }

  return { bins, bb: { minX, maxX, minY, maxY, minZ, maxZ, height, midX, midZ } };
}

export default class GLBParticleSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   * @param {object} options
   */
  constructor(scene, camera, options = {}) {
    this.scene = scene;
    this.camera = camera;

    // 配置参数
    this.sampleRate = options.sampleRate ?? 10;
    this.scatterFactor = options.scatterFactor ?? 0.03;
    this.breathStrength = options.breathStrength ?? 0.5;
    this.floatAmplitude = options.floatAmplitude ?? 0.3;
    this.particleSize = options.particleSize ?? 0.06;
    this.particleOpacity = options.particleOpacity ?? 0.6;

    // 环境粒子配置
    this.ambientCount = options.ambientCount ?? 200;
    this.ambientSize = options.ambientSize ?? 0.04;
    this.ambientSpeed = options.ambientSpeed ?? 1.0;
    this.ambientColor1 = options.ambientColor1 ?? '#ffd700';
    this.ambientColor2 = options.ambientColor2 ?? '#4488ff';

    // 内部状态
    this.allVertices = null;
    this.boundingBox = null;
    this.partData = {};
    this.particleGroup = null;
    this.ambientParticles = null;
    this.ambientData = null;
    this.glowingPart = null;
    this.hoveredPart = null;
    this.focusedParts = new Set();
    this.isLoaded = false;

    // 缓存原始顶点颜色（用于恢复）
    this._originalColors = new Map(); // partName -> Float32Array

    // 部位颜色（可编辑）
    this.partColors = {};
    for (const name of PART_NAMES) {
      this.partColors[name] = new THREE.Color(DEFAULT_COLORS[name]);
    }

    // 粒子纹理
    this.glowTex = createGlowTexture(64, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)');

    // GLTF 加载器
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    this.loader = new GLTFLoader();
    this.loader.setDRACOLoader(dracoLoader);
  }

  // ============ 顶点颜色计算：Y轴渐变 + 部位色混合 ============
  computeVertexColor(y, bb, partName) {
    const ny = (y - bb.minY) / bb.height;
    const base = new THREE.Color();
    // 淡蓝渐变：从深蓝到浅蓝
    if (ny < 0.3) {
      base.lerpColors(new THREE.Color('#5588bb'), new THREE.Color('#77aadd'), ny / 0.3);
    } else if (ny < 0.7) {
      base.lerpColors(new THREE.Color('#77aadd'), new THREE.Color('#99ccff'), (ny - 0.3) / 0.4);
    } else {
      base.lerpColors(new THREE.Color('#99ccff'), new THREE.Color('#bbddff'), (ny - 0.7) / 0.3);
    }
    const partColor = this.partColors[partName] || new THREE.Color('#88bbff');
    return new THREE.Color().lerpColors(base, partColor, 0.7);
  }

  // ============ 顶点居中 ============
  centerVertices(verts) {
    const n = verts.length / 3;
    let cx = 0, cy = 0, cz = 0;
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      cx += verts[i * 3];
      cy += verts[i * 3 + 1];
      cz += verts[i * 3 + 2];
      if (verts[i * 3 + 1] < minY) minY = verts[i * 3 + 1];
      if (verts[i * 3 + 1] > maxY) maxY = verts[i * 3 + 1];
    }
    cx /= n; cy /= n; cz /= n;
    for (let i = 0; i < n; i++) {
      verts[i * 3] -= cx;
      verts[i * 3 + 1] -= minY;
      verts[i * 3 + 2] -= cz;
    }
    console.log(`[GLBParticleSystem] 顶点居中完成, 高度: ${(maxY - minY).toFixed(2)}`);
  }

  // ============ 顶点分类（委托给独立导出函数） ============
  classifyVertices(allVerts) {
    return classifyVertices(allVerts);
  }

  // ============ 采样 ============
  sampleIndices(indices, targetCount) {
    if (indices.length <= targetCount) return indices.slice();
    const sampled = [];
    const step = indices.length / targetCount;
    for (let i = 0; i < targetCount; i++) {
      sampled.push(indices[Math.floor(i * step)]);
    }
    return sampled;
  }

  // ============ 创建分块粒子 ============
  createPartParticles(partName, baseVertices) {
    const count = baseVertices.length / 3;
    if (count === 0) return null;

    const scatterOffsets = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      scatterOffsets[i * 3] = Math.sin(phi) * Math.cos(theta);
      scatterOffsets[i * 3 + 1] = Math.sin(phi) * Math.sin(theta);
      scatterOffsets[i * 3 + 2] = Math.cos(phi);
    }

    const currentPos = new Float32Array(count * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(currentPos, 3));

    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const y = baseVertices[i * 3 + 1];
      const c = this.computeVertexColor(y, this.boundingBox, partName);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: this.particleSize,
      map: this.glowTex,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      transparent: true,
      opacity: this.particleOpacity,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geo, mat);
    return { baseVertices, scatterOffsets, currentPos, geo, mat, points, count };
  }

  // ============ 重建所有部位 ============
  rebuildAllParts() {
    if (!this.allVertices) return;

    if (this.particleGroup) {
      this.scene.remove(this.particleGroup);
      for (const key in this.partData) {
        this.partData[key].geo.dispose();
        this.partData[key].mat.dispose();
      }
    }

    const { bins, bb } = this.classifyVertices(this.allVertices);
    this.boundingBox = bb;
    this.partData = {};
    this.particleGroup = new THREE.Group();

    let totalParticles = 0;
    for (const name of PART_NAMES) {
      const sampled = this.sampleIndices(bins[name], Math.floor(bins[name].length * this.sampleRate / 100));
      if (sampled.length === 0) continue;
      const baseVerts = new Float32Array(sampled.length * 3);
      for (let i = 0; i < sampled.length; i++) {
        const idx = sampled[i] * 3;
        baseVerts[i * 3] = this.allVertices[idx];
        baseVerts[i * 3 + 1] = this.allVertices[idx + 1];
        baseVerts[i * 3 + 2] = this.allVertices[idx + 2];
      }
      const pd = this.createPartParticles(name, baseVerts);
      if (pd) {
        this.partData[name] = pd;
        this.particleGroup.add(pd.points);
        totalParticles += pd.count;
      }
    }

    this.scene.add(this.particleGroup);
    console.log(`[GLBParticleSystem] 粒子重建完成: ${totalParticles.toLocaleString()} 个粒子, 采样率 ${this.sampleRate}%`);
  }

  // ============ 环境漂浮粒子 ============
  createAmbientParticles(bb) {
    if (this.ambientParticles) {
      this.scene.remove(this.ambientParticles);
      this.ambientParticles.geometry.dispose();
      this.ambientParticles.material.dispose();
    }

    const count = this.ambientCount;
    if (count === 0) return;

    const positions = new Float32Array(count * 3);
    const centers = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    const phases = new Float32Array(count);
    const amplitudes = new Float32Array(count * 2);

    const cx = (bb.minX + bb.maxX) / 2;
    const cy = (bb.minY + bb.maxY) / 2;
    const cz = (bb.minZ + bb.maxZ) / 2;
    const hw = (bb.maxX - bb.minX) / 2 * 1.5;
    const hh = bb.height / 2 * 1.5;
    const hd = (bb.maxZ - bb.minZ) / 2 * 1.5;

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 0.65 + Math.random() * 0.35;

      const px = cx + Math.cos(angle) * Math.sin(phi) * hw * r;
      const py = cy + Math.sin(angle) * Math.sin(phi) * hh * r;
      const pz = cz + Math.cos(phi) * hd * r;

      positions[i * 3] = px;
      positions[i * 3 + 1] = py;
      positions[i * 3 + 2] = pz;

      centers[i * 3] = px + (Math.random() - 0.5) * 0.2;
      centers[i * 3 + 1] = py + (Math.random() - 0.5) * 0.2;
      centers[i * 3 + 2] = pz + (Math.random() - 0.5) * 0.2;

      speeds[i] = 0.3 + Math.random() * 0.7;
      phases[i] = Math.random() * Math.PI * 2;
      amplitudes[i * 2] = 0.03 + Math.random() * 0.12;
      amplitudes[i * 2 + 1] = 0.03 + Math.random() * 0.12;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const colors = new Float32Array(count * 3);
    const c1 = new THREE.Color(this.ambientColor1);
    const c2 = new THREE.Color(this.ambientColor2);
    for (let i = 0; i < count; i++) {
      const c = new THREE.Color().lerpColors(c1, c2, Math.random());
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: this.ambientSize,
      map: this.glowTex,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.65,
      sizeAttenuation: true,
    });

    this.ambientParticles = new THREE.Points(geo, mat);
    this.ambientData = { positions, centers, speeds, phases, amplitudes, count };
    this.scene.add(this.ambientParticles);
  }

  // ============ 加载 GLB 模型 ============
  /**
   * 异步加载 GLB 模型并初始化粒子系统
   * @param {string} url - GLB 模型路径
   * @param {function} onProgress - 加载进度回调 (0~1)
   * @returns {Promise<void>}
   */
  async loadModel(url, onProgress) {
    return new Promise((resolve, reject) => {
      this.loader.load(url, (gltf) => {
        console.log('[GLBParticleSystem] GLB 加载成功，提取顶点...');
        const model = gltf.scene;
        const vertices = [];
        let totalVertices = 0;

        model.traverse((child) => {
          if (child.isMesh) {
            const geom = child.geometry;
            const posAttr = geom.getAttribute('position');
            child.updateWorldMatrix(true, false);
            const wm = child.matrixWorld;
            for (let i = 0; i < posAttr.count; i++) {
              const v = new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
              v.applyMatrix4(wm);
              vertices.push(v.x, v.y, v.z);
            }
            totalVertices += posAttr.count;
          }
        });

        console.log(`[GLBParticleSystem] 提取顶点: ${totalVertices.toLocaleString()}`);
        this.allVertices = new Float32Array(vertices);
        this.centerVertices(this.allVertices);
        this.rebuildAllParts();
        this.createAmbientParticles(this.boundingBox);
        this.isLoaded = true;
        resolve();
      }, (progress) => {
        if (progress.total && onProgress) {
          onProgress(progress.loaded / progress.total);
        }
      }, (err) => {
        console.error('[GLBParticleSystem] 加载失败:', err);
        reject(err);
      });
    });
  }

  // ============ 每帧更新 ============
  /**
   * @param {number} t - 已运行时间（秒）
   */
  update(t) {
    if (!this.isLoaded) return;

    // 更新所有部位粒子位置
    for (const name of PART_NAMES) {
      const pd = this.partData[name];
      if (!pd) continue;
      const pos = pd.currentPos;
      const base = pd.baseVertices;
      const scatter = pd.scatterOffsets;
      const count = pd.count;

      // 悬停部位：分散度平滑增大（仅影响 scatter，不影响呼吸/漂浮）
      const isHovered = (name === this.hoveredPart);
      const targetScatter = isHovered ? 2.5 : 1.0;
      // 平滑 lerp
      if (!pd._hoverScatter) pd._hoverScatter = 1.0;
      pd._hoverScatter += (targetScatter - pd._hoverScatter) * 0.06;
      const scatterMul = pd._hoverScatter;

      for (let i = 0; i < count; i++) {
        const ox = base[i * 3], oy = base[i * 3 + 1], oz = base[i * 3 + 2];

        const sx = scatter[i * 3] * this.scatterFactor * scatterMul;
        const sy = scatter[i * 3 + 1] * this.scatterFactor * scatterMul;
        const sz = scatter[i * 3 + 2] * this.scatterFactor * scatterMul;

        const dist = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1;
        const nx = ox / dist, ny = oy / dist, nz = oz / dist;

        const breathPhase = (oy + 2) * 2.5;
        const breath = Math.sin(t * 1.5 + breathPhase) * this.breathStrength * 0.02;

        const floatPhase = ox * 3 + oz * 1.5;
        const floatY = Math.sin(t * 0.8 + floatPhase) * this.floatAmplitude * 0.03;
        const floatX = Math.cos(t * 0.6 + floatPhase) * this.floatAmplitude * 0.015;

        pos[i * 3] = ox + sx + nx * breath + floatX;
        pos[i * 3 + 1] = oy + sy + breath * 0.5 + floatY;
        pos[i * 3 + 2] = oz + sz + nz * breath * 0.3;
      }
      pd.geo.attributes.position.needsUpdate = true;

      // 悬停发光：平滑调整粒子大小和透明度
      const isFocused = this.focusedParts.has(name);
      const focusSize = this.particleSize * 1.4;
      const focusOpacity = 0.8;
      const targetSize = isHovered ? this.particleSize * 1.5 : (isFocused ? focusSize : this.particleSize);
      const targetOpacity = isHovered ? 0.9 : (isFocused ? focusOpacity : this.particleOpacity);
      // 从当前材质值初始化，避免 GSAP 动画后被覆盖跳变
      if (!pd._hoverSize) pd._hoverSize = pd.mat.size;
      if (!pd._hoverOpacity) pd._hoverOpacity = pd.mat.opacity;
      pd._hoverSize += (targetSize - pd._hoverSize) * 0.08;
      pd._hoverOpacity += (targetOpacity - pd._hoverOpacity) * 0.08;
      pd.mat.size = pd._hoverSize;
      pd.mat.opacity = pd._hoverOpacity;
    }

    // 环境漂浮粒子动画
    if (this.ambientData) {
      const ad = this.ambientData;
      const pos = ad.positions;
      for (let i = 0; i < ad.count; i++) {
        const cx = ad.centers[i * 3];
        const cy = ad.centers[i * 3 + 1];
        const cz = ad.centers[i * 3 + 2];
        const sp = ad.speeds[i];
        const ph = ad.phases[i];
        const ax = ad.amplitudes[i * 2];
        const ay = ad.amplitudes[i * 2 + 1];

        pos[i * 3] = cx + Math.sin(t * sp * this.ambientSpeed + ph) * ax;
        pos[i * 3 + 1] = cy + Math.cos(t * sp * 0.7 * this.ambientSpeed + ph) * ay;
        pos[i * 3 + 2] = cz + Math.cos(t * sp * 0.5 * this.ambientSpeed + ph + 1) * ax * 0.6;
      }
      this.ambientParticles.geometry.attributes.position.needsUpdate = true;
    }
  }

  // ============ 部位发光控制 ============
  setPartGlow(partName) {
    const pd = this.partData[partName];
    if (!pd) return;
    gsap.killTweensOf(pd.mat);
    gsap.to(pd.mat, {
      size: this.particleSize * 2.0,
      opacity: 1.0,
      duration: 0.5,
      ease: 'power2.out',
    });
    this.glowingPart = partName;
  }

  resetPartGlow(partName) {
    const pd = this.partData[partName];
    if (!pd) return;
    gsap.killTweensOf(pd.mat);
    // 如果处于 focused 状态，保持 slightly 更大的 size
    const targetSize = this.focusedParts.has(partName) ? this.particleSize * 1.4 : this.particleSize;
    const targetOpacity = this.focusedParts.has(partName) ? 0.8 : this.particleOpacity;
    gsap.to(pd.mat, {
      size: targetSize,
      opacity: targetOpacity,
      duration: 0.5,
      ease: 'power2.in',
    });
    if (this.glowingPart === partName) this.glowingPart = null;
  }

  // ============ 悬停效果 ============
  setPartHover(partName, enabled) {
    const pd = this.partData[partName];
    if (!pd) return;
    if (enabled) {
      this.hoveredPart = partName;
      this._brightenPartColors(partName, 1.3);
    } else {
      if (this.hoveredPart === partName) {
        this.hoveredPart = null;
      }
      if (this.glowingPart !== partName && !this.focusedParts.has(partName)) {
        this._restorePartColors(partName);
      }
    }
  }

  // ============ 持久高亮 ============
  setPartFocused(partName) {
    this.focusedParts.add(partName);
    const pd = this.partData[partName];
    if (!pd) return;
    gsap.killTweensOf(pd.mat);
    gsap.to(pd.mat, {
      size: this.particleSize * 1.4,
      opacity: 0.8,
      duration: 0.5,
      ease: 'power2.out',
    });
    this._setPartColorsWhite(partName);
  }

  // ============ 颜色亮度辅助 ============
  _brightenPartColors(partName, factor) {
    const pd = this.partData[partName];
    if (!pd) return;

    // 缓存原始颜色（如果尚未缓存）
    if (!this._originalColors.has(partName)) {
      const origAttr = pd.geo.getAttribute('color');
      if (!origAttr) return;
      const orig = new Float32Array(origAttr.count * 3);
      orig.set(origAttr.array);
      this._originalColors.set(partName, orig);
    }

    const colors = pd.geo.getAttribute('color');
    if (!colors) return;
    const orig = this._originalColors.get(partName);
    for (let i = 0; i < colors.count; i++) {
      colors.setX(i, Math.min(orig[i * 3] * factor, 1.0));
      colors.setY(i, Math.min(orig[i * 3 + 1] * factor, 1.0));
      colors.setZ(i, Math.min(orig[i * 3 + 2] * factor, 1.0));
    }
    colors.needsUpdate = true;
  }

  // 将部位粒子颜色设为白色（点击卡片后触发）
  _setPartColorsWhite(partName) {
    const pd = this.partData[partName];
    if (!pd) return;

    const colors = pd.geo.getAttribute('color');
    if (!colors) return;
    const white = new THREE.Color('#ffffff');
    for (let i = 0; i < colors.count; i++) {
      colors.setX(i, white.r);
      colors.setY(i, white.g);
      colors.setZ(i, white.b);
    }
    colors.needsUpdate = true;
    // 同步更新缓存，防止 hover 恢复时变回蓝色
    this._originalColors.set(partName, new Float32Array(colors.array));
  }

  _restorePartColors(partName) {
    const pd = this.partData[partName];
    if (!pd) return;
    const orig = this._originalColors.get(partName);
    if (!orig) return;
    const colors = pd.geo.getAttribute('color');
    if (!colors) return;
    for (let i = 0; i < colors.count; i++) {
      colors.setX(i, orig[i * 3]);
      colors.setY(i, orig[i * 3 + 1]);
      colors.setZ(i, orig[i * 3 + 2]);
    }
    colors.needsUpdate = true;
  }

  // ============ 颜色编辑 ============
  setPartColor(partName, colorHex) {
    this.partColors[partName] = new THREE.Color(colorHex);
    this.rebuildPartColors(partName);
  }

  rebuildPartColors(partName) {
    const pd = this.partData[partName];
    if (!pd || !this.boundingBox) return;
    const count = pd.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const y = pd.baseVertices[i * 3 + 1];
      const c = this.computeVertexColor(y, this.boundingBox, partName);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    pd.geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }

  // ============ 参数调节 ============
  setScatterFactor(v) { this.scatterFactor = v; }
  setBreathStrength(v) { this.breathStrength = v; }
  setFloatAmplitude(v) { this.floatAmplitude = v; }
  setParticleSize(v) {
    this.particleSize = v;
    for (const key in this.partData) this.partData[key].mat.size = v;
  }
  setSampleRate(v) {
    this.sampleRate = v;
    this.rebuildAllParts();
  }

  // ============ 获取器 ============
  getGroup() { return this.particleGroup; }
  getPartData() { return this.partData; }
  getBoundingBox() { return this.boundingBox; }
  getPartNames() { return PART_NAMES; }
  getPartColors() { return this.partColors; }
  getTotalParticles() {
    return Object.values(this.partData).reduce((s, p) => s + p.count, 0);
  }

  // ============ 获取部位 3D 锚点（用于卡片定位） ============
  /**
   * 获取指定部位在模型空间中的平均位置
   * @param {string} partName
   * @returns {THREE.Vector3|null}
   */
  getPartAnchor(partName) {
    const pd = this.partData[partName];
    if (!pd) return null;
    const base = pd.baseVertices;
    const count = pd.count;
    let ax = 0, ay = 0, az = 0;
    for (let i = 0; i < count; i++) {
      ax += base[i * 3];
      ay += base[i * 3 + 1];
      az += base[i * 3 + 2];
    }
    return new THREE.Vector3(ax / count, ay / count, az / count);
  }

  // ============ 销毁 ============
  dispose() {
    if (this.particleGroup) {
      this.scene.remove(this.particleGroup);
      for (const key in this.partData) {
        this.partData[key].geo.dispose();
        this.partData[key].mat.dispose();
      }
    }
    if (this.ambientParticles) {
      this.scene.remove(this.ambientParticles);
      this.ambientParticles.geometry.dispose();
      this.ambientParticles.material.dispose();
    }
    this.glowTex.dispose();
    this.partData = {};
    this.isLoaded = false;
  }
}