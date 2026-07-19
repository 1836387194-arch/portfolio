/**
 * 卡片系统 — 三层 DOM 架构：orbit(轨道) → parallax(视差) → spotlight(交互)
 * 三层独立 transform，scroll/mouse/hover 互不冲突
 */
export default class CardSystem {
  constructor({ particleSystem, container }) {
    this.particleSystem = particleSystem;
    this.container = container;
    this.cards = [];
    this.activeCard = null;
    this.onCardClickCb = null;
    this.onCardHoverCb = null;

    // 全局鼠标位置（归一化 -1..1），用于视差倾斜
    this._mouseX = 0;
    this._mouseY = 0;
    this._onGlobalMouseMove = (e) => {
      this._mouseX = (e.clientX / window.innerWidth) * 2 - 1;
      this._mouseY = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener('mousemove', this._onGlobalMouseMove);
    this.globalOpacity = 0;
  }

  static getDefaultDefinitions() {
    const deg2rad = (d) => d * Math.PI / 180;
    return [
      { part: 'heart', title: 'Story', subtitle: '我的文字', baseAngle: deg2rad(0), yOffset: 0.05, bgImage: '/card-story.jpg' },
      { part: 'head', title: 'Vision', subtitle: '视频作品', baseAngle: deg2rad(72), yOffset: 0.35, bgImage: '/card-vision.jpg' },
      { part: 'hands', title: 'Creation', subtitle: 'AI协作实践', baseAngle: deg2rad(144), yOffset: 0.12, bgImage: '/card-creation.jpg' },
      { part: 'body', title: 'Journey', subtitle: '我的经历', baseAngle: deg2rad(216), yOffset: -0.12, bgImage: '/card-journey.jpg' },
      { part: 'feet', title: 'Capabilities', subtitle: '我的能力', baseAngle: deg2rad(288), yOffset: -0.40, bgImage: '/card-structure.jpg' },
    ];
  }

  createCards(definitions) {
    this.container.innerHTML = '';

    // ===== 磁铁效果：基于 screenX/Y 判断 =====
    this._magnetPadding = 80;
    this._magnetStrength = 25;
    this._magnetCards = [];
    this._onMagnetMouseMove = (e) => {
      for (const card of this._magnetCards) {
        if (card.isDetached) { card.magnetX = 0; card.magnetY = 0; continue; }
        // 使用上一帧的屏幕坐标（而非 getBoundingClientRect，因为 spotlight 布局位置始终为 (0,0)）
        const centerX = card.screenX;
        const centerY = card.screenY;
        const cardWidth = 150;
        const cardHeight = 150;
        const distX = Math.abs(centerX - e.clientX);
        const distY = Math.abs(centerY - e.clientY);

        if (distX < cardWidth / 2 + this._magnetPadding && distY < cardHeight / 2 + this._magnetPadding) {
          card.magnetX = (e.clientX - centerX) / this._magnetStrength;
          card.magnetY = (e.clientY - centerY) / this._magnetStrength;
          card.magnetActive = true;
        } else {
          card.magnetX = 0;
          card.magnetY = 0;
          card.magnetActive = false;
        }
      }
    };
    window.addEventListener('mousemove', this._onMagnetMouseMove);

    for (const def of definitions) {
      // 层 1：orbit（scroll-driven 轨道）
      const orbitEl = document.createElement('div');
      orbitEl.className = 'card-orbit';

      // 层 2：parallax（mouse-driven 视差倾斜）
      const parallaxEl = document.createElement('div');
      parallaxEl.className = 'card-parallax';

      // 层 3：spotlight（magnet + hover 交互）
      const el = document.createElement('div');
      el.className = 'card-spotlight';
      el.dataset.part = def.part;
      el.style.setProperty('--card-bg', `url(${def.bgImage})`);

      el.innerHTML = `
        <div class="card-inner">
          <div class="card-bg-image"></div>
          <div class="card-frost"></div>
          <div class="card-content">
            <div class="card-title">${def.title}</div>
            <div class="card-subtitle">${def.subtitle}</div>
          </div>
        </div>
      `;

      el.style.opacity = '0';

      // 组装三层结构
      parallaxEl.appendChild(el);
      orbitEl.appendChild(parallaxEl);
      this.container.appendChild(orbitEl);

      const cardData = {
        orbitEl,     // 层 1
        parallaxEl,  // 层 2
        el,          // 层 3 (.card-spotlight)
        part: def.part, baseAngle: def.baseAngle, yOffset: def.yOffset,
        screenX: 0, screenY: 0, isDetached: false, isHovered: false,
      };
      this.cards.push(cardData);
      this._magnetCards.push(cardData);

      el.addEventListener('mouseenter', () => {
        cardData.isHovered = true;
        if (this.onCardHoverCb) this.onCardHoverCb(def.part, true);
      });
      el.addEventListener('mouseleave', () => {
        cardData.isHovered = false;
        if (this.onCardHoverCb) this.onCardHoverCb(def.part, false);
      });

      el.addEventListener('click', () => {
        this._handleCardClick(el, def.part);
      });
    }

    console.log(`[CardSystem] 创建了 ${this.cards.length} 张卡片（三层 DOM 架构）`);
  }

  _handleCardClick(el, part) {
    if (this.activeCard === el) {
      this.clearActiveCard();
      if (this.onCardClickCb) this.onCardClickCb(null);
      return;
    }
    if (this.activeCard) this.activeCard.classList.remove('active');
    el.classList.add('active');
    this.activeCard = el;
    if (this.onCardClickCb) this.onCardClickCb(part);
  }

  onCardClick(cb) { this.onCardClickCb = cb; }
  onCardHover(cb) { this.onCardHoverCb = cb; }

  clearActiveCard() {
    if (this.activeCard) { this.activeCard.classList.remove('active'); this.activeCard = null; }
  }

  setActiveCard(partName) {
    this.clearActiveCard();
    const card = this.cards.find(c => c.part === partName);
    if (card) { card.el.classList.add('active'); this.activeCard = card.el; }
  }

  getCardScreenPosition(partName) {
    const card = this.cards.find(c => c.part === partName);
    if (!card) return null;
    return { x: card.screenX, y: card.screenY, el: card.el };
  }

  detachCard(partName) {
    const card = this.cards.find(c => c.part === partName);
    if (!card) return null;
    card.isDetached = true;
    return card;
  }

  attachCard(partName) {
    const card = this.cards.find(c => c.part === partName);
    if (!card) return;
    card.isDetached = false;
    card.el.classList.remove('card-focus');
  }

  setMiniMode(enabled) {
    if (enabled) {
      this.container.classList.add('focus-mode');
    } else {
      this.container.classList.remove('focus-mode');
    }
  }

  setRemainingCardsDimmed(exceptPart) {
    for (const card of this.cards) {
      if (card.part === exceptPart || card.isDetached) continue;
      card.el.classList.add('card-dimmed');
    }
  }

  resetRemainingCards() {
    for (const card of this.cards) {
      card.el.classList.remove('card-dimmed');
    }
  }

  // ============ 三层独立 transform 更新 ============
  updatePositions(rotationY) {
    const particleGroup = this.particleSystem.getGroup();
    if (!particleGroup) return;

    const isMobile = window.innerWidth < 768;
    const orbitRadius = isMobile ? 260 : 380;
    const tiltAngle = 0.45;
    const yOffsetScale = 120;
    const yOffsetGlobal = 100;
    const sinTilt = Math.sin(tiltAngle);
    const cosTilt = Math.cos(tiltAngle);

    const showCards = this.globalOpacity > 0.001;

    // 鼠标视差倾斜（全局共享，所有卡片相同）
    const parallaxStrength = 0.07;
    const parallaxRY = -this._mouseX * parallaxStrength;
    const parallaxRX = this._mouseY * parallaxStrength;

    const depthData = [];

    for (const card of this.cards) {
      if (card.isDetached) continue;

      const orbitalAngle = card.baseAngle + rotationY;
      const cosA = Math.cos(orbitalAngle);
      const sinA = Math.sin(orbitalAngle);

      // 层 1：轨道位置（scroll-driven）
      const orbitX = orbitRadius * cosA;
      const orbitY_orbit = -orbitRadius * sinA * sinTilt;
      const orbitZ = orbitRadius * sinA * cosTilt;
      const baseY = -card.yOffset * yOffsetScale;
      const orbitY = orbitY_orbit + baseY + yOffsetGlobal;

      // 层 3：磁铁偏移平滑插值
      if (card.magnetActive) {
        const lf = 0.15;
        card._smoothMX = (card._smoothMX || 0) + (card.magnetX - (card._smoothMX || 0)) * lf;
        card._smoothMY = (card._smoothMY || 0) + (card.magnetY - (card._smoothMY || 0)) * lf;
      } else {
        card._smoothMX = (card._smoothMX || 0) * 0.85;
        card._smoothMY = (card._smoothMY || 0) * 0.85;
      }

      // 层 3：hover 效果
      const hoverScale = card.isHovered ? 1.04 : 1.0;
      const hoverTz = card.isHovered ? 50 : 0;

      // 透明度
      const baseOpacity = 0.35 + (orbitZ / (orbitRadius * cosTilt) + 1) * 0.325;
      const opacity = showCards ? Math.min(1, baseOpacity * this.globalOpacity) : 0;

      // 屏幕坐标映射（始终更新，供 getCardScreenPosition 和磁铁使用）
      const perspectiveFactor = 800 / Math.max(800 - orbitZ, 1);
      const halfW = window.innerWidth / 2;
      const halfH = window.innerHeight / 2;
      card.screenX = halfW + orbitX * perspectiveFactor;
      card.screenY = halfH + orbitY * perspectiveFactor;

      depthData.push({
        card, orbitX, orbitY, orbitZ,
        parallaxRX, parallaxRY,
        hoverScale, hoverTz, opacity,
        sortedIndex: 0,
      });
    }

    // 按 z 降序排列
    depthData.sort((a, b) => b.orbitZ - a.orbitZ);
    depthData.forEach((d, i) => { d.sortedIndex = i; });

    for (const d of depthData) {
      const { card, orbitX, orbitY, orbitZ, parallaxRX, parallaxRY, hoverScale, hoverTz, opacity, sortedIndex } = d;

      if (!card.el.classList.contains('card-focus')) {
        // 层 1：scroll-driven 轨道位置（始终更新）
        card.orbitEl.style.transform =
          `translate3d(${orbitX.toFixed(1)}px, ${orbitY.toFixed(1)}px, ${orbitZ.toFixed(1)}px)`;

        // 层 2：mouse-driven 视差倾斜（始终更新）
        card.parallaxEl.style.transform =
          `rotateX(${parallaxRX.toFixed(4)}rad) rotateY(${parallaxRY.toFixed(4)}rad)`;

        // 层 3：磁铁 + hover
        const mx = card._smoothMX || 0;
        const my = card._smoothMY || 0;
        card.el.style.transform =
          `translate(-50%, -50%) translateX(${mx.toFixed(1)}px) translateY(${my.toFixed(1)}px) translateZ(${hoverTz.toFixed(1)}px) scale(${hoverScale.toFixed(2)})`;

        card.el.style.opacity = opacity.toFixed(2);
        card.el.style.zIndex = String(1000 - sortedIndex);
      }
    }
  }

  dispose() {
    if (this._onGlobalMouseMove) {
      window.removeEventListener('mousemove', this._onGlobalMouseMove);
    }
    if (this._onMagnetMouseMove) {
      window.removeEventListener('mousemove', this._onMagnetMouseMove);
    }
    this._magnetCards = [];
    this.container.innerHTML = '';
    this.cards = [];
    this.activeCard = null;
  }
}