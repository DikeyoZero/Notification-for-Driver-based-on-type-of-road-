/*
 * support.js - trình dựng giao diện tối giản cho các file *.dc.html của VisionDrive AI.
 * Giúp Landing.dc.html và Main.dc.html chạy trực tiếp trong trình duyệt, không cần công cụ Design.
 * Hỗ trợ: <x-dc>, <helmet>, {{đường.dẫn}}, <sc-if value>, <sc-for list as>, onClick, onChange,
 * DCLogic (state, setState, props, renderVals, componentDidMount, componentWillUnmount).
 */
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  /* ---------- DCLogic ---------- */
  function DCLogic(props) {
    this.props = props || {};
    this.__mounted = false;
  }
  DCLogic.prototype.setState = function (patch) {
    var p = typeof patch === 'function' ? patch(this.state, this.props) : patch;
    if (p) this.state = Object.assign({}, this.state, p);
    if (this.__schedule) this.__schedule();
  };
  window.DCLogic = DCLogic;

  /* ---------- biên dịch mẫu ---------- */
  function parseParts(str) {
    var out = [], re = /\{\{\s*([^}]*?)\s*\}\}/g, last = 0, m;
    while ((m = re.exec(str))) {
      if (m.index > last) out.push(str.slice(last, m.index));
      out.push({ p: m[1] });
      last = re.lastIndex;
    }
    if (last < str.length) out.push(str.slice(last));
    return out;
  }

  function lookup(scope, path) {
    if (path === '' ) return undefined;
    var segs = path.split('.');
    var v = scope[segs[0]];
    for (var i = 1; i < segs.length; i++) {
      if (v === null || v === undefined) return undefined;
      v = v[segs[i]];
    }
    return v;
  }

  function evalParts(parts, scope) {
    if (parts.length === 1 && typeof parts[0] === 'object') return lookup(scope, parts[0].p);
    var s = '';
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (typeof p === 'string') s += p;
      else {
        var v = lookup(scope, p.p);
        s += (v === null || v === undefined || v === false) ? '' : String(v);
      }
    }
    return s;
  }

  function compileNode(node) {
    if (node.nodeType === 3) {
      var txt = node.nodeValue;
      if (!/\S/.test(txt)) return null;
      return { k: 'text', parts: parseParts(txt) };
    }
    if (node.nodeType !== 1) return null;
    var tag = node.tagName.toLowerCase();
    if (tag === 'script' && node.hasAttribute('data-dc-script')) return null;
    var kids = compileChildren(node);
    if (tag === 'sc-if') {
      return { k: 'if', test: parseParts(node.getAttribute('value') || ''), kids: kids };
    }
    if (tag === 'sc-for') {
      return { k: 'for', list: parseParts(node.getAttribute('list') || ''), as: node.getAttribute('as') || 'item', kids: kids };
    }
    var attrs = [];
    for (var i = 0; i < node.attributes.length; i++) {
      var a = node.attributes[i];
      attrs.push({ n: a.name, parts: parseParts(a.value) });
    }
    return { k: 'el', tag: tag, ns: node.namespaceURI === SVG_NS ? SVG_NS : null, attrs: attrs, kids: kids };
  }

  function compileChildren(parent) {
    var out = [], c = parent.childNodes;
    for (var i = 0; i < c.length; i++) {
      var n = compileNode(c[i]);
      if (n) out.push(n);
    }
    return out;
  }

  /* ---------- mở rộng mẫu thành cây ảo ---------- */
  function expand(nodes, scope, out) {
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.k === 'text') {
        var v = evalParts(n.parts, scope);
        out.push({ t: 'text', s: (v === null || v === undefined || v === false) ? '' : String(v) });
      } else if (n.k === 'if') {
        if (evalParts(n.test, scope)) expand(n.kids, scope, out);
      } else if (n.k === 'for') {
        var list = evalParts(n.list, scope);
        if (list && list.length) {
          for (var j = 0; j < list.length; j++) {
            var child = Object.create(scope);
            child[n.as] = list[j];
            child.index = j;
            expand(n.kids, child, out);
          }
        }
      } else {
        var attrs = {}, ev = {};
        for (var k = 0; k < n.attrs.length; k++) {
          var a = n.attrs[k];
          var name = a.n;
          if (name.indexOf('hint-') === 0) continue;
          var val = evalParts(a.parts, scope);
          if (/^on[a-z]+$/.test(name)) {
            var evName = name.slice(2);
            if (evName === 'change' && (n.tag === 'input' && !(/file|checkbox|radio/.test(attrsType(n, scope))))) evName = 'input';
            if (typeof val === 'function') ev[evName] = val;
          } else {
            attrs[name] = val;
          }
        }
        var vkids = [];
        expand(n.kids, scope, vkids);
        out.push({ t: 'el', tag: n.tag, ns: n.ns, attrs: attrs, ev: ev, kids: vkids });
      }
    }
  }

  function attrsType(n, scope) {
    for (var i = 0; i < n.attrs.length; i++) if (n.attrs[i].n === 'type') return String(evalParts(n.attrs[i].parts, scope) || '');
    return '';
  }

  /* ---------- áp dụng lên DOM ---------- */
  var BOOL = { disabled: 1, checked: 1, hidden: 1, selected: 1, readonly: 1, multiple: 1, required: 1, autoplay: 1, muted: 1, loop: 1, controls: 1, playsinline: 1 };

  function setAttr(el, name, val, prev) {
    if (prev && prev[name] === val) return;
    if (val === false || val === null || val === undefined) {
      el.removeAttribute(name);
      if (name === 'value' && 'value' in el) { try { el.value = ''; } catch (e) {} }
      return;
    }
    if (name === 'value' && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) {
      if (String(el.value) !== String(val)) el.value = val;
      return;
    }
    if (val === true) { el.setAttribute(name, BOOL[name] ? '' : 'true'); return; }
    el.setAttribute(name, String(val));
  }

  function applyEl(el, v) {
    var prev = el.__a || {};
    var k;
    for (k in v.attrs) setAttr(el, k, v.attrs[k], prev);
    for (k in prev) if (!(k in v.attrs)) el.removeAttribute(k);
    el.__a = v.attrs;
    var h = el.__h || (el.__h = {});
    for (k in v.ev) {
      if (!h[k]) {
        (function (name) {
          el.addEventListener(name, function (e) { var f = el.__h[name]; if (f) f.call(el, e); });
        })(k);
      }
      h[k] = v.ev[k];
    }
    for (k in h) if (!(k in v.ev)) h[k] = null;
  }

  function create(v) {
    if (v.t === 'text') return document.createTextNode(v.s);
    var el = v.ns ? document.createElementNS(v.ns, v.tag) : document.createElement(v.tag);
    applyEl(el, v);
    patchChildren(el, v.kids);
    return el;
  }

  function same(dom, v) {
    if (v.t === 'text') return dom.nodeType === 3;
    return dom.nodeType === 1 && dom.tagName.toLowerCase() === v.tag.toLowerCase() && (dom.namespaceURI === SVG_NS) === !!v.ns;
  }

  function patchChildren(parent, vkids) {
    var i;
    for (i = 0; i < vkids.length; i++) {
      var v = vkids[i], dom = parent.childNodes[i];
      if (!dom) { parent.appendChild(create(v)); continue; }
      if (!same(dom, v)) { parent.replaceChild(create(v), dom); continue; }
      if (v.t === 'text') { if (dom.nodeValue !== v.s) dom.nodeValue = v.s; }
      else { applyEl(dom, v); patchChildren(dom, v.kids); }
    }
    while (parent.childNodes.length > vkids.length) parent.removeChild(parent.lastChild);
  }

  /* ---------- khởi chạy ---------- */
  function boot() {
    var host = document.querySelector('x-dc');
    if (!host) return;

    var helmet = host.querySelector('helmet');
    if (helmet) {
      Array.prototype.slice.call(helmet.children).forEach(function (n) { document.head.appendChild(n); });
      helmet.parentNode.removeChild(helmet);
    }

    var tpl = compileChildren(host);
    var scriptEl = document.querySelector('script[data-dc-script]');
    var props = {};
    if (scriptEl) {
      try {
        var cfg = JSON.parse(scriptEl.getAttribute('data-props') || '{}');
        Object.keys(cfg).forEach(function (k) {
          if (k.charAt(0) === '$') return;
          var c = cfg[k];
          props[k] = (c && typeof c === 'object' && 'default' in c) ? c.default : c;
        });
      } catch (e) { /* bỏ qua cấu hình lỗi */ }
    }

    var Component;
    try {
      Component = new Function('DCLogic', (scriptEl ? scriptEl.textContent : '') + '\n;return Component;')(DCLogic);
    } catch (e) {
      console.error('[support.js] Lỗi nạp script của trang:', e);
      return;
    }

    var root = document.createElement('div');
    root.id = 'dc-root';
    host.parentNode.insertBefore(root, host);
    host.parentNode.removeChild(host);

    var inst = new Component(props);
    inst.props = props;
    var queued = false;

    function render() {
      queued = false;
      var vals = inst.renderVals ? inst.renderVals() : {};
      var scope = Object.create(vals);
      var out = [];
      expand(tpl, scope, out);
      patchChildren(root, out);
    }
    inst.__schedule = function () {
      if (queued) return;
      queued = true;
      Promise.resolve().then(render);
    };

    render();
    if (inst.componentDidMount) inst.componentDidMount();
    window.addEventListener('pagehide', function () { if (inst.componentWillUnmount) inst.componentWillUnmount(); });
    window.__dc = inst;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
