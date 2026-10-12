// ==UserScript==
// @name         ChatGPT 默认 GPT-5.6 Sol High（快速版）
// @namespace    https://chatgpt.com/local-default-model/
// @version      1.5.0
// @description  仅在 chatgpt.com 新对话页运行；优先复用当前状态，以最少 UI 操作切换到 GPT-5.6 Sol + High。
// @match        https://chatgpt.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = '1.5.0';
  const INSTANCE = '__chatgpt56SolHighFast_v150';

  if (window[INSTANCE]) return;
  window[INSTANCE] = true;

  // ============================================================
  // 基础配置
  // ============================================================

  const CONTROL =
    'button,' +
    '[role="button"],' +
    '[role="menuitem"],' +
    '[role="menuitemradio"],' +
    '[role="menuitemcheckbox"],' +
    '[role="option"],' +
    '[cmdk-item],' +
    '[data-radix-collection-item]';

  const POPUP =
    '[role="menu"],' +
    '[role="listbox"],' +
    '[role="dialog"],' +
    '[data-radix-popper-content-wrapper]';

  const WORDS = {
    advanced: [
      'Advanced',
      '高级',
      '高級',
    ],

    model: [
      'Model',
      'Select model',
      'Choose model',
      '模型',
      '选择模型',
      '選擇模型',
    ],

    effort: [
      'Effort',
      'Reasoning effort',
      'Thinking effort',
      '推理强度',
      '推理強度',
      '思考强度',
      '思考強度',
      '强度',
      '強度',
    ],

    more: [
      'More models',
      'Other models',
      'Legacy models',
      'View other models',
      'Show all models',
      '更多模型',
      '其他模型',
      '其它模型',
      '旧版模型',
      '舊版模型',
      '查看其他模型',
    ],
  };

  const state = {
    epoch: 0,
    url: location.href,

    running: false,
    requested: false,
    done: false,

    attempts: 0,
    timer: null,

    interacted: false,

    // 用于避免关闭用户自己打开的菜单。
    menuEpoch: null,
    menuRoots: [],
  };

  // ============================================================
  // 通用工具
  // ============================================================

  const sleep = (ms) =>
    new Promise(resolve => setTimeout(resolve, ms));

  const clean = (value) =>
    String(value || '')
      .replace(/[‐-‒–—−]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();

  const text = (el) =>
    clean(
      el &&
      (
        el.innerText ||
        el.textContent ||
        el.getAttribute('aria-label')
      )
    );

  const head = (el) =>
    clean(
      el &&
      (
        el.innerText ||
        el.textContent ||
        el.getAttribute('aria-label') ||
        ''
      ).split(/\n/)[0]
    );

  const names = (el) => {
    if (!el) return [];

    return [
      head(el),
      el.getAttribute('aria-label'),
      el.getAttribute('title'),
    ]
      .filter(Boolean)
      .map(clean)
      .filter((value, index, arr) => arr.indexOf(value) === index);
  };

  function isModel(label) {
    return /^(?:gpt[ -]*)?5\.6[ -]+sol(?:\s*[✓✔])?$/i.test(
      clean(label)
    );
  }

  // 只认精确 High。
  // Extra High / Max / Ultra 均不能冒充 High。
  function isHigh(label) {
    return /^(?:high|高|高强度|高強度)(?:\s*[✓✔])?$/i.test(
      clean(label)
    );
  }

  function isEffort(label) {
    return /^(?:instant|minimal|low|light|medium|high|extra high|max|ultra|极速|極速|低|中|高|极高|極高)$/i.test(
      clean(label)
    );
  }

  function visible(el) {
    if (!(el instanceof Element)) return false;
    if (!el.isConnected) return false;

    const rect = el.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }

    // ChatGPT 有时会把两个菜单视图同时挂在 DOM 上，
    // 其中一个 opacity:0。
    for (
      let node = el;
      node;
      node = node.parentElement
    ) {
      const style = getComputedStyle(node);

      if (
        node.hasAttribute('inert') ||
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse' ||
        Number(style.opacity) === 0
      ) {
        return false;
      }
    }

    return true;
  }

  function all(selector, root = document) {
    return [...root.querySelectorAll(selector)]
      .filter(visible);
  }

  function composer() {
    return (
      all(
        '#prompt-textarea,' +
        'textarea,' +
        '[contenteditable="true"]'
      )[0] || null
    );
  }

  // 只在“尚未开始聊天”的页面自动运行。
  function newChat() {
    return (
      /^\/(?:new\/?|$)/.test(location.pathname) ||
      /^\/g\/[^/]+\/?$/.test(location.pathname)
    );
  }

  function canRun(epoch) {
    const editor = composer();

    return (
      epoch === state.epoch &&
      newChat() &&
      !state.interacted &&
      document.visibilityState !== 'hidden' &&
      !all('[data-testid="stop-button"]').length &&
      !clean(
        editor?.value ||
        editor?.textContent
      )
    );
  }

  function label(el) {
    if (!el) return '';

    return clean(
      [
        text(el),
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
      ]
        .filter(Boolean)
        .join(' ')
    );
  }

  // ============================================================
  // 找 ChatGPT 模型按钮
  // ============================================================

  function picker() {
    const editor = composer();

    if (!editor) return null;

    const form = editor.closest('form');

    const candidates = all(
      'button,[role="button"]'
    ).filter(el => {
      // 不选择菜单内部按钮。
      if (el.closest(POPUP)) {
        return false;
      }

      const name = label(el);

      // 排除输入框附近的其他按钮。
      if (
        /voice|dictat|microphone|record|send|语音|录音|发送|麥克風|麦克风/i
          .test(name)
      ) {
        return false;
      }

      return (
        /^(?:gpt[ -]*\d|\d(?:\.\d)?\s+(?:sol|luna|astra)|latest|最新|auto\b|instant\b|thinking\b|pro\b|high\b|medium\b|light\b|power\b|自动|思考|极速|極速|高|中)/i
          .test(name) ||

        /model.*(?:picker|select)|选择.*模型|選擇.*模型|推理强度|reasoning effort/i
          .test(name) ||

        /model-switcher|model-picker/
          .test(
            el.getAttribute('data-testid') || ''
          )
      );
    });

    const scoped = form
      ? candidates.filter(el => form.contains(el))
      : [];

    const rect = editor.getBoundingClientRect();

    const list = scoped.length
      ? scoped
      : candidates;

    list.sort((a, b) => {
      const distance = (el) => {
        const r = el.getBoundingClientRect();

        return (
          Math.abs(r.top - rect.bottom) +
          Math.abs(r.right - rect.right)
        );
      };

      return distance(a) - distance(b);
    });

    return list[0] || null;
  }

  // ============================================================
  // 菜单工具
  // ============================================================

  function menus() {
    return all(POPUP);
  }

  function controls() {
    return [
      ...new Set(
        menus().flatMap(root =>
          all(CONTROL, root)
        )
      ),
    ];
  }

  function matchesWord(el, words) {
    return words.some(word => {
      const wanted = word.toLowerCase();

      return names(el).some(name => {
        const value = name.toLowerCase();

        return (
          value === wanted ||
          value.startsWith(`${wanted} `) ||
          value.startsWith(`${wanted}:`) ||
          value.startsWith(`${wanted}：`)
        );
      });
    });
  }

  function findWord(words) {
    return controls()
      .find(el => matchesWord(el, words));
  }

  function findModel() {
    return controls()
      .find(el =>
        names(el).some(isModel)
      );
  }

  function selected(el) {
    if (!el) return false;

    if (
      ['aria-checked', 'aria-selected']
        .some(
          attr =>
            el.getAttribute(attr) === 'true'
        )
    ) {
      return true;
    }

    if (
      el.getAttribute('data-state') === 'checked' ||
      el.getAttribute('data-state') === 'selected'
    ) {
      return true;
    }

    return !!el.querySelector(
      '[data-state="checked"],' +
      '[aria-checked="true"],' +
      'svg.lucide-check,' +
      '[data-testid="checkmark"]'
    );
  }

  function enabled(el) {
    return (
      !!el &&
      !el.disabled &&
      el.getAttribute('aria-disabled') !== 'true'
    );
  }

  function key(el, value) {
    if (!el) return;

    el.focus?.({
      preventScroll: true,
    });

    for (
      const type of ['keydown', 'keyup']
    ) {
      el.dispatchEvent(
        new KeyboardEvent(type, {
          key: value,
          code: value,
          bubbles: true,
          cancelable: true,
        })
      );
    }
  }

  function click(el, epoch) {
    if (
      !canRun(epoch) ||
      !visible(el) ||
      !enabled(el)
    ) {
      return false;
    }

    el.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    });

    const r = el.getBoundingClientRect();

    const x =
      r.left + r.width / 2;

    const y =
      r.top + r.height / 2;

    const hit =
      document.elementFromPoint(x, y);

    if (
      !hit ||
      !(
        hit === el ||
        el.contains(hit)
      )
    ) {
      return false;
    }

    // 不提前 hover，避免 Radix 子菜单发生打开→关闭。
    for (
      const type of [
        'pointerdown',
        'mousedown',
        'pointerup',
        'mouseup',
        'click',
      ]
    ) {
      const EventClass =
        type.startsWith('pointer') &&
        typeof PointerEvent === 'function'
          ? PointerEvent
          : MouseEvent;

      hit.dispatchEvent(
        new EventClass(type, {
          bubbles: true,
          cancelable: true,
          composed: true,

          clientX: x,
          clientY: y,

          button: 0,
          buttons:
            /down$/.test(type)
              ? 1
              : 0,

          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
        })
      );
    }

    return true;
  }

  async function wait(
    find,
    epoch,
    ms = 1500
  ) {
    const until =
      Date.now() + ms;

    do {
      if (!canRun(epoch)) {
        return null;
      }

      const result = find();

      if (result) {
        return result;
      }

      await sleep(80);
    } while (
      Date.now() < until
    );

    return null;
  }

  // ============================================================
  // 打开 / 关闭菜单
  // ============================================================

  async function closeMenus(epoch) {
    // 不是脚本自己打开的菜单，不碰。
    if (
      state.menuEpoch !== epoch
    ) {
      return !menus().length;
    }

    const roots = [
      ...new Set([
        ...state.menuRoots,
        ...menus(),
      ]),
    ];

    for (
      let i = 0;
      i < 4 &&
      menus().length &&
      canRun(epoch);
      i += 1
    ) {
      key(
        document.activeElement ||
        document.body,
        'Escape'
      );

      await sleep(70);
    }

    const detached =
      await wait(
        () =>
          roots.every(
            root =>
              !root.isConnected
          ),
        epoch,
        1800
      );

    if (
      detached &&
      !menus().length
    ) {
      state.menuEpoch = null;
      state.menuRoots = [];

      return true;
    }

    // 如果菜单本身已经消失，同样算成功。
    if (!menus().length) {
      state.menuEpoch = null;
      state.menuRoots = [];

      return true;
    }

    return false;
  }

  async function openRoot(epoch) {
    // 页面已有其他菜单，
    // 且不是本次脚本打开的，不抢控制权。
    if (
      menus().length &&
      state.menuEpoch !== epoch
    ) {
      return false;
    }

    // 如果本脚本之前的菜单还挂着，
    // 先完全退出。
    if (
      menus().length &&
      state.menuEpoch === epoch
    ) {
      if (!await closeMenus(epoch)) {
        return false;
      }
    }

    const button =
      await wait(
        picker,
        epoch,
        8000
      );

    if (
      !button ||
      !canRun(epoch) ||
      !enabled(button)
    ) {
      return false;
    }

    state.menuEpoch = epoch;

    // 优先 Enter。
    // 比完整模拟鼠标事件更简单。
    key(button, 'Enter');

    let opened =
      await wait(
        () =>
          menus().length ||
          button.getAttribute(
            'aria-expanded'
          ) === 'true',
        epoch,
        650
      );

    // Enter 无效时再鼠标点击。
    if (
      !opened &&
      click(button, epoch)
    ) {
      opened =
        await wait(
          () =>
            menus().length ||
            button.getAttribute(
              'aria-expanded'
            ) === 'true',
          epoch,
          900
        );
    }

    if (!opened) {
      return false;
    }

    const ready =
      await wait(
        () =>
          menus().length &&
          controls().length,
        epoch,
        2200
      );

    state.menuRoots =
      menus();

    return !!ready;
  }

  async function openRow(
    row,
    epoch,
    ready
  ) {
    if (
      !row ||
      !enabled(row)
    ) {
      return false;
    }

    if (ready()) {
      return true;
    }

    // ChatGPT 某些版本使用普通 view toggle。
    if (
      row.hasAttribute(
        'data-model-picker-view-toggle'
      )
    ) {
      if (!click(row, epoch)) {
        return false;
      }

      return !!await wait(
        ready,
        epoch,
        2200
      );
    }

    const before =
      new Set(menus());

    const opened = () =>
      row.getAttribute(
        'aria-expanded'
      ) === 'true' ||

      row.getAttribute(
        'data-state'
      ) === 'open' ||

      menus().some(
        menu =>
          !before.has(menu)
      );

    // Radix 子菜单优先 ArrowRight。
    key(row, 'ArrowRight');

    if (
      await wait(
        ready,
        epoch,
        1000
      )
    ) {
      return true;
    }

    if (opened()) {
      return !!await wait(
        ready,
        epoch,
        1800
      );
    }

    if (
      !canRun(epoch) ||
      !visible(row)
    ) {
      return false;
    }

    if (!click(row, epoch)) {
      return false;
    }

    return !!await wait(
      ready,
      epoch,
      1800
    );
  }

  async function advanced(epoch) {
    const row =
      findWord(
        WORDS.advanced
      );

    // 没有 Advanced 不算错误。
    // 部分 UI 直接展示 Model / Effort。
    if (!row) {
      return true;
    }

    return openRow(
      row,
      epoch,
      () =>
        !!findWord(
          WORDS.model
        ) ||
        !!findWord(
          WORDS.effort
        ) ||
        !!findModel()
    );
  }

  // ============================================================
  // 当前模型判断
  // ============================================================

  function currentModel(row) {
    if (!row) return false;

    const value =
      text(row).replace(
        /^(?:model|模型)\s*[:：]?\s*/i,
        ''
      );

    return isModel(value);
  }

  // 这是整个快速逻辑最重要的地方：
  //
  // 如果输入框旁边的模型按钮已经显示 5.6 Sol，
  // 完全不打开“模型列表”重新选择。
  function triggerModel() {
    const button = picker();

    if (!button) {
      return false;
    }

    return names(button).some(
      name =>
        /^(?:gpt[ -]*)?5\.6[ -]+sol(?=$|[\s·•|✓✔])/i
          .test(name)
    );
  }

  // ============================================================
  // 模型选择
  // ============================================================

  async function modelChoices(epoch) {
    // 已经是目标模型：
    // 不打开菜单。
    if (triggerModel()) {
      return {
        already: true,
        option: null,
      };
    }

    if (
      !await openRoot(epoch)
    ) {
      return null;
    }

    await advanced(epoch);

    // 打开菜单之后，
    // 再判断一次当前 Model 行。
    const row =
      findWord(
        WORDS.model
      );

    if (
      triggerModel() ||
      currentModel(row)
    ) {
      return {
        already: true,
        option: null,
      };
    }

    // 当前界面已经有 Sol，
    // 就直接使用。
    let option =
      findModel();

    // 否则进入 Model 子菜单。
    if (!option) {
      const opener =
        row ||
        effortRow();

      if (opener) {
        await openRow(
          opener,
          epoch,
          () =>
            !!findModel() ||
            !!findWord(
              WORDS.more
            ) ||
            controls().some(
              el =>
                el !== opener &&
                !el.hasAttribute(
                  'data-model-picker-view-toggle'
                ) &&
                /^(?:gpt[ -]*\d|\d(?:\.\d)?\s+(?:sol|luna|astra))/i
                  .test(head(el))
            )
        );
      }

      option =
        findModel();
    }

    // More models 最多深入 3 层。
    for (
      let depth = 0;
      depth < 3 &&
      !option;
      depth += 1
    ) {
      const more =
        findWord(
          WORDS.more
        );

      if (!more) break;

      const before =
        controls()
          .map(text)
          .join('\n');

      const changed =
        await openRow(
          more,
          epoch,
          () =>
            !!findModel() ||
            controls()
              .map(text)
              .join('\n') !== before
        );

      if (!changed) {
        break;
      }

      option =
        await wait(
          findModel,
          epoch,
          1600
        );
    }

    return {
      already: false,
      option:
        option ||
        findModel(),
    };
  }

  async function chooseModelIfNeeded(epoch) {
    // 最快路径：
    // 当前按钮直接显示 Sol。
    if (triggerModel()) {
      report(
        '当前已经是 GPT-5.6 Sol，跳过模型选择'
      );

      return true;
    }

    const result =
      await modelChoices(
        epoch
      );

    if (!result) {
      throw new Error(
        '无法打开模型菜单'
      );
    }

    if (result.already) {
      report(
        '菜单确认当前已经是 GPT-5.6 Sol'
      );

      return true;
    }

    const option =
      result.option;

    if (
      !option ||
      !enabled(option)
    ) {
      throw new Error(
        '菜单中未找到可用的 GPT-5.6 Sol'
      );
    }

    if (!selected(option)) {
      if (
        !click(
          option,
          epoch
        )
      ) {
        throw new Error(
          '无法点击 GPT-5.6 Sol'
        );
      }

      // 等菜单响应，
      // 但不重新打开菜单做模型二次核验。
      await sleep(220);
    }

    report(
      '已选择 GPT-5.6 Sol'
    );

    return true;
  }

  // ============================================================
  // 推理强度
  // ============================================================

  function effortRow() {
    const rows =
      controls().filter(el => {
        const role =
          el.getAttribute('role');

        return (
          isEffort(head(el)) &&
          role !== 'menuitemradio' &&
          role !== 'option' &&
          !el.hasAttribute(
            'aria-checked'
          )
        );
      });

    return rows.length === 1
      ? rows[0]
      : null;
  }

  function slider() {
    return (
      menus()
        .flatMap(root =>
          all(
            '[role="slider"],input[type="range"]',
            root
          )
        )[0] ||
      null
    );
  }

  function sliderKeyboard(el) {
    if (!el) return null;

    const row =
      el.closest(
        '[role="menuitem"]'
      );

    if (
      row &&
      (
        row.hasAttribute(
          'data-reasoning-slider'
        ) ||

        /ArrowLeft.*ArrowRight|ArrowRight.*ArrowLeft/
          .test(
            row.getAttribute(
              'aria-keyshortcuts'
            ) || ''
          )
      )
    ) {
      return row;
    }

    return el;
  }

  function sliderEffort(el) {
    if (!el) return '';

    const aria =
      clean(
        el.getAttribute(
          'aria-valuetext'
        )
      );

    if (aria) {
      return aria;
    }

    for (
      const target of new Set([
        el,
        sliderKeyboard(el),
      ])
    ) {
      if (!target) continue;

      const ids =
        (
          target.getAttribute(
            'aria-describedby'
          ) || ''
        )
          .split(/\s+/)
          .filter(Boolean);

      for (const id of ids) {
        const status =
          document.getElementById(
            id
          );

        const value =
          clean(
            status?.textContent
          )
            .split(/[，,。]/)[0];

        if (
          isEffort(value) ||
          isHigh(value)
        ) {
          return value;
        }
      }
    }

    const row =
      effortRow();

    return row
      ? head(row)
      : '';
  }

  function highOption() {
    return controls()
      .find(
        el =>
          names(el).some(
            isHigh
          ) &&
          !el.hasAttribute(
            'aria-haspopup'
          )
      );
  }

  function highProof() {
    const el =
      slider();

    if (el) {
      return isHigh(
        sliderEffort(el)
      );
    }

    const choice =
      highOption();

    if (selected(choice)) {
      return true;
    }

    const row =
      findWord(
        WORDS.effort
      );

    if (!row) {
      return false;
    }

    const value =
      text(row).replace(
        /^(?:reasoning effort|thinking effort|effort|推理强度|推理強度|思考强度|思考強度)\s*[:：]?\s*/i,
        ''
      );

    return isHigh(value);
  }

  function usableSlider() {
    const el =
      slider();

    if (
      el &&
      enabled(
        sliderKeyboard(el)
      )
    ) {
      return el;
    }

    return null;
  }

  function usableHigh() {
    const option =
      highOption();

    return enabled(option)
      ? option
      : null;
  }

  function effortReady() {
    return !!(
      highProof() ||
      usableHigh() ||
      usableSlider()
    );
  }

  // ============================================================
  // 进入强度界面
  // ============================================================

  async function ensureEffortPanel(epoch) {
    // 最重要的优化：
    //
    // 如果选择 Sol 后强度面板已经直接出现，
    // 什么都不重新打开。
    if (effortReady()) {
      return true;
    }

    // 如果当前已有本脚本菜单，
    // 直接在当前菜单里找。
    if (
      menus().length &&
      state.menuEpoch === epoch
    ) {
      await advanced(epoch);

      if (effortReady()) {
        return true;
      }

      const row =
        findWord(
          WORDS.effort
        );

      if (row) {
        await openRow(
          row,
          epoch,
          effortReady
        );

        if (effortReady()) {
          return true;
        }
      }

      // 某些版本选择模型后，
      // 模型列表仍保留，
      // 再点一次“已选中的 Sol”会返回强度面板。
      const option =
        findModel();

      if (
        option &&
        selected(option) &&
        enabled(option)
      ) {
        report(
          '当前仍停留在模型列表，返回强度面板'
        );

        click(
          option,
          epoch
        );

        if (
          await wait(
            effortReady,
            epoch,
            1600
          )
        ) {
          return true;
        }
      }
    }

    // 当前没有菜单：
    // 只在这里重新打开一次。
    if (!menus().length) {
      if (
        !await openRoot(epoch)
      ) {
        return false;
      }
    }

    await advanced(epoch);

    if (effortReady()) {
      return true;
    }

    const row =
      findWord(
        WORDS.effort
      );

    if (row) {
      await openRow(
        row,
        epoch,
        effortReady
      );
    }

    if (effortReady()) {
      return true;
    }

    // 再处理一次“模型列表保留”的 UI。
    const option =
      findModel();

    if (
      option &&
      selected(option) &&
      enabled(option)
    ) {
      click(
        option,
        epoch
      );

      await wait(
        effortReady,
        epoch,
        1600
      );
    }

    return effortReady();
  }

  // ============================================================
  // Slider：精确移动到 High
  // ============================================================

  function rankEffort(value) {
    const table = {
      instant: 0,
      minimal: 0,

      low: 1,
      light: 1,

      medium: 2,

      high: 3,

      'extra high': 4,

      max: 5,
      ultra: 5,

      '极速': 0,
      '極速': 0,

      '低': 1,
      '中': 2,

      '高': 3,
      '高强度': 3,
      '高強度': 3,

      '极高': 4,
      '極高': 4,
    };

    return (
      table[
        clean(value)
          .toLowerCase()
      ] ?? -1
    );
  }

  async function setSliderHigh(epoch) {
    let el =
      slider();

    if (
      !el ||
      !enabled(
        sliderKeyboard(el)
      )
    ) {
      throw new Error(
        '未找到可操作的强度滑块'
      );
    }

    let current =
      sliderEffort(el);

    if (isHigh(current)) {
      return true;
    }

    if (
      rankEffort(current) < 0
    ) {
      throw new Error(
        '无法读取当前强度标签，不猜测 High 的位置'
      );
    }

    const originalLabel =
      current;

    const originalInputValue =
      el instanceof HTMLInputElement
        ? el.value
        : null;

    const originalAriaValue =
      el.getAttribute(
        'aria-valuenow'
      );

    const nativeSetter =
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )?.set;

    function setNative(
      target,
      value
    ) {
      if (
        !nativeSetter ||
        !(target instanceof HTMLInputElement) ||
        target.type !== 'range'
      ) {
        return false;
      }

      nativeSetter.call(
        target,
        String(value)
      );

      target.dispatchEvent(
        new Event(
          'input',
          {
            bubbles: true,
          }
        )
      );

      target.dispatchEvent(
        new Event(
          'change',
          {
            bubbles: true,
          }
        )
      );

      return true;
    }

    async function step(
      direction
    ) {
      if (!canRun(epoch)) {
        return false;
      }

      el = slider();

      if (
        !el ||
        !enabled(
          sliderKeyboard(el)
        )
      ) {
        return false;
      }

      const before =
        sliderEffort(el) +
        ':' +
        (
          el.getAttribute(
            'aria-valuenow'
          ) ??
          el.value ??
          ''
        );

      if (
        el instanceof HTMLInputElement &&
        el.type === 'range'
      ) {
        const amount =
          Number(
            el.step || 1
          );

        if (
          !Number.isFinite(amount) ||
          amount <= 0
        ) {
          return false;
        }

        if (
          !setNative(
            el,
            Number(el.value) +
            direction * amount
          )
        ) {
          return false;
        }
      } else {
        key(
          sliderKeyboard(el),
          direction > 0
            ? 'ArrowRight'
            : 'ArrowLeft'
        );
      }

      await sleep(100);

      el = slider();

      if (!el) {
        return false;
      }

      const after =
        sliderEffort(el) +
        ':' +
        (
          el.getAttribute(
            'aria-valuenow'
          ) ??
          el.value ??
          ''
        );

      return (
        before !== after
      );
    }

    // 从当前档位直接向 High 走。
    let direction = null;

    for (
      let attempt = 0;
      attempt < 12 &&
      canRun(epoch);
      attempt += 1
    ) {
      el = slider();

      if (!el) break;

      current =
        sliderEffort(el);

      if (isHigh(current)) {
        return true;
      }

      const rank =
        rankEffort(current);

      if (rank < 0) {
        break;
      }

      const nextDirection =
        rank < 3
          ? 1
          : -1;

      // 一旦越过 High 后方向发生反转，
      // 停止，防止 Medium ↔ Extra High 来回跳。
      if (
        direction !== null &&
        nextDirection !== direction
      ) {
        break;
      }

      direction =
        nextDirection;

      if (
        !await step(direction)
      ) {
        break;
      }
    }

    // 失败则恢复。
    el = slider();

    if (
      el &&
      canRun(epoch)
    ) {
      if (
        el instanceof HTMLInputElement &&
        originalInputValue !== null
      ) {
        setNative(
          el,
          originalInputValue
        );
      } else {
        for (
          let attempt = 0;
          attempt < 10 &&
          slider() &&
          canRun(epoch);
          attempt += 1
        ) {
          el = slider();

          const currentLabel =
            sliderEffort(el);

          if (
            currentLabel === originalLabel ||
            (
              originalAriaValue !== null &&
              el.getAttribute(
                'aria-valuenow'
              ) === originalAriaValue
            )
          ) {
            break;
          }

          const currentRank =
            rankEffort(
              currentLabel
            );

          const originalRank =
            rankEffort(
              originalLabel
            );

          if (
            currentRank < 0 ||
            originalRank < 0 ||
            currentRank === originalRank
          ) {
            break;
          }

          await step(
            currentRank <
            originalRank
              ? 1
              : -1
          );
        }
      }
    }

    throw new Error(
      '滑块未能精确停在 High'
    );
  }

  // ============================================================
  // 设置 High
  // ============================================================

  async function chooseHighIfNeeded(epoch) {
    if (
      !await ensureEffortPanel(
        epoch
      )
    ) {
      throw new Error(
        '无法进入推理强度设置'
      );
    }

    // 已经 High：
    // 零额外点击。
    if (highProof()) {
      report(
        '当前已经是 High，跳过强度修改'
      );

      return true;
    }

    // 优先直接点击 High。
    const option =
      usableHigh();

    if (option) {
      if (
        !click(
          option,
          epoch
        )
      ) {
        throw new Error(
          '无法点击 High'
        );
      }

      // 只验证当前菜单状态，
      // 不重新打开菜单。
      await wait(
        highProof,
        epoch,
        800
      );

      if (!highProof()) {
        throw new Error(
          '点击 High 后未确认成功'
        );
      }

      report(
        '已选择 High'
      );

      return true;
    }

    // 当前 UI 是 Slider。
    if (usableSlider()) {
      await setSliderHigh(
        epoch
      );

      if (!highProof()) {
        throw new Error(
          '滑块操作后未确认 High'
        );
      }

      report(
        '已通过滑块选择 High'
      );

      return true;
    }

    throw new Error(
      '强度界面中没有可操作的 High'
    );
  }

  // ============================================================
  // 主流程
  // ============================================================

  async function apply() {
    if (state.running) {
      state.requested = true;
      return;
    }

    if (
      state.done ||
      state.attempts >= 3 ||
      !newChat()
    ) {
      return;
    }

    const epoch =
      state.epoch;

    if (!canRun(epoch)) {
      return;
    }

    state.running = true;
    state.attempts += 1;

    try {
      // --------------------------------------------------------
      // 第一步：
      // 已经是 5.6 Sol 就完全跳过模型列表。
      // --------------------------------------------------------

      await chooseModelIfNeeded(
        epoch
      );

      if (!canRun(epoch)) {
        throw new Error(
          '用户已接管页面'
        );
      }

      // --------------------------------------------------------
      // 第二步：
      // 利用当前菜单状态直接设置 High。
      // --------------------------------------------------------

      await chooseHighIfNeeded(
        epoch
      );

      if (!canRun(epoch)) {
        throw new Error(
          '用户已接管页面'
        );
      }

      // 不再调用 verifyBoth()。
      //
      // 因为：
      // 1. 模型选择时已经基于目标元素执行；
      // 2. High 在当前面板已经做了精确核验；
      // 3. 再重新打开菜单只会增加操作数量。

      state.done = true;

      report(
        '完成：GPT-5.6 Sol + High'
      );
    } catch (error) {
      if (canRun(epoch)) {
        report(
          error?.message ||
          String(error),
          true
        );
      }
    } finally {
      // 只关闭脚本自己打开的菜单。
      await closeMenus(epoch);

      state.running = false;

      if (state.requested) {
        state.requested = false;

        schedule(350);
      } else if (
        canRun(epoch) &&
        !state.done &&
        state.attempts < 3
      ) {
        schedule(800);
      } else if (
        canRun(epoch) &&
        !state.done
      ) {
        report(
          '自动设置未完成；请检查当前 ChatGPT 模型菜单结构。',
          true
        );
      }
    }
  }

  // ============================================================
  // 调度
  // ============================================================

  function schedule(
    delay = 650
  ) {
    clearTimeout(
      state.timer
    );

    state.timer =
      setTimeout(
        apply,
        delay
      );
  }

  function reset() {
    state.epoch += 1;

    state.done = false;
    state.attempts = 0;
    state.interacted = false;

    state.menuEpoch = null;
    state.menuRoots = [];

    clearTimeout(
      state.timer
    );

    if (newChat()) {
      schedule();
    }
  }

  // ============================================================
  // SPA 页面导航检测
  // ============================================================

  setInterval(() => {
    if (
      location.href !==
      state.url
    ) {
      state.url =
        location.href;

      reset();
    }
  }, 400);

  // ============================================================
  // 用户接管保护
  // ============================================================

  function newChatControl(target) {
    const el =
      target instanceof Element
        ? target.closest(
            'a,button,[role="button"]'
          )
        : null;

    if (!el) {
      return false;
    }

    const name =
      clean(
        el.getAttribute(
          'aria-label'
        ) ||
        text(el)
      );

    const href =
      el.getAttribute(
        'href'
      ) || '';

    return (
      /^(?:new chat|新建对话|新聊天|新建聊天)$/i
        .test(name) ||

      /^(?:\/|\/new\/?)(?:\?|$)/
        .test(href) ||

      el.getAttribute(
        'data-testid'
      ) === 'new-chat-button'
    );
  }

  function yieldToUser(event) {
    // 脚本制造的事件 isTrusted=false，
    // 不会导致自己中止自己。
    if (
      !event.isTrusted ||
      !newChat()
    ) {
      return;
    }

    state.interacted = true;

    clearTimeout(
      state.timer
    );

    report(
      '检测到用户操作，停止自动控制页面'
    );
  }

  document.addEventListener(
    'pointerdown',
    event => {
      if (
        !newChatControl(
          event.target
        )
      ) {
        yieldToUser(event);
      }
    },
    true
  );

  document.addEventListener(
    'click',
    event => {
      if (!event.isTrusted) {
        return;
      }

      if (
        newChatControl(
          event.target
        )
      ) {
        reset();
      }
    },
    true
  );

  document.addEventListener(
    'keydown',
    event => {
      const editor =
        composer();

      const target =
        event.target;

      if (
        target === editor ||
        editor?.contains(target) ||

        (
          target instanceof Element &&
          (
            target.closest(POPUP) ||
            target === picker()
          )
        )
      ) {
        yieldToUser(event);
      }
    },
    true
  );

  document.addEventListener(
    'input',
    event => {
      const editor =
        composer();

      if (
        event.target === editor ||
        editor?.contains(
          event.target
        )
      ) {
        yieldToUser(event);
      }
    },
    true
  );

  document.addEventListener(
    'visibilitychange',
    () => {
      if (
        document.visibilityState === 'visible' &&
        !state.done &&
        !state.interacted &&
        newChat()
      ) {
        schedule(350);
      }
    }
  );

  // ============================================================
  // 启动
  // ============================================================

  report(
    '快速版已加载，仅运行于 chatgpt.com'
  );

  schedule(700);

  // ============================================================
  // 日志
  // ============================================================

  function report(
    message,
    error = false
  ) {
    const prefix =
      `[ChatGPT 5.6 Sol High v${VERSION}]`;

    if (error) {
      console.warn(
        prefix,
        message
      );
    } else {
      console.info(
        prefix,
        message
      );
    }
  }
})();