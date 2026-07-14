/**
 * @fileoverview Field bridge — emits the list of bindable fields for the
 * currently selected repeater block to the parent Angular app via postMessage.
 *
 * The parent (app.ts / app.html) renders the actual field chips inside its
 * existing properties side panel. This module only computes the list and
 * notifies the parent when the selection changes.
 *
 * Nested-repeat scoping
 * ---------------------
 * When the selected block sits *inside* one or more ancestor repeaters, the
 * suggested expressions are written relative to the innermost ancestor alias:
 *
 *   {% for visit in mainContent.visitDetails %}
 *     {% for feedback in visit.arriveOnSiteFeedback %}
 *       {{ feedback.answer }}          ← scope = feedback (innermost)
 *     {% endfor %}
 *   {% endfor %}
 *
 * Nested arrays found inside the alias scope (e.g. `arriveOnSiteFeedback` inside
 * each `visit`) are exposed as `kind: 'array'` rows so the parent UI can offer
 * them as binding targets for a child repeater.
 *
 * Message contract:
 *   { source: 'custom-form-twig', type: 'fields:available',
 *     data: { repeatPath, repeatAlias, fields: [{key, kind, expr, arrayPath?}, ...] } }
 *   { source: 'custom-form-twig', type: 'fields:cleared' }
 */
(function () {
  window.FlowCanvas = window.FlowCanvas || {};

  // -------------------------------------------------------------------------
  // Binding-data lookup (read from parent window)
  // -------------------------------------------------------------------------
  const getBindingData = () => {
    try {
      const getter = window.parent?.__BROCHURE_FLOW_GET_BINDING_DATA__;
      if (typeof getter === 'function') return getter();
      return window.parent?.__BROCHURE_FLOW_BINDING_DATA__ ?? null;
    } catch (e) { return null; }
  };

  const resolvePath = (data, path) => {
    if (!data || !path) return undefined;
    const parts = path.split('.');
    let cur = data;
    for (const p of parts) {
      if (cur == null) return undefined;
      cur = cur[p];
    }
    return cur;
  };

  // From an array, sample the first item — that is what we use to infer the
  // shape of each iteration.
  const sampleItem = (arr) => (Array.isArray(arr) && arr.length > 0) ? arr[0] : null;

  // For a given sample object, return scalar fields and nested-array fields
  // separately. The scope is the alias the parent {% for %} introduces so all
  // returned `expr` values are alias-relative.
  const buildFieldsForScope = (sample, alias) => {
    if (!sample || typeof sample !== 'object') return [];
    return Object.keys(sample).map((key) => {
      const value = sample[key];
      const kind = Array.isArray(value)
        ? 'array'
        : (value !== null && typeof value === 'object') ? 'object' : 'value';

      const out = { key, kind, expr: `{{ ${alias}.${key} }}` };

      if (kind === 'array') {
        out.arrayPath = `${alias}.${key}`;
        out.count = value.length;
        const inner = sampleItem(value);
        out.preview = inner && typeof inner === 'object'
          ? Object.keys(inner).slice(0, 3).join(', ')
          : '';
      }
      return out;
    });
  };

  // -------------------------------------------------------------------------
  // Ancestor-repeater chain.
  //
  // Walks UP from a selected block collecting EVERY ancestor that carries a
  // `data-repeat-path`. The innermost (closest to the selection) becomes the
  // active scope; the rest let us resolve nested-alias paths against real
  // sample data.
  // -------------------------------------------------------------------------
  // Walk UP from a block, collecting every ancestor repeater's chain. A block
  // can carry either a single binding (data-repeat-path + -alias) OR a full
  // multi-level chain (data-repeat-chain = JSON). The multi-level form expands
  // into multiple chain entries, so a child block dropped inside sees ALL the
  // alias namespaces its parent introduces.
  const parseChainAttr = (json) => {
    if (!json) return null;
    try {
      const parsed = JSON.parse(json);
      if (!Array.isArray(parsed)) return null;
      return parsed.filter((s) => s && s.path && s.alias);
    } catch (e) { return null; }
  };

  const findRepeaterChain = (block) => {
    const chain = [];
    if (!block) return chain;
    let cur = block;
    while (cur) {
      const multi = parseChainAttr(cur.dataset?.repeatChain);
      if (multi && multi.length) {
        // Push in reverse so the final chain.reverse() below restores the
        // outermost-first order. Spread each step so extra fields like
        // `kind: 'map'` and `keyAlias` survive — the chain resolver and
        // twig generator both need them.
        for (let i = multi.length - 1; i >= 0; i--) {
          chain.push({ ...multi[i] });
        }
      } else if (cur.dataset?.repeatPath) {
        chain.push({
          path: cur.dataset.repeatPath,
          alias: cur.dataset.repeatAlias || 'item'
        });
      }
      if (cur.matches?.('.cs_margin, .cs-flow-canvas') || cur.tagName === 'BODY') break;
      cur = cur.parentElement;
    }
    // chain is currently innermost-first; reverse to outermost-first, then
    // dedupe steps whose path was already seen. Modal-saved chains on a
    // child block typically include the same outer loops their ancestor
    // section also carries — without dedup, resolveChainSample iterates
    // the same array twice which works but is wasteful.
    const reversed = chain.reverse();
    const seen = new Set();
    const out = [];
    for (const step of reversed) {
      if (seen.has(step.path)) continue;
      seen.add(step.path);
      out.push(step);
    }
    return out;
  };

  // Given a repeater chain like
  //   [{ path: 'mainContent.visitDetails', alias: 'visit' },
  //    { path: 'visit.arriveOnSiteFeedback', alias: 'feedback' }]
  // resolve the chain against real binding data and return the sample item
  // representing one iteration of the innermost loop.
  const resolveChainSample = (chain, bindingData) => {
    if (!chain.length) return null;

    let sample = null;
    let arr = null;
    const aliasNamespace = {};

    for (const step of chain) {
      const path = step.path;
      const firstSegment = path.split('.')[0];
      let base;
      let remainder;
      if (Object.prototype.hasOwnProperty.call(aliasNamespace, firstSegment)) {
        base = aliasNamespace[firstSegment];
        remainder = path.slice(firstSegment.length + 1);
      } else {
        base = bindingData;
        remainder = path;
      }

      arr = remainder ? resolvePath(base, remainder) : base;
      // Map step: the path resolves to a date-keyed object whose values
      // are arrays. The "sample" of one iteration is the FIRST value
      // (an array of labour items), which the next step will then
      // sample further.
      if (step.kind === 'map' && arr && typeof arr === 'object' && !Array.isArray(arr)) {
        const firstKey = Object.keys(arr)[0];
        sample = firstKey != null ? arr[firstKey] : null;
      } else {
        sample = sampleItem(arr);
      }
      if (!sample) return null;
      aliasNamespace[step.alias] = sample;
    }

    return sample;
  };

  // -------------------------------------------------------------------------
  // Message helpers
  // -------------------------------------------------------------------------
  let lastSentKey = null;

  const sendFields = (chain) => {
    const innermost = chain[chain.length - 1];
    const data = getBindingData();
    const sample = resolveChainSample(chain, data);

    // Map-step terminus: the innermost saved step iterates a date-keyed
    // object whose values are arrays. Field chips for "an array" would
    // just be numeric indices, which isn't useful — what the user
    // actually wants is the shape of one labour item. So when the
    // resolved sample is an Array, we sample its first item for fields
    // and report the alias unchanged (the same alias they'd use in the
    // implicit inner loop).
    let displaySample = sample;
    if (Array.isArray(sample)) {
      displaySample = sample.length ? sample[0] : null;
    }

    const fields = displaySample ? buildFieldsForScope(displaySample, innermost.alias) : [];

    // Map steps (eg. labourTimeDetails.date → { "07/05/2026": [...] }) iterate
    // `key, value` pairs. The KEY (the date string) is itself a value the user
    // wants to show — typically the date header row. buildFieldsForScope only
    // walks the inner item's fields, so the key alias would otherwise be
    // unbindable and users fall back to a wrong hardcoded path. Surface each
    // map step's keyAlias as its own `{{ dateValue }}` chip, outermost first so
    // it reads above the item fields.
    chain.forEach((step) => {
      if (step.kind === 'map' && step.keyAlias) {
        fields.unshift({ key: step.keyAlias, kind: 'value', expr: `{{ ${step.keyAlias} }}` });
      }
    });

    const key = `${innermost.path}::${innermost.alias}::${fields.length}::${chain.length}`;
    if (key === lastSentKey) return;
    lastSentKey = key;

    try {
      window.parent?.postMessage({
        source: 'custom-form-twig',
        type: 'fields:available',
        data: {
          repeatPath: innermost.path,
          repeatAlias: innermost.alias,
          fields,
          ancestorChain: chain
        }
      }, '*');
    } catch (e) { /* ignore */ }
  };

  const sendCleared = () => {
    if (lastSentKey === null) return;
    lastSentKey = null;
    try {
      window.parent?.postMessage({
        source: 'custom-form-twig',
        type: 'fields:cleared'
      }, '*');
    } catch (e) { /* ignore */ }
  };

  // -------------------------------------------------------------------------
  // Selection watcher
  // -------------------------------------------------------------------------
  const checkSelection = () => {
    const selected = document.querySelector(
      '.cs-flow-canvas .cs_block_s.cs-selected, ' +
      '.cs-flow-canvas .cs_block_s.cs-editing'
    );
    const chain = findRepeaterChain(selected);
    if (chain.length) {
      sendFields(chain);
    } else if (selected) {
      // Block is selected but not inside a repeater — show root-level variables
      const bindingData = getBindingData();
      if (bindingData && typeof bindingData === 'object') {
        const rootFields = buildFieldsForScope(bindingData, 'mainContent');
        const key = `root::mainContent::${rootFields.length}::0`;
        if (key !== lastSentKey) {
          lastSentKey = key;
          try {
            window.parent?.postMessage({
              source: 'custom-form-twig',
              type: 'fields:available',
              data: {
                repeatPath: '',
                repeatAlias: 'mainContent',
                fields: rootFields,
                ancestorChain: []
              }
            }, '*');
          } catch (e) { /* ignore */ }
        }
      }
    } else {
      sendCleared();
    }
  };

  window.FlowCanvas.initFieldPanel = function (canvas) {
    const observer = new MutationObserver(() => {
      requestAnimationFrame(checkSelection);
    });
    observer.observe(canvas, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'data-repeat-path', 'data-repeat-alias']
    });
    checkSelection();
  };

  // -------------------------------------------------------------------------
  // Tree builder for the binding modal — walks every array reachable from a
  // starting scope, including arrays nested inside other arrays, and emits
  // indented rows. Each row carries the *full chain* needed to reproduce that
  // path at runtime so the twig generator can wrap the block in multiple
  // {% for %} loops.
  //
  // Each row shape:
  //   {
  //     path: 'visit.arriveOnSiteFeedback',     // display path (relative to scope)
  //     fullPath: 'mainContent.visitDetails[0].arriveOnSiteFeedback', // for debug
  //     count: 5,
  //     preview: 'name, answered, answer',
  //     depth: 1,                                // 0 = top-level item under scope
  //     chain: [                                 // every for-loop needed to reach here
  //       { path: 'mainContent.visitDetails', alias: 'visit' },
  //       { path: 'visit.arriveOnSiteFeedback', alias: '__leaf__' }  // alias replaced on apply
  //     ],
  //     scope: 'root' | 'ancestor'
  //   }
  //
  // `seedChain` lets the caller prefix every emitted row with parent for-loops
  // that already exist (when scoping from an ancestor section).
  // -------------------------------------------------------------------------
  const defaultAliasFor = (key, depth) => {
    // Heuristic singularize: drop trailing 's' / 'es' / 'ies'. Falls back to
    // the original key if nothing matches. Aliases are only PLACEHOLDERS —
    // the user can rename the leaf alias in the modal; intermediate aliases
    // stay as-is.
    if (!key) return `item${depth}`;
    if (/ies$/i.test(key)) return key.slice(0, -3) + 'y';
    if (/[^aeiou]es$/i.test(key)) return key.slice(0, -2);
    if (/s$/i.test(key) && key.length > 2) return key.slice(0, -1);
    return key;
  };

  // Detect whether an object is a "map of arrays" — i.e. its values are
  // all arrays. This is the shape Twig iterates with
  //   {% for key, list in obj %}
  // For these we emit ONE loopable row (with key+value aliases) plus a
  // child row representing the inner array's items.
  const isMapOfArrays = (obj) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
    const keys = Object.keys(obj);
    if (!keys.length) return false;
    return keys.every((k) => Array.isArray(obj[k]));
  };

  const buildFullArrayTree = (sample, scopeAlias, seedChain, scope) => {
    const rows = [];
    if (!sample || typeof sample !== 'object') return rows;

    // Walk every key. For nested arrays we emit a row and recurse into
    // their sample item. For nested plain objects we DON'T emit a row
    // but still recurse so deeper arrays surface (otherwise dot-paths
    // like `visit.labourTimeDetails.date["..."]` would be invisible).
    // For map-of-arrays objects (date-keyed lists) we emit one row that
    // loops `key, value` pairs, plus a deeper row for the inner array.
    const walk = (obj, pathPrefix, chain, depth, recurseAlias) => {
      Object.keys(obj).forEach((key) => {
        const value = obj[key];
        const relPath = pathPrefix ? `${pathPrefix}.${key}` : key;

        if (Array.isArray(value)) {
          const inner = sampleItem(value);
          const childAlias = defaultAliasFor(key, depth + 1);
          const row = {
            path: relPath,
            count: value.length,
            preview: inner && typeof inner === 'object'
              ? Object.keys(inner).slice(0, 3).join(', ')
              : String(inner ?? ''),
            depth,
            chain: [
              ...chain,
              { path: relPath, alias: childAlias }
            ],
            scope
          };
          rows.push(row);
          if (inner && typeof inner === 'object') {
            walk(inner, childAlias, row.chain, depth + 1, childAlias);
          }
          return;
        }

        if (value && typeof value === 'object') {
          // Map-of-arrays (eg. labourTimeDetails.date) → emit ONE
          // composite loopable row. Selecting it produces TWO nested
          // for-loops in the generated twig: an outer
          //   {% for key, list in path %}
          // pair, plus an inner
          //   {% for item in list %}
          // so the user can immediately bind the inner item's fields
          // without having to pick two rows. The user's "Loop variable
          // name" input edits the INNER alias (the actual row variable
          // they'll reference in cells).
          if (isMapOfArrays(value)) {
            const sampleKey = Object.keys(value)[0];
            const innerArr = value[sampleKey];
            const keyAlias = defaultAliasFor(key + 'Value', depth + 1);
            const valueAlias = defaultAliasFor(key, depth + 1) + 's';
            const innerSample = sampleItem(innerArr);
            const innerAlias = defaultAliasFor(key + 'Item', depth + 2);
            const fullChain = [
              ...chain,
              { path: relPath, alias: valueAlias, keyAlias, kind: 'map' },
              { path: valueAlias, alias: innerAlias },
            ];
            const row = {
              path: relPath,
              count: innerArr.length,
              preview: innerSample && typeof innerSample === 'object'
                ? Object.keys(innerSample).slice(0, 3).join(', ')
                : String(innerSample ?? ''),
              depth,
              chain: fullChain,
              scope,
              kind: 'map'
            };
            rows.push(row);

            if (innerSample && typeof innerSample === 'object') {
              walk(innerSample, innerAlias, fullChain, depth + 1, innerAlias);
            }
            return;
          }

          // Plain nested object — descend without emitting a row.
          walk(value, relPath, chain, depth, recurseAlias);
        }
      });
    };

    walk(sample, scopeAlias, seedChain, 0, scopeAlias);
    return rows;
  };

  // Public utility — also used by custom-form.js to compute scoped arrays for
  // the binding modal when a user is dropping a new repeater inside an existing
  // repeater scope. Walks the ancestor chain ABOVE the dropped block (not
  // including itself), resolves each alias against real binding data, and
  // returns the arrays that exist inside the innermost ancestor's iteration.
  window.FlowCanvas.computeScopedArrays = function (block, bindingData) {
    const ancestor = block?.parentElement || null;
    const chain = findRepeaterChain(ancestor);
    if (!chain.length) return null;

    const innermost = chain[chain.length - 1];
    const sample = resolveChainSample(chain, bindingData);
    if (!sample) return { alias: innermost.alias, arrays: [] };

    // Tree-aware: full nested-array tree relative to the innermost ancestor.
    // Seed chain = the ancestor for-loops that already exist; rows append on
    // top of those so the twig generator can produce the full nested
    // {% for %} stack from a single block.
    const seedChain = chain.map((s) => ({ path: s.path, alias: s.alias }));
    const arrays = buildFullArrayTree(sample, innermost.alias, seedChain, 'ancestor');

    return { alias: innermost.alias, arrays };
  };

  // Build the FULL tree starting from root binding data — used when a block
  // is dropped on the canvas root (no ancestor repeater).
  window.FlowCanvas.buildRootArrayTree = function (bindingData) {
    if (!bindingData || typeof bindingData !== 'object') return [];
    // Walk the object tree looking for arrays. When we find one, emit it as
    // a depth-0 row and recurse into its first item for deeper arrays.
    const rows = [];

    const walkObject = (obj, pathPrefix) => {
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
      Object.keys(obj).forEach((key) => {
        const value = obj[key];
        const nextPath = pathPrefix ? `${pathPrefix}.${key}` : key;
        if (Array.isArray(value)) {
          const inner = sampleItem(value);
          const alias = defaultAliasFor(key, 1);
          const row = {
            path: nextPath,
            count: value.length,
            preview: inner && typeof inner === 'object'
              ? Object.keys(inner).slice(0, 3).join(', ')
              : String(inner ?? ''),
            depth: 0,
            chain: [{ path: nextPath, alias }],
            scope: 'root'
          };
          rows.push(row);
          // Recurse into first item to surface deeper arrays.
          if (inner && typeof inner === 'object') {
            const deeper = buildFullArrayTree(inner, alias, row.chain, 'root');
            // Bump depths so they're relative to this top-level row.
            deeper.forEach((d) => { d.depth = d.depth + 1; });
            rows.push(...deeper);
          }
        } else if (value && typeof value === 'object') {
          walkObject(value, nextPath);
        }
      });
    };

    walkObject(bindingData, '');
    return rows;
  };
})();
