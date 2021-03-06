import { createDocumentFragment } from 'utils/dom';
import { isArray, isObject, isObjectType } from 'utils/is';
import { findMap } from 'utils/array';
import {
  toEscapedString,
  toString,
  destroyed,
  shuffled,
  unbind,
  unrender,
  unrenderAndDestroy,
  update
} from 'shared/methodCallers';
import Fragment from './Fragment';
import findElement from './items/shared/findElement';
import { getContext } from 'shared/getRactiveContext';
import { keys } from 'utils/object';
import KeyModel from 'src/model/specials/KeyModel';

export default class RepeatedFragment {
  constructor(options) {
    this.parent = options.owner.up;

    // bit of a hack, so reference resolution works without another
    // layer of indirection
    this.up = this;
    this.owner = options.owner;
    this.ractive = this.parent.ractive;
    this.delegate =
      this.ractive.delegate !== false &&
      (this.parent.delegate || findDelegate(findElement(options.owner)));
    // delegation disabled by directive
    if (this.delegate && this.delegate.delegate === false) this.delegate = false;
    // let the element know it's a delegate handler
    if (this.delegate) this.delegate.delegate = this.delegate;

    // encapsulated styles should be inherited until they get applied by an element
    this.cssIds = 'cssIds' in options ? options.cssIds : this.parent ? this.parent.cssIds : null;

    this.context = null;
    this.rendered = false;
    this.iterations = [];

    this.template = options.template;

    this.indexRef = options.indexRef;
    this.keyRef = options.keyRef;

    this.pendingNewIndices = null;
    this.previousIterations = null;

    // track array versus object so updates of type rest
    this.isArray = false;
  }

  bind(context) {
    this.context = context;
    this.bound = true;
    const value = context.get();

    this.aliases = this.owner.template.z && this.owner.template.z.slice();

    // {{#each array}}...
    if ((this.isArray = isArray(value))) {
      // we can't use map, because of sparse arrays
      this.iterations = [];
      const max = (this.length = value.length);
      for (let i = 0; i < max; i += 1) {
        this.iterations[i] = this.createIteration(i, i);
      }
    } else if (isObject(value)) {
      // {{#each object}}...
      this.isArray = false;

      // TODO this is a dreadful hack. There must be a neater way
      if (this.indexRef) {
        const refs = this.indexRef.split(',');
        this.keyRef = refs[0];
        this.indexRef = refs[1];
      }

      const ks = keys(value);
      this.length = ks.length;

      this.iterations = ks.map((key, index) => {
        return this.createIteration(key, index);
      });
    }

    return this;
  }

  bubble(index) {
    if (!this.bubbled) this.bubbled = [];
    this.bubbled.push(index);

    this.owner.bubble();
  }

  createIteration(key, index) {
    const fragment = new Fragment({
      owner: this,
      template: this.template
    });

    fragment.isIteration = true;
    fragment.delegate = this.delegate;

    if (this.aliases) fragment.aliases = {};
    swizzleFragment(this, fragment, key, index);

    return fragment.bind(fragment.context);
  }

  destroyed() {
    this.iterations.forEach(destroyed);
  }

  detach() {
    const docFrag = createDocumentFragment();
    this.iterations.forEach(fragment => docFrag.appendChild(fragment.detach()));
    return docFrag;
  }

  find(selector, options) {
    return findMap(this.iterations, i => i.find(selector, options));
  }

  findAll(selector, options) {
    return this.iterations.forEach(i => i.findAll(selector, options));
  }

  findAllComponents(name, options) {
    return this.iterations.forEach(i => i.findAllComponents(name, options));
  }

  findComponent(name, options) {
    return findMap(this.iterations, i => i.findComponent(name, options));
  }

  findContext() {
    return this.context;
  }

  findNextNode(iteration) {
    if (iteration.index < this.iterations.length - 1) {
      for (let i = iteration.index + 1; i < this.iterations.length; i++) {
        const node = this.iterations[i].firstNode(true);
        if (node) return node;
      }
    }

    return this.owner.findNextNode();
  }

  firstNode(skipParent) {
    return this.iterations[0] ? this.iterations[0].firstNode(skipParent) : null;
  }

  getLast() {
    return this.lastModel || (this.lastModel = new KeyModel(this.length - 1));
  }

  rebind(next) {
    this.context = next;
    this.iterations.forEach(fragment => {
      swizzleFragment(this, fragment, fragment.key, fragment.index);
    });
  }

  render(target, occupants) {
    const xs = this.iterations;
    if (xs) {
      const len = xs.length;
      for (let i = 0; i < len; i++) {
        xs[i].render(target, occupants);
      }
    }

    this.rendered = true;
  }

  shuffle(newIndices, merge) {
    if (!this.pendingNewIndices) this.previousIterations = this.iterations.slice();

    if (!this.pendingNewIndices) this.pendingNewIndices = [];

    this.pendingNewIndices.push(newIndices);

    const iterations = [];

    newIndices.forEach((newIndex, oldIndex) => {
      if (newIndex === -1) return;

      const fragment = this.iterations[oldIndex];
      iterations[newIndex] = fragment;

      if (merge) fragment.shouldRebind = 1;

      if (newIndex !== oldIndex && fragment) fragment.dirty = true;
    });

    this.iterations = iterations;

    this.bubble();
  }

  shuffled() {
    this.iterations.forEach(shuffled);
  }

  toString(escape) {
    return this.iterations ? this.iterations.map(escape ? toEscapedString : toString).join('') : '';
  }

  unbind() {
    this.bound = false;
    this.iterations.forEach(unbind);
    return this;
  }

  unrender(shouldDestroy) {
    this.iterations.forEach(shouldDestroy ? unrenderAndDestroy : unrender);
    if (this.pendingNewIndices && this.previousIterations) {
      this.previousIterations.forEach(fragment => {
        if (fragment.rendered) shouldDestroy ? unrenderAndDestroy(fragment) : unrender(fragment);
      });
    }
    this.rendered = false;
  }

  update() {
    if (this.pendingNewIndices) {
      this.bubbled.length = 0;
      this.updatePostShuffle();
      return;
    }

    if (this.updating) return;
    this.updating = true;

    this.iterations.forEach((f, i) => f && f.idxModel && f.idxModel.applyValue(i));

    const value = this.context.get();
    const wasArray = this.isArray;

    let toRemove;
    let oldKeys;
    let reset = true;
    let i;

    if ((this.isArray = isArray(value))) {
      if (wasArray) {
        reset = false;
        if (this.iterations.length > value.length) {
          toRemove = this.iterations.splice(value.length);
        }
      }
    } else if (isObject(value) && !wasArray) {
      reset = false;
      toRemove = [];
      oldKeys = {};
      i = this.iterations.length;

      while (i--) {
        const fragment = this.iterations[i];
        if (fragment.key in value) {
          oldKeys[fragment.key] = true;
        } else {
          this.iterations.splice(i, 1);
          toRemove.push(fragment);
        }
      }
    }

    const newLength = isArray(value) ? value.length : isObject(value) ? keys(value).length : 0;
    this.length = newLength;
    this.updateLast();

    if (reset) {
      toRemove = this.iterations;
      this.iterations = [];
    }

    if (toRemove) {
      toRemove.forEach(fragment => {
        fragment.unbind();
        fragment.unrender(true);
      });
    }

    // update the remaining ones
    if (!reset && this.isArray && this.bubbled && this.bubbled.length) {
      const bubbled = this.bubbled;
      this.bubbled = [];
      bubbled.forEach(i => this.iterations[i] && this.iterations[i].update());
    } else {
      this.iterations.forEach(update);
    }

    // add new iterations
    let docFrag;
    let fragment;

    if (newLength > this.iterations.length) {
      docFrag = this.rendered ? createDocumentFragment() : null;
      i = this.iterations.length;

      if (isArray(value)) {
        while (i < value.length) {
          fragment = this.createIteration(i, i);

          this.iterations.push(fragment);
          if (this.rendered) fragment.render(docFrag);

          i += 1;
        }
      } else if (isObject(value)) {
        // TODO this is a dreadful hack. There must be a neater way
        if (this.indexRef && !this.keyRef) {
          const refs = this.indexRef.split(',');
          this.keyRef = refs[0];
          this.indexRef = refs[1];
        }

        keys(value).forEach(key => {
          if (!oldKeys || !(key in oldKeys)) {
            fragment = this.createIteration(key, i);

            this.iterations.push(fragment);
            if (this.rendered) fragment.render(docFrag);

            i += 1;
          }
        });
      }

      if (this.rendered) {
        const parentNode = this.parent.findParentNode();
        const anchor = this.parent.findNextNode(this.owner);

        parentNode.insertBefore(docFrag, anchor);
      }
    }

    this.updating = false;
  }

  updateLast() {
    if (this.lastModel) this.lastModel.applyValue(this.length - 1);
  }

  updatePostShuffle() {
    const newIndices = this.pendingNewIndices[0];
    const parentNode = this.rendered ? this.parent.findParentNode() : null;
    const nextNode = parentNode && this.owner.findNextNode();
    const docFrag = parentNode ? createDocumentFragment() : null;

    // map first shuffle through
    this.pendingNewIndices.slice(1).forEach(indices => {
      newIndices.forEach((newIndex, oldIndex) => {
        newIndices[oldIndex] = indices[newIndex];
      });
    });

    const len = (this.length = this.context.get().length);
    const prev = this.previousIterations;
    const iters = this.iterations;
    const stash = {};
    let idx, dest, pos, next, anchor;

    const map = new Array(newIndices.length);
    newIndices.forEach((e, i) => (map[e] = i));

    this.updateLast();

    idx = pos = 0;
    while (idx < len) {
      dest = newIndices[pos];
      next = null;

      if (dest === -1) {
        // drop it like it's hot
        prev[pos++].unbind().unrender(true);
      } else if (dest > idx) {
        // need to stash or pull one up
        next = newIndices[pos + 1]; // TODO: maybe a shouldMove function that tracks multiple entries?
        if (next <= dest) {
          stash[dest] = prev[pos];
          prev[pos++] = null;
        } else {
          next = stash[idx] || prev[map[idx]];
          prev[map[idx]] = null;
          anchor = prev[nextRendered(pos, newIndices, prev)];
          anchor = (anchor && parentNode && anchor.firstNode()) || nextNode;

          if (next) {
            swizzleFragment(this, next, idx, idx);
            if (parentNode) parentNode.insertBefore(next.detach(), anchor);
          } else {
            next = iters[idx] = this.createIteration(idx, idx);
            if (parentNode) {
              next.render(docFrag);
              parentNode.insertBefore(docFrag, anchor);
            }
          }

          idx++;
        }
      } else {
        // all is well
        next = iters[idx];
        anchor = prev[nextRendered(pos, newIndices, prev)];
        anchor = (anchor && parentNode && anchor.firstNode()) || nextNode;
        if (!next) {
          next = iters[idx] = this.createIteration(idx, idx);
          if (parentNode) {
            next.render(docFrag);
            parentNode.insertBefore(docFrag, anchor);
          }
        } else if (pos !== idx || stash[idx]) {
          swizzleFragment(this, next, idx, idx);
          if (stash[idx] && parentNode) parentNode.insertBefore(next.detach(), anchor);
        }

        idx++;
        prev[pos++] = null;
      }

      if (next && isObjectType(next)) {
        next.update();
      }
    }

    // clean up any stragglers
    prev.forEach(f => f && f.unbind().unrender(true));

    this.pendingNewIndices = null;

    this.shuffled();
  }
}

RepeatedFragment.prototype.getContext = getContext;

// find the topmost delegate
function findDelegate(start) {
  let el = start;
  let delegate = start;

  while (el) {
    if (el.delegate) delegate = el;
    el = el.parent;
  }

  return delegate;
}

function nextRendered(start, newIndices, frags) {
  const len = newIndices.length;
  for (let i = start; i < len; i++) {
    if (~newIndices[i] && frags[i] && frags[i].rendered) return i;
  }
}

function swizzleFragment(section, fragment, key, idx) {
  const model = section.context ? section.context.joinKey(key) : undefined;

  fragment.key = key;
  fragment.index = idx;
  fragment.context = model;

  if (fragment.idxModel) fragment.idxModel.applyValue(idx);
  if (fragment.keyModel) fragment.keyModel.applyValue(key);

  // handle any aliases
  const aliases = fragment.aliases;
  section.aliases &&
    section.aliases.forEach(a => {
      if (a.x.r === '.') aliases[a.n] = model;
      else if (a.x.r === '@index') aliases[a.n] = fragment.getIndex();
      else if (a.x.r === '@key') aliases[a.n] = fragment.getKey();
      else if (a.x.r === '@keypath') aliases[a.n] = fragment.getKeypath();
      else if (a.x.r === '@rootpath') aliases[a.n] = fragment.getKeypath(true);
    });
}
