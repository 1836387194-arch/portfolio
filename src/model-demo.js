import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { gsap } from 'gsap';
import { classifyVertices } from './particles/GLBParticleSystem.js';

// ============ 场景初始化 ============
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 0.5, 4);
camera.lookAt(0, 0.5, 0);

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x0a0a14);
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.5, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 2;
controls.maxDistance = 15;
controls.maxPolarAngle = Math.PI * 0.8;
controls.update();

// 星空
const starsGeo = new THREE.BufferGeometry();
const starsCount = 1500;
const starsPos = new Float32Array(starsCount * 3);
const starsCol = new Float32Array(starsCount * 3);
for (let i = 0; i < starsCount; i++) {
  const r = 15 + Math.random() * 25;
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  starsPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
  starsPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
  starsPos[i * 3 + 2] = r * Math.cos(phi);
  const b = 0.3 + Math.random() * 0.5;
  starsCol[i * 3] = 0.6 * b;
  starsCol[i * 3 + 1] = 0.7 * b;
  starsCol[i * 3 + 2] = 1.0 * b;
}
starsGeo.setAttribute('position', new THREE.BufferAttribute(starsPos, 3));
starsGeo.setAttribute('color', new THREE.BufferAttribute(starsCol, 3));
const stars = new THREE.Points(starsGeo, new THREE.PointsMaterial({
  size: 0.06, blending: THREE.AdditiveBlending, depthWrite: false,
  vertexColors: true, transparent: true, opacity: 0.5, sizeAttenuation: true
}));
scene.add(stars);

// 粒子纹理
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
const glowTex = createGlowTexture(64, 'rgba(255,255,255,1)', 'rgba(100,180,255,0.3)');

// ============ 可编辑的各部位颜色 ============
const PART_NAMES = ['head', 'heart', 'body', 'hands', 'feet'];

// 可编辑的各部位颜色
const partColors = {
  head: new THREE.Color('#ffd700'),
  heart: new THREE.Color('#ff3366'),
  body: new THREE.Color('#4488ff'),
  hands: new THREE.Color('#ff8844'),
  feet: new THREE.Color('#44cc88'),
};

// 顶点颜色：部位本色 + Y轴底色渐变混合，边界自然过渡
// 底色提供统一基调，部位色保持可编辑性
function computeVertexColor(y, bb, partName) {
  const ny = (y - bb.minY) / bb.height; // 0=脚底, 1=头顶
  // Y轴底色：脚(青) → 躯干(蓝) → 头(暖)，提供统一渐变基调
  const base = new THREE.Color();
  if (ny < 0.3) {
    base.lerpColors(new THREE.Color('#336688'), new THREE.Color('#4466aa'), ny / 0.3);
  } else if (ny < 0.7) {
    base.lerpColors(new THREE.Color('#4466aa'), new THREE.Color('#665588'), (ny - 0.3) / 0.4);
  } else {
    base.lerpColors(new THREE.Color('#665588'), new THREE.Color('#997744'), (ny - 0.7) / 0.3);
  }
  // 部位色 70% + 底色 30%，部位色为主，底色提供平滑过渡
  const partColor = partColors[partName] || new THREE.Color('#ffffff');
  return new THREE.Color().lerpColors(base, partColor, 0.7);
}

// 全局状态
let allVertices = null;       // 原始全部顶点
let boundingBox = null;       // { minY, maxY, minX, maxX, minZ, maxZ, height }
let partData = {};            // name -> { baseVertices: Float32Array, scatterOffsets: Float32Array, ... }
let particleGroup = null;
let scatterFactor = 0.03;
let breathStrength = 0.5;
let floatAmplitude = 0.3;
let currentSampleRate = 10;
const infoEl = document.getElementById('info');

// ============ 环境漂浮粒子 ============
let ambientParticles = null;  // Points 对象
let ambientData = null;       // { positions, centers, speeds, phases, amplitudes, count }
let ambientCount = 200;
let ambientSize = 0.04;
let ambientSpeed = 1.0;
let ambientColor1 = '#ffd700'; // 暖色
let ambientColor2 = '#4488ff'; // 冷色

function createAmbientParticles(bb) {
  if (ambientParticles) {
    scene.remove(ambientParticles);
    ambientParticles.geometry.dispose();
    ambientParticles.material.dispose();
  }

  const count = ambientCount;
  const positions = new Float32Array(count * 3);
  const centers = new Float32Array(count * 3);   // 每个粒子的轨道中心
  const speeds = new Float32Array(count);         // 轨道速度
  const phases = new Float32Array(count);         // 初始相位
  const amplitudes = new Float32Array(count * 2); // 轨道半径 (x, y)

  const cx = (bb.minX + bb.maxX) / 2;
  const cy = (bb.minY + bb.maxY) / 2;
  const cz = (bb.minZ + bb.maxZ) / 2;
  const hw = (bb.maxX - bb.minX) / 2 * 1.5;  // 宽度方向扩展 1.5x
  const hh = bb.height / 2 * 1.5;             // 高度方向扩展 1.5x
  const hd = (bb.maxZ - bb.minZ) / 2 * 1.5;  // 深度方向扩展 1.5x
  const innerHw = (bb.maxX - bb.minX) / 2 * 0.6;
  const innerHh = bb.height / 2 * 0.6;
  const innerHd = (bb.maxZ - bb.minZ) / 2 * 0.6;

  for (let i = 0; i < count; i++) {
    // 生成在外壳和内部之间的随机位置（避免嵌入模型）
    let px, py, pz;
    const angle = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = 0.65 + Math.random() * 0.35; // 半径比例

    px = cx + Math.cos(angle) * Math.sin(phi) * hw * r;
    py = cy + Math.sin(angle) * Math.sin(phi) * hh * r;
    pz = cz + Math.cos(phi) * hd * r;

    positions[i * 3] = px;
    positions[i * 3 + 1] = py;
    positions[i * 3 + 2] = pz;

    // 轨道中心：当前点附近随机偏移
    centers[i * 3] = px + (Math.random() - 0.5) * 0.2;
    centers[i * 3 + 1] = py + (Math.random() - 0.5) * 0.2;
    centers[i * 3 + 2] = pz + (Math.random() - 0.5) * 0.2;

    speeds[i] = 0.3 + Math.random() * 0.7;
    phases[i] = Math.random() * Math.PI * 2;
    amplitudes[i * 2] = 0.03 + Math.random() * 0.12;     // X 振幅
    amplitudes[i * 2 + 1] = 0.03 + Math.random() * 0.12; // Y 振幅
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  // 颜色：用户指定的两种颜色之间随机混合
  const colors = new Float32Array(count * 3);
  const c1 = new THREE.Color(ambientColor1);
  const c2 = new THREE.Color(ambientColor2);
  for (let i = 0; i < count; i++) {
    const c = new THREE.Color().lerpColors(c1, c2, Math.random());
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    size: ambientSize, map: glowTex, vertexColors: true,
    blending: THREE.AdditiveBlending, depthWrite: false,
    transparent: true, opacity: 0.65, sizeAttenuation: true,
  });

  ambientParticles = new THREE.Points(geo, mat);
  ambientData = { positions, centers, speeds, phases, amplitudes, count };
  scene.add(ambientParticles);
}

function rebuildAmbientParticles() {
  if (boundingBox) createAmbientParticles(boundingBox);
}

// ============ 采样 ============
function sampleIndices(indices, targetCount) {
  if (indices.length <= targetCount) return indices.slice();
  const sampled = [];
  const step = indices.length / targetCount;
  for (let i = 0; i < targetCount; i++) {
    sampled.push(indices[Math.floor(i * step)]);
  }
  return sampled;
}

// ============ 创建分块粒子 ============
function createPartParticles(partName, baseVertices) {
  const count = baseVertices.length / 3;
  if (count === 0) return null;

  // 随机散落偏移
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

  // 顶点颜色：Y 轴平滑渐变，消除部位硬边界
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const y = baseVertices[i * 3 + 1];
    const c = computeVertexColor(y, boundingBox, partName);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    size: 0.06, map: glowTex, vertexColors: true,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true,
    transparent: true, opacity: 0.6, sizeAttenuation: true,
  });

  const points = new THREE.Points(geo, mat);
  return { baseVertices, scatterOffsets, currentPos, geo, mat, points, count };
}

function rebuildAllParts() {
  if (!allVertices) return;

  // 清理
  if (particleGroup) {
    scene.remove(particleGroup);
    for (const key in partData) {
      partData[key].geo.dispose();
      partData[key].mat.dispose();
    }
  }

  const { bins, bb } = classifyVertices(allVertices);
  boundingBox = bb;
  partData = {};
  particleGroup = new THREE.Group();

  let totalParticles = 0;
  for (const name of PART_NAMES) {
    const sampled = sampleIndices(bins[name], Math.floor(bins[name].length * currentSampleRate / 100));
    if (sampled.length === 0) continue;
    const baseVerts = new Float32Array(sampled.length * 3);
    for (let i = 0; i < sampled.length; i++) {
      const idx = sampled[i] * 3;
      baseVerts[i * 3] = allVertices[idx];
      baseVerts[i * 3 + 1] = allVertices[idx + 1];
      baseVerts[i * 3 + 2] = allVertices[idx + 2];
    }
    const pd = createPartParticles(name, baseVerts);
    if (pd) {
      partData[name] = pd;
      particleGroup.add(pd.points);
      totalParticles += pd.count;
    }
  }

  scene.add(particleGroup);
  infoEl.innerHTML =
    `原始顶点: ${(allVertices.length / 3).toLocaleString()}<br>` +
    `采样粒子: ${totalParticles.toLocaleString()}<br>` +
    `采样率: ${currentSampleRate}%<br>` +
    `分散度: ${scatterFactor.toFixed(3)}`;
}

// ============ 顶点居中 ============
function centerVertices(verts) {
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
  // 居中：XZ 到原点，Y 轴让脚底在 y=0 附近
  for (let i = 0; i < n; i++) {
    verts[i * 3] -= cx;
    verts[i * 3 + 1] -= minY;
    verts[i * 3 + 2] -= cz;
  }
  console.log(`[居中] 偏移: (${cx.toFixed(2)}, ${cy.toFixed(2)}, ${cz.toFixed(2)}), 高度: ${(maxY - minY).toFixed(2)}`);
}

// ============ 加载 GLB ============
const loader = new GLTFLoader();
infoEl.innerHTML = '加载模型中...';
loader.load('/human-model.glb', (gltf) => {
  console.log('[GLB] 加载成功，开始提取顶点...');
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

  console.log(`[GLB] 提取顶点: ${totalVertices.toLocaleString()}`);
  allVertices = new Float32Array(vertices);
  centerVertices(allVertices);
  rebuildAllParts();
  createAmbientParticles(boundingBox);
  console.log('[GLB] 粒子重建完成');
}, (progress) => {
  if (progress.total) {
    const pct = Math.round(progress.loaded / progress.total * 100);
    infoEl.innerHTML = `加载中... ${pct}%`;
  }
}, (err) => {
  infoEl.innerHTML = `加载失败: ${err.message}`;
  console.error('[GLB] 加载失败:', err);
});

// ============ 动画 ============
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  controls.update();
  stars.rotation.y += 0.0001;
  stars.rotation.x += 0.00005;

  // 更新所有部位粒子位置
  for (const name of PART_NAMES) {
    const pd = partData[name];
    if (!pd) continue;
    const pos = pd.currentPos;
    const base = pd.baseVertices;
    const scatter = pd.scatterOffsets;
    const count = pd.count;

    for (let i = 0; i < count; i++) {
      const ox = base[i * 3], oy = base[i * 3 + 1], oz = base[i * 3 + 2];

      // 分散
      const sx = scatter[i * 3] * scatterFactor;
      const sy = scatter[i * 3 + 1] * scatterFactor;
      const sz = scatter[i * 3 + 2] * scatterFactor;

      // 呼吸：径向缩放
      const dist = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1;
      const nx = ox / dist, ny = oy / dist, nz = oz / dist;
      const breathPhase = (oy + 2) * 2.5;
      const breath = Math.sin(t * 1.5 + breathPhase) * breathStrength * 0.02;

      // 漂浮
      const floatPhase = ox * 3 + oz * 1.5;
      const floatY = Math.sin(t * 0.8 + floatPhase) * floatAmplitude * 0.03;
      const floatX = Math.cos(t * 0.6 + floatPhase) * floatAmplitude * 0.015;

      pos[i * 3] = ox + sx + nx * breath + floatX;
      pos[i * 3 + 1] = oy + sy + breath * 0.5 + floatY;
      pos[i * 3 + 2] = oz + sz + nz * breath * 0.3;
    }
    pd.geo.attributes.position.needsUpdate = true;
  }

  // 环境漂浮粒子动画
  if (ambientData) {
    const ad = ambientData;
    const pos = ad.positions;
    for (let i = 0; i < ad.count; i++) {
      const cx = ad.centers[i * 3];
      const cy = ad.centers[i * 3 + 1];
      const cz = ad.centers[i * 3 + 2];
      const sp = ad.speeds[i];
      const ph = ad.phases[i];
      const ax = ad.amplitudes[i * 2];
      const ay = ad.amplitudes[i * 2 + 1];

      pos[i * 3] = cx + Math.sin(t * sp * ambientSpeed + ph) * ax;
      pos[i * 3 + 1] = cy + Math.cos(t * sp * 0.7 * ambientSpeed + ph) * ay;
      pos[i * 3 + 2] = cz + Math.cos(t * sp * 0.5 * ambientSpeed + ph + 1) * ax * 0.6;
    }
    ambientParticles.geometry.attributes.position.needsUpdate = true;
  }

  renderer.render(scene, camera);
}
animate();

// ============ UI 事件 ============
document.getElementById('slider-size').addEventListener('input', (e) => {
  const v = parseFloat(e.target.value);
  document.getElementById('val-size').textContent = v.toFixed(1);
  const size = v * 0.01;
  for (const key in partData) partData[key].mat.size = size;
});

document.getElementById('slider-sample').addEventListener('input', (e) => {
  currentSampleRate = parseInt(e.target.value);
  document.getElementById('val-sample').textContent = currentSampleRate + '%';
  rebuildAllParts();
});

document.getElementById('slider-scatter').addEventListener('input', (e) => {
  scatterFactor = parseFloat(e.target.value);
  document.getElementById('val-scatter').textContent = scatterFactor.toFixed(3);
  if (boundingBox) {
    const total = Object.values(partData).reduce((s, p) => s + p.count, 0);
    infoEl.innerHTML =
      `原始顶点: ${(allVertices.length / 3).toLocaleString()}<br>` +
      `采样粒子: ${total.toLocaleString()}<br>` +
      `采样率: ${currentSampleRate}%<br>` +
      `分散度: ${scatterFactor.toFixed(3)}`;
  }
});

document.getElementById('slider-breath').addEventListener('input', (e) => {
  breathStrength = parseFloat(e.target.value);
  document.getElementById('val-breath').textContent = breathStrength.toFixed(1);
});

document.getElementById('slider-float').addEventListener('input', (e) => {
  floatAmplitude = parseFloat(e.target.value);
  document.getElementById('val-float').textContent = floatAmplitude.toFixed(2);
});

document.getElementById('select-blend').addEventListener('change', (e) => {
  const blend = e.target.value === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending;
  for (const key in partData) partData[key].mat.blending = blend;
});

document.getElementById('slider-ambient').addEventListener('input', (e) => {
  ambientCount = parseInt(e.target.value);
  document.getElementById('val-ambient').textContent = ambientCount;
  rebuildAmbientParticles();
});

// 环境粒子颜色1
document.getElementById('color-ambient1').addEventListener('input', (e) => {
  ambientColor1 = e.target.value;
  rebuildAmbientParticles();
});
// 环境粒子颜色2
document.getElementById('color-ambient2').addEventListener('input', (e) => {
  ambientColor2 = e.target.value;
  rebuildAmbientParticles();
});
// 环境粒子大小
document.getElementById('slider-ambient-size').addEventListener('input', (e) => {
  ambientSize = parseFloat(e.target.value) * 0.01;
  document.getElementById('val-ambient-size').textContent = (ambientSize * 100).toFixed(0);
  if (ambientParticles) ambientParticles.material.size = ambientSize;
});
// 环境粒子速度
document.getElementById('slider-ambient-speed').addEventListener('input', (e) => {
  ambientSpeed = parseFloat(e.target.value);
  document.getElementById('val-ambient-speed').textContent = ambientSpeed.toFixed(1);
});

// 重建单个部位的颜色（修改颜色选择器时触发，无需重建几何体）
function rebuildPartColors(partName) {
  const pd = partData[partName];
  if (!pd || !boundingBox) return;
  const count = pd.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const y = pd.baseVertices[i * 3 + 1];
    const c = computeVertexColor(y, boundingBox, partName);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  pd.geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

// 部位颜色选择器
document.querySelectorAll('.part-color').forEach(el => {
  el.addEventListener('input', (e) => {
    const part = e.target.dataset.part;
    partColors[part] = new THREE.Color(e.target.value);
    rebuildPartColors(part);
  });
});

// 部位显隐切换
document.querySelectorAll('.part-toggle').forEach(el => {
  el.addEventListener('click', (e) => {
    const part = e.target.dataset.part;
    const pd = partData[part];
    if (!pd) return;
    pd.points.visible = !pd.points.visible;
    e.target.textContent = pd.points.visible ? '👁' : '◌';
  });
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR') {
    camera.position.set(0, 0.5, 4);
    controls.target.set(0, 0.5, 0);
    controls.update();
  }
});

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ============ 部位发光效果（卡片联动） ============
const defaultPartSize = 0.06;
const defaultPartOpacity = 0.6;
let glowingPart = null;

function setPartGlow(partName) {
  const pd = partData[partName];
  if (!pd) return;
  gsap.killTweensOf(pd.mat);
  gsap.to(pd.mat, {
    size: defaultPartSize * 2.0,
    opacity: 1.0,
    duration: 0.5,
    ease: 'power2.out',
  });
  glowingPart = partName;
}

function resetPartGlow(partName) {
  const pd = partData[partName];
  if (!pd) return;
  gsap.killTweensOf(pd.mat);
  gsap.to(pd.mat, {
    size: defaultPartSize,
    opacity: defaultPartOpacity,
    duration: 0.5,
    ease: 'power2.in',
  });
  if (glowingPart === partName) glowingPart = null;
}

// ============ 卡片点击联动 ============
let activeCard = null;
document.querySelectorAll('.card-spotlight').forEach(card => {
  card.addEventListener('click', () => {
    const part = card.dataset.part;
    if (!part) return;

    if (activeCard === card) {
      // 再次点击已激活卡片 → 恢复
      resetPartGlow(part);
      card.classList.remove('active');
      activeCard = null;
      return;
    }

    // 恢复前一个
    if (activeCard) {
      resetPartGlow(activeCard.dataset.part);
      activeCard.classList.remove('active');
    }

    // 激活新的
    setPartGlow(part);
    card.classList.add('active');
    activeCard = card;
  });
});