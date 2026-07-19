import * as THREE from 'three';

export default class SceneManager {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.clock = new THREE.Clock();
    this.isMobile = window.innerWidth < 768;
    this.starfield = null;
  }

  init() {
    // 场景
    this.scene = new THREE.Scene();

    // 相机（GLB 模型高度约 1 单位，初始 z=1.0 占视口更大，入场后缩至 z=1.5）
    const cameraZ = this.isMobile ? 3.0 : 0.75;
    this.camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    this.camera.position.set(0, 0.85, cameraZ);
    this.camera.lookAt(0, 0.85, 0);

    // 渲染器
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);

    // 挂载到 DOM
    const container = document.getElementById('canvas-container');
    container.appendChild(this.renderer.domElement);

    // 星空背景
    this.createStarfield();

    // 响应式处理
    window.addEventListener('resize', () => this.onResize());

    return this;
  }

  createStarfield() {
    const starCount = this.isMobile ? 500 : 1200;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      // 在大球壳上分布星星
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const radius = 15 + Math.random() * 20;

      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = radius * Math.cos(phi);

      // 随机微弱的蓝白色
      const brightness = 0.3 + Math.random() * 0.5;
      colors[i * 3] = 0.7 * brightness;
      colors[i * 3 + 1] = 0.8 * brightness;
      colors[i * 3 + 2] = 1.0 * brightness;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.06,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      sizeAttenuation: true,
    });

    this.starfield = new THREE.Points(geometry, material);
    this.scene.add(this.starfield);
  }

  onResize() {
    this.isMobile = window.innerWidth < 768;

    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  setCameraZ(z) {
    this.camera.position.z = z;
  }

  setCameraY(y) {
    this.camera.position.y = y;
  }

  setLookAtY(y) {
    this.camera.lookAt(0, y, 0);
  }

  render() {
    // 星空缓慢旋转
    if (this.starfield) {
      this.starfield.rotation.y += 0.0001;
      this.starfield.rotation.x += 0.00005;
    }
    this.renderer.render(this.scene, this.camera);
  }

  getDelta() {
    return this.clock.getDelta();
  }
}