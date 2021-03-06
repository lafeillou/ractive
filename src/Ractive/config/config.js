import { warnIfDebug } from 'utils/log';
import adaptConfigurator from './custom/adapt';
import cssConfigurator from './custom/css/css';
import dataConfigurator from './custom/data';
import templateConfigurator from './custom/template';
import defaults from './defaults';
import registries from './registries';
import wrapPrototype from './wrapPrototypeMethod';
import deprecate from './deprecate';
import RactiveProto from '../prototype';
import { hasOwn, keys } from 'utils/object';
import { isFunction } from 'utils/is';

const config = {
  extend: (Parent, proto, options, Child) => configure('extend', Parent, proto, options, Child),
  init: (Parent, ractive, options) => configure('init', Parent, ractive, options),
  reset: ractive => order.filter(c => c.reset && c.reset(ractive)).map(c => c.name)
};

const custom = {
  adapt: adaptConfigurator,
  computed: config,
  css: cssConfigurator,
  data: dataConfigurator,
  helpers: config,
  template: templateConfigurator
};

const defaultKeys = keys(defaults);

const isStandardKey = makeObj(defaultKeys.filter(key => !custom[key]));

// blacklisted keys that we don't double extend
const isBlacklisted = makeObj(
  defaultKeys.concat(registries.map(r => r.name), ['on', 'observe', 'attributes', 'cssData', 'use'])
);

const order = [].concat(
  defaultKeys.filter(key => !registries[key] && !custom[key]),
  registries,
  //custom.data,
  custom.template,
  custom.css
);

function configure(method, Parent, target, options, Child) {
  deprecate(options);

  for (const key in options) {
    if (hasOwn(isStandardKey, key)) {
      const value = options[key];

      // warn the developer if they passed a function and ignore its value

      // NOTE: we allow some functions on "el" because we duck type element lists
      // and some libraries or ef'ed-up virtual browsers (phantomJS) return a
      // function object as the result of querySelector methods
      if (key !== 'el' && isFunction(value)) {
        warnIfDebug(
          `${key} is a Ractive option that does not expect a function and will be ignored`,
          method === 'init' ? target : null
        );
      } else {
        target[key] = value;
      }
    }
  }

  // disallow combination of `append` and `enhance`
  if (options.append && options.enhance) {
    throw new Error('Cannot use append and enhance at the same time');
  }

  registries.forEach(registry => {
    registry[method](Parent, target, options, Child);
  });

  adaptConfigurator[method](Parent, target, options, Child);
  templateConfigurator[method](Parent, target, options, Child);
  cssConfigurator[method](Parent, target, options, Child);

  extendOtherMethods(Parent.prototype, target, options);
}

const _super = /\b_super\b/;
function extendOtherMethods(parent, target, options) {
  for (const key in options) {
    if (!isBlacklisted[key] && hasOwn(options, key)) {
      let member = options[key];

      // if this is a method that overwrites a method, wrap it:
      if (isFunction(member)) {
        if (key in RactiveProto && !_super.test(member.toString())) {
          warnIfDebug(
            `Overriding Ractive prototype function '${key}' without calling the '${_super}' method can be very dangerous.`
          );
        }
        member = wrapPrototype(parent, key, member);
      }

      target[key] = member;
    }
  }
}

function makeObj(array) {
  const obj = {};
  array.forEach(x => (obj[x] = true));
  return obj;
}

export default config;
