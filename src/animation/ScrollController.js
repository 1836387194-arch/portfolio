export default class ScrollController {
  /**
   * @param {THREE.Group} particleGroup
   * @param {object} options
   * @param {number} options.lerpFactor - 平滑系数
   * @param {function} options.onUpdate - 旋转更新回调 (rotationY)
   */
  constructor(particleGroup, options = {}) {
    this.particleGroup = particleGroup;
    this.initialRotation = options.initialRotationY ?? 0;
    this.currentRotation = this.initialRotation;
    this.targetRotation = this.initialRotation;
    this.lerpFactor = options.lerpFactor ?? 0.06;
    this.onUpdate = options.onUpdate || null;
    this.enabled = true;
    this.isMobile = window.innerWidth < 768;

    // 入场动画
    this.entranceRange = options.entranceRange ?? (this.isMobile ? 0.35 : 0.25);
    this._entranceProgress = 0;
    this._targetEntranceProgress = 0;

    // scrollProgress → rotation 直接映射
    // scrollProgress=0 → rotation=initialRotation, scrollProgress=1 → rotation=initialRotation+maxRotation
    this.maxRotation = options.maxRotation ?? (4 * Math.PI);

    this._onScroll = this._onScroll.bind(this);
    this._onResize = this._onResize.bind(this);
  }

  init() {
    window.addEventListener('scroll', this._onScroll, { passive: true });
    window.addEventListener('resize', this._onResize);
    this._onScroll();
    return this;
  }

  _onResize() {
    this.isMobile = window.innerWidth < 768;
    this.entranceRange = this.isMobile ? 0.35 : 0.25;
  }

  _onScroll() {
    if (!this.enabled) return;
    const maxScroll = document.body.scrollHeight - window.innerHeight;
    if (maxScroll <= 0) {
      this.targetRotation = this.initialRotation;
      return;
    }
    const scrollProgress = Math.min(window.scrollY / maxScroll, 1);

    // 入场进度
    this._targetEntranceProgress = Math.min(scrollProgress / this.entranceRange, 1);

    // scrollProgress → rotation 直接映射
    this.targetRotation = this.initialRotation + scrollProgress * this.maxRotation;
  }

  /**
   * 在渲染循环中调用，平滑更新旋转
   */
  update() {
    if (!this.enabled) return;
    this.currentRotation += (this.targetRotation - this.currentRotation) * this.lerpFactor;

    if (this.particleGroup) {
      this.particleGroup.rotation.y = -this.currentRotation;
    }

    // 入场进度平滑插值
    this._entranceProgress += (this._targetEntranceProgress - this._entranceProgress) * this.lerpFactor;

    if (this.onUpdate) {
      this.onUpdate(this.currentRotation);
    }
  }

  /**
   * 获取当前旋转角度
   */
  getCurrentRotation() {
    return this.currentRotation;
  }

  /**
   * 获取入场进度（lerp 平滑后）
   */
  getEntranceProgress() {
    return this._entranceProgress;
  }

  /**
   * 启用/禁用滚动旋转
   */
  setEnabled(enabled) {
    this.enabled = enabled;
  }

  /**
   * 从粒子当前旋转同步内部状态（focus 退出时调用）
   * 避免旋转跳变，确保 lerp 从正确起点开始
   */
  resyncFromParticle(particleRotationY) {
    // 先计算目标旋转
    this._onScroll();
    const target = this.targetRotation;
    // 将粒子当前旋转归一化到 target 附近，避免 lerp 跨越巨大差值导致高速旋转
    let raw = -particleRotationY;
    const twoPI = 2 * Math.PI;
    const diff = raw - target;
    raw = target + ((diff % twoPI) + twoPI) % twoPI;
    if (raw - target > Math.PI) raw -= twoPI;
    this.currentRotation = raw;
  }

  dispose() {
    window.removeEventListener('scroll', this._onScroll);
    window.removeEventListener('resize', this._onResize);
  }
}