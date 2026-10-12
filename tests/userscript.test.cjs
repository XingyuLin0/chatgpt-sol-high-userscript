'use strict';

// Offline behavioral fixture for the published userscript. It models only the
// DOM controls touched by the script; it does not claim to emulate ChatGPT.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'chatgpt-5.6-sol-high.user.js'),
  'utf8',
);

function fixture(config = {}) {
  const timers = new Set();
  const listeners = new Map();
  const events = [];
  const output = [];
  const ui = {
    model: config.model || 'GPT-6 Sol',
    effort: config.effort || 'Medium',
    menusOpened: 0,
    modelOptionsRendered: 0,
    modelOptionClicks: 0,
    effortKeyEvents: [],
    userTookOver: false,
  };
  let document;
  let body;
  let hit = null;

  const scaledTimeout = (fn, ms = 0) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, Math.max(0, ms / 30));
    timers.add(timer);
    return timer;
  };

  function matches(el, selector) {
    return selector.split(',').some((raw) => {
      const part = raw.trim();
      if (part.startsWith('#')) return el.getAttribute('id') === part.slice(1);
      const tag = part.match(/^[a-z]+/i)?.[0];
      if (tag && tag.toLowerCase() !== el.tagName.toLowerCase()) return false;
      for (const match of part.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)) {
        if (!el.hasAttribute(match[1])) return false;
        if (match[2] !== undefined && el.getAttribute(match[1]) !== match[2]) return false;
      }
      return !!tag || part.startsWith('[');
    });
  }

  class Element {
    constructor(tag, attrs = {}, label = '') {
      this.tagName = tag.toUpperCase();
      this.attrs = { ...attrs };
      this.innerText = label;
      this.textContent = label;
      this.children = [];
      this.parentElement = null;
      this.isConnected = true;
      this.disabled = false;
      this.style = { display: 'block', visibility: 'visible', opacity: '1' };
    }
    getAttribute(name) { return this.attrs[name] ?? null; }
    hasAttribute(name) { return Object.hasOwn(this.attrs, name); }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    removeAttribute(name) { delete this.attrs[name]; }
    append(...children) {
      for (const child of children) {
        child.parentElement = this;
        this.children.push(child);
      }
      return this;
    }
    querySelectorAll(selector) {
      return this.children.flatMap((child) => [
        ...(matches(child, selector) ? [child] : []),
        ...child.querySelectorAll(selector),
      ]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) {
      return matches(this, selector) ? this : this.parentElement?.closest(selector) || null;
    }
    contains(child) { return this === child || this.children.some((el) => el.contains(child)); }
    getBoundingClientRect() {
      hit = this;
      return { left: 0, top: 0, right: 100, bottom: 30, width: 100, height: 30 };
    }
    scrollIntoView() {}
    focus() { document.activeElement = this; }
    dispatchEvent(event) {
      events.push([this.innerText || this.getAttribute('aria-label') || this.tagName, event.type, event.key]);
      if (event.type === 'keydown' && event.key === 'Escape') closeMenus();
      this.onEvent?.(event);
      return true;
    }
  }

  class HTMLInputElement extends Element {
    constructor(attrs = {}) {
      super('input', attrs);
      this.type = attrs.type;
      this.min = '0';
      this.max = '5';
      this.step = '1';
      this._value = '0';
    }
    get value() { return this._value; }
    set value(value) {
      this._value = String(Math.min(Number(this.max), Math.max(Number(this.min), Number(value))));
    }
  }

  class Event {
    constructor(type, fields = {}) {
      this.type = type;
      this.isTrusted = false;
      Object.assign(this, fields);
    }
  }

  const row = (name, attrs = {}) => new Element('div', { role: 'menuitem', ...attrs }, name);
  const closeMenus = () => {
    const detach = (el) => {
      el.isConnected = false;
      for (const child of el.children) detach(child);
    };
    for (const root of body.querySelectorAll('[role="menu"]')) detach(root);
  };

  const picker = new Element('button', {
    'data-testid': 'model-switcher',
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
  }, `${ui.model}\n${ui.effort}`);
  const editor = new Element('div', { id: 'prompt-textarea', contenteditable: 'true' });
  const form = new Element('form').append(editor, picker);
  body = new Element('body').append(form);

  function addEffortSlider(root) {
    const levels = config.levels || ['Low', 'Medium', 'High', 'Extra High', 'Max'];
    const rowControl = row('Medium', {
      'data-reasoning-slider': 'true',
      'aria-keyshortcuts': 'ArrowLeft ArrowRight',
    });
    const slider = new Element('span', { role: 'slider', 'aria-valuetext': ui.effort });
    rowControl.append(slider);
    rowControl.innerText = rowControl.textContent = ui.effort;
    rowControl.onEvent = (event) => {
      if (event.type !== 'keydown' || !/^Arrow/.test(event.key)) return;
      ui.effortKeyEvents.push(event.key);
      let index = levels.indexOf(ui.effort);
      index = Math.max(0, Math.min(levels.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)));
      ui.effort = levels[index];
      rowControl.innerText = rowControl.textContent = ui.effort;
      slider.setAttribute('aria-valuetext', ui.effort);
      picker.innerText = picker.textContent = `${ui.model}\n${ui.effort}`;
      if (config.takeoverOnFirstEffortKey && !ui.userTookOver) {
        ui.userTookOver = true;
        for (const handler of listeners.get('pointerdown') || []) {
          handler({ isTrusted: true, target: editor });
        }
      }
    };
    root.append(rowControl);
  }

  function renderRootMenu() {
    closeMenus();
    const root = new Element('div', { role: 'menu' });
    body.append(root);
    ui.menusOpened += 1;

    if (config.missingModel) {
      ui.modelOptionsRendered += 1;
      for (const name of ['GPT-6 Sol', 'GPT-5.6 Luna']) {
        root.append(row(name, { role: 'menuitemradio', 'aria-checked': String(ui.model === name) }));
      }
    } else if (ui.model !== 'GPT-5.6 Sol' && config.modelSelection) {
      ui.modelOptionsRendered += 1;
      for (const name of ['GPT-6 Sol', 'GPT-5.6 Luna', 'GPT-5.6 Sol']) {
        const option = row(name, { role: 'menuitemradio', 'aria-checked': String(ui.model === name) });
        option.onEvent = (event) => {
          if (event.type !== 'click') return;
          ui.modelOptionClicks += 1;
          ui.model = name;
          picker.innerText = picker.textContent = `${ui.model}\n${ui.effort}`;
          closeMenus();
          if (config.takeoverOnModelSelect) {
            ui.userTookOver = true;
            for (const handler of listeners.get('pointerdown') || []) {
              handler({ isTrusted: true, target: editor });
            }
          }
        };
        root.append(option);
      }
    }

    if (config.directHighOptions) {
      const choices = config.noExactHigh
        ? ['Medium', 'Extra High']
        : ['Medium', 'High', 'Extra High'];
      for (const name of choices) {
        const option = row(name, {
          role: 'menuitemradio',
          'aria-checked': String(ui.effort === name),
        });
        option.onEvent = (event) => {
          if (event.type !== 'click') return;
          ui.effort = name;
          for (const sibling of root.querySelectorAll('[role="menuitemradio"]')) {
            sibling.setAttribute('aria-checked', String(sibling === option));
          }
        };
        root.append(option);
      }
    } else {
      addEffortSlider(root);
    }
    picker.setAttribute('aria-expanded', 'true');
  }

  picker.onEvent = (event) => {
    if (event.type === 'keydown' && event.key === 'Enter') renderRootMenu();
    if (event.type === 'keydown' && event.key === 'Escape') closeMenus();
  };

  document = {
    body,
    documentElement: body,
    activeElement: body,
    visibilityState: 'visible',
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    elementFromPoint: () => hit,
    getElementById(id) {
      return [body, ...body.querySelectorAll('[role="menu"]')]
        .flatMap((root) => [root, ...root.querySelectorAll('*')])
        .find((el) => el.getAttribute('id') === id) || null;
    },
    querySelectorAll(selector) {
      return [
        ...(matches(body, selector) ? [body] : []),
        ...body.querySelectorAll(selector),
      ];
    },
  };

  const sandbox = {
    document,
    location: { href: 'https://chatgpt.com/', pathname: '/' },
    Element,
    HTMLInputElement,
    Event,
    KeyboardEvent: Event,
    MouseEvent: Event,
    PointerEvent: Event,
    getComputedStyle: (el) => el.style,
    setTimeout: scaledTimeout,
    clearTimeout(timer) {
      clearTimeout(timer);
      timers.delete(timer);
    },
    setInterval: () => 0,
    console: {
      info: (...args) => output.push(args.join(' ')),
      warn: (...args) => output.push(args.join(' ')),
    },
  };
  sandbox.window = sandbox;

  const start = '  schedule(700);';
  assert.equal(source.split(start).length - 1, 1, 'test hook must match the published 1.5.0 startup');
  const instrumented = source.replace(start, '  window.testApi = { apply, state, isModel, isHigh };');
  vm.runInNewContext(instrumented, sandbox, { filename: 'chatgpt-5.6-sol-high.user.js' });

  return {
    api: sandbox.testApi,
    ui,
    output,
    events,
    cleanup() { for (const timer of timers) clearTimeout(timer); },
  };
}

async function run(config, verify) {
  const f = fixture(config);
  try {
    await f.api.apply();
    verify(f);
  } finally {
    f.cleanup();
  }
}

test('only the exact GPT-5.6 Sol model and exact High effort qualify', () => {
  const f = fixture();
  try {
    assert.equal(f.api.isModel('GPT‑5.6 Sol'), true);
    for (const name of ['GPT-6 Sol', 'GPT-5.6 Luna', 'GPT-5.6 Terra', 'GPT-5.6']) {
      assert.equal(f.api.isModel(name), false);
    }
    assert.equal(f.api.isHigh('High'), true);
    assert.equal(f.api.isHigh('高'), true);
    for (const name of ['Extra High', 'Max', 'Ultra']) assert.equal(f.api.isHigh(name), false);
  } finally {
    f.cleanup();
  }
});

test('already selected Sol skips model-list selection and moves Medium to exact High', async () => run({
  model: 'GPT-5.6 Sol',
  effort: 'Medium',
}, (f) => {
  assert.equal(f.ui.modelOptionsRendered, 0);
  assert.equal(f.ui.modelOptionClicks, 0);
  assert.deepEqual(f.ui.effortKeyEvents, ['ArrowRight']);
  assert.equal(f.ui.effort, 'High');
  assert.equal(f.api.state.done, true);
  assert.ok(f.output.some((line) => line.includes('当前已经是 GPT-5.6 Sol，跳过模型选择')));
  assert.ok(f.output.some((line) => line.includes('完成：GPT-5.6 Sol + High')));
}));

test('selects Sol when needed, then sets High through the current effort slider', async () => run({
  modelSelection: true,
  effort: 'Medium',
}, (f) => {
  assert.equal(f.ui.model, 'GPT-5.6 Sol');
  assert.equal(f.ui.modelOptionClicks, 1);
  assert.equal(f.ui.effort, 'High');
  assert.equal(f.api.state.done, true);
  assert.deepEqual(f.ui.effortKeyEvents, ['ArrowRight']);
}));

test('a missing target model does not report completion from High alone', async () => run({
  missingModel: true,
  effort: 'High',
}, (f) => {
  assert.equal(f.ui.model, 'GPT-6 Sol');
  assert.equal(f.ui.modelOptionsRendered, 1);
  assert.equal(f.ui.modelOptionClicks, 0);
  assert.equal(f.api.state.done, false);
  assert.ok(f.output.some((line) => line.includes('菜单中未找到可用的 GPT-5.6 Sol')));
  assert.equal(f.output.some((line) => line.includes('完成：GPT-5.6 Sol + High')), false);
}));

test('user takeover during model selection stops the later effort change', async () => run({
  modelSelection: true,
  takeoverOnModelSelect: true,
  effort: 'Medium',
}, (f) => {
  assert.equal(f.ui.userTookOver, true);
  assert.equal(f.ui.model, 'GPT-5.6 Sol');
  assert.equal(f.ui.effort, 'Medium');
  assert.equal(f.ui.effortKeyEvents.length, 0);
  assert.equal(f.api.state.done, false);
  assert.equal(f.output.some((line) => line.includes('完成：GPT-5.6 Sol + High')), false);
}));

test('already High remains unchanged and does not send slider keys', async () => run({
  model: 'GPT-5.6 Sol',
  effort: 'High',
}, (f) => {
  assert.equal(f.ui.modelOptionsRendered, 0);
  assert.equal(f.ui.effort, 'High');
  assert.equal(f.ui.effortKeyEvents.length, 0);
  assert.equal(f.api.state.done, true);
  assert.ok(f.output.some((line) => line.includes('当前已经是 High，跳过强度修改')));
}));

test('selects the exact High menu option and verifies its selected state', async () => run({
  model: 'GPT-5.6 Sol',
  effort: 'Medium',
  directHighOptions: true,
}, (f) => {
  assert.equal(f.ui.effort, 'High');
  assert.equal(f.api.state.done, true);
  assert.ok(f.output.some((line) => line.includes('已选择 High')));
}));

test('Extra High alone is not accepted as High', async () => run({
  model: 'GPT-5.6 Sol',
  effort: 'Extra High',
  directHighOptions: true,
  noExactHigh: true,
}, (f) => {
  assert.equal(f.ui.effort, 'Extra High');
  assert.equal(f.api.state.done, false);
  assert.equal(f.output.some((line) => line.includes('完成：GPT-5.6 Sol + High')), false);
}));

test('a slider without an exact High restores its original effort and reports incomplete', async () => run({
  model: 'GPT-5.6 Sol',
  effort: 'Medium',
  levels: ['Low', 'Medium', 'Extra High', 'Max'],
}, (f) => {
  assert.equal(f.ui.effort, 'Medium');
  assert.deepEqual(f.ui.effortKeyEvents, ['ArrowRight', 'ArrowLeft']);
  assert.equal(f.api.state.done, false);
  assert.equal(f.output.some((line) => line.includes('完成：GPT-5.6 Sol + High')), false);
}));
