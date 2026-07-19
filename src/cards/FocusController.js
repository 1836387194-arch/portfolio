import { gsap } from 'gsap';
import DetailOverlay from './DetailOverlay.js';

/**
 * 双状态模式控制器：探索模式 ↔ 专注模式
 * 3D 空间卡片飞出动画 + 背景 crossfade + 左下角迷你粒子人
 */
export default class FocusController {
  /**
   * @param {object} options
   * @param {object} options.particleSystem
   * @param {object} options.cardSystem
   * @param {object} options.scrollController
   * @param {HTMLElement} options.canvasContainer
   * @param {HTMLElement} options.controlsHint
   * @param {HTMLElement} options.bgOverlay    - body::before 叠加层
   * @param {HTMLElement} options.focusBg      - focus 模式背景层
   */
  constructor({ particleSystem, cardSystem, scrollController, canvasContainer, controlsHint, bgOverlay, focusBg, focusTitleOverlay }) {
    this.particleSystem = particleSystem;
    this.cardSystem = cardSystem;
    this.scrollController = scrollController;
    this.canvasContainer = canvasContainer;
    this.controlsHint = controlsHint;
    this.bgOverlay = bgOverlay;
    this.focusBg = focusBg;

    this.focusTitleOverlay = focusTitleOverlay;
    this.focusTitleZh = focusTitleOverlay?.querySelector('#focus-title-zh');
    this.focusTitleEn = focusTitleOverlay?.querySelector('#focus-title-en');

    this.state = 'explore';
    this.focusedPart = null;
    this.focusCard = null;
    this.miniRotation = 0;
    this.miniSpeed = 0.5;
  }

  getState() { return this.state; }

  /**
   * 在 focus 模式下切换到另一个卡片 — 平滑过渡，不放大缩小
   */
  switchFocus(newPartName) {
    if (this.state !== 'focus' || this.focusedPart === newPartName) return;
    this.state = 'transitioning';
    const cardEl = this.focusCard.el;
    const oldPartName = this.focusedPart;

    // 背景保持 focus 状态不变
    // 卡片内容替换
    this._removeFocusContent(cardEl);
    this.focusedPart = newPartName;

    // 重置高亮部分
    this.particleSystem.setPartFocused(oldPartName);
    this.particleSystem.setPartFocused(newPartName);

    // 注入新内容
    this._injectFocusContent(cardEl, newPartName);

    // 短暂过渡后恢复
    this.state = 'focus';
  }

  /**
   * 进入专注模式 — 3D 卡片飞出 + 背景切换 + 粒子人左下角
   */
  enterFocus(partName) {
    if (this.state !== 'explore') return;
    this.state = 'transitioning';
    this.focusedPart = partName;

    const cardData = this.cardSystem.getCardScreenPosition(partName);
    if (!cardData) { this.state = 'explore'; return; }

    const cardEl = cardData.el;
    const startX = cardData.x;
    const startY = cardData.y;

    // 1. 从轨道中取出卡片
    this.focusCard = this.cardSystem.detachCard(partName);
    if (!this.focusCard) { this.state = 'explore'; return; }

    // 2. 背景 crossfade：淡入 focus 背景
    this._crossfadeBackground(true);

    // 3. 保存当前旋转角度，设置迷你模式
    this.miniRotation = this.scrollController.getCurrentRotation();
    this.cardSystem.setMiniMode(true);
    this.canvasContainer.classList.add('focus-mode');
    this.controlsHint.classList.add('focus-hidden');

    // 4. 剩余卡片变暗
    this.cardSystem.setRemainingCardsDimmed(partName);

    // 5. 暂停滚动旋转
    this.scrollController.setEnabled(false);

    // 6. 卡片 3D 飞出动画 — 占据右侧 2/3 页面
    // 关键：将卡片移出 parallaxEl（三层结构的中间层），避免 perspective 包含块影响
    this._cardOriginalParent = this.focusCard.parallaxEl;
    document.body.appendChild(cardEl);

    const targetLeft = '62vw';   // 卡片中心在 62vw，宽度 56vw → 右侧留 10vw 边距
    const targetTop = '50%';
    const targetWidth = '56vw';
    const targetHeight = '84vh';  // 上下各留 8vh 边距

    cardEl.style.position = 'fixed';
    cardEl.style.left = startX + 'px';
    cardEl.style.top = startY + 'px';
    cardEl.style.width = '180px';
    cardEl.style.height = '180px';
    cardEl.style.transform = 'translate(-50%, -50%) scale(1)';
    cardEl.style.zIndex = '200';

    // 注入详情内容和关闭按钮 — 移到动画完成后，避免 inset:0 在卡片膨胀期间错位
    // 提前更新标题覆盖层文字，再显示，避免先闪现旧标题
    const contentMap = DetailOverlay.getContentMap();
    const info = contentMap[partName] || { title: partName, subtitle: '' };
    if (this.focusTitleZh) this.focusTitleZh.textContent = info.subtitle;
    if (this.focusTitleEn) this.focusTitleEn.textContent = info.title;
    if (this.focusTitleOverlay) {
      this.focusTitleOverlay.classList.add('active');
    }

    // 强制回流
    cardEl.offsetHeight;

    // 3D 飞出：宽度 180px→56vw，高度 180px→84vh，translateZ 500px
    gsap.to(cardEl, {
      left: targetLeft,
      top: targetTop,
      width: targetWidth,
      height: targetHeight,
      duration: 0.7,
      ease: 'power3.out',
      onUpdate: () => {
        cardEl.style.transform = 'translate(-50%, -50%) translateZ(500px)';
      },
      onComplete: () => {
        cardEl.classList.add('card-focus');
        // 卡片到达最终尺寸后再注入内容，避免 absolute+inset 在动画期间错位
        this._injectFocusContent(cardEl, partName);
        this.state = 'focus';
      },
    });
  }

  /**
   * 退出专注模式 — 反向动画 + 背景恢复
   */
  exitFocus() {
    if (this.state !== 'focus') return;
    if (!this.focusCard) { this.state = 'explore'; return; }
    this.state = 'transitioning';

    const cardEl = this.focusCard.el;
    const partName = this.focusedPart;

    // 背景 crossfade：淡出 focus 背景
    this._crossfadeBackground(false);

    // 获取目标轨道位置
    const targetData = this.cardSystem.getCardScreenPosition(partName);
    const targetX = targetData ? targetData.x : window.innerWidth / 2;
    const targetY = targetData ? targetData.y : window.innerHeight / 2;

    // 移除 focus 样式
    cardEl.classList.remove('card-focus');

    // 缩小 + 飞回轨道
    gsap.to(cardEl, {
      left: targetX + 'px',
      top: targetY + 'px',
      width: '180px',
      height: '180px',
      duration: 0.5,
      ease: 'power2.inOut',
      onUpdate: () => {
        cardEl.style.transform = 'translate(-50%, -50%) translateZ(0px)';
      },
      onComplete: () => {
        // 清理 focus 内容
        this._removeFocusContent(cardEl);

        // 隐藏标题覆盖层
        if (this.focusTitleOverlay) {
          this.focusTitleOverlay.classList.remove('active');
        }

        // 将卡片移回原父容器
        if (this._cardOriginalParent) {
          this._cardOriginalParent.appendChild(cardEl);
          this._cardOriginalParent = null;
        }

        // 重置 GSAP 动画残留的 inline 样式，交还给 CSS + updatePositions 控制
        cardEl.style.position = '';
        cardEl.style.left = '';
        cardEl.style.top = '';
        cardEl.style.width = '';
        cardEl.style.height = '';
        cardEl.style.zIndex = '';
        cardEl.style.transform = '';

        // 放回轨道
        this.cardSystem.attachCard(partName);

        // 恢复探索模式
        this.cardSystem.setMiniMode(false);
        this.canvasContainer.classList.remove('focus-mode');
        this.controlsHint.classList.remove('focus-hidden');

        // 同步旋转状态：从粒子当前旋转接管，避免跳变
        this.scrollController.resyncFromParticle(this.particleSystem.getGroup().rotation.y);
        this.scrollController.setEnabled(true);
        this.cardSystem.clearActiveCard();
        this.cardSystem.resetRemainingCards();

        // 持久高亮
        this.particleSystem.setPartFocused(partName);

        this.state = 'explore';
        this.focusedPart = null;
        this.focusCard = null;
      },
    });
  }

  /**
   * 专注模式下的渲染循环
   */
  update(dt) {
    if (this.state === 'explore') return;
    this.miniRotation += this.miniSpeed * dt;
    this.particleSystem.getGroup().rotation.y = this.miniRotation;
    this.cardSystem.updatePositions(this.miniRotation);
  }

  // ============ 内部 ============

  /** 背景 crossfade */
  _crossfadeBackground(enter) {
    if (enter) {
      this.focusBg.classList.add('active');
      if (this.bgOverlay) {
        this.bgOverlay.style.transition = 'background 0.8s ease';
        this.bgOverlay.style.background = 'rgba(0, 0, 0, 0.08)';
      }
    } else {
      this.focusBg.classList.remove('active');
      if (this.bgOverlay) {
        this.bgOverlay.style.background = 'rgba(0, 0, 0, 0.05)';
      }
    }
  }

  _injectFocusContent(el, partName) {
    const contentMap = DetailOverlay.getContentMap();
    const info = contentMap[partName] || { title: partName, subtitle: '', entries: [] };

    // 更新标题覆盖层（左侧粒子人上方）
    if (this.focusTitleZh) this.focusTitleZh.textContent = info.subtitle;
    if (this.focusTitleEn) this.focusTitleEn.textContent = info.title;

    // 生成文章条目
    let entriesHTML = '';
    for (let i = 0; i < (info.entries || []).length; i++) {
      const entry = info.entries[i];
      const hoverLabel = entry.hoverLabel || '阅读全文';
      const hasHover = entry.hoverLabel !== ''; // 空字符串表示禁用 hover 交互
      const honorHTML = entry.honor ? `<div class="focus-entry-honor">${entry.honor}</div>` : '';
      const roleHTML = entry.role ? `<div class="focus-entry-role">${entry.role}</div>` : '';
      const tagsHTML = entry.tags ? `<div class="focus-entry-tags">${entry.tags}</div>` : '';
      const readmoreHTML = hasHover ? `<span class="focus-entry-readmore">${hoverLabel}</span>` : '';
      entriesHTML += `
        <div class="focus-entry${hasHover ? '' : ' focus-entry-static'}" data-entry-index="${i}">
          <span class="focus-entry-bullet"></span>
          <span class="focus-entry-title">${entry.title}</span>
          ${honorHTML}
          ${roleHTML}
          ${tagsHTML}
          <div class="focus-entry-summary">${entry.summary}</div>
          ${readmoreHTML}
        </div>`;
    }

    const detailDiv = document.createElement('div');
    detailDiv.className = 'card-detail-body';
    detailDiv.innerHTML = entriesHTML;

    // 存储条目数据用于点击回调
    this._currentEntries = info.entries || [];

    // 委托点击事件：条目 → 打开全文面板 / 视频链接 / 子视频面板
    detailDiv.addEventListener('click', (e) => {
      const entryEl = e.target.closest('.focus-entry');
      if (!entryEl || entryEl.classList.contains('focus-entry-static')) return;
      e.stopPropagation();
      e.preventDefault();
      const idx = parseInt(entryEl.dataset.entryIndex, 10);
      if (!isNaN(idx) && this._currentEntries[idx]) {
        const entry = this._currentEntries[idx];
        if (entry.subEntries) {
          this._openVideoSubPanel(el, entry);
        } else if (entry.videoUrl) {
          window.open(entry.videoUrl, '_blank', 'noopener');
        } else {
          this._openArticlePanel(el, entry);
        }
      }
    });

    el.appendChild(detailDiv);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'card-focus-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.exitFocus();
    });
    el.appendChild(closeBtn);
  }

  _openArticlePanel(el, entry) {
    // 移除已存在的面板
    this._closeArticlePanel(el);

    const panel = document.createElement('div');
    panel.className = 'article-panel';
    const inspiredHTML = entry.inspiredBy
      ? `<a class="article-inspired-by" href="${entry.inspiredByUrl}" target="_blank" rel="noopener">${entry.inspiredBy}</a>`
      : '';

    panel.innerHTML = `
      <div class="article-panel-header">
        <div>
          <div class="article-panel-title">${entry.title}</div>
          <div class="article-panel-tags">${entry.tags}</div>
          ${inspiredHTML}
        </div>
        <button class="article-panel-back">&times;</button>
      </div>
      <div class="article-panel-body">
        ${entry.content || `<p>${entry.summary}</p>`}
      </div>
    `;

    panel.querySelector('.article-panel-back').addEventListener('click', (e) => {
      e.stopPropagation();
      this._closeArticlePanel(el);
    });

    el.appendChild(panel);

    // 隐藏条目的滚动条，面板自带滚动
    const detailBody = el.querySelector('.card-detail-body');
    if (detailBody) detailBody.style.overflow = 'hidden';

    // 强制回流后激活动画
    panel.offsetHeight;
    panel.classList.add('active');
  }

  _closeArticlePanel(el) {
    const panel = el?.querySelector('.article-panel');
    if (panel) {
      panel.classList.remove('active');
      // 等动画结束再移除
      panel.addEventListener('transitionend', () => panel.remove(), { once: true });
      // 兜底：500ms 后强制移除
      setTimeout(() => { if (panel.parentNode) panel.remove(); }, 500);
    }
    // 恢复条目区域滚动
    const detailBody = el?.querySelector('.card-detail-body');
    if (detailBody) detailBody.style.overflow = '';
  }

  _openVideoSubPanel(el, entry) {
    // 先关闭已有面板
    this._closeArticlePanel(el);
    this._closeVideoSubPanel(el);

    const panel = document.createElement('div');
    panel.className = 'video-sub-panel';

    let optionsHTML = '';
    for (const sub of entry.subEntries) {
      optionsHTML += `
        <a class="video-sub-option" href="${sub.url}" target="_blank" rel="noopener">
          <span class="video-sub-bullet">▶</span>
          <span class="video-sub-title">${sub.title}</span>
        </a>`;
    }

    panel.innerHTML = `
      <div class="video-sub-header">
        <span class="video-sub-label">${entry.title}</span>
        <button class="video-sub-back">&times;</button>
      </div>
      <div class="video-sub-body">
        ${optionsHTML}
      </div>
    `;

    panel.querySelector('.video-sub-back').addEventListener('click', (e) => {
      e.stopPropagation();
      this._closeVideoSubPanel(el);
    });

    el.appendChild(panel);

    const detailBody = el.querySelector('.card-detail-body');
    if (detailBody) detailBody.style.overflow = 'hidden';

    panel.offsetHeight;
    panel.classList.add('active');
  }

  _closeVideoSubPanel(el) {
    const panel = el?.querySelector('.video-sub-panel');
    if (panel) {
      panel.classList.remove('active');
      panel.addEventListener('transitionend', () => panel.remove(), { once: true });
      setTimeout(() => { if (panel.parentNode) panel.remove(); }, 500);
    }
    const detailBody = el?.querySelector('.card-detail-body');
    if (detailBody) detailBody.style.overflow = '';
  }

  _removeFocusContent(el) {
    this._closeArticlePanel(el);
    this._closeVideoSubPanel(el);
    const detailBody = el.querySelector('.card-detail-body');
    if (detailBody) detailBody.remove();
    const closeBtn = el.querySelector('.card-focus-close');
    if (closeBtn) closeBtn.remove();
  }
}