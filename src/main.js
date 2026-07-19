import * as THREE from 'three';
import gsap from 'gsap';
import SceneManager from './scene/SceneManager.js';
import GLBParticleSystem from './particles/GLBParticleSystem.js';
import CardSystem from './cards/CardSystem.js';
import ScrollController from './animation/ScrollController.js';
import FocusController from './cards/FocusController.js';

class App {
  constructor() {
    this.sceneManager = null;
    this.particleSystem = null;
    this.cardSystem = null;
    this.scrollController = null;
    this.focusController = null;
    this.clock = new THREE.Clock();
  }

  async init() {
    // 1. 场景管理器
    this.sceneManager = new SceneManager();
    this.sceneManager.init();
    const { scene, camera } = this.sceneManager;

    // 2. GLB 粒子系统
    this.particleSystem = new GLBParticleSystem(scene, camera, {
      sampleRate: 55,
      scatterFactor: 0.010,
      breathStrength: 0.5,
      floatAmplitude: 0.5,
      particleSize: 0.007,
      ambientCount: 170,
      ambientSize: 0.02,
      ambientSpeed: 1.1,
      ambientColor1: '#ffffff',
      ambientColor2: '#0000ff',
    });

    // 显示加载进度
    const loadingHint = document.getElementById('loading-hint');
    await this.particleSystem.loadModel('/human-model.glb', (progress) => {
      if (loadingHint) {
        loadingHint.querySelector('p').textContent = `加载中... ${Math.round(progress * 100)}%`;
      }
    });

    // 隐藏加载提示
    if (loadingHint) {
      loadingHint.style.opacity = '0';
      setTimeout(() => loadingHint.remove(), 500);
    }

    console.log(`[App] 粒子系统就绪: ${this.particleSystem.getTotalParticles().toLocaleString()} 个粒子`);

    // 8. 开场文字动画：页面加载后立即逐字入场
    const heroText = document.getElementById('hero-text');
    if (heroText) {
      const heroLeft = heroText.querySelector('.hero-left');
      const heroRight = heroText.querySelector('.hero-right');

      const splitText = (el) => {
        if (!el) return;
        const text = el.textContent.trim();
        el.innerHTML = '';
        for (const char of text) {
          const span = document.createElement('span');
          span.className = 'char';
          span.textContent = char;
          el.appendChild(span);
        }
      };

      splitText(heroLeft);
      splitText(heroRight);

      const allChars = heroText.querySelectorAll('.char');
      gsap.fromTo(allChars,
        {
          opacity: 0,
          yPercent: 120,
          scaleY: 2.3,
          scaleX: 0.7,
          transformOrigin: '50% 0%',
        },
        {
          opacity: 1,
          yPercent: 0,
          scaleY: 1,
          scaleX: 1,
          duration: 1,
          stagger: 0.03,
          ease: 'back.inOut(2)',
        }
      );
    }

    // 3. 卡片系统
    const cardLayer = document.getElementById('card-layer');
    this.cardSystem = new CardSystem({
      particleSystem: this.particleSystem,
      container: cardLayer,
    });
    this.cardSystem.createCards(CardSystem.getDefaultDefinitions());

    // 卡片点击 → 进入/退出专注模式
    this.cardSystem.onCardClick((partName) => {
      if (partName) {
        this.focusController.enterFocus(partName);
      } else {
        this.focusController.exitFocus();
      }
    });

    // 卡片悬停 → 粒子柔光效果（仅探索模式）
    this.cardSystem.onCardHover((partName, isHovered) => {
      if (this.focusController.getState() === 'explore') {
        this.particleSystem.setPartHover(partName, isHovered);
      }
    });

    // 4. 滚动旋转控制器
    const particleGroup = this.particleSystem.getGroup();
    this.scrollController = new ScrollController(particleGroup, {
      lerpFactor: 0.06,
      initialRotationY: Math.PI,
      maxRotation: 4 * Math.PI,
      onUpdate: (rotationY) => {
        this.cardSystem.updatePositions(rotationY);
      },
    });
    this.scrollController.init();

    // 5. Focus 控制器（双状态模式：探索 ↔ 专注）
    this.focusController = new FocusController({
      particleSystem: this.particleSystem,
      cardSystem: this.cardSystem,
      scrollController: this.scrollController,
      canvasContainer: document.getElementById('canvas-container'),
      controlsHint: document.getElementById('controls-hint'),
      bgOverlay: document.getElementById('bg-overlay'),
      focusBg: document.getElementById('focus-bg'),
      focusTitleOverlay: document.getElementById('focus-title-overlay'),
    });

    // 6. 响应式
    window.addEventListener('resize', () => {
      this.sceneManager.onResize();
    });

    // 7. 启动渲染循环
    this.animate();
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const now = performance.now() / 1000;
    if (!this._lastTime) this._lastTime = now;
    const rawDt = now - this._lastTime;
    this._lastTime = now;
    const dt = Math.min(rawDt, 0.1); // 防止标签页切换时大帧跳跃
    const t = this.clock.getElapsedTime();
    const state = this.focusController.getState();

    if (state !== 'explore') {
      // 专注模式 + 过渡动画：FocusController 驱动迷你旋转 + 卡片定位
      this.focusController.update(dt);
    } else {
      // 探索模式：ScrollController 驱动滚动旋转 + 卡片定位
      this.scrollController.update();

      // --- 入场动画：scroll-driven ---
      const ep = this.scrollController.getEntranceProgress();
      const isMobile = window.innerWidth < 768;

      // Camera z: 桌面 0.75→1.5，移动端 3.0→3.5
      const camZ = isMobile ? 3.0 + ep * 0.5 : 0.75 + ep * 0.75;
      this.sceneManager.setCameraZ(camZ);

      // lookAt Y: 0.85→0.5（上半身→全身），移动端保持不变
      if (!isMobile) {
        const lookAtY = 0.85 - ep * 0.35;
        this.sceneManager.setLookAtY(lookAtY);
        // 相机 Y 同步跟随 lookAt，保持粒子人始终在屏幕中心
        this.sceneManager.setCameraY(lookAtY);
      }

      // 卡片全局透明度
      this.cardSystem.globalOpacity = ep;

      // Hero text：滚动淡出，回顶淡入
      const heroText = document.getElementById('hero-text');
      if (heroText) {
        const scrollY = window.scrollY;
        const fadeOutStart = 50;
        const fadeOutEnd = 300;
        let heroOpacity;
        if (scrollY <= fadeOutStart) {
          heroOpacity = 1;
        } else if (scrollY >= fadeOutEnd) {
          heroOpacity = 0;
        } else {
          heroOpacity = 1 - (scrollY - fadeOutStart) / (fadeOutEnd - fadeOutStart);
        }
        heroText.style.opacity = heroOpacity;
        heroText.style.pointerEvents = 'none';
        heroText.style.transition = 'none';
      }
    }

    // 粒子动画在两个模式中都需要
    this.particleSystem.update(t);

    // 渲染
    this.sceneManager.render();
  }
}

// 启动应用
const app = new App();
app.init().catch((err) => {
  console.error('[App] 初始化失败:', err);
  const loadingHint = document.getElementById('loading-hint');
  if (loadingHint) {
    loadingHint.innerHTML = `<p style="color:#ff4444">加载失败: ${err.message}</p>`;
  }
});