/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 9227:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

"use strict";


var bind = __nccwpck_require__(8334);

var $apply = __nccwpck_require__(4177);
var $call = __nccwpck_require__(2808);
var $reflectApply = __nccwpck_require__(8309);

/** @type {import('./actualApply')} */
module.exports = $reflectApply || bind.call($call, $apply);


/***/ }),

/***/ 4177:
/***/ ((module) => {

"use strict";


/** @type {import('./functionApply')} */
module.exports = Function.prototype.apply;


/***/ }),

/***/ 2808:
/***/ ((module) => {

"use strict";


/** @type {import('./functionCall')} */
module.exports = Function.prototype.call;


/***/ }),

/***/ 6815:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

"use strict";


var bind = __nccwpck_require__(8334);
var $TypeError = __nccwpck_require__(6361);

var $call = __nccwpck_require__(2808);
var $actualApply = __nccwpck_require__(9227);

/** @type {(args: [Function, thisArg?: unknown, ...args: unknown[]]) => Function} TODO FIXME, find a way to use import('.') */
module.exports = function callBindBasic(args) {
	if (args.length < 1 || typeof args[0] !== 'function') {
		throw new $TypeError('a function is required');
	}
	return $actualApply(bind, $call, args);
};


/***/ }),

/***/ 8309:
/***/ ((module) => {

"use strict";


/** @type {import('./reflectApply')} */
module.exports = typeof Reflect !== 'undefined' && Reflect && Reflect.apply;


/***/ }),

/***/ 1785:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

"use strict";


var GetIntrinsic = __nccwpck_require__(4538);

var callBindBasic = __nccwpck_require__(6815);

/** @type {(thisArg: string, searchString: string, position?: number) => number} */
var $indexOf = callBindBasic([GetIntrinsic('%String.prototype.indexOf%')]);

/** @type {import('.')} */
module.exports = function callBoundIntrinsic(name, allowMissing) {
	/* eslint no-extra-parens: 0 */

	var intrinsic = /** @type {(this: unknown, ...args: unknown[]) => unknown} */ (GetIntrinsic(name, !!allowMissing));
	if (typeof intrinsic === 'function' && $indexOf(name, '.prototype.') > -1) {
		return callBindBasic(/** @type {const} */ ([intrinsic]));
	}
	return intrinsic;
};


/***/ }),

/***/ 2693:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

"use strict";


var callBind = __nccwpck_require__(6815);
var gOPD = __nccwpck_require__(8501);

var hasProtoAccessor;
try {
	// eslint-disable-next-line no-extra-parens, no-proto
	hasProtoAccessor = /** @type {{ __proto__?: typeof Array.prototype }} */ ([]).__proto__ === Array.prototype;
} catch (e) {
	if (!e || typeof e !== 'object' || !('code' in e) || e.code !== 'ERR_PROTO_ACCESS') {
		throw e;
	}
}

// eslint-disable-next-line no-extra-parens
var desc = !!hasProtoAccessor && gOPD && gOPD(Object.prototype, /** @type {keyof typeof Object.prototype} */ ('__proto__'));

var $Object = Object;
var $getPrototypeOf = $Object.getPrototypeOf;

/** @type {import('./get')} */
module.exports = desc && typeof desc.get === 'function'
	? callBind([desc.get])
	: typeof $getPrototypeOf === 'function'
		? /** @type {import('./get')} */ function getDunder(value) {
			// eslint-disable-next-line eqeqeq
			return $getPrototypeOf(value == null ? value : $Object(value));
		}
		: false;


/***/ }),

/***/ 6123:
/***/ ((module) => {

"use strict";


/** @type {import('.')} */
var $defineProperty = Object.defineProperty || false;
if ($defineProperty) {
	try {
		$defineProperty({}, 'a', { value: 1 });
	} catch (e) {
		// IE 8 has a broken defineProperty
		$defineProperty = false;
	}
}

module.exports = $defineProperty;


/***/ }),

/***/ 1933:
/***/ ((module) => {

"use strict";


/** @type {import('./eval')} */
module.exports = EvalError;


/***/ }),

/***/ 8015:
/***/ ((module) => {

"use strict";


/** @type {import('.')} */
module.exports = Error;


/***/ }),

/***/ 4415:
/***/ ((module) => {

"use strict";


/** @type {import('./range')} */
module.exports = RangeError;


/***/ }),

/***/ 6279:
/***/ ((module) => {

"use strict";


/** @type {import('./ref')} */
module.exports = ReferenceError;


/***/ }),

/***/ 5474:
/***/ ((module) => {

"use strict";


/** @type {import('./syntax')} */
module.exports = SyntaxError;


/***/ }),

/***/ 6361:
/***/ ((module) => {

"use strict";


/** @type {import('./type')} */
module.exports = TypeError;


/***/ }),

/***/ 5065:
/***/ ((module) => {

"use strict";


/** @type {import('./uri')} */
module.exports = URIError;


/***/ }),

/***/ 8308:
/***/ ((module) => {

"use strict";


/** @type {import('.')} */
module.exports = Object;


/***/ }),

/***/ 9320:
/***/ ((module) => {

"use strict";


/* eslint no-invalid-this: 1 */

var ERROR_MESSAGE = 'Function.prototype.bind called on incompatible ';
var toStr = Object.prototype.toString;
var max = Math.max;
var funcType = '[object Function]';

var concatty = function concatty(a, b) {
    var arr = [];

    for (var i = 0; i < a.length; i += 1) {
        arr[i] = a[i];
    }
    for (var j = 0; j < b.length; j += 1) {
        arr[j + a.length] = b[j];
    }

    return arr;
};

var slicy = function slicy(arrLike, offset) {
    var arr = [];
    for (var i = offset || 0, j = 0; i < arrLike.length; i += 1, j += 1) {
        arr[j] = arrLike[i];
    }
    return arr;
};

var joiny = function (arr, joiner) {
    var str = '';
    for (var i = 0; i < arr.length; i += 1) {
        str += arr[i];
        if (i + 1 < arr.length) {
            str += joiner;
        }
    }
    return str;
};

module.exports = function bind(that) {
    var target = this;
    if (typeof target !== 'function' || toStr.apply(target) !== funcType) {
        throw new TypeError(ERROR_MESSAGE + target);
    }
    var args = slicy(arguments, 1);

    var bound;
    var binder = function () {
        if (this instanceof bound) {
            var result = target.apply(
                this,
                concatty(args, arguments)
            );
            if (Object(result) === result) {
                return result;
            }
            return this;
        }
        return target.apply(
            that,
            concatty(args, arguments)
        );

    };

    var boundLength = max(0, target.length - args.length);
    var boundArgs = [];
    for (var i = 0; i < boundLength; i++) {
        boundArgs[i] = '$' + i;
    }

    bound = Function('binder', 'return function (' + joiny(boundArgs, ',') + '){ return binder.apply(this,arguments); }')(binder);

    if (target.prototype) {
        var Empty = function Empty() {};
        Empty.prototype = target.prototype;
        bound.prototype = new Empty();
        Empty.prototype = null;
    }

    return bound;
};


/***/ }),

/***/ 8334:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

"use strict";


var implementation = __nccwpck_require__(9320);

module.exports = Function.prototype.bind || implementation;


/***/ }),

/***/ 4538:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

"use strict";


var undefined;

var $Object = __nccwpck_require__(8308);

var $Error = __nccwpck_require__(8015);
var $EvalError = __nccwpck_require__(1933);
var $RangeError = __nccwpck_require__(4415);
var $ReferenceError = __nccwpck_require__(6279);
var $SyntaxError = __nccwpck_require__(5474);
var $TypeError = __nccwpck_require__(6361);
var $URIError = __nccwpck_require__(5065);

var abs = __nccwpck_require__(9775);
var floor = __nccwpck_require__(924);
var max = __nccwpck_require__(2419);
var min = __nccwpck_require__(3373);
var pow = __nccwpck_require__(8029);
var round = __nccwpck_require__(9396);
var sign = __nccwpck_require__(9091);

var $Function = Function;

// eslint-disable-next-line consistent-return
var getEvalledConstructor = function (expressionSyntax) {
	try {
		return $Function('"use strict"; return (' + expressionSyntax + ').constructor;')();
	} catch (e) {}
};

var $gOPD = __nccwpck_require__(8501);
var $defineProperty = __nccwpck_require__(6123);

var throwTypeError = function () {
	throw new $TypeError();
};
var ThrowTypeError = $gOPD
	? (function () {
		try {
			// eslint-disable-next-line no-unused-expressions, no-caller, no-restricted-properties
			arguments.callee; // IE 8 does not throw here
			return throwTypeError;
		} catch (calleeThrows) {
			try {
				// IE 8 throws on Object.getOwnPropertyDescriptor(arguments, '')
				return $gOPD(arguments, 'callee').get;
			} catch (gOPDthrows) {
				return throwTypeError;
			}
		}
	}())
	: throwTypeError;

var hasSymbols = __nccwpck_require__(587)();

var getProto = __nccwpck_require__(3592);
var $ObjectGPO = __nccwpck_require__(5045);
var $ReflectGPO = __nccwpck_require__(8859);

var $apply = __nccwpck_require__(4177);
var $call = __nccwpck_require__(2808);

var needsEval = {};

var TypedArray = typeof Uint8Array === 'undefined' || !getProto ? undefined : getProto(Uint8Array);

var INTRINSICS = {
	__proto__: null,
	'%AggregateError%': typeof AggregateError === 'undefined' ? undefined : AggregateError,
	'%Array%': Array,
	'%ArrayBuffer%': typeof ArrayBuffer === 'undefined' ? undefined : ArrayBuffer,
	'%ArrayIteratorPrototype%': hasSymbols && getProto ? getProto([][Symbol.iterator]()) : undefined,
	'%AsyncFromSyncIteratorPrototype%': undefined,
	'%AsyncFunction%': needsEval,
	'%AsyncGenerator%': needsEval,
	'%AsyncGeneratorFunction%': needsEval,
	'%AsyncIteratorPrototype%': needsEval,
	'%Atomics%': typeof Atomics === 'undefined' ? undefined : Atomics,
	'%BigInt%': typeof BigInt === 'undefined' ? undefined : BigInt,
	'%BigInt64Array%': typeof BigInt64Array === 'undefined' ? undefined : BigInt64Array,
	'%BigUint64Array%': typeof BigUint64Array === 'undefined' ? undefined : BigUint64Array,
	'%Boolean%': Boolean,
	'%DataView%': typeof DataView === 'undefined' ? undefined : DataView,
	'%Date%': Date,
	'%decodeURI%': decodeURI,
	'%decodeURIComponent%': decodeURIComponent,
	'%encodeURI%': encodeURI,
	'%encodeURIComponent%': encodeURIComponent,
	'%Error%': $Error,
	'%eval%': eval, // eslint-disable-line no-eval
	'%EvalError%': $EvalError,
	'%Float16Array%': typeof Float16Array === 'undefined' ? undefined : Float16Array,
	'%Float32Array%': typeof Float32Array === 'undefined' ? undefined : Float32Array,
	'%Float64Array%': typeof Float64Array === 'undefined' ? undefined : Float64Array,
	'%FinalizationRegistry%': typeof FinalizationRegistry === 'undefined' ? undefined : FinalizationRegistry,
	'%Function%': $Function,
	'%GeneratorFunction%': needsEval,
	'%Int8Array%': typeof Int8Array === 'undefined' ? undefined : Int8Array,
	'%Int16Array%': typeof Int16Array === 'undefined' ? undefined : Int16Array,
	'%Int32Array%': typeof Int32Array === 'undefined' ? undefined : Int32Array,
	'%isFinite%': isFinite,
	'%isNaN%': isNaN,
	'%IteratorPrototype%': hasSymbols && getProto ? getProto(getProto([][Symbol.iterator]())) : undefined,
	'%JSON%': typeof JSON === 'object' ? JSON : undefined,
	'%Map%': typeof Map === 'undefined' ? undefined : Map,
	'%MapIteratorPrototype%': typeof Map === 'undefined' || !hasSymbols || !getProto ? undefined : getProto(new Map()[Symbol.iterator]()),
	'%Math%': Math,
	'%Number%': Number,
	'%Object%': $Object,
	'%Object.getOwnPropertyDescriptor%': $gOPD,
	'%parseFloat%': parseFloat,
	'%parseInt%': parseInt,
	'%Promise%': typeof Promise === 'undefined' ? undefined : Promise,
	'%Proxy%': typeof Proxy === 'undefined' ? undefined : Proxy,
	'%RangeError%': $RangeError,
	'%ReferenceError%': $ReferenceError,
	'%Reflect%': typeof Reflect === 'undefined' ? undefined : Reflect,
	'%RegExp%': RegExp,
	'%Set%': typeof Set === 'undefined' ? undefined : Set,
	'%SetIteratorPrototype%': typeof Set === 'undefined' || !hasSymbols || !getProto ? undefined : getProto(new Set()[Symbol.iterator]()),
	'%SharedArrayBuffer%': typeof SharedArrayBuffer === 'undefined' ? undefined : SharedArrayBuffer,
	'%String%': String,
	'%StringIteratorPrototype%': hasSymbols && getProto ? getProto(''[Symbol.iterator]()) : undefined,
	'%Symbol%': hasSymbols ? Symbol : undefined,
	'%SyntaxError%': $SyntaxError,
	'%ThrowTypeError%': ThrowTypeError,
	'%TypedArray%': TypedArray,
	'%TypeError%': $TypeError,
	'%Uint8Array%': typeof Uint8Array === 'undefined' ? undefined : Uint8Array,
	'%Uint8ClampedArray%': typeof Uint8ClampedArray === 'undefined' ? undefined : Uint8ClampedArray,
	'%Uint16Array%': typeof Uint16Array === 'undefined' ? undefined : Uint16Array,
	'%Uint32Array%': typeof Uint32Array === 'undefined' ? undefined : Uint32Array,
	'%URIError%': $URIError,
	'%WeakMap%': typeof WeakMap === 'undefined' ? undefined : WeakMap,
	'%WeakRef%': typeof WeakRef === 'undefined' ? undefined : WeakRef,
	'%WeakSet%': typeof WeakSet === 'undefined' ? undefined : WeakSet,

	'%Function.prototype.call%': $call,
	'%Function.prototype.apply%': $apply,
	'%Object.defineProperty%': $defineProperty,
	'%Object.getPrototypeOf%': $ObjectGPO,
	'%Math.abs%': abs,
	'%Math.floor%': floor,
	'%Math.max%': max,
	'%Math.min%': min,
	'%Math.pow%': pow,
	'%Math.round%': round,
	'%Math.sign%': sign,
	'%Reflect.getPrototypeOf%': $ReflectGPO
};

if (getProto) {
	try {
		null.error; // eslint-disable-line no-unused-expressions
	} catch (e) {
		// https://github.com/tc39/proposal-shadowrealm/pull/384#issuecomment-1364264229
		var errorProto = getProto(getProto(e));
		INTRINSICS['%Error.prototype%'] = errorProto;
	}
}

var doEval = function doEval(name) {
	var value;
	if (name === '%AsyncFunction%') {
		value = getEvalledConstructor('async function () {}');
	} else if (name === '%GeneratorFunction%') {
		value = getEvalledConstructor('function* () {}');
	} else if (name === '%AsyncGeneratorFunction%') {
		value = getEvalledConstructor('async function* () {}');
	} else if (name === '%AsyncGenerator%') {
		var fn = doEval('%AsyncGeneratorFunction%');
		if (fn) {
			value = fn.prototype;
		}
	} else if (name === '%AsyncIteratorPrototype%') {
		var gen = doEval('%AsyncGenerator%');
		if (gen && getProto) {
			value = getProto(gen.prototype);
		}
	}

	INTRINSICS[name] = value;

	return value;
};

var LEGACY_ALIASES = {
	__proto__: null,
	'%ArrayBufferPrototype%': ['ArrayBuffer', 'prototype'],
	'%ArrayPrototype%': ['Array', 'prototype'],
	'%ArrayProto_entries%': ['Array', 'prototype', 'entries'],
	'%ArrayProto_forEach%': ['Array', 'prototype', 'forEach'],
	'%ArrayProto_keys%': ['Array', 'prototype', 'keys'],
	'%ArrayProto_values%': ['Array', 'prototype', 'values'],
	'%AsyncFunctionPrototype%': ['AsyncFunction', 'prototype'],
	'%AsyncGenerator%': ['AsyncGeneratorFunction', 'prototype'],
	'%AsyncGeneratorPrototype%': ['AsyncGeneratorFunction', 'prototype', 'prototype'],
	'%BooleanPrototype%': ['Boolean', 'prototype'],
	'%DataViewPrototype%': ['DataView', 'prototype'],
	'%DatePrototype%': ['Date', 'prototype'],
	'%ErrorPrototype%': ['Error', 'prototype'],
	'%EvalErrorPrototype%': ['EvalError', 'prototype'],
	'%Float32ArrayPrototype%': ['Float32Array', 'prototype'],
	'%Float64ArrayPrototype%': ['Float64Array', 'prototype'],
	'%FunctionPrototype%': ['Function', 'prototype'],
	'%Generator%': ['GeneratorFunction', 'prototype'],
	'%GeneratorPrototype%': ['GeneratorFunction', 'prototype', 'prototype'],
	'%Int8ArrayPrototype%': ['Int8Array', 'prototype'],
	'%Int16ArrayPrototype%': ['Int16Array', 'prototype'],
	'%Int32ArrayPrototype%': ['Int32Array', 'prototype'],
	'%JSONParse%': ['JSON', 'parse'],
	'%JSONStringify%': ['JSON', 'stringify'],
	'%MapPrototype%': ['Map', 'prototype'],
	'%NumberPrototype%': ['Number', 'prototype'],
	'%ObjectPrototype%': ['Object', 'prototype'],
	'%ObjProto_toString%': ['Object', 'prototype', 'toString'],
	'%ObjProto_valueOf%': ['Object', 'prototype', 'valueOf'],
	'%PromisePrototype%': ['Promise', 'prototype'],
	'%PromiseProto_then%': ['Promise', 'prototype', 'then'],
	'%Promise_all%': ['Promise', 'all'],
	'%Promise_reject%': ['Promise', 'reject'],
	'%Promise_resolve%': ['Promise', 'resolve'],
	'%RangeErrorPrototype%': ['RangeError', 'prototype'],
	'%ReferenceErrorPrototype%': ['ReferenceError', 'prototype'],
	'%RegExpPrototype%': ['RegExp', 'prototype'],
	'%SetPrototype%': ['Set', 'prototype'],
	'%SharedArrayBufferPrototype%': ['SharedArrayBuffer', 'prototype'],
	'%StringPrototype%': ['String', 'prototype'],
	'%SymbolPrototype%': ['Symbol', 'prototype'],
	'%SyntaxErrorPrototype%': ['SyntaxError', 'prototype'],
	'%TypedArrayPrototype%': ['TypedArray', 'prototype'],
	'%TypeErrorPrototype%': ['TypeError', 'prototype'],
	'%Uint8ArrayPrototype%': ['Uint8Array', 'prototype'],
	'%Uint8ClampedArrayPrototype%': ['Uint8ClampedArray', 'prototype'],
	'%Uint16ArrayPrototype%': ['Uint16Array', 'prototype'],
	'%Uint32ArrayPrototype%': ['Uint32Array', 'prototype'],
	'%URIErrorPrototype%': ['URIError', 'prototype'],
	'%WeakMapPrototype%': ['WeakMap', 'prototype'],
	'%WeakSetPrototype%': ['WeakSet', 'prototype']
};

var bind = __nccwpck_require__(8334);
var hasOwn = __nccwpck_require__(2157);
var $concat = bind.call($call, Array.prototype.concat);
var $spliceApply = bind.call($apply, Array.prototype.splice);
var $replace = bind.call($call, String.prototype.replace);
var $strSlice = bind.call($call, String.prototype.slice);
var $exec = bind.call($call, RegExp.prototype.exec);

/* adapted from https://github.com/lodash/lodash/blob/4.17.15/dist/lodash.js#L6735-L6744 */
var rePropName = /[^%.[\]]+|\[(?:(-?\d+(?:\.\d+)?)|(["'])((?:(?!\2)[^\\]|\\.)*?)\2)\]|(?=(?:\.|\[\])(?:\.|\[\]|%$))/g;
var reEscapeChar = /\\(\\)?/g; /** Used to match backslashes in property paths. */
var stringToPath = function stringToPath(string) {
	var first = $strSlice(string, 0, 1);
	var last = $strSlice(string, -1);
	if (first === '%' && last !== '%') {
		throw new $SyntaxError('invalid intrinsic syntax, expected closing `%`');
	} else if (last === '%' && first !== '%') {
		throw new $SyntaxError('invalid intrinsic syntax, expected opening `%`');
	}
	var result = [];
	$replace(string, rePropName, function (match, number, quote, subString) {
		result[result.length] = quote ? $replace(subString, reEscapeChar, '$1') : number || match;
	});
	return result;
};
/* end adaptation */

var getBaseIntrinsic = function getBaseIntrinsic(name, allowMissing) {
	var intrinsicName = name;
	var alias;
	if (hasOwn(LEGACY_ALIASES, intrinsicName)) {
		alias = LEGACY_ALIASES[intrinsicName];
		intrinsicName = '%' + alias[0] + '%';
	}

	if (hasOwn(INTRINSICS, intrinsicName)) {
		var value = INTRINSICS[intrinsicName];
		if (value === needsEval) {
			value = doEval(intrinsicName);
		}
		if (typeof value === 'undefined' && !allowMissing) {
			throw new $TypeError('intrinsic ' + name + ' exists, but is not available. Please file an issue!');
		}

		return {
			alias: alias,
			name: intrinsicName,
			value: value
		};
	}

	throw new $SyntaxError('intrinsic ' + name + ' does not exist!');
};

module.exports = function GetIntrinsic(name, allowMissing) {
	if (typeof name !== 'string' || name.length === 0) {
		throw new $TypeError('intrinsic name must be a non-empty string');
	}
	if (arguments.length > 1 && typeof allowMissing !== 'boolean') {
		throw new $TypeError('"allowMissing" argument must be a boolean');
	}

	if ($exec(/^%?[^%]*%?$/, name) === null) {
		throw new $SyntaxError('`%` may not be present anywhere but at the beginning and end of the intrinsic name');
	}
	var parts = stringToPath(name);
	var intrinsicBaseName = parts.length > 0 ? parts[0] : '';

	var intrinsic = getBaseIntrinsic('%' + intrinsicBaseName + '%', allowMissing);
	var intrinsicRealName = intrinsic.name;
	var value = intrinsic.value;
	var skipFurtherCaching = false;

	var alias = intrinsic.alias;
	if (alias) {
		intrinsicBaseName = alias[0];
		$spliceApply(parts, $concat([0, 1], alias));
	}

	for (var i = 1, isOwn = true; i < parts.length; i += 1) {
		var part = parts[i];
		var first = $strSlice(part, 0, 1);
		var last = $strSlice(part, -1);
		if (
			(
				(first === '"' || first === "'" || first === '`')
				|| (last === '"' || last === "'" || last === '`')
			)
			&& first !== last
		) {
			throw new $SyntaxError('property names with quotes must have matching quotes');
		}
		if (part === 'constructor' || !isOwn) {
			skipFurtherCaching = true;
		}

		intrinsicBaseName += '.' + part;
		intrinsicRealName = '%' + intrinsicBaseName + '%';

		if (hasOwn(INTRINSICS, intrinsicRealName)) {
			value = INTRINSICS[intrinsicRealName];
		} else if (value != null) {
			if (!(part in value)) {
				if (!allowMissing) {
					throw new $TypeError('base intrinsic for ' + name + ' exists, but the property is not available.');
				}
				return void undefined;
			}
			if ($gOPD && (i + 1) >= parts.length) {
				var desc = $gOPD(value, part);
				isOwn = !!desc;

				// By convention, when a data property is converted to an accessor
				// property to emulate a data property that does not suffer from
				// the override mistake, that accessor's getter is marked with
				// an `originalValue` property. Here, when we detect this, we
				// uphold the illusion by pretending to see that original data
				// property, i.e., returning the value rather than the getter
				// itself.
				if (isOwn && 'get' in desc && !('originalValue' in desc.get)) {
					value = desc.get;
				} else {
					value = value[part];
				}
			} else {
				isOwn = hasOwn(value, part);
				value = value[part];
			}

			if (isOwn && !skipFurtherCaching) {
				INTRINSICS[intrinsicRealName] = value;
			}
		}
	}
	return value;
};


/***/ }),

/***/ 5045:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

"use strict";


var $Object = __nccwpck_require__(8308);

/** @type {import('./Object.getPrototypeOf')} */
module.exports = $Object.getPrototypeOf || null;


/***/ }),

/***/ 8859:
/***/ ((module) => {

"use strict";


/** @type {import('./Reflect.getPrototypeOf')} */
module.exports = (typeof Reflect !== 'undefined' && Reflect.getPrototypeOf) || null;


/***/ }),

/***/ 3592:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

"use strict";


var reflectGetProto = __nccwpck_require__(8859);
var originalGetProto = __nccwpck_require__(5045);

var getDunderProto = __nccwpck_require__(2693);

/** @type {import('.')} */
module.exports = reflectGetProto
	? function getProto(O) {
		// @ts-expect-error TS can't narrow inside a closure, for some reason
		return reflectGetProto(O);
	}
	: originalGetProto
		? function getProto(O) {
			if (!O || (typeof O !== 'object' && typeof O !== 'function')) {
				throw new TypeError('getProto: not an object');
			}
			// @ts-expect-error TS can't narrow inside a closure, for some reason
			return originalGetProto(O);
		}
		: getDunderProto
			? function getProto(O) {
				// @ts-expect-error TS can't narrow inside a closure, for some reason
				return getDunderProto(O);
			}
			: null;


/***/ }),

/***/ 7087:
/***/ ((module) => {

"use strict";


/** @type {import('./gOPD')} */
module.exports = Object.getOwnPropertyDescriptor;


/***/ }),

/***/ 8501:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

"use strict";


/** @type {import('.')} */
var $gOPD = __nccwpck_require__(7087);

if ($gOPD) {
	try {
		$gOPD([], 'length');
	} catch (e) {
		// IE 8 has a broken gOPD
		$gOPD = null;
	}
}

module.exports = $gOPD;


/***/ }),

/***/ 587:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

"use strict";


var origSymbol = typeof Symbol !== 'undefined' && Symbol;
var hasSymbolSham = __nccwpck_require__(7747);

/** @type {import('.')} */
module.exports = function hasNativeSymbols() {
	if (typeof origSymbol !== 'function') { return false; }
	if (typeof Symbol !== 'function') { return false; }
	if (typeof origSymbol('foo') !== 'symbol') { return false; }
	if (typeof Symbol('bar') !== 'symbol') { return false; }

	return hasSymbolSham();
};


/***/ }),

/***/ 7747:
/***/ ((module) => {

"use strict";


/** @type {import('./shams')} */
/* eslint complexity: [2, 18], max-statements: [2, 33] */
module.exports = function hasSymbols() {
	if (typeof Symbol !== 'function' || typeof Object.getOwnPropertySymbols !== 'function') { return false; }
	if (typeof Symbol.iterator === 'symbol') { return true; }

	/** @type {{ [k in symbol]?: unknown }} */
	var obj = {};
	var sym = Symbol('test');
	var symObj = Object(sym);
	if (typeof sym === 'string') { return false; }

	if (Object.prototype.toString.call(sym) !== '[object Symbol]') { return false; }
	if (Object.prototype.toString.call(symObj) !== '[object Symbol]') { return false; }

	// temp disabled per https://github.com/ljharb/object.assign/issues/17
	// if (sym instanceof Symbol) { return false; }
	// temp disabled per https://github.com/WebReflection/get-own-property-symbols/issues/4
	// if (!(symObj instanceof Symbol)) { return false; }

	// if (typeof Symbol.prototype.toString !== 'function') { return false; }
	// if (String(sym) !== Symbol.prototype.toString.call(sym)) { return false; }

	var symVal = 42;
	obj[sym] = symVal;
	for (var _ in obj) { return false; } // eslint-disable-line no-restricted-syntax, no-unreachable-loop
	if (typeof Object.keys === 'function' && Object.keys(obj).length !== 0) { return false; }

	if (typeof Object.getOwnPropertyNames === 'function' && Object.getOwnPropertyNames(obj).length !== 0) { return false; }

	var syms = Object.getOwnPropertySymbols(obj);
	if (syms.length !== 1 || syms[0] !== sym) { return false; }

	if (!Object.prototype.propertyIsEnumerable.call(obj, sym)) { return false; }

	if (typeof Object.getOwnPropertyDescriptor === 'function') {
		// eslint-disable-next-line no-extra-parens
		var descriptor = /** @type {PropertyDescriptor} */ (Object.getOwnPropertyDescriptor(obj, sym));
		if (descriptor.value !== symVal || descriptor.enumerable !== true) { return false; }
	}

	return true;
};


/***/ }),

/***/ 2157:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

"use strict";


var call = Function.prototype.call;
var $hasOwn = Object.prototype.hasOwnProperty;
var bind = __nccwpck_require__(8334);

/** @type {import('.')} */
module.exports = bind.call(call, $hasOwn);


/***/ }),

/***/ 9775:
/***/ ((module) => {

"use strict";


/** @type {import('./abs')} */
module.exports = Math.abs;


/***/ }),

/***/ 924:
/***/ ((module) => {

"use strict";


/** @type {import('./floor')} */
module.exports = Math.floor;


/***/ }),

/***/ 7661:
/***/ ((module) => {

"use strict";


/** @type {import('./isNaN')} */
module.exports = Number.isNaN || function isNaN(a) {
	return a !== a;
};


/***/ }),

/***/ 2419:
/***/ ((module) => {

"use strict";


/** @type {import('./max')} */
module.exports = Math.max;


/***/ }),

/***/ 3373:
/***/ ((module) => {

"use strict";


/** @type {import('./min')} */
module.exports = Math.min;


/***/ }),

/***/ 8029:
/***/ ((module) => {

"use strict";


/** @type {import('./pow')} */
module.exports = Math.pow;


/***/ }),

/***/ 9396:
/***/ ((module) => {

"use strict";


/** @type {import('./round')} */
module.exports = Math.round;


/***/ }),

/***/ 9091:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

"use strict";


var $isNaN = __nccwpck_require__(7661);

/** @type {import('./sign')} */
module.exports = function sign(number) {
	if ($isNaN(number) || number === 0) {
		return number;
	}
	return number < 0 ? -1 : +1;
};


/***/ }),

/***/ 504:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

var hasMap = typeof Map === 'function' && Map.prototype;
var mapSizeDescriptor = Object.getOwnPropertyDescriptor && hasMap ? Object.getOwnPropertyDescriptor(Map.prototype, 'size') : null;
var mapSize = hasMap && mapSizeDescriptor && typeof mapSizeDescriptor.get === 'function' ? mapSizeDescriptor.get : null;
var mapForEach = hasMap && Map.prototype.forEach;
var hasSet = typeof Set === 'function' && Set.prototype;
var setSizeDescriptor = Object.getOwnPropertyDescriptor && hasSet ? Object.getOwnPropertyDescriptor(Set.prototype, 'size') : null;
var setSize = hasSet && setSizeDescriptor && typeof setSizeDescriptor.get === 'function' ? setSizeDescriptor.get : null;
var setForEach = hasSet && Set.prototype.forEach;
var hasWeakMap = typeof WeakMap === 'function' && WeakMap.prototype;
var weakMapHas = hasWeakMap ? WeakMap.prototype.has : null;
var hasWeakSet = typeof WeakSet === 'function' && WeakSet.prototype;
var weakSetHas = hasWeakSet ? WeakSet.prototype.has : null;
var hasWeakRef = typeof WeakRef === 'function' && WeakRef.prototype;
var weakRefDeref = hasWeakRef ? WeakRef.prototype.deref : null;
var booleanValueOf = Boolean.prototype.valueOf;
var objectToString = Object.prototype.toString;
var functionToString = Function.prototype.toString;
var $match = String.prototype.match;
var $slice = String.prototype.slice;
var $replace = String.prototype.replace;
var $toUpperCase = String.prototype.toUpperCase;
var $toLowerCase = String.prototype.toLowerCase;
var $test = RegExp.prototype.test;
var $concat = Array.prototype.concat;
var $join = Array.prototype.join;
var $arrSlice = Array.prototype.slice;
var $floor = Math.floor;
var bigIntValueOf = typeof BigInt === 'function' ? BigInt.prototype.valueOf : null;
var gOPS = Object.getOwnPropertySymbols;
var symToString = typeof Symbol === 'function' && typeof Symbol.iterator === 'symbol' ? Symbol.prototype.toString : null;
var hasShammedSymbols = typeof Symbol === 'function' && typeof Symbol.iterator === 'object';
// ie, `has-tostringtag/shams
var toStringTag = typeof Symbol === 'function' && Symbol.toStringTag && (typeof Symbol.toStringTag === hasShammedSymbols ? 'object' : 'symbol')
    ? Symbol.toStringTag
    : null;
var isEnumerable = Object.prototype.propertyIsEnumerable;

var gPO = (typeof Reflect === 'function' ? Reflect.getPrototypeOf : Object.getPrototypeOf) || (
    [].__proto__ === Array.prototype // eslint-disable-line no-proto
        ? function (O) {
            return O.__proto__; // eslint-disable-line no-proto
        }
        : null
);

function addNumericSeparator(num, str) {
    if (
        num === Infinity
        || num === -Infinity
        || num !== num
        || (num && num > -1000 && num < 1000)
        || $test.call(/e/, str)
    ) {
        return str;
    }
    var sepRegex = /[0-9](?=(?:[0-9]{3})+(?![0-9]))/g;
    if (typeof num === 'number') {
        var int = num < 0 ? -$floor(-num) : $floor(num); // trunc(num)
        if (int !== num) {
            var intStr = String(int);
            var dec = $slice.call(str, intStr.length + 1);
            return $replace.call(intStr, sepRegex, '$&_') + '.' + $replace.call($replace.call(dec, /([0-9]{3})/g, '$&_'), /_$/, '');
        }
    }
    return $replace.call(str, sepRegex, '$&_');
}

var utilInspect = __nccwpck_require__(7265);
var inspectCustom = utilInspect.custom;
var inspectSymbol = isSymbol(inspectCustom) ? inspectCustom : null;

var quotes = {
    __proto__: null,
    'double': '"',
    single: "'"
};
var quoteREs = {
    __proto__: null,
    'double': /(["\\])/g,
    single: /(['\\])/g
};

module.exports = function inspect_(obj, options, depth, seen) {
    var opts = options || {};

    if (has(opts, 'quoteStyle') && !has(quotes, opts.quoteStyle)) {
        throw new TypeError('option "quoteStyle" must be "single" or "double"');
    }
    if (
        has(opts, 'maxStringLength') && (typeof opts.maxStringLength === 'number'
            ? opts.maxStringLength < 0 && opts.maxStringLength !== Infinity
            : opts.maxStringLength !== null
        )
    ) {
        throw new TypeError('option "maxStringLength", if provided, must be a positive integer, Infinity, or `null`');
    }
    var customInspect = has(opts, 'customInspect') ? opts.customInspect : true;
    if (typeof customInspect !== 'boolean' && customInspect !== 'symbol') {
        throw new TypeError('option "customInspect", if provided, must be `true`, `false`, or `\'symbol\'`');
    }

    if (
        has(opts, 'indent')
        && opts.indent !== null
        && opts.indent !== '\t'
        && !(parseInt(opts.indent, 10) === opts.indent && opts.indent > 0)
    ) {
        throw new TypeError('option "indent" must be "\\t", an integer > 0, or `null`');
    }
    if (has(opts, 'numericSeparator') && typeof opts.numericSeparator !== 'boolean') {
        throw new TypeError('option "numericSeparator", if provided, must be `true` or `false`');
    }
    var numericSeparator = opts.numericSeparator;

    if (typeof obj === 'undefined') {
        return 'undefined';
    }
    if (obj === null) {
        return 'null';
    }
    if (typeof obj === 'boolean') {
        return obj ? 'true' : 'false';
    }

    if (typeof obj === 'string') {
        return inspectString(obj, opts);
    }
    if (typeof obj === 'number') {
        if (obj === 0) {
            return Infinity / obj > 0 ? '0' : '-0';
        }
        var str = String(obj);
        return numericSeparator ? addNumericSeparator(obj, str) : str;
    }
    if (typeof obj === 'bigint') {
        var bigIntStr = String(obj) + 'n';
        return numericSeparator ? addNumericSeparator(obj, bigIntStr) : bigIntStr;
    }

    var maxDepth = typeof opts.depth === 'undefined' ? 5 : opts.depth;
    if (typeof depth === 'undefined') { depth = 0; }
    if (depth >= maxDepth && maxDepth > 0 && typeof obj === 'object') {
        return isArray(obj) ? '[Array]' : '[Object]';
    }

    var indent = getIndent(opts, depth);

    if (typeof seen === 'undefined') {
        seen = [];
    } else if (indexOf(seen, obj) >= 0) {
        return '[Circular]';
    }

    function inspect(value, from, noIndent) {
        if (from) {
            seen = $arrSlice.call(seen);
            seen.push(from);
        }
        if (noIndent) {
            var newOpts = {
                depth: opts.depth
            };
            if (has(opts, 'quoteStyle')) {
                newOpts.quoteStyle = opts.quoteStyle;
            }
            return inspect_(value, newOpts, depth + 1, seen);
        }
        return inspect_(value, opts, depth + 1, seen);
    }

    if (typeof obj === 'function' && !isRegExp(obj)) { // in older engines, regexes are callable
        var name = nameOf(obj);
        var keys = arrObjKeys(obj, inspect);
        return '[Function' + (name ? ': ' + name : ' (anonymous)') + ']' + (keys.length > 0 ? ' { ' + $join.call(keys, ', ') + ' }' : '');
    }
    if (isSymbol(obj)) {
        var symString = hasShammedSymbols ? $replace.call(String(obj), /^(Symbol\(.*\))_[^)]*$/, '$1') : symToString.call(obj);
        return typeof obj === 'object' && !hasShammedSymbols ? markBoxed(symString) : symString;
    }
    if (isElement(obj)) {
        var s = '<' + $toLowerCase.call(String(obj.nodeName));
        var attrs = obj.attributes || [];
        for (var i = 0; i < attrs.length; i++) {
            s += ' ' + attrs[i].name + '=' + wrapQuotes(quote(attrs[i].value), 'double', opts);
        }
        s += '>';
        if (obj.childNodes && obj.childNodes.length) { s += '...'; }
        s += '</' + $toLowerCase.call(String(obj.nodeName)) + '>';
        return s;
    }
    if (isArray(obj)) {
        if (obj.length === 0) { return '[]'; }
        var xs = arrObjKeys(obj, inspect);
        if (indent && !singleLineValues(xs)) {
            return '[' + indentedJoin(xs, indent) + ']';
        }
        return '[ ' + $join.call(xs, ', ') + ' ]';
    }
    if (isError(obj)) {
        var parts = arrObjKeys(obj, inspect);
        if (!('cause' in Error.prototype) && 'cause' in obj && !isEnumerable.call(obj, 'cause')) {
            return '{ [' + String(obj) + '] ' + $join.call($concat.call('[cause]: ' + inspect(obj.cause), parts), ', ') + ' }';
        }
        if (parts.length === 0) { return '[' + String(obj) + ']'; }
        return '{ [' + String(obj) + '] ' + $join.call(parts, ', ') + ' }';
    }
    if (typeof obj === 'object' && customInspect) {
        if (inspectSymbol && typeof obj[inspectSymbol] === 'function' && utilInspect) {
            return utilInspect(obj, { depth: maxDepth - depth });
        } else if (customInspect !== 'symbol' && typeof obj.inspect === 'function') {
            return obj.inspect();
        }
    }
    if (isMap(obj)) {
        var mapParts = [];
        if (mapForEach) {
            mapForEach.call(obj, function (value, key) {
                mapParts.push(inspect(key, obj, true) + ' => ' + inspect(value, obj));
            });
        }
        return collectionOf('Map', mapSize.call(obj), mapParts, indent);
    }
    if (isSet(obj)) {
        var setParts = [];
        if (setForEach) {
            setForEach.call(obj, function (value) {
                setParts.push(inspect(value, obj));
            });
        }
        return collectionOf('Set', setSize.call(obj), setParts, indent);
    }
    if (isWeakMap(obj)) {
        return weakCollectionOf('WeakMap');
    }
    if (isWeakSet(obj)) {
        return weakCollectionOf('WeakSet');
    }
    if (isWeakRef(obj)) {
        return weakCollectionOf('WeakRef');
    }
    if (isNumber(obj)) {
        return markBoxed(inspect(Number(obj)));
    }
    if (isBigInt(obj)) {
        return markBoxed(inspect(bigIntValueOf.call(obj)));
    }
    if (isBoolean(obj)) {
        return markBoxed(booleanValueOf.call(obj));
    }
    if (isString(obj)) {
        return markBoxed(inspect(String(obj)));
    }
    // note: in IE 8, sometimes `global !== window` but both are the prototypes of each other
    /* eslint-env browser */
    if (typeof window !== 'undefined' && obj === window) {
        return '{ [object Window] }';
    }
    if (
        (typeof globalThis !== 'undefined' && obj === globalThis)
        || (typeof global !== 'undefined' && obj === global)
    ) {
        return '{ [object globalThis] }';
    }
    if (!isDate(obj) && !isRegExp(obj)) {
        var ys = arrObjKeys(obj, inspect);
        var isPlainObject = gPO ? gPO(obj) === Object.prototype : obj instanceof Object || obj.constructor === Object;
        var protoTag = obj instanceof Object ? '' : 'null prototype';
        var stringTag = !isPlainObject && toStringTag && Object(obj) === obj && toStringTag in obj ? $slice.call(toStr(obj), 8, -1) : protoTag ? 'Object' : '';
        var constructorTag = isPlainObject || typeof obj.constructor !== 'function' ? '' : obj.constructor.name ? obj.constructor.name + ' ' : '';
        var tag = constructorTag + (stringTag || protoTag ? '[' + $join.call($concat.call([], stringTag || [], protoTag || []), ': ') + '] ' : '');
        if (ys.length === 0) { return tag + '{}'; }
        if (indent) {
            return tag + '{' + indentedJoin(ys, indent) + '}';
        }
        return tag + '{ ' + $join.call(ys, ', ') + ' }';
    }
    return String(obj);
};

function wrapQuotes(s, defaultStyle, opts) {
    var style = opts.quoteStyle || defaultStyle;
    var quoteChar = quotes[style];
    return quoteChar + s + quoteChar;
}

function quote(s) {
    return $replace.call(String(s), /"/g, '&quot;');
}

function canTrustToString(obj) {
    return !toStringTag || !(typeof obj === 'object' && (toStringTag in obj || typeof obj[toStringTag] !== 'undefined'));
}
function isArray(obj) { return toStr(obj) === '[object Array]' && canTrustToString(obj); }
function isDate(obj) { return toStr(obj) === '[object Date]' && canTrustToString(obj); }
function isRegExp(obj) { return toStr(obj) === '[object RegExp]' && canTrustToString(obj); }
function isError(obj) { return toStr(obj) === '[object Error]' && canTrustToString(obj); }
function isString(obj) { return toStr(obj) === '[object String]' && canTrustToString(obj); }
function isNumber(obj) { return toStr(obj) === '[object Number]' && canTrustToString(obj); }
function isBoolean(obj) { return toStr(obj) === '[object Boolean]' && canTrustToString(obj); }

// Symbol and BigInt do have Symbol.toStringTag by spec, so that can't be used to eliminate false positives
function isSymbol(obj) {
    if (hasShammedSymbols) {
        return obj && typeof obj === 'object' && obj instanceof Symbol;
    }
    if (typeof obj === 'symbol') {
        return true;
    }
    if (!obj || typeof obj !== 'object' || !symToString) {
        return false;
    }
    try {
        symToString.call(obj);
        return true;
    } catch (e) {}
    return false;
}

function isBigInt(obj) {
    if (!obj || typeof obj !== 'object' || !bigIntValueOf) {
        return false;
    }
    try {
        bigIntValueOf.call(obj);
        return true;
    } catch (e) {}
    return false;
}

var hasOwn = Object.prototype.hasOwnProperty || function (key) { return key in this; };
function has(obj, key) {
    return hasOwn.call(obj, key);
}

function toStr(obj) {
    return objectToString.call(obj);
}

function nameOf(f) {
    if (f.name) { return f.name; }
    var m = $match.call(functionToString.call(f), /^function\s*([\w$]+)/);
    if (m) { return m[1]; }
    return null;
}

function indexOf(xs, x) {
    if (xs.indexOf) { return xs.indexOf(x); }
    for (var i = 0, l = xs.length; i < l; i++) {
        if (xs[i] === x) { return i; }
    }
    return -1;
}

function isMap(x) {
    if (!mapSize || !x || typeof x !== 'object') {
        return false;
    }
    try {
        mapSize.call(x);
        try {
            setSize.call(x);
        } catch (s) {
            return true;
        }
        return x instanceof Map; // core-js workaround, pre-v2.5.0
    } catch (e) {}
    return false;
}

function isWeakMap(x) {
    if (!weakMapHas || !x || typeof x !== 'object') {
        return false;
    }
    try {
        weakMapHas.call(x, weakMapHas);
        try {
            weakSetHas.call(x, weakSetHas);
        } catch (s) {
            return true;
        }
        return x instanceof WeakMap; // core-js workaround, pre-v2.5.0
    } catch (e) {}
    return false;
}

function isWeakRef(x) {
    if (!weakRefDeref || !x || typeof x !== 'object') {
        return false;
    }
    try {
        weakRefDeref.call(x);
        return true;
    } catch (e) {}
    return false;
}

function isSet(x) {
    if (!setSize || !x || typeof x !== 'object') {
        return false;
    }
    try {
        setSize.call(x);
        try {
            mapSize.call(x);
        } catch (m) {
            return true;
        }
        return x instanceof Set; // core-js workaround, pre-v2.5.0
    } catch (e) {}
    return false;
}

function isWeakSet(x) {
    if (!weakSetHas || !x || typeof x !== 'object') {
        return false;
    }
    try {
        weakSetHas.call(x, weakSetHas);
        try {
            weakMapHas.call(x, weakMapHas);
        } catch (s) {
            return true;
        }
        return x instanceof WeakSet; // core-js workaround, pre-v2.5.0
    } catch (e) {}
    return false;
}

function isElement(x) {
    if (!x || typeof x !== 'object') { return false; }
    if (typeof HTMLElement !== 'undefined' && x instanceof HTMLElement) {
        return true;
    }
    return typeof x.nodeName === 'string' && typeof x.getAttribute === 'function';
}

function inspectString(str, opts) {
    if (str.length > opts.maxStringLength) {
        var remaining = str.length - opts.maxStringLength;
        var trailer = '... ' + remaining + ' more character' + (remaining > 1 ? 's' : '');
        return inspectString($slice.call(str, 0, opts.maxStringLength), opts) + trailer;
    }
    var quoteRE = quoteREs[opts.quoteStyle || 'single'];
    quoteRE.lastIndex = 0;
    // eslint-disable-next-line no-control-regex
    var s = $replace.call($replace.call(str, quoteRE, '\\$1'), /[\x00-\x1f]/g, lowbyte);
    return wrapQuotes(s, 'single', opts);
}

function lowbyte(c) {
    var n = c.charCodeAt(0);
    var x = {
        8: 'b',
        9: 't',
        10: 'n',
        12: 'f',
        13: 'r'
    }[n];
    if (x) { return '\\' + x; }
    return '\\x' + (n < 0x10 ? '0' : '') + $toUpperCase.call(n.toString(16));
}

function markBoxed(str) {
    return 'Object(' + str + ')';
}

function weakCollectionOf(type) {
    return type + ' { ? }';
}

function collectionOf(type, size, entries, indent) {
    var joinedEntries = indent ? indentedJoin(entries, indent) : $join.call(entries, ', ');
    return type + ' (' + size + ') {' + joinedEntries + '}';
}

function singleLineValues(xs) {
    for (var i = 0; i < xs.length; i++) {
        if (indexOf(xs[i], '\n') >= 0) {
            return false;
        }
    }
    return true;
}

function getIndent(opts, depth) {
    var baseIndent;
    if (opts.indent === '\t') {
        baseIndent = '\t';
    } else if (typeof opts.indent === 'number' && opts.indent > 0) {
        baseIndent = $join.call(Array(opts.indent + 1), ' ');
    } else {
        return null;
    }
    return {
        base: baseIndent,
        prev: $join.call(Array(depth + 1), baseIndent)
    };
}

function indentedJoin(xs, indent) {
    if (xs.length === 0) { return ''; }
    var lineJoiner = '\n' + indent.prev + indent.base;
    return lineJoiner + $join.call(xs, ',' + lineJoiner) + '\n' + indent.prev;
}

function arrObjKeys(obj, inspect) {
    var isArr = isArray(obj);
    var xs = [];
    if (isArr) {
        xs.length = obj.length;
        for (var i = 0; i < obj.length; i++) {
            xs[i] = has(obj, i) ? inspect(obj[i], obj) : '';
        }
    }
    var syms = typeof gOPS === 'function' ? gOPS(obj) : [];
    var symMap;
    if (hasShammedSymbols) {
        symMap = {};
        for (var k = 0; k < syms.length; k++) {
            symMap['$' + syms[k]] = syms[k];
        }
    }

    for (var key in obj) { // eslint-disable-line no-restricted-syntax
        if (!has(obj, key)) { continue; } // eslint-disable-line no-restricted-syntax, no-continue
        if (isArr && String(Number(key)) === key && key < obj.length) { continue; } // eslint-disable-line no-restricted-syntax, no-continue
        if (hasShammedSymbols && symMap['$' + key] instanceof Symbol) {
            // this is to prevent shammed Symbols, which are stored as strings, from being included in the string key section
            continue; // eslint-disable-line no-restricted-syntax, no-continue
        } else if ($test.call(/[^\w$]/, key)) {
            xs.push(inspect(key, obj) + ': ' + inspect(obj[key], obj));
        } else {
            xs.push(key + ': ' + inspect(obj[key], obj));
        }
    }
    if (typeof gOPS === 'function') {
        for (var j = 0; j < syms.length; j++) {
            if (isEnumerable.call(obj, syms[j])) {
                xs.push('[' + inspect(syms[j]) + ']: ' + inspect(obj[syms[j]], obj));
            }
        }
    }
    return xs;
}


/***/ }),

/***/ 7265:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

module.exports = __nccwpck_require__(3837).inspect;


/***/ }),

/***/ 4274:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

"use strict";


module.exports = __nccwpck_require__(1378);


/***/ }),

/***/ 4550:
/***/ ((module) => {

"use strict";


const WIN_SLASH = '\\\\/';
const WIN_NO_SLASH = `[^${WIN_SLASH}]`;

/**
 * Posix glob regex
 */

const DOT_LITERAL = '\\.';
const PLUS_LITERAL = '\\+';
const QMARK_LITERAL = '\\?';
const SLASH_LITERAL = '\\/';
const ONE_CHAR = '(?=.)';
const QMARK = '[^/]';
const END_ANCHOR = `(?:${SLASH_LITERAL}|$)`;
const START_ANCHOR = `(?:^|${SLASH_LITERAL})`;
const DOTS_SLASH = `${DOT_LITERAL}{1,2}${END_ANCHOR}`;
const NO_DOT = `(?!${DOT_LITERAL})`;
const NO_DOTS = `(?!${START_ANCHOR}${DOTS_SLASH})`;
const NO_DOT_SLASH = `(?!${DOT_LITERAL}{0,1}${END_ANCHOR})`;
const NO_DOTS_SLASH = `(?!${DOTS_SLASH})`;
const QMARK_NO_DOT = `[^.${SLASH_LITERAL}]`;
const STAR = `${QMARK}*?`;
const SEP = '/';

const POSIX_CHARS = {
  DOT_LITERAL,
  PLUS_LITERAL,
  QMARK_LITERAL,
  SLASH_LITERAL,
  ONE_CHAR,
  QMARK,
  END_ANCHOR,
  DOTS_SLASH,
  NO_DOT,
  NO_DOTS,
  NO_DOT_SLASH,
  NO_DOTS_SLASH,
  QMARK_NO_DOT,
  STAR,
  START_ANCHOR,
  SEP
};

/**
 * Windows glob regex
 */

const WINDOWS_CHARS = {
  ...POSIX_CHARS,

  SLASH_LITERAL: `[${WIN_SLASH}]`,
  QMARK: WIN_NO_SLASH,
  STAR: `${WIN_NO_SLASH}*?`,
  DOTS_SLASH: `${DOT_LITERAL}{1,2}(?:[${WIN_SLASH}]|$)`,
  NO_DOT: `(?!${DOT_LITERAL})`,
  NO_DOTS: `(?!(?:^|[${WIN_SLASH}])${DOT_LITERAL}{1,2}(?:[${WIN_SLASH}]|$))`,
  NO_DOT_SLASH: `(?!${DOT_LITERAL}{0,1}(?:[${WIN_SLASH}]|$))`,
  NO_DOTS_SLASH: `(?!${DOT_LITERAL}{1,2}(?:[${WIN_SLASH}]|$))`,
  QMARK_NO_DOT: `[^.${WIN_SLASH}]`,
  START_ANCHOR: `(?:^|[${WIN_SLASH}])`,
  END_ANCHOR: `(?:[${WIN_SLASH}]|$)`,
  SEP: '\\'
};

/**
 * POSIX Bracket Regex
 */

const POSIX_REGEX_SOURCE = {
  alnum: 'a-zA-Z0-9',
  alpha: 'a-zA-Z',
  ascii: '\\x00-\\x7F',
  blank: ' \\t',
  cntrl: '\\x00-\\x1F\\x7F',
  digit: '0-9',
  graph: '\\x21-\\x7E',
  lower: 'a-z',
  print: '\\x20-\\x7E ',
  punct: '\\-!"#$%&\'()\\*+,./:;<=>?@[\\]^_`{|}~',
  space: ' \\t\\r\\n\\v\\f',
  upper: 'A-Z',
  word: 'A-Za-z0-9_',
  xdigit: 'A-Fa-f0-9'
};

module.exports = {
  MAX_LENGTH: 1024 * 64,
  POSIX_REGEX_SOURCE,

  // regular expressions
  REGEX_BACKSLASH: /\\(?![*+?^${}(|)[\]])/g,
  REGEX_NON_SPECIAL_CHARS: /^[^@![\].,$*+?^{}()|\\/]+/,
  REGEX_SPECIAL_CHARS: /[-*+?.^${}(|)[\]]/,
  REGEX_SPECIAL_CHARS_BACKREF: /(\\?)((\W)(\3*))/g,
  REGEX_SPECIAL_CHARS_GLOBAL: /([-*+?.^${}(|)[\]])/g,
  REGEX_REMOVE_BACKSLASH: /(?:\[.*?[^\\]\]|\\(?=.))/g,

  // Replace globs with equivalent patterns to reduce parsing time.
  REPLACEMENTS: {
    '***': '*',
    '**/**': '**',
    '**/**/**': '**'
  },

  // Digits
  CHAR_0: 48, /* 0 */
  CHAR_9: 57, /* 9 */

  // Alphabet chars.
  CHAR_UPPERCASE_A: 65, /* A */
  CHAR_LOWERCASE_A: 97, /* a */
  CHAR_UPPERCASE_Z: 90, /* Z */
  CHAR_LOWERCASE_Z: 122, /* z */

  CHAR_LEFT_PARENTHESES: 40, /* ( */
  CHAR_RIGHT_PARENTHESES: 41, /* ) */

  CHAR_ASTERISK: 42, /* * */

  // Non-alphabetic chars.
  CHAR_AMPERSAND: 38, /* & */
  CHAR_AT: 64, /* @ */
  CHAR_BACKWARD_SLASH: 92, /* \ */
  CHAR_CARRIAGE_RETURN: 13, /* \r */
  CHAR_CIRCUMFLEX_ACCENT: 94, /* ^ */
  CHAR_COLON: 58, /* : */
  CHAR_COMMA: 44, /* , */
  CHAR_DOT: 46, /* . */
  CHAR_DOUBLE_QUOTE: 34, /* " */
  CHAR_EQUAL: 61, /* = */
  CHAR_EXCLAMATION_MARK: 33, /* ! */
  CHAR_FORM_FEED: 12, /* \f */
  CHAR_FORWARD_SLASH: 47, /* / */
  CHAR_GRAVE_ACCENT: 96, /* ` */
  CHAR_HASH: 35, /* # */
  CHAR_HYPHEN_MINUS: 45, /* - */
  CHAR_LEFT_ANGLE_BRACKET: 60, /* < */
  CHAR_LEFT_CURLY_BRACE: 123, /* { */
  CHAR_LEFT_SQUARE_BRACKET: 91, /* [ */
  CHAR_LINE_FEED: 10, /* \n */
  CHAR_NO_BREAK_SPACE: 160, /* \u00A0 */
  CHAR_PERCENT: 37, /* % */
  CHAR_PLUS: 43, /* + */
  CHAR_QUESTION_MARK: 63, /* ? */
  CHAR_RIGHT_ANGLE_BRACKET: 62, /* > */
  CHAR_RIGHT_CURLY_BRACE: 125, /* } */
  CHAR_RIGHT_SQUARE_BRACKET: 93, /* ] */
  CHAR_SEMICOLON: 59, /* ; */
  CHAR_SINGLE_QUOTE: 39, /* ' */
  CHAR_SPACE: 32, /*   */
  CHAR_TAB: 9, /* \t */
  CHAR_UNDERSCORE: 95, /* _ */
  CHAR_VERTICAL_LINE: 124, /* | */
  CHAR_ZERO_WIDTH_NOBREAK_SPACE: 65279, /* \uFEFF */

  /**
   * Create EXTGLOB_CHARS
   */

  extglobChars(chars) {
    return {
      '!': { type: 'negate', open: '(?:(?!(?:', close: `))${chars.STAR})` },
      '?': { type: 'qmark', open: '(?:', close: ')?' },
      '+': { type: 'plus', open: '(?:', close: ')+' },
      '*': { type: 'star', open: '(?:', close: ')*' },
      '@': { type: 'at', open: '(?:', close: ')' }
    };
  },

  /**
   * Create GLOB_CHARS
   */

  globChars(win32) {
    return win32 === true ? WINDOWS_CHARS : POSIX_CHARS;
  }
};


/***/ }),

/***/ 136:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

"use strict";


const constants = __nccwpck_require__(4550);
const utils = __nccwpck_require__(3402);

/**
 * Constants
 */

const {
  MAX_LENGTH,
  POSIX_REGEX_SOURCE,
  REGEX_NON_SPECIAL_CHARS,
  REGEX_SPECIAL_CHARS_BACKREF,
  REPLACEMENTS
} = constants;

/**
 * Helpers
 */

const expandRange = (args, options) => {
  if (typeof options.expandRange === 'function') {
    return options.expandRange(...args, options);
  }

  args.sort();
  const value = `[${args.join('-')}]`;

  try {
    /* eslint-disable-next-line no-new */
    new RegExp(value);
  } catch (ex) {
    return args.map(v => utils.escapeRegex(v)).join('..');
  }

  return value;
};

/**
 * Create the message for a syntax error
 */

const syntaxError = (type, char) => {
  return `Missing ${type}: "${char}" - use "\\\\${char}" to match literal characters`;
};

/**
 * Parse the given input string.
 * @param {String} input
 * @param {Object} options
 * @return {Object}
 */

const parse = (input, options) => {
  if (typeof input !== 'string') {
    throw new TypeError('Expected a string');
  }

  input = REPLACEMENTS[input] || input;

  const opts = { ...options };
  const max = typeof opts.maxLength === 'number' ? Math.min(MAX_LENGTH, opts.maxLength) : MAX_LENGTH;

  let len = input.length;
  if (len > max) {
    throw new SyntaxError(`Input length: ${len}, exceeds maximum allowed length: ${max}`);
  }

  const bos = { type: 'bos', value: '', output: opts.prepend || '' };
  const tokens = [bos];

  const capture = opts.capture ? '' : '?:';

  // create constants based on platform, for windows or posix
  const PLATFORM_CHARS = constants.globChars(opts.windows);
  const EXTGLOB_CHARS = constants.extglobChars(PLATFORM_CHARS);

  const {
    DOT_LITERAL,
    PLUS_LITERAL,
    SLASH_LITERAL,
    ONE_CHAR,
    DOTS_SLASH,
    NO_DOT,
    NO_DOT_SLASH,
    NO_DOTS_SLASH,
    QMARK,
    QMARK_NO_DOT,
    STAR,
    START_ANCHOR
  } = PLATFORM_CHARS;

  const globstar = (opts) => {
    return `(${capture}(?:(?!${START_ANCHOR}${opts.dot ? DOTS_SLASH : DOT_LITERAL}).)*?)`;
  };

  const nodot = opts.dot ? '' : NO_DOT;
  const qmarkNoDot = opts.dot ? QMARK : QMARK_NO_DOT;
  let star = opts.bash === true ? globstar(opts) : STAR;

  if (opts.capture) {
    star = `(${star})`;
  }

  // minimatch options support
  if (typeof opts.noext === 'boolean') {
    opts.noextglob = opts.noext;
  }

  const state = {
    input,
    index: -1,
    start: 0,
    dot: opts.dot === true,
    consumed: '',
    output: '',
    prefix: '',
    backtrack: false,
    negated: false,
    brackets: 0,
    braces: 0,
    parens: 0,
    quotes: 0,
    globstar: false,
    tokens
  };

  input = utils.removePrefix(input, state);
  len = input.length;

  const extglobs = [];
  const braces = [];
  const stack = [];
  let prev = bos;
  let value;

  /**
   * Tokenizing helpers
   */

  const eos = () => state.index === len - 1;
  const peek = state.peek = (n = 1) => input[state.index + n];
  const advance = state.advance = () => input[++state.index];
  const remaining = () => input.slice(state.index + 1);
  const consume = (value = '', num = 0) => {
    state.consumed += value;
    state.index += num;
  };
  const append = token => {
    state.output += token.output != null ? token.output : token.value;
    consume(token.value);
  };

  const negate = () => {
    let count = 1;

    while (peek() === '!' && (peek(2) !== '(' || peek(3) === '?')) {
      advance();
      state.start++;
      count++;
    }

    if (count % 2 === 0) {
      return false;
    }

    state.negated = true;
    state.start++;
    return true;
  };

  const increment = type => {
    state[type]++;
    stack.push(type);
  };

  const decrement = type => {
    state[type]--;
    stack.pop();
  };

  /**
   * Push tokens onto the tokens array. This helper speeds up
   * tokenizing by 1) helping us avoid backtracking as much as possible,
   * and 2) helping us avoid creating extra tokens when consecutive
   * characters are plain text. This improves performance and simplifies
   * lookbehinds.
   */

  const push = tok => {
    if (prev.type === 'globstar') {
      const isBrace = state.braces > 0 && (tok.type === 'comma' || tok.type === 'brace');
      const isExtglob = tok.extglob === true || (extglobs.length && (tok.type === 'pipe' || tok.type === 'paren'));

      if (tok.type !== 'slash' && tok.type !== 'paren' && !isBrace && !isExtglob) {
        state.output = state.output.slice(0, -prev.output.length);
        prev.type = 'star';
        prev.value = '*';
        prev.output = star;
        state.output += prev.output;
      }
    }

    if (extglobs.length && tok.type !== 'paren' && !EXTGLOB_CHARS[tok.value]) {
      extglobs[extglobs.length - 1].inner += tok.value;
    }

    if (tok.value || tok.output) append(tok);
    if (prev && prev.type === 'text' && tok.type === 'text') {
      prev.value += tok.value;
      prev.output = (prev.output || '') + tok.value;
      return;
    }

    tok.prev = prev;
    tokens.push(tok);
    prev = tok;
  };

  const extglobOpen = (type, value) => {
    const token = { ...EXTGLOB_CHARS[value], conditions: 1, inner: '' };

    token.prev = prev;
    token.parens = state.parens;
    token.output = state.output;
    const output = (opts.capture ? '(' : '') + token.open;

    increment('parens');
    push({ type, value, output: state.output ? '' : ONE_CHAR });
    push({ type: 'paren', extglob: true, value: advance(), output });
    extglobs.push(token);
  };

  const extglobClose = token => {
    let output = token.close + (opts.capture ? ')' : '');

    if (token.type === 'negate') {
      let extglobStar = star;

      if (token.inner && token.inner.length > 1 && token.inner.includes('/')) {
        extglobStar = globstar(opts);
      }

      if (extglobStar !== star || eos() || /^\)+$/.test(remaining())) {
        output = token.close = `)$))${extglobStar}`;
      }

      if (token.prev.type === 'bos' && eos()) {
        state.negatedExtglob = true;
      }
    }

    push({ type: 'paren', extglob: true, value, output });
    decrement('parens');
  };

  /**
   * Fast paths
   */

  if (opts.fastpaths !== false && !/(^[*!]|[/()[\]{}"])/.test(input)) {
    let backslashes = false;

    let output = input.replace(REGEX_SPECIAL_CHARS_BACKREF, (m, esc, chars, first, rest, index) => {
      if (first === '\\') {
        backslashes = true;
        return m;
      }

      if (first === '?') {
        if (esc) {
          return esc + first + (rest ? QMARK.repeat(rest.length) : '');
        }
        if (index === 0) {
          return qmarkNoDot + (rest ? QMARK.repeat(rest.length) : '');
        }
        return QMARK.repeat(chars.length);
      }

      if (first === '.') {
        return DOT_LITERAL.repeat(chars.length);
      }

      if (first === '*') {
        if (esc) {
          return esc + first + (rest ? star : '');
        }
        return star;
      }
      return esc ? m : `\\${m}`;
    });

    if (backslashes === true) {
      if (opts.unescape === true) {
        output = output.replace(/\\/g, '');
      } else {
        output = output.replace(/\\+/g, m => {
          return m.length % 2 === 0 ? '\\\\' : (m ? '\\' : '');
        });
      }
    }

    if (output === input && opts.contains === true) {
      state.output = input;
      return state;
    }

    state.output = utils.wrapOutput(output, state, options);
    return state;
  }

  /**
   * Tokenize input until we reach end-of-string
   */

  while (!eos()) {
    value = advance();

    if (value === '\u0000') {
      continue;
    }

    /**
     * Escaped characters
     */

    if (value === '\\') {
      const next = peek();

      if (next === '/' && opts.bash !== true) {
        continue;
      }

      if (next === '.' || next === ';') {
        continue;
      }

      if (!next) {
        value += '\\';
        push({ type: 'text', value });
        continue;
      }

      // collapse slashes to reduce potential for exploits
      const match = /^\\+/.exec(remaining());
      let slashes = 0;

      if (match && match[0].length > 2) {
        slashes = match[0].length;
        state.index += slashes;
        if (slashes % 2 !== 0) {
          value += '\\';
        }
      }

      if (opts.unescape === true) {
        value = advance() || '';
      } else {
        value += advance() || '';
      }

      if (state.brackets === 0) {
        push({ type: 'text', value });
        continue;
      }
    }

    /**
     * If we're inside a regex character class, continue
     * until we reach the closing bracket.
     */

    if (state.brackets > 0 && (value !== ']' || prev.value === '[' || prev.value === '[^')) {
      if (opts.posix !== false && value === ':') {
        const inner = prev.value.slice(1);
        if (inner.includes('[')) {
          prev.posix = true;

          if (inner.includes(':')) {
            const idx = prev.value.lastIndexOf('[');
            const pre = prev.value.slice(0, idx);
            const rest = prev.value.slice(idx + 2);
            const posix = POSIX_REGEX_SOURCE[rest];
            if (posix) {
              prev.value = pre + posix;
              state.backtrack = true;
              advance();

              if (!bos.output && tokens.indexOf(prev) === 1) {
                bos.output = ONE_CHAR;
              }
              continue;
            }
          }
        }
      }

      if ((value === '[' && peek() !== ':') || (value === '-' && peek() === ']')) {
        value = `\\${value}`;
      }

      if (value === ']' && (prev.value === '[' || prev.value === '[^')) {
        value = `\\${value}`;
      }

      if (opts.posix === true && value === '!' && prev.value === '[') {
        value = '^';
      }

      prev.value += value;
      append({ value });
      continue;
    }

    /**
     * If we're inside a quoted string, continue
     * until we reach the closing double quote.
     */

    if (state.quotes === 1 && value !== '"') {
      value = utils.escapeRegex(value);
      prev.value += value;
      append({ value });
      continue;
    }

    /**
     * Double quotes
     */

    if (value === '"') {
      state.quotes = state.quotes === 1 ? 0 : 1;
      if (opts.keepQuotes === true) {
        push({ type: 'text', value });
      }
      continue;
    }

    /**
     * Parentheses
     */

    if (value === '(') {
      increment('parens');
      push({ type: 'paren', value });
      continue;
    }

    if (value === ')') {
      if (state.parens === 0 && opts.strictBrackets === true) {
        throw new SyntaxError(syntaxError('opening', '('));
      }

      const extglob = extglobs[extglobs.length - 1];
      if (extglob && state.parens === extglob.parens + 1) {
        extglobClose(extglobs.pop());
        continue;
      }

      push({ type: 'paren', value, output: state.parens ? ')' : '\\)' });
      decrement('parens');
      continue;
    }

    /**
     * Square brackets
     */

    if (value === '[') {
      if (opts.nobracket === true || !remaining().includes(']')) {
        if (opts.nobracket !== true && opts.strictBrackets === true) {
          throw new SyntaxError(syntaxError('closing', ']'));
        }

        value = `\\${value}`;
      } else {
        increment('brackets');
      }

      push({ type: 'bracket', value });
      continue;
    }

    if (value === ']') {
      if (opts.nobracket === true || (prev && prev.type === 'bracket' && prev.value.length === 1)) {
        push({ type: 'text', value, output: `\\${value}` });
        continue;
      }

      if (state.brackets === 0) {
        if (opts.strictBrackets === true) {
          throw new SyntaxError(syntaxError('opening', '['));
        }

        push({ type: 'text', value, output: `\\${value}` });
        continue;
      }

      decrement('brackets');

      const prevValue = prev.value.slice(1);
      if (prev.posix !== true && prevValue[0] === '^' && !prevValue.includes('/')) {
        value = `/${value}`;
      }

      prev.value += value;
      append({ value });

      // when literal brackets are explicitly disabled
      // assume we should match with a regex character class
      if (opts.literalBrackets === false || utils.hasRegexChars(prevValue)) {
        continue;
      }

      const escaped = utils.escapeRegex(prev.value);
      state.output = state.output.slice(0, -prev.value.length);

      // when literal brackets are explicitly enabled
      // assume we should escape the brackets to match literal characters
      if (opts.literalBrackets === true) {
        state.output += escaped;
        prev.value = escaped;
        continue;
      }

      // when the user specifies nothing, try to match both
      prev.value = `(${capture}${escaped}|${prev.value})`;
      state.output += prev.value;
      continue;
    }

    /**
     * Braces
     */

    if (value === '{' && opts.nobrace !== true) {
      increment('braces');

      const open = {
        type: 'brace',
        value,
        output: '(',
        outputIndex: state.output.length,
        tokensIndex: state.tokens.length
      };

      braces.push(open);
      push(open);
      continue;
    }

    if (value === '}') {
      const brace = braces[braces.length - 1];

      if (opts.nobrace === true || !brace) {
        push({ type: 'text', value, output: value });
        continue;
      }

      let output = ')';

      if (brace.dots === true) {
        const arr = tokens.slice();
        const range = [];

        for (let i = arr.length - 1; i >= 0; i--) {
          tokens.pop();
          if (arr[i].type === 'brace') {
            break;
          }
          if (arr[i].type !== 'dots') {
            range.unshift(arr[i].value);
          }
        }

        output = expandRange(range, opts);
        state.backtrack = true;
      }

      if (brace.comma !== true && brace.dots !== true) {
        const out = state.output.slice(0, brace.outputIndex);
        const toks = state.tokens.slice(brace.tokensIndex);
        brace.value = brace.output = '\\{';
        value = output = '\\}';
        state.output = out;
        for (const t of toks) {
          state.output += (t.output || t.value);
        }
      }

      push({ type: 'brace', value, output });
      decrement('braces');
      braces.pop();
      continue;
    }

    /**
     * Pipes
     */

    if (value === '|') {
      if (extglobs.length > 0) {
        extglobs[extglobs.length - 1].conditions++;
      }
      push({ type: 'text', value });
      continue;
    }

    /**
     * Commas
     */

    if (value === ',') {
      let output = value;

      const brace = braces[braces.length - 1];
      if (brace && stack[stack.length - 1] === 'braces') {
        brace.comma = true;
        output = '|';
      }

      push({ type: 'comma', value, output });
      continue;
    }

    /**
     * Slashes
     */

    if (value === '/') {
      // if the beginning of the glob is "./", advance the start
      // to the current index, and don't add the "./" characters
      // to the state. This greatly simplifies lookbehinds when
      // checking for BOS characters like "!" and "." (not "./")
      if (prev.type === 'dot' && state.index === state.start + 1) {
        state.start = state.index + 1;
        state.consumed = '';
        state.output = '';
        tokens.pop();
        prev = bos; // reset "prev" to the first token
        continue;
      }

      push({ type: 'slash', value, output: SLASH_LITERAL });
      continue;
    }

    /**
     * Dots
     */

    if (value === '.') {
      if (state.braces > 0 && prev.type === 'dot') {
        if (prev.value === '.') prev.output = DOT_LITERAL;
        const brace = braces[braces.length - 1];
        prev.type = 'dots';
        prev.output += value;
        prev.value += value;
        brace.dots = true;
        continue;
      }

      if ((state.braces + state.parens) === 0 && prev.type !== 'bos' && prev.type !== 'slash') {
        push({ type: 'text', value, output: DOT_LITERAL });
        continue;
      }

      push({ type: 'dot', value, output: DOT_LITERAL });
      continue;
    }

    /**
     * Question marks
     */

    if (value === '?') {
      const isGroup = prev && prev.value === '(';
      if (!isGroup && opts.noextglob !== true && peek() === '(' && peek(2) !== '?') {
        extglobOpen('qmark', value);
        continue;
      }

      if (prev && prev.type === 'paren') {
        const next = peek();
        let output = value;

        if (next === '<' && !utils.supportsLookbehinds()) {
          throw new Error('Node.js v10 or higher is required for regex lookbehinds');
        }

        if ((prev.value === '(' && !/[!=<:]/.test(next)) || (next === '<' && !/<([!=]|\w+>)/.test(remaining()))) {
          output = `\\${value}`;
        }

        push({ type: 'text', value, output });
        continue;
      }

      if (opts.dot !== true && (prev.type === 'slash' || prev.type === 'bos')) {
        push({ type: 'qmark', value, output: QMARK_NO_DOT });
        continue;
      }

      push({ type: 'qmark', value, output: QMARK });
      continue;
    }

    /**
     * Exclamation
     */

    if (value === '!') {
      if (opts.noextglob !== true && peek() === '(') {
        if (peek(2) !== '?' || !/[!=<:]/.test(peek(3))) {
          extglobOpen('negate', value);
          continue;
        }
      }

      if (opts.nonegate !== true && state.index === 0) {
        negate();
        continue;
      }
    }

    /**
     * Plus
     */

    if (value === '+') {
      if (opts.noextglob !== true && peek() === '(' && peek(2) !== '?') {
        extglobOpen('plus', value);
        continue;
      }

      if ((prev && prev.value === '(') || opts.regex === false) {
        push({ type: 'plus', value, output: PLUS_LITERAL });
        continue;
      }

      if ((prev && (prev.type === 'bracket' || prev.type === 'paren' || prev.type === 'brace')) || state.parens > 0) {
        push({ type: 'plus', value });
        continue;
      }

      push({ type: 'plus', value: PLUS_LITERAL });
      continue;
    }

    /**
     * Plain text
     */

    if (value === '@') {
      if (opts.noextglob !== true && peek() === '(' && peek(2) !== '?') {
        push({ type: 'at', extglob: true, value, output: '' });
        continue;
      }

      push({ type: 'text', value });
      continue;
    }

    /**
     * Plain text
     */

    if (value !== '*') {
      if (value === '$' || value === '^') {
        value = `\\${value}`;
      }

      const match = REGEX_NON_SPECIAL_CHARS.exec(remaining());
      if (match) {
        value += match[0];
        state.index += match[0].length;
      }

      push({ type: 'text', value });
      continue;
    }

    /**
     * Stars
     */

    if (prev && (prev.type === 'globstar' || prev.star === true)) {
      prev.type = 'star';
      prev.star = true;
      prev.value += value;
      prev.output = star;
      state.backtrack = true;
      state.globstar = true;
      consume(value);
      continue;
    }

    let rest = remaining();
    if (opts.noextglob !== true && /^\([^?]/.test(rest)) {
      extglobOpen('star', value);
      continue;
    }

    if (prev.type === 'star') {
      if (opts.noglobstar === true) {
        consume(value);
        continue;
      }

      const prior = prev.prev;
      const before = prior.prev;
      const isStart = prior.type === 'slash' || prior.type === 'bos';
      const afterStar = before && (before.type === 'star' || before.type === 'globstar');

      if (opts.bash === true && (!isStart || (rest[0] && rest[0] !== '/'))) {
        push({ type: 'star', value, output: '' });
        continue;
      }

      const isBrace = state.braces > 0 && (prior.type === 'comma' || prior.type === 'brace');
      const isExtglob = extglobs.length && (prior.type === 'pipe' || prior.type === 'paren');
      if (!isStart && prior.type !== 'paren' && !isBrace && !isExtglob) {
        push({ type: 'star', value, output: '' });
        continue;
      }

      // strip consecutive `/**/`
      while (rest.slice(0, 3) === '/**') {
        const after = input[state.index + 4];
        if (after && after !== '/') {
          break;
        }
        rest = rest.slice(3);
        consume('/**', 3);
      }

      if (prior.type === 'bos' && eos()) {
        prev.type = 'globstar';
        prev.value += value;
        prev.output = globstar(opts);
        state.output = prev.output;
        state.globstar = true;
        consume(value);
        continue;
      }

      if (prior.type === 'slash' && prior.prev.type !== 'bos' && !afterStar && eos()) {
        state.output = state.output.slice(0, -(prior.output + prev.output).length);
        prior.output = `(?:${prior.output}`;

        prev.type = 'globstar';
        prev.output = globstar(opts) + (opts.strictSlashes ? ')' : '|$)');
        prev.value += value;
        state.globstar = true;
        state.output += prior.output + prev.output;
        consume(value);
        continue;
      }

      if (prior.type === 'slash' && prior.prev.type !== 'bos' && rest[0] === '/') {
        const end = rest[1] !== void 0 ? '|$' : '';

        state.output = state.output.slice(0, -(prior.output + prev.output).length);
        prior.output = `(?:${prior.output}`;

        prev.type = 'globstar';
        prev.output = `${globstar(opts)}${SLASH_LITERAL}|${SLASH_LITERAL}${end})`;
        prev.value += value;

        state.output += prior.output + prev.output;
        state.globstar = true;

        consume(value + advance());

        push({ type: 'slash', value: '/', output: '' });
        continue;
      }

      if (prior.type === 'bos' && rest[0] === '/') {
        prev.type = 'globstar';
        prev.value += value;
        prev.output = `(?:^|${SLASH_LITERAL}|${globstar(opts)}${SLASH_LITERAL})`;
        state.output = prev.output;
        state.globstar = true;
        consume(value + advance());
        push({ type: 'slash', value: '/', output: '' });
        continue;
      }

      // remove single star from output
      state.output = state.output.slice(0, -prev.output.length);

      // reset previous token to globstar
      prev.type = 'globstar';
      prev.output = globstar(opts);
      prev.value += value;

      // reset output with globstar
      state.output += prev.output;
      state.globstar = true;
      consume(value);
      continue;
    }

    const token = { type: 'star', value, output: star };

    if (opts.bash === true) {
      token.output = '.*?';
      if (prev.type === 'bos' || prev.type === 'slash') {
        token.output = nodot + token.output;
      }
      push(token);
      continue;
    }

    if (prev && (prev.type === 'bracket' || prev.type === 'paren') && opts.regex === true) {
      token.output = value;
      push(token);
      continue;
    }

    if (state.index === state.start || prev.type === 'slash' || prev.type === 'dot') {
      if (prev.type === 'dot') {
        state.output += NO_DOT_SLASH;
        prev.output += NO_DOT_SLASH;

      } else if (opts.dot === true) {
        state.output += NO_DOTS_SLASH;
        prev.output += NO_DOTS_SLASH;

      } else {
        state.output += nodot;
        prev.output += nodot;
      }

      if (peek() !== '*') {
        state.output += ONE_CHAR;
        prev.output += ONE_CHAR;
      }
    }

    push(token);
  }

  while (state.brackets > 0) {
    if (opts.strictBrackets === true) throw new SyntaxError(syntaxError('closing', ']'));
    state.output = utils.escapeLast(state.output, '[');
    decrement('brackets');
  }

  while (state.parens > 0) {
    if (opts.strictBrackets === true) throw new SyntaxError(syntaxError('closing', ')'));
    state.output = utils.escapeLast(state.output, '(');
    decrement('parens');
  }

  while (state.braces > 0) {
    if (opts.strictBrackets === true) throw new SyntaxError(syntaxError('closing', '}'));
    state.output = utils.escapeLast(state.output, '{');
    decrement('braces');
  }

  if (opts.strictSlashes !== true && (prev.type === 'star' || prev.type === 'bracket')) {
    push({ type: 'maybe_slash', value: '', output: `${SLASH_LITERAL}?` });
  }

  // rebuild the output if we had to backtrack at any point
  if (state.backtrack === true) {
    state.output = '';

    for (const token of state.tokens) {
      state.output += token.output != null ? token.output : token.value;

      if (token.suffix) {
        state.output += token.suffix;
      }
    }
  }

  return state;
};

/**
 * Fast paths for creating regular expressions for common glob patterns.
 * This can significantly speed up processing and has very little downside
 * impact when none of the fast paths match.
 */

parse.fastpaths = (input, options) => {
  const opts = { ...options };
  const max = typeof opts.maxLength === 'number' ? Math.min(MAX_LENGTH, opts.maxLength) : MAX_LENGTH;
  const len = input.length;
  if (len > max) {
    throw new SyntaxError(`Input length: ${len}, exceeds maximum allowed length: ${max}`);
  }

  input = REPLACEMENTS[input] || input;

  // create constants based on platform, for windows or posix
  const {
    DOT_LITERAL,
    SLASH_LITERAL,
    ONE_CHAR,
    DOTS_SLASH,
    NO_DOT,
    NO_DOTS,
    NO_DOTS_SLASH,
    STAR,
    START_ANCHOR
  } = constants.globChars(opts.windows);

  const nodot = opts.dot ? NO_DOTS : NO_DOT;
  const slashDot = opts.dot ? NO_DOTS_SLASH : NO_DOT;
  const capture = opts.capture ? '' : '?:';
  const state = { negated: false, prefix: '' };
  let star = opts.bash === true ? '.*?' : STAR;

  if (opts.capture) {
    star = `(${star})`;
  }

  const globstar = (opts) => {
    if (opts.noglobstar === true) return star;
    return `(${capture}(?:(?!${START_ANCHOR}${opts.dot ? DOTS_SLASH : DOT_LITERAL}).)*?)`;
  };

  const create = str => {
    switch (str) {
      case '*':
        return `${nodot}${ONE_CHAR}${star}`;

      case '.*':
        return `${DOT_LITERAL}${ONE_CHAR}${star}`;

      case '*.*':
        return `${nodot}${star}${DOT_LITERAL}${ONE_CHAR}${star}`;

      case '*/*':
        return `${nodot}${star}${SLASH_LITERAL}${ONE_CHAR}${slashDot}${star}`;

      case '**':
        return nodot + globstar(opts);

      case '**/*':
        return `(?:${nodot}${globstar(opts)}${SLASH_LITERAL})?${slashDot}${ONE_CHAR}${star}`;

      case '**/*.*':
        return `(?:${nodot}${globstar(opts)}${SLASH_LITERAL})?${slashDot}${star}${DOT_LITERAL}${ONE_CHAR}${star}`;

      case '**/.*':
        return `(?:${nodot}${globstar(opts)}${SLASH_LITERAL})?${DOT_LITERAL}${ONE_CHAR}${star}`;

      default: {
        const match = /^(.*?)\.(\w+)$/.exec(str);
        if (!match) return;

        const source = create(match[1]);
        if (!source) return;

        return source + DOT_LITERAL + match[2];
      }
    }
  };

  const output = utils.removePrefix(input, state);
  let source = create(output);

  if (source && opts.strictSlashes !== true) {
    source += `${SLASH_LITERAL}?`;
  }

  return source;
};

module.exports = parse;


/***/ }),

/***/ 1378:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

"use strict";


const scan = __nccwpck_require__(460);
const parse = __nccwpck_require__(136);
const utils = __nccwpck_require__(3402);
const constants = __nccwpck_require__(4550);
const isObject = val => val && typeof val === 'object' && !Array.isArray(val);

/**
 * Creates a matcher function from one or more glob patterns. The
 * returned function takes a string to match as its first argument,
 * and returns true if the string is a match. The returned matcher
 * function also takes a boolean as the second argument that, when true,
 * returns an object with additional information.
 *
 * ```js
 * const picomatch = require('picomatch');
 * // picomatch(glob[, options]);
 *
 * const isMatch = picomatch('*.!(*a)');
 * console.log(isMatch('a.a')); //=> false
 * console.log(isMatch('a.b')); //=> true
 * ```
 * @name picomatch
 * @param {String|Array} `globs` One or more glob patterns.
 * @param {Object=} `options`
 * @return {Function=} Returns a matcher function.
 * @api public
 */

const picomatch = (glob, options, returnState = false) => {
  if (Array.isArray(glob)) {
    const fns = glob.map(input => picomatch(input, options, returnState));
    const arrayMatcher = str => {
      for (const isMatch of fns) {
        const state = isMatch(str);
        if (state) return state;
      }
      return false;
    };
    return arrayMatcher;
  }

  const isState = isObject(glob) && glob.tokens && glob.input;

  if (glob === '' || (typeof glob !== 'string' && !isState)) {
    throw new TypeError('Expected pattern to be a non-empty string');
  }

  const opts = options || {};
  const posix = opts.windows;
  const regex = isState
    ? picomatch.compileRe(glob, options)
    : picomatch.makeRe(glob, options, false, true);

  const state = regex.state;
  delete regex.state;

  let isIgnored = () => false;
  if (opts.ignore) {
    const ignoreOpts = { ...options, ignore: null, onMatch: null, onResult: null };
    isIgnored = picomatch(opts.ignore, ignoreOpts, returnState);
  }

  const matcher = (input, returnObject = false) => {
    const { isMatch, match, output } = picomatch.test(input, regex, options, { glob, posix });
    const result = { glob, state, regex, posix, input, output, match, isMatch };

    if (typeof opts.onResult === 'function') {
      opts.onResult(result);
    }

    if (isMatch === false) {
      result.isMatch = false;
      return returnObject ? result : false;
    }

    if (isIgnored(input)) {
      if (typeof opts.onIgnore === 'function') {
        opts.onIgnore(result);
      }
      result.isMatch = false;
      return returnObject ? result : false;
    }

    if (typeof opts.onMatch === 'function') {
      opts.onMatch(result);
    }
    return returnObject ? result : true;
  };

  if (returnState) {
    matcher.state = state;
  }

  return matcher;
};

/**
 * Test `input` with the given `regex`. This is used by the main
 * `picomatch()` function to test the input string.
 *
 * ```js
 * const picomatch = require('picomatch');
 * // picomatch.test(input, regex[, options]);
 *
 * console.log(picomatch.test('foo/bar', /^(?:([^/]*?)\/([^/]*?))$/));
 * // { isMatch: true, match: [ 'foo/', 'foo', 'bar' ], output: 'foo/bar' }
 * ```
 * @param {String} `input` String to test.
 * @param {RegExp} `regex`
 * @return {Object} Returns an object with matching info.
 * @api public
 */

picomatch.test = (input, regex, options, { glob, posix } = {}) => {
  if (typeof input !== 'string') {
    throw new TypeError('Expected input to be a string');
  }

  if (input === '') {
    return { isMatch: false, output: '' };
  }

  const opts = options || {};
  const format = opts.format || (posix ? utils.toPosixSlashes : null);
  let match = input === glob;
  let output = (match && format) ? format(input) : input;

  if (match === false) {
    output = format ? format(input) : input;
    match = output === glob;
  }

  if (match === false || opts.capture === true) {
    if (opts.matchBase === true || opts.basename === true) {
      match = picomatch.matchBase(input, regex, options, posix);
    } else {
      match = regex.exec(output);
    }
  }

  return { isMatch: Boolean(match), match, output };
};

/**
 * Match the basename of a filepath.
 *
 * ```js
 * const picomatch = require('picomatch');
 * // picomatch.matchBase(input, glob[, options]);
 * console.log(picomatch.matchBase('foo/bar.js', '*.js'); // true
 * ```
 * @param {String} `input` String to test.
 * @param {RegExp|String} `glob` Glob pattern or regex created by [.makeRe](#makeRe).
 * @return {Boolean}
 * @api public
 */

picomatch.matchBase = (input, glob, options) => {
  const regex = glob instanceof RegExp ? glob : picomatch.makeRe(glob, options);
  return regex.test(utils.basename(input));
};

/**
 * Returns true if **any** of the given glob `patterns` match the specified `string`.
 *
 * ```js
 * const picomatch = require('picomatch');
 * // picomatch.isMatch(string, patterns[, options]);
 *
 * console.log(picomatch.isMatch('a.a', ['b.*', '*.a'])); //=> true
 * console.log(picomatch.isMatch('a.a', 'b.*')); //=> false
 * ```
 * @param {String|Array} str The string to test.
 * @param {String|Array} patterns One or more glob patterns to use for matching.
 * @param {Object} [options] See available [options](#options).
 * @return {Boolean} Returns true if any patterns match `str`
 * @api public
 */

picomatch.isMatch = (str, patterns, options) => picomatch(patterns, options)(str);

/**
 * Parse a glob pattern to create the source string for a regular
 * expression.
 *
 * ```js
 * const picomatch = require('picomatch');
 * const result = picomatch.parse(pattern[, options]);
 * ```
 * @param {String} `pattern`
 * @param {Object} `options`
 * @return {Object} Returns an object with useful properties and output to be used as a regex source string.
 * @api public
 */

picomatch.parse = (pattern, options) => {
  if (Array.isArray(pattern)) return pattern.map(p => picomatch.parse(p, options));
  return parse(pattern, { ...options, fastpaths: false });
};

/**
 * Scan a glob pattern to separate the pattern into segments.
 *
 * ```js
 * const picomatch = require('picomatch');
 * // picomatch.scan(input[, options]);
 *
 * const result = picomatch.scan('!./foo/*.js');
 * console.log(result);
 * { prefix: '!./',
 *   input: '!./foo/*.js',
 *   start: 3,
 *   base: 'foo',
 *   glob: '*.js',
 *   isBrace: false,
 *   isBracket: false,
 *   isGlob: true,
 *   isExtglob: false,
 *   isGlobstar: false,
 *   negated: true }
 * ```
 * @param {String} `input` Glob pattern to scan.
 * @param {Object} `options`
 * @return {Object} Returns an object with
 * @api public
 */

picomatch.scan = (input, options) => scan(input, options);

/**
 * Create a regular expression from a parsed glob pattern.
 *
 * ```js
 * const picomatch = require('picomatch');
 * const state = picomatch.parse('*.js');
 * // picomatch.compileRe(state[, options]);
 *
 * console.log(picomatch.compileRe(state));
 * //=> /^(?:(?!\.)(?=.)[^/]*?\.js)$/
 * ```
 * @param {String} `state` The object returned from the `.parse` method.
 * @param {Object} `options`
 * @return {RegExp} Returns a regex created from the given pattern.
 * @api public
 */

picomatch.compileRe = (parsed, options, returnOutput = false, returnState = false) => {
  if (returnOutput === true) {
    return parsed.output;
  }

  const opts = options || {};
  const prepend = opts.contains ? '' : '^';
  const append = opts.contains ? '' : '$';

  let source = `${prepend}(?:${parsed.output})${append}`;
  if (parsed && parsed.negated === true) {
    source = `^(?!${source}).*$`;
  }

  const regex = picomatch.toRegex(source, options);
  if (returnState === true) {
    regex.state = parsed;
  }

  return regex;
};

picomatch.makeRe = (input, options, returnOutput = false, returnState = false) => {
  if (!input || typeof input !== 'string') {
    throw new TypeError('Expected a non-empty string');
  }

  const opts = options || {};
  let parsed = { negated: false, fastpaths: true };
  let prefix = '';
  let output;

  if (input.startsWith('./')) {
    input = input.slice(2);
    prefix = parsed.prefix = './';
  }

  if (opts.fastpaths !== false && (input[0] === '.' || input[0] === '*')) {
    output = parse.fastpaths(input, options);
  }

  if (output === undefined) {
    parsed = parse(input, options);
    parsed.prefix = prefix + (parsed.prefix || '');
  } else {
    parsed.output = output;
  }

  return picomatch.compileRe(parsed, options, returnOutput, returnState);
};

/**
 * Create a regular expression from the given regex source string.
 *
 * ```js
 * const picomatch = require('picomatch');
 * // picomatch.toRegex(source[, options]);
 *
 * const { output } = picomatch.parse('*.js');
 * console.log(picomatch.toRegex(output));
 * //=> /^(?:(?!\.)(?=.)[^/]*?\.js)$/
 * ```
 * @param {String} `source` Regular expression source string.
 * @param {Object} `options`
 * @return {RegExp}
 * @api public
 */

picomatch.toRegex = (source, options) => {
  try {
    const opts = options || {};
    return new RegExp(source, opts.flags || (opts.nocase ? 'i' : ''));
  } catch (err) {
    if (options && options.debug === true) throw err;
    return /$^/;
  }
};

/**
 * Picomatch constants.
 * @return {Object}
 */

picomatch.constants = constants;

/**
 * Expose "picomatch"
 */

module.exports = picomatch;


/***/ }),

/***/ 460:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

"use strict";


const utils = __nccwpck_require__(3402);
const {
  CHAR_ASTERISK,             /* * */
  CHAR_AT,                   /* @ */
  CHAR_BACKWARD_SLASH,       /* \ */
  CHAR_COMMA,                /* , */
  CHAR_DOT,                  /* . */
  CHAR_EXCLAMATION_MARK,     /* ! */
  CHAR_FORWARD_SLASH,        /* / */
  CHAR_LEFT_CURLY_BRACE,     /* { */
  CHAR_LEFT_PARENTHESES,     /* ( */
  CHAR_LEFT_SQUARE_BRACKET,  /* [ */
  CHAR_PLUS,                 /* + */
  CHAR_QUESTION_MARK,        /* ? */
  CHAR_RIGHT_CURLY_BRACE,    /* } */
  CHAR_RIGHT_PARENTHESES,    /* ) */
  CHAR_RIGHT_SQUARE_BRACKET  /* ] */
} = __nccwpck_require__(4550);

const isPathSeparator = code => {
  return code === CHAR_FORWARD_SLASH || code === CHAR_BACKWARD_SLASH;
};

const depth = token => {
  if (token.isPrefix !== true) {
    token.depth = token.isGlobstar ? Infinity : 1;
  }
};

/**
 * Quickly scans a glob pattern and returns an object with a handful of
 * useful properties, like `isGlob`, `path` (the leading non-glob, if it exists),
 * `glob` (the actual pattern), and `negated` (true if the path starts with `!`).
 *
 * ```js
 * const pm = require('picomatch');
 * console.log(pm.scan('foo/bar/*.js'));
 * { isGlob: true, input: 'foo/bar/*.js', base: 'foo/bar', glob: '*.js' }
 * ```
 * @param {String} `str`
 * @param {Object} `options`
 * @return {Object} Returns an object with tokens and regex source string.
 * @api public
 */

const scan = (input, options) => {
  const opts = options || {};

  const length = input.length - 1;
  const scanToEnd = opts.parts === true || opts.scanToEnd === true;
  const slashes = [];
  const tokens = [];
  const parts = [];

  let str = input;
  let index = -1;
  let start = 0;
  let lastIndex = 0;
  let isBrace = false;
  let isBracket = false;
  let isGlob = false;
  let isExtglob = false;
  let isGlobstar = false;
  let braceEscaped = false;
  let backslashes = false;
  let negated = false;
  let finished = false;
  let braces = 0;
  let prev;
  let code;
  let token = { value: '', depth: 0, isGlob: false };

  const eos = () => index >= length;
  const peek = () => str.charCodeAt(index + 1);
  const advance = () => {
    prev = code;
    return str.charCodeAt(++index);
  };

  while (index < length) {
    code = advance();
    let next;

    if (code === CHAR_BACKWARD_SLASH) {
      backslashes = token.backslashes = true;
      code = advance();

      if (code === CHAR_LEFT_CURLY_BRACE) {
        braceEscaped = true;
      }
      continue;
    }

    if (braceEscaped === true || code === CHAR_LEFT_CURLY_BRACE) {
      braces++;

      while (eos() !== true && (code = advance())) {
        if (code === CHAR_BACKWARD_SLASH) {
          backslashes = token.backslashes = true;
          advance();
          continue;
        }

        if (code === CHAR_LEFT_CURLY_BRACE) {
          braces++;
          continue;
        }

        if (braceEscaped !== true && code === CHAR_DOT && (code = advance()) === CHAR_DOT) {
          isBrace = token.isBrace = true;
          isGlob = token.isGlob = true;
          finished = true;

          if (scanToEnd === true) {
            continue;
          }

          break;
        }

        if (braceEscaped !== true && code === CHAR_COMMA) {
          isBrace = token.isBrace = true;
          isGlob = token.isGlob = true;
          finished = true;

          if (scanToEnd === true) {
            continue;
          }

          break;
        }

        if (code === CHAR_RIGHT_CURLY_BRACE) {
          braces--;

          if (braces === 0) {
            braceEscaped = false;
            isBrace = token.isBrace = true;
            finished = true;
            break;
          }
        }
      }

      if (scanToEnd === true) {
        continue;
      }

      break;
    }

    if (code === CHAR_FORWARD_SLASH) {
      slashes.push(index);
      tokens.push(token);
      token = { value: '', depth: 0, isGlob: false };

      if (finished === true) continue;
      if (prev === CHAR_DOT && index === (start + 1)) {
        start += 2;
        continue;
      }

      lastIndex = index + 1;
      continue;
    }

    if (opts.noext !== true) {
      const isExtglobChar = code === CHAR_PLUS
        || code === CHAR_AT
        || code === CHAR_ASTERISK
        || code === CHAR_QUESTION_MARK
        || code === CHAR_EXCLAMATION_MARK;

      if (isExtglobChar === true && peek() === CHAR_LEFT_PARENTHESES) {
        isGlob = token.isGlob = true;
        isExtglob = token.isExtglob = true;
        finished = true;

        if (scanToEnd === true) {
          while (eos() !== true && (code = advance())) {
            if (code === CHAR_BACKWARD_SLASH) {
              backslashes = token.backslashes = true;
              code = advance();
              continue;
            }

            if (code === CHAR_RIGHT_PARENTHESES) {
              isGlob = token.isGlob = true;
              finished = true;
              break;
            }
          }
          continue;
        }
        break;
      }
    }

    if (code === CHAR_ASTERISK) {
      if (prev === CHAR_ASTERISK) isGlobstar = token.isGlobstar = true;
      isGlob = token.isGlob = true;
      finished = true;

      if (scanToEnd === true) {
        continue;
      }
      break;
    }

    if (code === CHAR_QUESTION_MARK) {
      isGlob = token.isGlob = true;
      finished = true;

      if (scanToEnd === true) {
        continue;
      }
      break;
    }

    if (code === CHAR_LEFT_SQUARE_BRACKET) {
      while (eos() !== true && (next = advance())) {
        if (next === CHAR_BACKWARD_SLASH) {
          backslashes = token.backslashes = true;
          advance();
          continue;
        }

        if (next === CHAR_RIGHT_SQUARE_BRACKET) {
          isBracket = token.isBracket = true;
          isGlob = token.isGlob = true;
          finished = true;

          if (scanToEnd === true) {
            continue;
          }
          break;
        }
      }
    }

    if (opts.nonegate !== true && code === CHAR_EXCLAMATION_MARK && index === start) {
      negated = token.negated = true;
      start++;
      continue;
    }

    if (opts.noparen !== true && code === CHAR_LEFT_PARENTHESES) {
      isGlob = token.isGlob = true;

      if (scanToEnd === true) {
        while (eos() !== true && (code = advance())) {
          if (code === CHAR_LEFT_PARENTHESES) {
            backslashes = token.backslashes = true;
            code = advance();
            continue;
          }

          if (code === CHAR_RIGHT_PARENTHESES) {
            finished = true;
            break;
          }
        }
        continue;
      }
      break;
    }

    if (isGlob === true) {
      finished = true;

      if (scanToEnd === true) {
        continue;
      }

      break;
    }
  }

  if (opts.noext === true) {
    isExtglob = false;
    isGlob = false;
  }

  let base = str;
  let prefix = '';
  let glob = '';

  if (start > 0) {
    prefix = str.slice(0, start);
    str = str.slice(start);
    lastIndex -= start;
  }

  if (base && isGlob === true && lastIndex > 0) {
    base = str.slice(0, lastIndex);
    glob = str.slice(lastIndex);
  } else if (isGlob === true) {
    base = '';
    glob = str;
  } else {
    base = str;
  }

  if (base && base !== '' && base !== '/' && base !== str) {
    if (isPathSeparator(base.charCodeAt(base.length - 1))) {
      base = base.slice(0, -1);
    }
  }

  if (opts.unescape === true) {
    if (glob) glob = utils.removeBackslashes(glob);

    if (base && backslashes === true) {
      base = utils.removeBackslashes(base);
    }
  }

  const state = {
    prefix,
    input,
    start,
    base,
    glob,
    isBrace,
    isBracket,
    isGlob,
    isExtglob,
    isGlobstar,
    negated
  };

  if (opts.tokens === true) {
    state.maxDepth = 0;
    if (!isPathSeparator(code)) {
      tokens.push(token);
    }
    state.tokens = tokens;
  }

  if (opts.parts === true || opts.tokens === true) {
    let prevIndex;

    for (let idx = 0; idx < slashes.length; idx++) {
      const n = prevIndex ? prevIndex + 1 : start;
      const i = slashes[idx];
      const value = input.slice(n, i);
      if (opts.tokens) {
        if (idx === 0 && start !== 0) {
          tokens[idx].isPrefix = true;
          tokens[idx].value = prefix;
        } else {
          tokens[idx].value = value;
        }
        depth(tokens[idx]);
        state.maxDepth += tokens[idx].depth;
      }
      if (idx !== 0 || value !== '') {
        parts.push(value);
      }
      prevIndex = i;
    }

    if (prevIndex && prevIndex + 1 < input.length) {
      const value = input.slice(prevIndex + 1);
      parts.push(value);

      if (opts.tokens) {
        tokens[tokens.length - 1].value = value;
        depth(tokens[tokens.length - 1]);
        state.maxDepth += tokens[tokens.length - 1].depth;
      }
    }

    state.slashes = slashes;
    state.parts = parts;
  }

  return state;
};

module.exports = scan;


/***/ }),

/***/ 3402:
/***/ ((__unused_webpack_module, exports, __nccwpck_require__) => {

"use strict";


const {
  REGEX_BACKSLASH,
  REGEX_REMOVE_BACKSLASH,
  REGEX_SPECIAL_CHARS,
  REGEX_SPECIAL_CHARS_GLOBAL
} = __nccwpck_require__(4550);

exports.isObject = val => val !== null && typeof val === 'object' && !Array.isArray(val);
exports.hasRegexChars = str => REGEX_SPECIAL_CHARS.test(str);
exports.isRegexChar = str => str.length === 1 && exports.hasRegexChars(str);
exports.escapeRegex = str => str.replace(REGEX_SPECIAL_CHARS_GLOBAL, '\\$1');
exports.toPosixSlashes = str => str.replace(REGEX_BACKSLASH, '/');

exports.removeBackslashes = str => {
  return str.replace(REGEX_REMOVE_BACKSLASH, match => {
    return match === '\\' ? '' : match;
  });
};

exports.supportsLookbehinds = () => {
  const segs = process.version.slice(1).split('.').map(Number);
  if (segs.length === 3 && segs[0] >= 9 || (segs[0] === 8 && segs[1] >= 10)) {
    return true;
  }
  return false;
};

exports.escapeLast = (input, char, lastIdx) => {
  const idx = input.lastIndexOf(char, lastIdx);
  if (idx === -1) return input;
  if (input[idx - 1] === '\\') return exports.escapeLast(input, char, idx - 1);
  return `${input.slice(0, idx)}\\${input.slice(idx)}`;
};

exports.removePrefix = (input, state = {}) => {
  let output = input;
  if (output.startsWith('./')) {
    output = output.slice(2);
    state.prefix = './';
  }
  return output;
};

exports.wrapOutput = (input, state = {}, options = {}) => {
  const prepend = options.contains ? '' : '^';
  const append = options.contains ? '' : '$';

  let output = `${prepend}(?:${input})${append}`;
  if (state.negated === true) {
    output = `(?:^(?!${output}).*$)`;
  }
  return output;
};

exports.basename = (path, { windows } = {}) => {
  if (windows) {
    return path.replace(/[\\/]$/, '').replace(/.*[\\/]/, '');
  } else {
    return path.replace(/\/$/, '').replace(/.*\//, '');
  }
};


/***/ }),

/***/ 4907:
/***/ ((module) => {

"use strict";


var replace = String.prototype.replace;
var percentTwenties = /%20/g;

var Format = {
    RFC1738: 'RFC1738',
    RFC3986: 'RFC3986'
};

module.exports = {
    'default': Format.RFC3986,
    formatters: {
        RFC1738: function (value) {
            return replace.call(value, percentTwenties, '+');
        },
        RFC3986: function (value) {
            return String(value);
        }
    },
    RFC1738: Format.RFC1738,
    RFC3986: Format.RFC3986
};


/***/ }),

/***/ 2760:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

"use strict";


var stringify = __nccwpck_require__(9954);
var parse = __nccwpck_require__(3912);
var formats = __nccwpck_require__(4907);

module.exports = {
    formats: formats,
    parse: parse,
    stringify: stringify
};


/***/ }),

/***/ 3912:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

"use strict";


var utils = __nccwpck_require__(2360);

var has = Object.prototype.hasOwnProperty;
var isArray = Array.isArray;

var defaults = {
    allowDots: false,
    allowEmptyArrays: false,
    allowPrototypes: false,
    allowSparse: false,
    arrayLimit: 20,
    charset: 'utf-8',
    charsetSentinel: false,
    comma: false,
    decodeDotInKeys: false,
    decoder: utils.decode,
    delimiter: '&',
    depth: 5,
    duplicates: 'combine',
    ignoreQueryPrefix: false,
    interpretNumericEntities: false,
    parameterLimit: 1000,
    parseArrays: true,
    plainObjects: false,
    strictDepth: false,
    strictMerge: true,
    strictNullHandling: false,
    throwOnLimitExceeded: false
};

var interpretNumericEntities = function (str) {
    return str.replace(/&#(\d+);/g, function ($0, numberStr) {
        return String.fromCharCode(parseInt(numberStr, 10));
    });
};

var parseArrayValue = function (val, options, currentArrayLength, isFlatArrayValue) {
    if (val && typeof val === 'string' && options.comma && val.indexOf(',') > -1) {
        if (isFlatArrayValue && options.throwOnLimitExceeded) {
            var commaCount = 0;
            var commaIndex = val.indexOf(',');
            while (commaIndex > -1) {
                commaCount += 1;
                if (commaCount >= options.arrayLimit) {
                    throw new RangeError('Array limit exceeded. Only ' + options.arrayLimit + ' element' + (options.arrayLimit === 1 ? '' : 's') + ' allowed in an array.');
                }
                commaIndex = val.indexOf(',', commaIndex + 1);
            }
        }
        return val.split(',');
    }

    if (options.throwOnLimitExceeded && currentArrayLength >= options.arrayLimit) {
        throw new RangeError('Array limit exceeded. Only ' + options.arrayLimit + ' element' + (options.arrayLimit === 1 ? '' : 's') + ' allowed in an array.');
    }

    return val;
};

// This is what browsers will submit when the ✓ character occurs in an
// application/x-www-form-urlencoded body and the encoding of the page containing
// the form is iso-8859-1, or when the submitted form has an accept-charset
// attribute of iso-8859-1. Presumably also with other charsets that do not contain
// the ✓ character, such as us-ascii.
var isoSentinel = 'utf8=%26%2310003%3B'; // encodeURIComponent('&#10003;')

// These are the percent-encoded utf-8 octets representing a checkmark, indicating that the request actually is utf-8 encoded.
var charsetSentinel = 'utf8=%E2%9C%93'; // encodeURIComponent('✓')

var parseValues = function parseQueryStringValues(str, options) {
    var obj = { __proto__: null };

    var cleanStr = options.ignoreQueryPrefix ? str.replace(/^\?/, '') : str;
    cleanStr = cleanStr.replace(/%5B/gi, '[').replace(/%5D/gi, ']');

    var limit = options.parameterLimit === Infinity ? void undefined : options.parameterLimit;
    var parts = cleanStr.split(
        options.delimiter,
        options.throwOnLimitExceeded && typeof limit !== 'undefined' ? limit + 1 : limit
    );

    if (options.throwOnLimitExceeded && typeof limit !== 'undefined' && parts.length > limit) {
        throw new RangeError('Parameter limit exceeded. Only ' + limit + ' parameter' + (limit === 1 ? '' : 's') + ' allowed.');
    }

    var skipIndex = -1; // Keep track of where the utf8 sentinel was found
    var i;

    var charset = options.charset;
    if (options.charsetSentinel) {
        for (i = 0; i < parts.length; ++i) {
            if (parts[i].indexOf('utf8=') === 0) {
                if (parts[i] === charsetSentinel) {
                    charset = 'utf-8';
                } else if (parts[i] === isoSentinel) {
                    charset = 'iso-8859-1';
                }
                skipIndex = i;
                i = parts.length; // The eslint settings do not allow break;
            }
        }
    }

    for (i = 0; i < parts.length; ++i) {
        if (i === skipIndex) {
            continue;
        }
        var part = parts[i];

        var bracketEqualsPos = part.indexOf(']=');
        var pos = bracketEqualsPos === -1 ? part.indexOf('=') : bracketEqualsPos + 1;

        var key;
        var val;
        if (pos === -1) {
            key = options.decoder(part, defaults.decoder, charset, 'key');
            val = options.strictNullHandling ? null : '';
        } else {
            key = options.decoder(part.slice(0, pos), defaults.decoder, charset, 'key');

            if (key !== null) {
                val = utils.maybeMap(
                    parseArrayValue(
                        part.slice(pos + 1),
                        options,
                        isArray(obj[key]) ? obj[key].length : 0,
                        part.indexOf('[]=') === -1
                    ),
                    function (encodedVal) {
                        return options.decoder(encodedVal, defaults.decoder, charset, 'value');
                    }
                );
            }
        }

        if (val && options.interpretNumericEntities && charset === 'iso-8859-1') {
            val = interpretNumericEntities(String(val));
        }

        if (part.indexOf('[]=') > -1) {
            val = isArray(val) ? [val] : val;
        }

        if (options.comma && isArray(val) && val.length > options.arrayLimit) {
            val = utils.combine([], val, options.arrayLimit, options.plainObjects, options.throwOnLimitExceeded);
        }

        if (key !== null) {
            var existing = has.call(obj, key);
            if (existing && (options.duplicates === 'combine' || part.indexOf('[]=') > -1)) {
                obj[key] = utils.combine(
                    obj[key],
                    val,
                    options.arrayLimit,
                    options.plainObjects,
                    options.throwOnLimitExceeded
                );
            } else if (!existing || options.duplicates === 'last') {
                obj[key] = val;
            }
        }
    }

    return obj;
};

var parseObject = function (chain, val, options, valuesParsed) {
    var currentArrayLength = 0;
    if (chain.length > 0 && chain[chain.length - 1] === '[]') {
        var parentKey = chain.slice(0, -1).join('');
        currentArrayLength = Array.isArray(val) && val[parentKey] ? val[parentKey].length : 0;
    }

    var leaf = valuesParsed ? val : parseArrayValue(val, options, currentArrayLength);

    for (var i = chain.length - 1; i >= 0; --i) {
        var obj;
        var root = chain[i];

        if (root === '[]' && options.parseArrays) {
            if (utils.isOverflow(leaf)) {
                // leaf is already an overflow object, preserve it
                obj = leaf;
            } else {
                obj = options.allowEmptyArrays && (leaf === '' || (options.strictNullHandling && leaf === null))
                    ? []
                    : utils.combine(
                        [],
                        leaf,
                        options.arrayLimit,
                        options.plainObjects,
                        options.throwOnLimitExceeded
                    );
            }
        } else {
            obj = options.plainObjects ? { __proto__: null } : {};
            var cleanRoot = root.charAt(0) === '[' && root.charAt(root.length - 1) === ']' ? root.slice(1, -1) : root;
            var decodedRoot = options.decodeDotInKeys ? cleanRoot.replace(/%2E/g, '.') : cleanRoot;
            var index = parseInt(decodedRoot, 10);
            var isValidArrayIndex = !isNaN(index)
                && root !== decodedRoot
                && String(index) === decodedRoot
                && index >= 0
                && options.parseArrays;
            if (!options.parseArrays && decodedRoot === '') {
                obj = { 0: leaf };
            } else if (isValidArrayIndex && index < options.arrayLimit) {
                obj = [];
                obj[index] = leaf;
            } else if (isValidArrayIndex && options.throwOnLimitExceeded) {
                throw new RangeError('Array limit exceeded. Only ' + options.arrayLimit + ' element' + (options.arrayLimit === 1 ? '' : 's') + ' allowed in an array.');
            } else if (isValidArrayIndex) {
                obj[index] = leaf;
                utils.markOverflow(obj, index);
            } else if (decodedRoot !== '__proto__') {
                obj[decodedRoot] = leaf;
            }
        }

        leaf = obj;
    }

    return leaf;
};

// Split a key like "a[b][c[]]" into ['a', '[b]', '[c[]]'] while preserving
// qs parse semantics for depth/prototype guards.
var splitKeyIntoSegments = function splitKeyIntoSegments(originalKey, options) {
    var key = options.allowDots ? originalKey.replace(/\.([^.[]+)/g, '[$1]') : originalKey;

    // depth <= 0 keeps the whole key as one segment
    if (options.depth <= 0) {
        if (!options.plainObjects && has.call(Object.prototype, key)) {
            if (!options.allowPrototypes) {
                return;
            }
        }

        return [key];
    }

    var segments = [];

    // parent before the first '[' (may be empty if key starts with '[')
    var first = key.indexOf('[');
    var parent = first >= 0 ? key.slice(0, first) : key;
    if (parent) {
        if (!options.plainObjects && has.call(Object.prototype, parent)) {
            if (!options.allowPrototypes) {
                return;
            }
        }

        segments[segments.length] = parent;
    }

    var n = key.length;
    var open = first;
    var collected = 0;

    while (open >= 0 && collected < options.depth) {
        var level = 1;
        var i = open + 1;
        var close = -1;

        // balance nested '[' and ']' inside this bracket group using a nesting level counter
        while (i < n && close < 0) {
            var cu = key.charCodeAt(i);
            if (cu === 0x5B) { // '['
                level += 1;
            } else if (cu === 0x5D) { // ']'
                level -= 1;
                if (level === 0) {
                    close = i; // found matching close; loop will exit by condition
                }
            }
            i += 1;
        }

        if (close < 0) {
            // Unterminated group: wrap the raw remainder in one bracket pair so it stays
            // a single literal segment (e.g. "[[]b" -> "[[]b]"); we do not infer missing ']'.
            segments[segments.length] = '[' + key.slice(open) + ']';
            return segments;
        }

        var seg = key.slice(open, close + 1);
        // prototype guard for the content of this group
        var content = seg.slice(1, -1);
        if (!options.plainObjects && has.call(Object.prototype, content) && !options.allowPrototypes) {
            return;
        }

        segments[segments.length] = seg;
        collected += 1;

        // find the next '[' after this balanced group
        open = key.indexOf('[', close + 1);
    }

    if (open >= 0) {
        if (options.strictDepth === true) {
            throw new RangeError('Input depth exceeded depth option of ' + options.depth + ' and strictDepth is true');
        }

        segments[segments.length] = '[' + key.slice(open) + ']';
    }

    return segments;
};

var parseKeys = function parseQueryStringKeys(givenKey, val, options, valuesParsed) {
    if (!givenKey) {
        return;
    }

    var keys = splitKeyIntoSegments(givenKey, options);

    if (!keys) {
        return;
    }

    return parseObject(keys, val, options, valuesParsed);
};

var normalizeParseOptions = function normalizeParseOptions(opts) {
    if (!opts) {
        return defaults;
    }

    if (typeof opts.allowEmptyArrays !== 'undefined' && typeof opts.allowEmptyArrays !== 'boolean') {
        throw new TypeError('`allowEmptyArrays` option can only be `true` or `false`, when provided');
    }

    if (typeof opts.decodeDotInKeys !== 'undefined' && typeof opts.decodeDotInKeys !== 'boolean') {
        throw new TypeError('`decodeDotInKeys` option can only be `true` or `false`, when provided');
    }

    if (opts.decoder !== null && typeof opts.decoder !== 'undefined' && typeof opts.decoder !== 'function') {
        throw new TypeError('Decoder has to be a function.');
    }

    if (typeof opts.charset !== 'undefined' && opts.charset !== 'utf-8' && opts.charset !== 'iso-8859-1') {
        throw new TypeError('The charset option must be either utf-8, iso-8859-1, or undefined');
    }

    if (typeof opts.throwOnLimitExceeded !== 'undefined' && typeof opts.throwOnLimitExceeded !== 'boolean') {
        throw new TypeError('`throwOnLimitExceeded` option must be a boolean');
    }

    var charset = typeof opts.charset === 'undefined' ? defaults.charset : opts.charset;

    var duplicates = typeof opts.duplicates === 'undefined' ? defaults.duplicates : opts.duplicates;

    if (duplicates !== 'combine' && duplicates !== 'first' && duplicates !== 'last') {
        throw new TypeError('The duplicates option must be either combine, first, or last');
    }

    var allowDots = typeof opts.allowDots === 'undefined' ? opts.decodeDotInKeys === true ? true : defaults.allowDots : !!opts.allowDots;

    return {
        allowDots: allowDots,
        allowEmptyArrays: typeof opts.allowEmptyArrays === 'boolean' ? !!opts.allowEmptyArrays : defaults.allowEmptyArrays,
        allowPrototypes: typeof opts.allowPrototypes === 'boolean' ? opts.allowPrototypes : defaults.allowPrototypes,
        allowSparse: typeof opts.allowSparse === 'boolean' ? opts.allowSparse : defaults.allowSparse,
        arrayLimit: typeof opts.arrayLimit === 'number' ? opts.arrayLimit : defaults.arrayLimit,
        charset: charset,
        charsetSentinel: typeof opts.charsetSentinel === 'boolean' ? opts.charsetSentinel : defaults.charsetSentinel,
        comma: typeof opts.comma === 'boolean' ? opts.comma : defaults.comma,
        decodeDotInKeys: typeof opts.decodeDotInKeys === 'boolean' ? opts.decodeDotInKeys : defaults.decodeDotInKeys,
        decoder: typeof opts.decoder === 'function' ? opts.decoder : defaults.decoder,
        delimiter: typeof opts.delimiter === 'string' || utils.isRegExp(opts.delimiter) ? opts.delimiter : defaults.delimiter,
        // eslint-disable-next-line no-implicit-coercion, no-extra-parens
        depth: (typeof opts.depth === 'number' || opts.depth === false) ? +opts.depth : defaults.depth,
        duplicates: duplicates,
        ignoreQueryPrefix: opts.ignoreQueryPrefix === true,
        interpretNumericEntities: typeof opts.interpretNumericEntities === 'boolean' ? opts.interpretNumericEntities : defaults.interpretNumericEntities,
        parameterLimit: typeof opts.parameterLimit === 'number' ? opts.parameterLimit : defaults.parameterLimit,
        parseArrays: opts.parseArrays !== false,
        plainObjects: typeof opts.plainObjects === 'boolean' ? opts.plainObjects : defaults.plainObjects,
        strictDepth: typeof opts.strictDepth === 'boolean' ? !!opts.strictDepth : defaults.strictDepth,
        strictMerge: typeof opts.strictMerge === 'boolean' ? !!opts.strictMerge : defaults.strictMerge,
        strictNullHandling: typeof opts.strictNullHandling === 'boolean' ? opts.strictNullHandling : defaults.strictNullHandling,
        throwOnLimitExceeded: typeof opts.throwOnLimitExceeded === 'boolean' ? opts.throwOnLimitExceeded : false
    };
};

module.exports = function (str, opts) {
    var options = normalizeParseOptions(opts);

    if (str === '' || str === null || typeof str === 'undefined') {
        return options.plainObjects ? { __proto__: null } : {};
    }

    var tempObj = typeof str === 'string' ? parseValues(str, options) : str;
    var obj = options.plainObjects ? { __proto__: null } : {};

    // Iterate over the keys and setup the new object

    var keys = Object.keys(tempObj);
    for (var i = 0; i < keys.length; ++i) {
        var key = keys[i];
        var newObj = parseKeys(key, tempObj[key], options, typeof str === 'string');
        obj = utils.merge(obj, newObj, options);
    }

    if (options.allowSparse === true) {
        return obj;
    }

    return utils.compact(obj);
};


/***/ }),

/***/ 9954:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

"use strict";


var getSideChannel = __nccwpck_require__(4334);
var utils = __nccwpck_require__(2360);
var formats = __nccwpck_require__(4907);
var has = Object.prototype.hasOwnProperty;

var arrayPrefixGenerators = {
    brackets: function brackets(prefix) {
        return prefix + '[]';
    },
    comma: 'comma',
    indices: function indices(prefix, key) {
        return prefix + '[' + key + ']';
    },
    repeat: function repeat(prefix) {
        return prefix;
    }
};

var isArray = Array.isArray;
var push = Array.prototype.push;
var pushToArray = function (arr, valueOrArray) {
    push.apply(arr, isArray(valueOrArray) ? valueOrArray : [valueOrArray]);
};

var toISO = Date.prototype.toISOString;

var defaultFormat = formats['default'];
var defaults = {
    addQueryPrefix: false,
    allowDots: false,
    allowEmptyArrays: false,
    arrayFormat: 'indices',
    charset: 'utf-8',
    charsetSentinel: false,
    commaRoundTrip: false,
    delimiter: '&',
    encode: true,
    encodeDotInKeys: false,
    encoder: utils.encode,
    encodeValuesOnly: false,
    filter: void undefined,
    format: defaultFormat,
    formatter: formats.formatters[defaultFormat],
    // deprecated
    indices: false,
    serializeDate: function serializeDate(date) {
        return toISO.call(date);
    },
    skipNulls: false,
    strictNullHandling: false
};

var isNonNullishPrimitive = function isNonNullishPrimitive(v) {
    return typeof v === 'string'
        || typeof v === 'number'
        || typeof v === 'boolean'
        || typeof v === 'symbol'
        || typeof v === 'bigint';
};

var sentinel = {};

var stringify = function stringify(
    object,
    prefix,
    generateArrayPrefix,
    commaRoundTrip,
    allowEmptyArrays,
    strictNullHandling,
    skipNulls,
    encodeDotInKeys,
    encoder,
    filter,
    sort,
    allowDots,
    serializeDate,
    format,
    formatter,
    encodeValuesOnly,
    charset,
    sideChannel
) {
    var obj = object;

    var tmpSc = sideChannel;
    var step = 0;
    var findFlag = false;
    while ((tmpSc = tmpSc.get(sentinel)) !== void undefined && !findFlag) {
        // Where object last appeared in the ref tree
        var pos = tmpSc.get(object);
        step += 1;
        if (typeof pos !== 'undefined') {
            if (pos === step) {
                throw new RangeError('Cyclic object value');
            } else {
                findFlag = true; // Break while
            }
        }
        if (typeof tmpSc.get(sentinel) === 'undefined') {
            step = 0;
        }
    }

    if (typeof filter === 'function') {
        obj = filter(prefix, obj);
    } else if (obj instanceof Date) {
        obj = serializeDate(obj);
    } else if (generateArrayPrefix === 'comma' && isArray(obj)) {
        obj = utils.maybeMap(obj, function (value) {
            if (value instanceof Date) {
                return serializeDate(value);
            }
            return value;
        });
    }

    if (obj === null) {
        if (strictNullHandling) {
            return formatter(encoder && !encodeValuesOnly ? encoder(prefix, defaults.encoder, charset, 'key', format) : prefix);
        }

        obj = '';
    }

    if (isNonNullishPrimitive(obj) || utils.isBuffer(obj)) {
        if (encoder) {
            var keyValue = encodeValuesOnly ? prefix : encoder(prefix, defaults.encoder, charset, 'key', format);
            return [formatter(keyValue) + '=' + formatter(encoder(obj, defaults.encoder, charset, 'value', format))];
        }
        return [formatter(prefix) + '=' + formatter(String(obj))];
    }

    var values = [];

    if (typeof obj === 'undefined') {
        return values;
    }

    var objKeys;
    if (generateArrayPrefix === 'comma' && isArray(obj)) {
        // we need to join elements in
        if (encodeValuesOnly && encoder) {
            obj = utils.maybeMap(obj, function (v) {
                return v == null ? v : encoder(v);
            });
        }
        objKeys = [{ value: obj.length > 0 ? obj.join(',') || null : void undefined }];
    } else if (isArray(filter)) {
        objKeys = filter;
    } else {
        var keys = Object.keys(obj);
        objKeys = sort ? keys.sort(sort) : keys;
    }

    var encodedPrefix = encodeDotInKeys ? String(prefix).replace(/\./g, '%2E') : String(prefix);

    var adjustedPrefix = commaRoundTrip && isArray(obj) && obj.length === 1 ? encodedPrefix + '[]' : encodedPrefix;

    if (allowEmptyArrays && isArray(obj) && obj.length === 0) {
        return adjustedPrefix + '[]';
    }

    for (var j = 0; j < objKeys.length; ++j) {
        var key = objKeys[j];
        var value = typeof key === 'object' && key && typeof key.value !== 'undefined'
            ? key.value
            : obj[key];

        if (skipNulls && value === null) {
            continue;
        }

        var encodedKey = allowDots && encodeDotInKeys ? String(key).replace(/\./g, '%2E') : String(key);
        var keyPrefix = isArray(obj)
            ? typeof generateArrayPrefix === 'function' ? generateArrayPrefix(adjustedPrefix, encodedKey) : adjustedPrefix
            : adjustedPrefix + (allowDots ? '.' + encodedKey : '[' + encodedKey + ']');

        sideChannel.set(object, step);
        var valueSideChannel = getSideChannel();
        valueSideChannel.set(sentinel, sideChannel);
        pushToArray(values, stringify(
            value,
            keyPrefix,
            generateArrayPrefix,
            commaRoundTrip,
            allowEmptyArrays,
            strictNullHandling,
            skipNulls,
            encodeDotInKeys,
            generateArrayPrefix === 'comma' && encodeValuesOnly && isArray(obj) ? null : encoder,
            filter,
            sort,
            allowDots,
            serializeDate,
            format,
            formatter,
            encodeValuesOnly,
            charset,
            valueSideChannel
        ));
    }

    return values;
};

var normalizeStringifyOptions = function normalizeStringifyOptions(opts) {
    if (!opts) {
        return defaults;
    }

    if (typeof opts.allowEmptyArrays !== 'undefined' && typeof opts.allowEmptyArrays !== 'boolean') {
        throw new TypeError('`allowEmptyArrays` option can only be `true` or `false`, when provided');
    }

    if (typeof opts.encodeDotInKeys !== 'undefined' && typeof opts.encodeDotInKeys !== 'boolean') {
        throw new TypeError('`encodeDotInKeys` option can only be `true` or `false`, when provided');
    }

    if (opts.encoder !== null && typeof opts.encoder !== 'undefined' && typeof opts.encoder !== 'function') {
        throw new TypeError('Encoder has to be a function.');
    }

    var charset = opts.charset || defaults.charset;
    if (typeof opts.charset !== 'undefined' && opts.charset !== 'utf-8' && opts.charset !== 'iso-8859-1') {
        throw new TypeError('The charset option must be either utf-8, iso-8859-1, or undefined');
    }

    var format = formats['default'];
    if (typeof opts.format !== 'undefined') {
        if (!has.call(formats.formatters, opts.format)) {
            throw new TypeError('Unknown format option provided.');
        }
        format = opts.format;
    }
    var formatter = formats.formatters[format];

    var filter = defaults.filter;
    if (typeof opts.filter === 'function' || isArray(opts.filter)) {
        filter = opts.filter;
    }

    var arrayFormat;
    if (opts.arrayFormat in arrayPrefixGenerators) {
        arrayFormat = opts.arrayFormat;
    } else if ('indices' in opts) {
        arrayFormat = opts.indices ? 'indices' : 'repeat';
    } else {
        arrayFormat = defaults.arrayFormat;
    }

    if ('commaRoundTrip' in opts && typeof opts.commaRoundTrip !== 'boolean') {
        throw new TypeError('`commaRoundTrip` must be a boolean, or absent');
    }

    var allowDots = typeof opts.allowDots === 'undefined' ? opts.encodeDotInKeys === true ? true : defaults.allowDots : !!opts.allowDots;

    return {
        addQueryPrefix: typeof opts.addQueryPrefix === 'boolean' ? opts.addQueryPrefix : defaults.addQueryPrefix,
        allowDots: allowDots,
        allowEmptyArrays: typeof opts.allowEmptyArrays === 'boolean' ? !!opts.allowEmptyArrays : defaults.allowEmptyArrays,
        arrayFormat: arrayFormat,
        charset: charset,
        charsetSentinel: typeof opts.charsetSentinel === 'boolean' ? opts.charsetSentinel : defaults.charsetSentinel,
        commaRoundTrip: !!opts.commaRoundTrip,
        delimiter: typeof opts.delimiter === 'undefined' ? defaults.delimiter : opts.delimiter,
        encode: typeof opts.encode === 'boolean' ? opts.encode : defaults.encode,
        encodeDotInKeys: typeof opts.encodeDotInKeys === 'boolean' ? opts.encodeDotInKeys : defaults.encodeDotInKeys,
        encoder: typeof opts.encoder === 'function' ? opts.encoder : defaults.encoder,
        encodeValuesOnly: typeof opts.encodeValuesOnly === 'boolean' ? opts.encodeValuesOnly : defaults.encodeValuesOnly,
        filter: filter,
        format: format,
        formatter: formatter,
        serializeDate: typeof opts.serializeDate === 'function' ? opts.serializeDate : defaults.serializeDate,
        skipNulls: typeof opts.skipNulls === 'boolean' ? opts.skipNulls : defaults.skipNulls,
        sort: typeof opts.sort === 'function' ? opts.sort : null,
        strictNullHandling: typeof opts.strictNullHandling === 'boolean' ? opts.strictNullHandling : defaults.strictNullHandling
    };
};

module.exports = function (object, opts) {
    var obj = object;
    var options = normalizeStringifyOptions(opts);

    var objKeys;
    var filter;

    if (typeof options.filter === 'function') {
        filter = options.filter;
        obj = filter('', obj);
    } else if (isArray(options.filter)) {
        filter = options.filter;
        objKeys = filter;
    }

    var keys = [];

    if (typeof obj !== 'object' || obj === null) {
        return '';
    }

    var generateArrayPrefix = arrayPrefixGenerators[options.arrayFormat];
    var commaRoundTrip = generateArrayPrefix === 'comma' && options.commaRoundTrip;

    if (!objKeys) {
        objKeys = Object.keys(obj);
    }

    if (options.sort) {
        objKeys.sort(options.sort);
    }

    var sideChannel = getSideChannel();
    for (var i = 0; i < objKeys.length; ++i) {
        var key = objKeys[i];

        if (typeof key === 'undefined' || key === null) {
            continue;
        }

        var value = obj[key];

        if (options.skipNulls && value === null) {
            continue;
        }
        pushToArray(keys, stringify(
            value,
            key,
            generateArrayPrefix,
            commaRoundTrip,
            options.allowEmptyArrays,
            options.strictNullHandling,
            options.skipNulls,
            options.encodeDotInKeys,
            options.encode ? options.encoder : null,
            options.filter,
            options.sort,
            options.allowDots,
            options.serializeDate,
            options.format,
            options.formatter,
            options.encodeValuesOnly,
            options.charset,
            sideChannel
        ));
    }

    var joined = keys.join(options.delimiter);
    var prefix = options.addQueryPrefix === true ? '?' : '';

    if (options.charsetSentinel) {
        if (options.charset === 'iso-8859-1') {
            // encodeURIComponent('&#10003;'), the "numeric entity" representation of a checkmark
            prefix += 'utf8=%26%2310003%3B' + options.delimiter;
        } else {
            // encodeURIComponent('✓')
            prefix += 'utf8=%E2%9C%93' + options.delimiter;
        }
    }

    return joined.length > 0 ? prefix + joined : '';
};


/***/ }),

/***/ 2360:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

"use strict";


var formats = __nccwpck_require__(4907);
var getSideChannel = __nccwpck_require__(4334);
var defineProperty = __nccwpck_require__(6123);

var has = Object.prototype.hasOwnProperty;
var isArray = Array.isArray;

// Track objects created from arrayLimit overflow using side-channel
// Stores the current max numeric index for O(1) lookup
var overflowChannel = getSideChannel();

var markOverflow = function markOverflow(obj, maxIndex) {
    overflowChannel.set(obj, maxIndex);
    return obj;
};

var isOverflow = function isOverflow(obj) {
    return overflowChannel.has(obj);
};

var getMaxIndex = function getMaxIndex(obj) {
    return overflowChannel.get(obj);
};

var setMaxIndex = function setMaxIndex(obj, maxIndex) {
    overflowChannel.set(obj, maxIndex);
};

var hexTable = (function () {
    var array = [];
    for (var i = 0; i < 256; ++i) {
        array[array.length] = '%' + ((i < 16 ? '0' : '') + i.toString(16)).toUpperCase();
    }

    return array;
}());

var compactQueue = function compactQueue(queue) {
    while (queue.length > 1) {
        var item = queue.pop();
        var obj = item.obj[item.prop];

        if (isArray(obj)) {
            var compacted = [];

            for (var j = 0; j < obj.length; ++j) {
                if (typeof obj[j] !== 'undefined') {
                    compacted[compacted.length] = obj[j];
                }
            }

            item.obj[item.prop] = compacted;
        }
    }
};

var arrayToObject = function arrayToObject(source, options) {
    var obj = options && options.plainObjects ? { __proto__: null } : {};
    for (var i = 0; i < source.length; ++i) {
        if (typeof source[i] !== 'undefined') {
            obj[i] = source[i];
        }
    }

    return obj;
};

var setProperty = function setProperty(obj, key, value) {
    if (key === '__proto__' && defineProperty) {
        defineProperty(obj, key, {
            configurable: true,
            enumerable: true,
            value: value,
            writable: true
        });
    } else {
        obj[key] = value;
    }
};

var merge = function merge(target, source, options) {
    /* eslint no-param-reassign: 0 */
    if (!source) {
        return target;
    }

    if (typeof source !== 'object' && typeof source !== 'function') {
        if (isArray(target)) {
            var nextIndex = target.length;
            if (options && typeof options.arrayLimit === 'number' && nextIndex >= options.arrayLimit) {
                if (options.throwOnLimitExceeded) {
                    throw new RangeError('Array limit exceeded. Only ' + options.arrayLimit + ' element' + (options.arrayLimit === 1 ? '' : 's') + ' allowed in an array.');
                }
                return markOverflow(arrayToObject(target.concat(source), options), nextIndex);
            }
            target[nextIndex] = source;
        } else if (target && typeof target === 'object') {
            if (isOverflow(target)) {
                // Add at next numeric index for overflow objects
                var newIndex = getMaxIndex(target) + 1;
                target[newIndex] = source;
                setMaxIndex(target, newIndex);
            } else if (options && options.strictMerge) {
                return [target, source];
            } else if (
                (options && (options.plainObjects || options.allowPrototypes))
                || !has.call(Object.prototype, source)
            ) {
                target[source] = true;
            }
        } else {
            return [target, source];
        }

        return target;
    }

    if (!target || typeof target !== 'object') {
        if (isOverflow(source)) {
            // Create new object with target at 0, source values shifted by 1
            var sourceKeys = Object.keys(source);
            var result = options && options.plainObjects
                ? { __proto__: null, 0: target }
                : { 0: target };
            for (var m = 0; m < sourceKeys.length; m++) {
                var oldKey = parseInt(sourceKeys[m], 10);
                result[oldKey + 1] = source[sourceKeys[m]];
            }
            return markOverflow(result, getMaxIndex(source) + 1);
        }
        var combined = [target].concat(source);
        if (options && typeof options.arrayLimit === 'number' && combined.length > options.arrayLimit) {
            if (options.throwOnLimitExceeded) {
                throw new RangeError('Array limit exceeded. Only ' + options.arrayLimit + ' element' + (options.arrayLimit === 1 ? '' : 's') + ' allowed in an array.');
            }
            return markOverflow(arrayToObject(combined, options), combined.length - 1);
        }
        return combined;
    }

    var mergeTarget = target;
    if (isArray(target) && !isArray(source)) {
        mergeTarget = arrayToObject(target, options);
    }

    if (isArray(target) && isArray(source)) {
        source.forEach(function (item, i) {
            if (has.call(target, i)) {
                var targetItem = target[i];
                if (targetItem && typeof targetItem === 'object' && item && typeof item === 'object') {
                    target[i] = merge(targetItem, item, options);
                } else {
                    target[target.length] = item;
                }
            } else {
                target[i] = item;
            }
        });
        if (options && typeof options.arrayLimit === 'number' && target.length > options.arrayLimit) {
            if (options.throwOnLimitExceeded) {
                throw new RangeError('Array limit exceeded. Only ' + options.arrayLimit + ' element' + (options.arrayLimit === 1 ? '' : 's') + ' allowed in an array.');
            }
            return markOverflow(arrayToObject(target, options), target.length - 1);
        }
        return target;
    }

    return Object.keys(source).reduce(function (acc, key) {
        var value = source[key];

        if (has.call(acc, key)) {
            setProperty(acc, key, merge(acc[key], value, options));
        } else {
            setProperty(acc, key, value);
        }

        if (isOverflow(source) && !isOverflow(acc)) {
            markOverflow(acc, getMaxIndex(source));
        }
        if (isOverflow(acc)) {
            var keyNum = parseInt(key, 10);
            if (String(keyNum) === key && keyNum >= 0 && keyNum > getMaxIndex(acc)) {
                setMaxIndex(acc, keyNum);
            }
        }

        return acc;
    }, mergeTarget);
};

var assign = function assignSingleSource(target, source) {
    return Object.keys(source).reduce(function (acc, key) {
        setProperty(acc, key, source[key]);
        return acc;
    }, target);
};

var decode = function (str, defaultDecoder, charset) {
    var strWithoutPlus = str.replace(/\+/g, ' ');
    if (charset === 'iso-8859-1') {
        // unescape never throws, no try...catch needed:
        return strWithoutPlus.replace(/%[0-9a-f]{2}/gi, unescape);
    }
    // utf-8
    try {
        return decodeURIComponent(strWithoutPlus);
    } catch (e) {
        return strWithoutPlus;
    }
};

var limit = 1024;

/* eslint operator-linebreak: [2, "before"] */

var encode = function encode(str, defaultEncoder, charset, kind, format) {
    // This code was originally written by Brian White (mscdex) for the io.js core querystring library.
    // It has been adapted here for stricter adherence to RFC 3986
    if (str.length === 0) {
        return str;
    }

    var string = str;
    if (typeof str === 'symbol') {
        string = Symbol.prototype.toString.call(str);
    } else if (typeof str !== 'string') {
        string = String(str);
    }

    if (charset === 'iso-8859-1') {
        return escape(string).replace(/%u[0-9a-f]{4}/gi, function ($0) {
            return '%26%23' + parseInt($0.slice(2), 16) + '%3B';
        });
    }

    var out = '';
    for (var j = 0; j < string.length; j += limit) {
        var segment = string.length >= limit ? string.slice(j, j + limit) : string;
        if (j + limit < string.length) {
            var last = segment.charCodeAt(segment.length - 1);
            if (last >= 0xD800 && last <= 0xDBFF) {
                segment = segment.slice(0, -1);
                j -= 1;
            }
        }
        var arr = [];

        for (var i = 0; i < segment.length; ++i) {
            var c = segment.charCodeAt(i);
            if (
                c === 0x2D // -
                || c === 0x2E // .
                || c === 0x5F // _
                || c === 0x7E // ~
                || (c >= 0x30 && c <= 0x39) // 0-9
                || (c >= 0x41 && c <= 0x5A) // a-z
                || (c >= 0x61 && c <= 0x7A) // A-Z
                || (format === formats.RFC1738 && (c === 0x28 || c === 0x29)) // ( )
            ) {
                arr[arr.length] = segment.charAt(i);
                continue;
            }

            if (c < 0x80) {
                arr[arr.length] = hexTable[c];
                continue;
            }

            if (c < 0x800) {
                arr[arr.length] = hexTable[0xC0 | (c >> 6)]
                    + hexTable[0x80 | (c & 0x3F)];
                continue;
            }

            if (c < 0xD800 || c >= 0xE000) {
                arr[arr.length] = hexTable[0xE0 | (c >> 12)]
                    + hexTable[0x80 | ((c >> 6) & 0x3F)]
                    + hexTable[0x80 | (c & 0x3F)];
                continue;
            }

            i += 1;
            c = 0x10000 + (((c & 0x3FF) << 10) | (segment.charCodeAt(i) & 0x3FF));

            arr[arr.length] = hexTable[0xF0 | (c >> 18)]
                + hexTable[0x80 | ((c >> 12) & 0x3F)]
                + hexTable[0x80 | ((c >> 6) & 0x3F)]
                + hexTable[0x80 | (c & 0x3F)];
        }

        out += arr.join('');
    }

    return out;
};

var compact = function compact(value) {
    var queue = [{ obj: { o: value }, prop: 'o' }];
    var refs = getSideChannel();

    for (var i = 0; i < queue.length; ++i) {
        var item = queue[i];
        var obj = item.obj[item.prop];

        var keys = Object.keys(obj);
        for (var j = 0; j < keys.length; ++j) {
            var key = keys[j];
            var val = obj[key];
            if (typeof val === 'object' && val !== null && !refs.has(val)) {
                queue[queue.length] = { obj: obj, prop: key };
                refs.set(val, true);
            }
        }
    }

    compactQueue(queue);

    return value;
};

var isRegExp = function isRegExp(obj) {
    return Object.prototype.toString.call(obj) === '[object RegExp]';
};

var isBuffer = function isBuffer(obj) {
    if (!obj || typeof obj !== 'object') {
        return false;
    }

    return !!(obj.constructor && obj.constructor.isBuffer && obj.constructor.isBuffer(obj));
};

var combine = function combine(a, b, arrayLimit, plainObjects, throwOnLimitExceeded) {
    // If 'a' is already an overflow object, add to it
    if (isOverflow(a)) {
        if (throwOnLimitExceeded) {
            throw new RangeError('Array limit exceeded. Only ' + arrayLimit + ' element' + (arrayLimit === 1 ? '' : 's') + ' allowed in an array.');
        }
        var newIndex = getMaxIndex(a) + 1;
        a[newIndex] = b;
        setMaxIndex(a, newIndex);
        return a;
    }

    var result = [].concat(a, b);
    if (result.length > arrayLimit) {
        if (throwOnLimitExceeded) {
            throw new RangeError('Array limit exceeded. Only ' + arrayLimit + ' element' + (arrayLimit === 1 ? '' : 's') + ' allowed in an array.');
        }
        return markOverflow(arrayToObject(result, { plainObjects: plainObjects }), result.length - 1);
    }
    return result;
};

var maybeMap = function maybeMap(val, fn) {
    if (isArray(val)) {
        var mapped = [];
        for (var i = 0; i < val.length; i += 1) {
            mapped[mapped.length] = fn(val[i]);
        }
        return mapped;
    }
    return fn(val);
};

module.exports = {
    arrayToObject: arrayToObject,
    assign: assign,
    combine: combine,
    compact: compact,
    decode: decode,
    encode: encode,
    isBuffer: isBuffer,
    isOverflow: isOverflow,
    isRegExp: isRegExp,
    markOverflow: markOverflow,
    maybeMap: maybeMap,
    merge: merge
};


/***/ }),

/***/ 1045:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const RateLimiterRedis = __nccwpck_require__(6770);
const RateLimiterMongo = __nccwpck_require__(978);
const RateLimiterMySQL = __nccwpck_require__(2532);
const RateLimiterPostgres = __nccwpck_require__(414);
const { RateLimiterClusterMaster, RateLimiterClusterMasterPM2, RateLimiterCluster } = __nccwpck_require__(397);
const RateLimiterMemory = __nccwpck_require__(1351);
const RateLimiterMemcache = __nccwpck_require__(8747);
const RLWrapperBlackAndWhite = __nccwpck_require__(2533);
const RLWrapperTimeouts = __nccwpck_require__(8731);
const RateLimiterUnion = __nccwpck_require__(5373);
const RateLimiterQueue = __nccwpck_require__(2967);
const BurstyRateLimiter = __nccwpck_require__(6779);
const RateLimiterRes = __nccwpck_require__(9975);
const RateLimiterDynamo = __nccwpck_require__(9766);
const RateLimiterPrisma = __nccwpck_require__(6930);
const RateLimiterDrizzle = __nccwpck_require__(7726);
const RateLimiterDrizzleNonAtomic = __nccwpck_require__(7762);
const RateLimiterValkey = __nccwpck_require__(9830);
const RateLimiterValkeyGlide = __nccwpck_require__(2721);
const RateLimiterSQLite = __nccwpck_require__(8901);
const RateLimiterEtcd = __nccwpck_require__(8810);
const RateLimiterEtcdNonAtomic = __nccwpck_require__(5721);
const RateLimiterQueueError = __nccwpck_require__(9636);
const RateLimiterEtcdTransactionFailedError = __nccwpck_require__(7854);

module.exports = {
  RateLimiterRedis,
  RateLimiterMongo,
  RateLimiterMySQL,
  RateLimiterPostgres,
  RateLimiterMemory,
  RateLimiterMemcache,
  RateLimiterClusterMaster,
  RateLimiterClusterMasterPM2,
  RateLimiterCluster,
  RLWrapperBlackAndWhite,
  RLWrapperTimeouts,
  RateLimiterUnion,
  RateLimiterQueue,
  BurstyRateLimiter,
  RateLimiterRes,
  RateLimiterDynamo,
  RateLimiterPrisma,
  RateLimiterValkey,
  RateLimiterValkeyGlide,
  RateLimiterSQLite,
  RateLimiterEtcd,
  RateLimiterDrizzle,
  RateLimiterDrizzleNonAtomic,
  RateLimiterEtcdNonAtomic,
  RateLimiterQueueError,
  RateLimiterEtcdTransactionFailedError,
};


/***/ }),

/***/ 6779:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const RateLimiterRes = __nccwpck_require__(9975);

/**
 * Bursty rate limiter exposes only msBeforeNext time and doesn't expose points from bursty limiter by default
 * @type {BurstyRateLimiter}
 */
module.exports = class BurstyRateLimiter {
  constructor(rateLimiter, burstLimiter) {
    this._rateLimiter = rateLimiter;
    this._burstLimiter = burstLimiter
  }

  /**
   * Merge rate limiter response objects. Responses can be null
   *
   * @param {RateLimiterRes} [rlRes] Rate limiter response
   * @param {RateLimiterRes} [blRes] Bursty limiter response
   */
  _combineRes(rlRes, blRes) {
    if (!rlRes) {
      return null
    }

    return new RateLimiterRes(
      rlRes.remainingPoints,
      Math.min(rlRes.msBeforeNext, blRes ? blRes.msBeforeNext : 0),
      rlRes.consumedPoints,
      rlRes.isFirstInDuration
    )
  }

  /**
   * @param key
   * @param pointsToConsume
   * @param options
   * @returns {Promise<any>}
   */
  consume(key, pointsToConsume = 1, options = {}) {
    return this._rateLimiter.consume(key, pointsToConsume, options)
      .catch((rlRej) => {
        if (rlRej instanceof RateLimiterRes) {
          return this._burstLimiter.consume(key, pointsToConsume, options)
            .then((blRes) => {
              return Promise.resolve(this._combineRes(rlRej, blRes))
            })
            .catch((blRej) => {
                if (blRej instanceof RateLimiterRes) {
                  return Promise.reject(this._combineRes(rlRej, blRej))
                } else {
                  return Promise.reject(blRej)
                }
              }
            )
        } else {
          return Promise.reject(rlRej)
        }
      })
  }

  /**
   * It doesn't expose available points from burstLimiter
   *
   * @param key
   * @returns {Promise<RateLimiterRes>}
   */
  get(key) {
    return Promise.all([
      this._rateLimiter.get(key),
      this._burstLimiter.get(key),
    ]).then(([rlRes, blRes]) => {
      return this._combineRes(rlRes, blRes);
    });
  }

  get points() {
    return this._rateLimiter.points;
  }
};


/***/ }),

/***/ 2533:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const RateLimiterRes = __nccwpck_require__(9975);

module.exports = class RLWrapperBlackAndWhite {
  constructor(opts = {}) {
    this.limiter = opts.limiter;
    this.blackList = opts.blackList;
    this.whiteList = opts.whiteList;
    this.isBlackListed = opts.isBlackListed;
    this.isWhiteListed = opts.isWhiteListed;
    this.runActionAnyway = opts.runActionAnyway;
  }

  get limiter() {
    return this._limiter;
  }

  set limiter(value) {
    if (typeof value === 'undefined') {
      throw new Error('limiter is not set');
    }

    this._limiter = value;
  }

  get runActionAnyway() {
    return this._runActionAnyway;
  }

  set runActionAnyway(value) {
    this._runActionAnyway = typeof value === 'undefined' ? false : value;
  }

  get blackList() {
    return this._blackList;
  }

  set blackList(value) {
    this._blackList = Array.isArray(value) ? value : [];
  }

  get isBlackListed() {
    return this._isBlackListed;
  }

  set isBlackListed(func) {
    if (typeof func === 'undefined') {
      func = () => false;
    }
    if (typeof func !== 'function') {
      throw new Error('isBlackListed must be function');
    }
    this._isBlackListed = func;
  }

  get whiteList() {
    return this._whiteList;
  }

  set whiteList(value) {
    this._whiteList = Array.isArray(value) ? value : [];
  }

  get isWhiteListed() {
    return this._isWhiteListed;
  }

  set isWhiteListed(func) {
    if (typeof func === 'undefined') {
      func = () => false;
    }
    if (typeof func !== 'function') {
      throw new Error('isWhiteListed must be function');
    }
    this._isWhiteListed = func;
  }

  isBlackListedSomewhere(key) {
    return this.blackList.indexOf(key) >= 0 || this.isBlackListed(key);
  }

  isWhiteListedSomewhere(key) {
    return this.whiteList.indexOf(key) >= 0 || this.isWhiteListed(key);
  }

  getBlackRes() {
    return new RateLimiterRes(0, Number.MAX_SAFE_INTEGER, 0, false);
  }

  getWhiteRes() {
    return new RateLimiterRes(Number.MAX_SAFE_INTEGER, 0, 0, false);
  }

  rejectBlack() {
    return Promise.reject(this.getBlackRes());
  }

  resolveBlack() {
    return Promise.resolve(this.getBlackRes());
  }

  resolveWhite() {
    return Promise.resolve(this.getWhiteRes());
  }

  consume(key, pointsToConsume = 1) {
    let res;
    if (this.isWhiteListedSomewhere(key)) {
      res = this.resolveWhite();
    } else if (this.isBlackListedSomewhere(key)) {
      res = this.rejectBlack();
    }

    if (typeof res === 'undefined') {
      return this.limiter.consume(key, pointsToConsume);
    }

    if (this.runActionAnyway) {
      this.limiter.consume(key, pointsToConsume).catch(() => {});
    }
    return res;
  }

  block(key, secDuration) {
    let res;
    if (this.isWhiteListedSomewhere(key)) {
      res = this.resolveWhite();
    } else if (this.isBlackListedSomewhere(key)) {
      res = this.resolveBlack();
    }

    if (typeof res === 'undefined') {
      return this.limiter.block(key, secDuration);
    }

    if (this.runActionAnyway) {
      this.limiter.block(key, secDuration).catch(() => {});
    }
    return res;
  }

  penalty(key, points) {
    let res;
    if (this.isWhiteListedSomewhere(key)) {
      res = this.resolveWhite();
    } else if (this.isBlackListedSomewhere(key)) {
      res = this.resolveBlack();
    }

    if (typeof res === 'undefined') {
      return this.limiter.penalty(key, points);
    }

    if (this.runActionAnyway) {
      this.limiter.penalty(key, points).catch(() => {});
    }
    return res;
  }

  reward(key, points) {
    let res;
    if (this.isWhiteListedSomewhere(key)) {
      res = this.resolveWhite();
    } else if (this.isBlackListedSomewhere(key)) {
      res = this.resolveBlack();
    }

    if (typeof res === 'undefined') {
      return this.limiter.reward(key, points);
    }

    if (this.runActionAnyway) {
      this.limiter.reward(key, points).catch(() => {});
    }
    return res;
  }

  get(key) {
    let res;
    if (this.isWhiteListedSomewhere(key)) {
      res = this.resolveWhite();
    } else if (this.isBlackListedSomewhere(key)) {
      res = this.resolveBlack();
    }

    if (typeof res === 'undefined' || this.runActionAnyway) {
      return this.limiter.get(key);
    }

    return res;
  }

  delete(key) {
    return this.limiter.delete(key);
  }
};


/***/ }),

/***/ 8731:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const RateLimiterAbstract = __nccwpck_require__(363);
const RateLimiterInsuredAbstract = __nccwpck_require__(2813);

module.exports = class RLWrapperTimeouts extends RateLimiterInsuredAbstract {
  constructor(opts= {}) {
    super(opts);
    this.limiter = opts.limiter;
    this.timeoutMs = opts.timeoutMs || 0;
  }

  get limiter() {
    return this._limiter;
  }

  set limiter(limiter) {
    if (!(limiter instanceof RateLimiterAbstract)) {
      throw new TypeError('limiter must be an instance of RateLimiterAbstract');
    }
    this._limiter = limiter;
    if (!this.insuranceLimiter && limiter instanceof RateLimiterInsuredAbstract) {
      this.insuranceLimiter = limiter.insuranceLimiter;
    }
  }

  get timeoutMs() {
    return this._timeoutMs;
  }

  set timeoutMs(value) {
    if (typeof value !== 'number' || value < 0) {
      throw new TypeError('timeoutMs must be a non-negative number');
    }
    this._timeoutMs = value;
  }

  _run(funcName, params) {
    return new Promise(async (resolve, reject) => {
      const timeout = setTimeout(() => {
        return reject(new Error('Operation timed out'));
      }, this.timeoutMs);

      await this.limiter[funcName](...params)
        .then((result) => {
          clearTimeout(timeout);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timeout);
          reject(err);
        });
    });
  }

  _consume(key, pointsToConsume = 1, options = {}) {
    return this._run('consume', [key, pointsToConsume, options]);
  }

  _penalty(key, points = 1, options = {}) {
    return this._run('penalty', [key, points, options]);
  }

  _reward(key, points = 1, options = {}) {
    return this._run('reward', [key, points, options]);
  }

  _get(key, options = {}) {
    return this._run('get', [key, options]);
  }

  _set(key, points, secDuration, options = {}) {
    return this._run('set', [key, points, secDuration, options]);
  }

  _block(key, secDuration, options = {}) {
    return this._run('block', [key, secDuration, options]);
  }

  _delete(key, options = {}) {
    return this._run('delete', [key, options]);
  }

}


/***/ }),

/***/ 363:
/***/ ((module) => {

module.exports = class RateLimiterAbstract {
  /**
   *
   * @param opts Object Defaults {
   *   points: 4, // Number of points
   *   duration: 1, // Per seconds
   *   blockDuration: 0, // Block if consumed more than points in current duration for blockDuration seconds
   *   execEvenly: false, // Execute allowed actions evenly over duration
   *   execEvenlyMinDelayMs: duration * 1000 / points, // ms, works with execEvenly=true option
   *   keyPrefix: 'rlflx',
   * }
   */
  constructor(opts = {}) {
    this.points = opts.points;
    this.duration = opts.duration;
    this.blockDuration = opts.blockDuration;
    this.execEvenly = opts.execEvenly;
    this.execEvenlyMinDelayMs = opts.execEvenlyMinDelayMs;
    this.keyPrefix = opts.keyPrefix;
  }

  get points() {
    return this._points;
  }

  set points(value) {
    this._points = value >= 0 ? value : 4;
  }

  get duration() {
    return this._duration;
  }

  set duration(value) {
    this._duration = typeof value === 'undefined' ? 1 : value;
  }

  get msDuration() {
    return this.duration * 1000;
  }

  get blockDuration() {
    return this._blockDuration;
  }

  set blockDuration(value) {
    this._blockDuration = typeof value === 'undefined' ? 0 : value;
  }

  get msBlockDuration() {
    return this.blockDuration * 1000;
  }

  get execEvenly() {
    return this._execEvenly;
  }

  set execEvenly(value) {
    this._execEvenly = typeof value === 'undefined' ? false : Boolean(value);
  }

  get execEvenlyMinDelayMs() {
    return this._execEvenlyMinDelayMs;
  }

  set execEvenlyMinDelayMs(value) {
    this._execEvenlyMinDelayMs = typeof value === 'undefined' ? Math.ceil(this.msDuration / this.points) : value;
  }

  get keyPrefix() {
    return this._keyPrefix;
  }

  set keyPrefix(value) {
    if (typeof value === 'undefined') {
      value = 'rlflx';
    }
    if (typeof value !== 'string') {
      throw new Error('keyPrefix must be string');
    }
    this._keyPrefix = value;
  }

  _getKeySecDuration(options = {}) {
    return options && options.customDuration >= 0
      ? options.customDuration
      : this.duration;
  }

  getKey(key) {
    return this.keyPrefix.length > 0 ? `${this.keyPrefix}:${key}` : key;
  }

  parseKey(rlKey) {
    return rlKey.substring(this.keyPrefix.length);
  }

  consume() {
    throw new Error("You have to implement the method 'consume'!");
  }

  penalty() {
    throw new Error("You have to implement the method 'penalty'!");
  }

  reward() {
    throw new Error("You have to implement the method 'reward'!");
  }

  get() {
    throw new Error("You have to implement the method 'get'!");
  }

  set() {
    throw new Error("You have to implement the method 'set'!");
  }

  block() {
    throw new Error("You have to implement the method 'block'!");
  }

  delete() {
    throw new Error("You have to implement the method 'delete'!");
  }
};


/***/ }),

/***/ 397:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

/**
 * Implements rate limiting in cluster using built-in IPC
 *
 * Two classes are described here: master and worker
 * Master have to be create in the master process without any options.
 * Any number of rate limiters can be created in workers, but each rate limiter must be with unique keyPrefix
 *
 * Workflow:
 * 1. master rate limiter created in master process
 * 2. worker rate limiter sends 'init' message with necessary options during creating
 * 3. master receives options and adds new rate limiter by keyPrefix if it isn't created yet
 * 4. master sends 'init' back to worker's rate limiter
 * 5. worker can process requests immediately,
 *    but they will be postponed by 'workerWaitInit' until master sends 'init' to worker
 * 6. every request to worker rate limiter creates a promise
 * 7. if master doesn't response for 'timeout', promise is rejected
 * 8. master sends 'resolve' or 'reject' command to worker
 * 9. worker resolves or rejects promise depending on message from master
 *
 */

const cluster = __nccwpck_require__(5001);
const crypto = __nccwpck_require__(6113);
const RateLimiterAbstract = __nccwpck_require__(363);
const RateLimiterMemory = __nccwpck_require__(1351);
const RateLimiterRes = __nccwpck_require__(9975);

const channel = 'rate_limiter_flexible';
let masterInstance = null;

const masterSendToWorker = function (worker, msg, type, res) {
  let data;
  if (res === null || res === true || res === false) {
    data = res;
  } else {
    data = {
      remainingPoints: res.remainingPoints,
      msBeforeNext: res.msBeforeNext,
      consumedPoints: res.consumedPoints,
      isFirstInDuration: res.isFirstInDuration,
    };
  }
  worker.send({
    channel,
    keyPrefix: msg.keyPrefix, // which rate limiter exactly
    promiseId: msg.promiseId,
    type,
    data,
  });
};

const workerWaitInit = function (payload) {
  setTimeout(() => {
    if (this._initiated) {
      process.send(payload);
      // Promise will be removed by timeout if too long
    } else if (typeof this._promises[payload.promiseId] !== 'undefined') {
      workerWaitInit.call(this, payload);
    }
  }, 30);
};

const workerSendToMaster = function (func, promiseId, key, arg, opts) {
  const payload = {
    channel,
    keyPrefix: this.keyPrefix,
    func,
    promiseId,
    data: {
      key,
      arg,
      opts,
    },
  };

  if (!this._initiated) {
    // Wait init before sending messages to master
    workerWaitInit.call(this, payload);
  } else {
    process.send(payload);
  }
};

const masterProcessMsg = function (worker, msg) {
  if (!msg || msg.channel !== channel || typeof this._rateLimiters[msg.keyPrefix] === 'undefined') {
    return false;
  }

  let promise;

  switch (msg.func) {
    case 'consume':
      promise = this._rateLimiters[msg.keyPrefix].consume(msg.data.key, msg.data.arg, msg.data.opts);
      break;
    case 'penalty':
      promise = this._rateLimiters[msg.keyPrefix].penalty(msg.data.key, msg.data.arg, msg.data.opts);
      break;
    case 'reward':
      promise = this._rateLimiters[msg.keyPrefix].reward(msg.data.key, msg.data.arg, msg.data.opts);
      break;
    case 'block':
      promise = this._rateLimiters[msg.keyPrefix].block(msg.data.key, msg.data.arg, msg.data.opts);
      break;
    case 'get':
      promise = this._rateLimiters[msg.keyPrefix].get(msg.data.key, msg.data.opts);
      break;
    case 'delete':
      promise = this._rateLimiters[msg.keyPrefix].delete(msg.data.key, msg.data.opts);
      break;
    default:
      return false;
  }

  if (promise) {
    promise
      .then((res) => {
        masterSendToWorker(worker, msg, 'resolve', res);
      })
      .catch((rejRes) => {
        masterSendToWorker(worker, msg, 'reject', rejRes);
      });
  }
};

const workerProcessMsg = function (msg) {
  if (!msg || msg.channel !== channel || msg.keyPrefix !== this.keyPrefix) {
    return false;
  }

  if (this._promises[msg.promiseId]) {
    clearTimeout(this._promises[msg.promiseId].timeoutId);
    let res;
    if (msg.data === null || msg.data === true || msg.data === false) {
      res = msg.data;
    } else {
      res = new RateLimiterRes(
        msg.data.remainingPoints,
        msg.data.msBeforeNext,
        msg.data.consumedPoints,
        msg.data.isFirstInDuration // eslint-disable-line comma-dangle
      );
    }

    switch (msg.type) {
      case 'resolve':
        this._promises[msg.promiseId].resolve(res);
        break;
      case 'reject':
        this._promises[msg.promiseId].reject(res);
        break;
      default:
        throw new Error(`RateLimiterCluster: no such message type '${msg.type}'`);
    }

    delete this._promises[msg.promiseId];
  }
};
/**
 * Prepare options to send to master
 * Master will create rate limiter depending on options
 *
 * @returns {{points: *, duration: *, blockDuration: *, execEvenly: *, execEvenlyMinDelayMs: *, keyPrefix: *}}
 */
const getOpts = function () {
  return {
    points: this.points,
    duration: this.duration,
    blockDuration: this.blockDuration,
    execEvenly: this.execEvenly,
    execEvenlyMinDelayMs: this.execEvenlyMinDelayMs,
    keyPrefix: this.keyPrefix,
  };
};

const savePromise = function (resolve, reject) {
  const hrtime = process.hrtime();
  let promiseId = hrtime[0].toString() + hrtime[1].toString();

  if (typeof this._promises[promiseId] !== 'undefined') {
    promiseId += crypto.randomBytes(12).toString('base64');
  }

  this._promises[promiseId] = {
    resolve,
    reject,
    timeoutId: setTimeout(() => {
      delete this._promises[promiseId];
      reject(new Error('RateLimiterCluster timeout: no answer from master in time'));
    }, this.timeoutMs),
  };

  return promiseId;
};

class RateLimiterClusterMaster {
  constructor() {
    if (masterInstance) {
      return masterInstance;
    }

    this._rateLimiters = {};

    cluster.setMaxListeners(0);

    cluster.on('message', (worker, msg) => {
      if (msg && msg.channel === channel && msg.type === 'init') {
        // If init request, check or create rate limiter by key prefix and send 'init' back to worker
        if (typeof this._rateLimiters[msg.opts.keyPrefix] === 'undefined') {
          this._rateLimiters[msg.opts.keyPrefix] = new RateLimiterMemory(msg.opts);
        }

        worker.send({
          channel,
          type: 'init',
          keyPrefix: msg.opts.keyPrefix,
        });
      } else {
        masterProcessMsg.call(this, worker, msg);
      }
    });

    masterInstance = this;
  }
}

class RateLimiterClusterMasterPM2 {
  constructor(pm2) {
    if (masterInstance) {
      return masterInstance;
    }

    this._rateLimiters = {};

    pm2.launchBus((err, pm2Bus) => {
      pm2Bus.on('process:msg', (packet) => {
        const msg = packet.raw;
        if (msg && msg.channel === channel && msg.type === 'init') {
          // If init request, check or create rate limiter by key prefix and send 'init' back to worker
          if (typeof this._rateLimiters[msg.opts.keyPrefix] === 'undefined') {
            this._rateLimiters[msg.opts.keyPrefix] = new RateLimiterMemory(msg.opts);
          }

          pm2.sendDataToProcessId(packet.process.pm_id, {
            data: {},
            topic: channel,
            channel,
            type: 'init',
            keyPrefix: msg.opts.keyPrefix,
          }, (sendErr, res) => {
            if (sendErr) {
              console.log(sendErr, res);
            }
          });
        } else {
          const worker = {
            send: (msgData) => {
              const pm2Message = msgData;
              pm2Message.topic = channel;
              if (typeof pm2Message.data === 'undefined') {
                pm2Message.data = {};
              }
              pm2.sendDataToProcessId(packet.process.pm_id, pm2Message, (sendErr, res) => {
                if (sendErr) {
                  console.log(sendErr, res);
                }
              });
            },
          };
          masterProcessMsg.call(this, worker, msg);
        }
      });
    });

    masterInstance = this;
  }
}

class RateLimiterClusterWorker extends RateLimiterAbstract {
  get timeoutMs() {
    return this._timeoutMs;
  }

  set timeoutMs(value) {
    this._timeoutMs = typeof value === 'undefined' ? 5000 : Math.abs(parseInt(value));
  }

  constructor(opts = {}) {
    super(opts);

    process.setMaxListeners(0);

    this.timeoutMs = opts.timeoutMs;

    this._initiated = false;

    process.on('message', (msg) => {
      if (msg && msg.channel === channel && msg.type === 'init' && msg.keyPrefix === this.keyPrefix) {
        this._initiated = true;
      } else {
        workerProcessMsg.call(this, msg);
      }
    });

    // Create limiter on master with specific options
    process.send({
      channel,
      type: 'init',
      opts: getOpts.call(this),
    });

    this._promises = {};
  }

  consume(key, pointsToConsume = 1, options = {}) {
    return new Promise((resolve, reject) => {
      const promiseId = savePromise.call(this, resolve, reject);

      workerSendToMaster.call(this, 'consume', promiseId, key, pointsToConsume, options);
    });
  }

  penalty(key, points = 1, options = {}) {
    return new Promise((resolve, reject) => {
      const promiseId = savePromise.call(this, resolve, reject);

      workerSendToMaster.call(this, 'penalty', promiseId, key, points, options);
    });
  }

  reward(key, points = 1, options = {}) {
    return new Promise((resolve, reject) => {
      const promiseId = savePromise.call(this, resolve, reject);

      workerSendToMaster.call(this, 'reward', promiseId, key, points, options);
    });
  }

  block(key, secDuration, options = {}) {
    return new Promise((resolve, reject) => {
      const promiseId = savePromise.call(this, resolve, reject);

      workerSendToMaster.call(this, 'block', promiseId, key, secDuration, options);
    });
  }

  get(key, options = {}) {
    return new Promise((resolve, reject) => {
      const promiseId = savePromise.call(this, resolve, reject);

      workerSendToMaster.call(this, 'get', promiseId, key, options);
    });
  }

  delete(key, options = {}) {
    return new Promise((resolve, reject) => {
      const promiseId = savePromise.call(this, resolve, reject);

      workerSendToMaster.call(this, 'delete', promiseId, key, options);
    });
  }
}

module.exports = {
  RateLimiterClusterMaster,
  RateLimiterClusterMasterPM2,
  RateLimiterCluster: RateLimiterClusterWorker,
};


/***/ }),

/***/ 7726:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

let drizzleOperators = null;
const CLEANUP_INTERVAL_MS = 300000; // 5 minutes
const EXPIRED_THRESHOLD_MS = 3600000; // 1 hour

class RateLimiterDrizzleError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RateLimiterDrizzleError';
  }
}

async function getDrizzleOperators() {
  if (drizzleOperators) return drizzleOperators;

  try {
    // Use dynamic import to prevent static analysis tools from detecting the import
    function getPackageName() {
      return ['drizzle', 'orm'].join('-');
    }
    const drizzleOrm = await __nccwpck_require__(7668)(`${getPackageName()}`);
    const { and, or, gt, lt, eq, isNull, sql } = drizzleOrm.default || drizzleOrm;
    drizzleOperators = { and, or, gt, lt, eq, isNull, sql };
    return drizzleOperators;
  } catch (error) {
    throw new RateLimiterDrizzleError(
      'drizzle-orm is not installed. Please install drizzle-orm to use RateLimiterDrizzle.'
    );
  }
}

const RateLimiterStoreAbstract = __nccwpck_require__(5664);
const RateLimiterRes = __nccwpck_require__(9975);

class RateLimiterDrizzle extends RateLimiterStoreAbstract {
  constructor(opts) {
    super(opts);

    if (!opts?.schema) {
      throw new RateLimiterDrizzleError('Drizzle schema is required');
    }

    if (!opts?.storeClient) {
      throw new RateLimiterDrizzleError('Drizzle client is required');
    }

    this.schema = opts.schema;
    this.drizzleClient = opts.storeClient;
    this.clearExpiredByTimeout = opts.clearExpiredByTimeout ?? true;

    if (this.clearExpiredByTimeout) {
      this._clearExpiredHourAgo();
    }
  }

  _getRateLimiterRes(rlKey, changedPoints, result) {
    const res = new RateLimiterRes();

    let doc = result;
    res.isFirstInDuration = doc.points === changedPoints;
    res.consumedPoints = doc.points;
    res.remainingPoints = Math.max(this.points - res.consumedPoints, 0);
    res.msBeforeNext = doc.expire !== null
      ? Math.max(new Date(doc.expire).getTime() - Date.now(), 0)
      : -1;

    return res;
  }

  async _upsert(key, points, msDuration, forceExpire = false) {
    if (!this.drizzleClient) {
      return Promise.reject(new RateLimiterDrizzleError('Drizzle client is not established'))
    }

    const { eq, sql } = await getDrizzleOperators();
    const now = new Date();
    const newExpire = msDuration > 0 ? new Date(now.getTime() + msDuration) : null;

    const query = await this.drizzleClient.transaction(async (tx) => {
      const [existingRecord] = await tx
        .select()
        .from(this.schema)
        .where(eq(this.schema.key, key))
        .limit(1);

      const shouldUpdateExpire =
        forceExpire ||
        !existingRecord?.expire ||
        existingRecord?.expire <= now ||
        newExpire === null;

      const [data] = await tx
        .insert(this.schema)
        .values({
          key,
          points,
          expire: newExpire,
        })
        .onConflictDoUpdate({
          target: this.schema.key,
          set: {
            points: !shouldUpdateExpire
              ? sql`${this.schema.points} + ${points}`
              : points,
            ...(shouldUpdateExpire && { expire: newExpire }),
          },
        })
        .returning();

      return data;
    })

    return query
  }

  async _get(rlKey) {
    if (!this.drizzleClient) {
      return Promise.reject(new RateLimiterDrizzleError('Drizzle client is not established'))
    }

    const { and, or, gt, eq, isNull } = await getDrizzleOperators();

    const [response] = await this.drizzleClient
      .select()
      .from(this.schema)
      .where(
        and(
          eq(this.schema.key, rlKey),
          or(gt(this.schema.expire, new Date()), isNull(this.schema.expire))
        )
      )
      .limit(1);

    return response || null;

  }

  async _delete(rlKey) {
    if (!this.drizzleClient) {
      return Promise.reject(new RateLimiterDrizzleError('Drizzle client is not established'))
    }

    const { eq } = await getDrizzleOperators();

    const [result] = await this.drizzleClient
      .delete(this.schema)
      .where(eq(this.schema.key, rlKey))
      .returning({ key: this.schema.key });

    return !!result?.key
  }

  _clearExpiredHourAgo() {
    if (this._clearExpiredTimeoutId) {
      clearTimeout(this._clearExpiredTimeoutId);
    }

    this._clearExpiredTimeoutId = setTimeout(async () => {
      try {
        const { lt } = await getDrizzleOperators();
        await this.drizzleClient
          .delete(this.schema)
          .where(lt(this.schema.expire, new Date(Date.now() - EXPIRED_THRESHOLD_MS)));
      } catch (error) {
        console.warn('Failed to clear expired records:', error);
      }

      this._clearExpiredHourAgo();
    }, CLEANUP_INTERVAL_MS);

    this._clearExpiredTimeoutId.unref();
  }
}

module.exports = RateLimiterDrizzle;


/***/ }),

/***/ 7762:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

let drizzleOperators = null;
const CLEANUP_INTERVAL_MS = 300000; // 5 minutes
const EXPIRED_THRESHOLD_MS = 3600000; // 1 hour

class RateLimiterDrizzleError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RateLimiterDrizzleError';
  }
}

async function getDrizzleOperators() {
  if (drizzleOperators) return drizzleOperators;

  try {
    // Use dynamic import to prevent static analysis tools from detecting the import
    function getPackageName() {
      return ['drizzle', 'orm'].join('-');
    }
    const drizzleOrm = await __nccwpck_require__(7668)(`${getPackageName()}`);
    const { and, or, gt, lt, eq, isNull, sql } = drizzleOrm.default || drizzleOrm;
    drizzleOperators = { and, or, gt, lt, eq, isNull, sql };
    return drizzleOperators;
  } catch (error) {
    throw new RateLimiterDrizzleError(
      'drizzle-orm is not installed. Please install drizzle-orm to use RateLimiterDrizzleNonAtomic.'
    );
  }
}

const RateLimiterStoreAbstract = __nccwpck_require__(5664);
const RateLimiterRes = __nccwpck_require__(9975);

class RateLimiterDrizzleNonAtomic extends RateLimiterStoreAbstract {
  constructor(opts) {
    super(opts);

    if (!opts?.schema) {
      throw new RateLimiterDrizzleError('Drizzle schema is required');
    }

    if (!opts?.storeClient) {
      throw new RateLimiterDrizzleError('Drizzle client is required');
    }

    this.schema = opts.schema;
    this.drizzleClient = opts.storeClient;
    this.clearExpiredByTimeout = opts.clearExpiredByTimeout ?? true;

    if (this.clearExpiredByTimeout) {
      this._clearExpiredHourAgo();
    }
  }

  _getRateLimiterRes(rlKey, changedPoints, result) {
    const res = new RateLimiterRes();

    let doc = result;
    res.isFirstInDuration = doc.points === changedPoints;
    res.consumedPoints = doc.points;
    res.remainingPoints = Math.max(this.points - res.consumedPoints, 0);
    res.msBeforeNext = doc.expire !== null
      ? Math.max(new Date(doc.expire).getTime() - Date.now(), 0)
      : -1;

    return res;
  }

  async _upsert(key, points, msDuration, forceExpire = false) {
    if (!this.drizzleClient) {
      return Promise.reject(new RateLimiterDrizzleError('Drizzle client is not established'));
    }

    const { eq } = await getDrizzleOperators();
    const now = new Date();
    const newExpire = msDuration > 0 ? new Date(now.getTime() + msDuration) : null;

    const [existingRecord] = await this.drizzleClient
      .select()
      .from(this.schema)
      .where(eq(this.schema.key, key))
      .limit(1);

    const shouldUpdateExpire =
      forceExpire ||
      !existingRecord ||
      !existingRecord.expire ||
      existingRecord.expire <= now ||
      newExpire === null;

    let newPoints;
    if (existingRecord && !shouldUpdateExpire) {
      newPoints = existingRecord.points + points;
    } else {
      newPoints = points;
    }

    const [data] = await this.drizzleClient
      .insert(this.schema)
      .values({
        key,
        points: newPoints,
        expire: newExpire,
      })
      .onConflictDoUpdate({
        target: this.schema.key,
        set: {
          points: newPoints,
          ...(shouldUpdateExpire && { expire: newExpire }),
        },
      })
      .returning();

    return data;
  }

  async _get(rlKey) {
    if (!this.drizzleClient) {
      return Promise.reject(new RateLimiterDrizzleError('Drizzle client is not established'));
    }

    const { and, or, gt, eq, isNull } = await getDrizzleOperators();

    const [response] = await this.drizzleClient
      .select()
      .from(this.schema)
      .where(
        and(
          eq(this.schema.key, rlKey),
          or(gt(this.schema.expire, new Date()), isNull(this.schema.expire))
        )
      )
      .limit(1);

    return response || null;
  }

  async _delete(rlKey) {
    if (!this.drizzleClient) {
      return Promise.reject(new RateLimiterDrizzleError('Drizzle client is not established'));
    }

    const { eq } = await getDrizzleOperators();

    const [result] = await this.drizzleClient
      .delete(this.schema)
      .where(eq(this.schema.key, rlKey))
      .returning({ key: this.schema.key });

    return !!(result && result.key);
  }

  _clearExpiredHourAgo() {
    if (this._clearExpiredTimeoutId) {
      clearTimeout(this._clearExpiredTimeoutId);
    }

    this._clearExpiredTimeoutId = setTimeout(async () => {
      try {
        const { lt } = await getDrizzleOperators();
        await this.drizzleClient
          .delete(this.schema)
          .where(lt(this.schema.expire, new Date(Date.now() - EXPIRED_THRESHOLD_MS)));
      } catch (error) {
        console.warn('Failed to clear expired records:', error);
      }

      this._clearExpiredHourAgo();
    }, CLEANUP_INTERVAL_MS);

    this._clearExpiredTimeoutId.unref();
  }
}

module.exports = RateLimiterDrizzleNonAtomic;


/***/ }),

/***/ 9766:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const RateLimiterRes = __nccwpck_require__(9975);
const RateLimiterStoreAbstract = __nccwpck_require__(5664);

class DynamoItem {
  /**
   * Create a DynamoItem.
   * @param {string} rlKey - The key for the rate limiter.
   * @param {number} points - The number of points.
   * @param {number} expire - The expiration time in seconds.
   */
  constructor(rlKey, points, expire) {
    this.key = rlKey;
    this.points = points;
    this.expire = expire;
  }
}

// Free tier DynamoDB provisioned mode params
const DEFAULT_READ_CAPACITY_UNITS = 25;
const DEFAULT_WRITE_CAPACITY_UNITS = 25;

/**
 * Implementation of RateLimiterStoreAbstract using DynamoDB.
 * @class RateLimiterDynamo
 * @extends RateLimiterStoreAbstract
 */
class RateLimiterDynamo extends RateLimiterStoreAbstract {

    /**
     * Constructs a new instance of the class.
     * The storeClient MUST be an instance of AWS.DynamoDB NOT of AWS.DynamoDBClient.
     *
     * @param {Object} opts - The options for the constructor.
     * @param {function} cb - The callback function (optional).
     * @return {void}
     */
    constructor(opts, cb = null) {
        super(opts);

        this.client = opts.storeClient;
        this.tableName = opts.tableName;
        this.tableCreated = opts.tableCreated;
        this.ttlManuallySet = opts.ttlSet;
        
        if (!this.tableCreated) {
          this._createTable(opts.dynamoTableOpts)
          .then((data) => {
            this.tableCreated = true;

            this._setTTL()
            .finally(() => {
              // Callback invocation
              if (typeof cb === 'function') {
                cb();
              }
            });
            
          })
          .catch( err => {
            //callback invocation
            if (typeof cb === 'function') {
              cb(err);
            } else {
              throw err;
            }
          });

        } else {

          this._setTTL()
          .finally(() => {
            // Callback invocation
            if (typeof cb === 'function') {
              cb();
            }
          });
        }
    }

    get tableName() {
        return this._tableName;
    }

    set tableName(value) {
        this._tableName = typeof value === 'undefined' ? 'node-rate-limiter-flexible' : value;
    }

    get tableCreated() {
        return this._tableCreated
    }
    
    set tableCreated(value) {
        this._tableCreated = typeof value === 'undefined' ? false : !!value;
    }

    /**
     * Creates a table in the database. Return null if the table already exists.
     * 
     * @param {{readCapacityUnits: number, writeCapacityUnits: number}} tableOpts
     * @return {Promise} A promise that resolves with the result of creating the table.
     */
    async _createTable(tableOpts) {

      const params = {
        TableName: this.tableName,
        AttributeDefinitions: [
          {
            AttributeName: 'key',
            AttributeType: 'S'
          }
        ],
        KeySchema: [
          {
            AttributeName: 'key',
            KeyType: 'HASH'
          }
        ],
        ProvisionedThroughput: {
          ReadCapacityUnits: tableOpts && tableOpts.readCapacityUnits ? tableOpts.readCapacityUnits : DEFAULT_READ_CAPACITY_UNITS,
          WriteCapacityUnits: tableOpts && tableOpts.writeCapacityUnits ? tableOpts.writeCapacityUnits : DEFAULT_WRITE_CAPACITY_UNITS
        }
      };
      
      try {
        const data = await this.client.createTable(params);
        return data;
      } catch(err) {
        if (err.__type && err.__type.includes('ResourceInUseException')) {
          return null;
        } else {
          throw err;
        }
      }
    }

    /**
     * Retrieves an item from the table based on the provided key.
     *
     * @param {string} rlKey - The key used to retrieve the item.
     * @throws {Error} Throws an error if the table is not created yet.
     * @return {DynamoItem|null} - The retrieved item, or null if it doesn't exist.
     */
    async _get(rlKey) {

      if (!this.tableCreated) {
        throw new Error('Table is not created yet');
      }

      const params = {
        TableName: this.tableName,
        Key: {
          key: {S: rlKey}
        }
      };
      
      const data = await this.client.getItem(params);
      if(data.Item) {
        return new DynamoItem(
          data.Item.key.S,
          Number(data.Item.points.N),
          Number(data.Item.expire.N)
        );
      } else {
        return null;
      }
    }

    /**
     * Deletes an item from the table based on the given rlKey.
     *
     * @param {string} rlKey - The rlKey of the item to delete.
     * @throws {Error} Throws an error if the table is not created yet.
     * @return {boolean} Returns true if the item was successfully deleted, otherwise false.
     */
    async _delete(rlKey) {

      if (!this.tableCreated) {
        throw new Error('Table is not created yet');
      }

      const params = {
        TableName: this.tableName,
        Key: {
          key: {S: rlKey}
        },
        ConditionExpression: 'attribute_exists(#k)',
        ExpressionAttributeNames: {
          '#k': 'key'  
        }
      }
      
      try {
        const data = await this._client.deleteItem(params);
        return data.$metadata.httpStatusCode === 200;
      } catch(err) {
        // ConditionalCheckFailed, item does not exist in table
        if (err.__type && err.__type.includes('ConditionalCheckFailedException')) {
          return false;
        } else {
          throw err;
        }
      }

    }

    /**
     * Implemented with DynamoDB Atomic Counters. 3 calls are made to DynamoDB but each call is atomic.
     * From the documentation: "UpdateItem calls are naturally serialized within DynamoDB,
     * so there are no race condition concerns with making multiple simultaneous calls."
     * See: https://aws.amazon.com/it/blogs/database/implement-resource-counters-with-amazon-dynamodb/
     * @param {*} rlKey 
     * @param {*} points 
     * @param {*} msDuration 
     * @param {*} forceExpire 
     * @param {*} options 
     * @returns
     */
    async _upsert(rlKey, points, msDuration, forceExpire = false, options = {}) {

      if (!this.tableCreated) {
        throw new Error('Table is not created yet');
      }

      const dateNow = Date.now();
      const dateNowSec = dateNow / 1000;
      /* -1 means never expire, DynamoDb do not support null values in number fields.
         DynamoDb TTL use unix timestamp in seconds.
      */
      const newExpireSec = msDuration > 0 ? (dateNow + msDuration) / 1000 : -1;

      // Force expire, overwrite points. Create a new entry if not exists
      if (forceExpire) {
        return await this._baseUpsert({
          TableName: this.tableName,
          Key: { key: {S: rlKey} },
          UpdateExpression: 'SET points = :points, expire = :expire',
          ExpressionAttributeValues: {
            ':points': {N: points.toString()},
            ':expire': {N: newExpireSec.toString()}
          },
          ReturnValues: 'ALL_NEW'
        });
      }

      try {        
        // First try update, success if entry NOT exists or IS expired
        return await this._baseUpsert({
          TableName: this.tableName,
          Key: { key: {S: rlKey} },
          UpdateExpression: 'SET points = :new_points, expire = :new_expire',
          ExpressionAttributeValues: {
            ':new_points': {N: points.toString()},
            ':new_expire': {N: newExpireSec.toString()},
            ':where_expire': {N: dateNowSec.toString()}
          },
          ConditionExpression: 'expire <= :where_expire OR attribute_not_exists(points)',
          ReturnValues: 'ALL_NEW'
        });

      } catch (err) {
        // Second try update, success if entry exists and IS NOT expired
        return await this._baseUpsert({
          TableName: this.tableName,
          Key: { key: {S: rlKey} },
          UpdateExpression: 'SET points = points + :new_points',
          ExpressionAttributeValues: {
            ':new_points': {N: points.toString()},
            ':where_expire': {N: dateNowSec.toString()}
          },
          ConditionExpression: 'expire > :where_expire',
          ReturnValues: 'ALL_NEW'
        });
      }
    }
    
    /**
     * Asynchronously upserts data into the table. params is a DynamoDB params object.
     *
     * @param {Object} params - The parameters for the upsert operation.
     * @throws {Error} Throws an error if the table is not created yet.
     * @return {DynamoItem} Returns a DynamoItem object with the updated data.
     */
    async _baseUpsert(params) {

      if (!this.tableCreated) {
        throw new Error('Table is not created yet');
      }
      
      try {
        const data = await this.client.updateItem(params);
        return new DynamoItem(
          data.Attributes.key.S,
          Number(data.Attributes.points.N),
          Number(data.Attributes.expire.N)
        );
      } catch (err) {
        //console.log('_baseUpsert', params, err);
        throw err;
      }
    }

    /**
     * Sets the Time-to-Live (TTL) for the table. TTL use the expire field in the table.
     * See: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/howitworks-ttl.html
     *
     * @return {Promise} A promise that resolves when the TTL is successfully set.
     * @throws {Error} Throws an error if the table is not created yet.
     * @returns {Promise}
     */
    async _setTTL() {

      if (!this.tableCreated) {
        throw new Error('Table is not created yet');
      }

      try {
        
        // Check if the TTL is already set
        const isTTLSet = await this._isTTLSet();
        if (isTTLSet) {
          return;
        }

        const params = {
          TableName: this.tableName,
          TimeToLiveSpecification: {
            AttributeName: 'expire',
            Enabled: true
          }
        }

        const res = await this.client.updateTimeToLive(params);
        return res;

      } catch (err) {
        throw err;
      }

    }

    /**
     * Checks if the Time To Live (TTL) feature is set for the DynamoDB table.
     *
     * @return {boolean} Returns true if the TTL feature is enabled for the table, otherwise false.
     * @throws {Error} Throws an error if the table is not created yet or if there is an error while checking the TTL status.
     */
    async _isTTLSet() {
      
      if (!this.tableCreated) {
        throw new Error('Table is not created yet');
      }

      if (this.ttlManuallySet) {
        return true;
      }

      try {

        const res = await this.client.describeTimeToLive({TableName: this.tableName});
        return (
          res.$metadata.httpStatusCode == 200 
          && res.TimeToLiveDescription.TimeToLiveStatus === 'ENABLED'
          && res.TimeToLiveDescription.AttributeName === 'expire'
        );
        
      } catch (err) {
        throw err;
      }
    }

    /**
     * Generate a RateLimiterRes object based on the provided parameters.
     *
     * @param {string} rlKey - The key for the rate limiter.
     * @param {number} changedPoints - The number of points that have changed.
     * @param {DynamoItem} result - The result object of _get() method.
     * @returns {RateLimiterRes} - The generated RateLimiterRes object.
     */
    _getRateLimiterRes(rlKey, changedPoints, result) {

      const res = new RateLimiterRes();
      res.isFirstInDuration = changedPoints === result.points;
      res.consumedPoints = res.isFirstInDuration ? changedPoints : result.points;
      res.remainingPoints = Math.max(this.points - res.consumedPoints, 0);
      // Expire time saved in unix time seconds not ms
      res.msBeforeNext = result.expire != -1 ? Math.max(result.expire * 1000 - Date.now(), 0) : -1;

      return res;
    }

}

module.exports = RateLimiterDynamo;

/***/ }),

/***/ 8810:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const RateLimiterEtcdTransactionFailedError = __nccwpck_require__(7854);
const RateLimiterEtcdNonAtomic = __nccwpck_require__(5721);

const MAX_TRANSACTION_TRIES = 5;

class RateLimiterEtcd extends RateLimiterEtcdNonAtomic {
  /**
   * Resolve with object used for {@link _getRateLimiterRes} to generate {@link RateLimiterRes}.
   */
  async _upsert(rlKey, points, msDuration, forceExpire = false) {
    const expire = msDuration > 0 ? Date.now() + msDuration : null;

    let newValue = { points, expire };
    let oldValue;

    // If we need to force the expiration, just set the key.
    if (forceExpire) {
      await this.client
        .put(rlKey)
        .value(JSON.stringify(newValue));
    } else {
      // First try to add a new key
      const added = await this.client
        .if(rlKey, 'Version', '===', '0')
        .then(this.client
          .put(rlKey)
          .value(JSON.stringify(newValue)))
        .commit()
        .then(result => !!result.succeeded);

      // If the key already existed, try to update it in a transaction
      if (!added) {
        let success = false;

        for (let i = 0; i < MAX_TRANSACTION_TRIES; i++) {
          // eslint-disable-next-line no-await-in-loop
          oldValue = await this._get(rlKey);
          newValue = { points: oldValue.points + points, expire };

          // eslint-disable-next-line no-await-in-loop
          success = await this.client
            .if(rlKey, 'Value', '===', JSON.stringify(oldValue))
            .then(this.client
              .put(rlKey)
              .value(JSON.stringify(newValue)))
            .commit()
            .then(result => !!result.succeeded);
          if (success) {
            break;
          }
        }

        if (!success) {
          throw new RateLimiterEtcdTransactionFailedError('Could not set new value in a transaction.');
        }
      }
    }

    return newValue;
  }
}

module.exports = RateLimiterEtcd;


/***/ }),

/***/ 5721:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const RateLimiterStoreAbstract = __nccwpck_require__(5664);
const RateLimiterRes = __nccwpck_require__(9975);
const RateLimiterSetupError = __nccwpck_require__(2653);

class RateLimiterEtcdNonAtomic extends RateLimiterStoreAbstract {
  /**
   * @param {Object} opts
   */
  constructor(opts) {
    super(opts);

    if (!opts.storeClient) {
      throw new RateLimiterSetupError('You need to set the option "storeClient" to an instance of class "Etcd3".');
    }

    this.client = opts.storeClient;
  }

  /**
   * Get RateLimiterRes object filled depending on storeResult, which specific for exact store.
   */
  _getRateLimiterRes(rlKey, changedPoints, result) {
    const res = new RateLimiterRes();

    res.isFirstInDuration = changedPoints === result.points;
    res.consumedPoints = res.isFirstInDuration ? changedPoints : result.points;
    res.remainingPoints = Math.max(this.points - res.consumedPoints, 0);
    res.msBeforeNext = result.expire ? Math.max(result.expire - Date.now(), 0) : -1;

    return res;
  }

  /**
   * Resolve with object used for {@link _getRateLimiterRes} to generate {@link RateLimiterRes}.
   */
  async _upsert(rlKey, points, msDuration, forceExpire = false) {
    const expire = msDuration > 0 ? Date.now() + msDuration : null;

    let newValue = { points, expire };

    // If we need to force the expiration, just set the key.
    if (forceExpire) {
      await this.client
        .put(rlKey)
        .value(JSON.stringify(newValue));
    } else {
      const oldValue = await this._get(rlKey);
      newValue = { points: (oldValue !== null ? oldValue.points : 0) + points, expire };
      await this.client
        .put(rlKey)
        .value(JSON.stringify(newValue));
    }

    return newValue;
  }

  /**
   * Resolve with raw result from Store OR null if rlKey is not set
   * or Reject with error
   */
  async _get(rlKey) {
    return this.client
      .get(rlKey)
      .string()
      .then(result => (result !== null ? JSON.parse(result) : null));
  }

  /**
   * Resolve with true OR false if rlKey doesn't exist.
   * or Reject with error.
   */
  async _delete(rlKey) {
    return this.client
      .delete()
      .key(rlKey)
      .then(result => result.deleted === '1');
  }
}

module.exports = RateLimiterEtcdNonAtomic;


/***/ }),

/***/ 2813:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const RateLimiterAbstract = __nccwpck_require__(363);
const RateLimiterRes = __nccwpck_require__(9975);

module.exports = class RateLimiterInsuredAbstract extends RateLimiterAbstract {
  constructor(opts = {}) {
    super(opts);
    this.insuranceLimiter = opts.insuranceLimiter;
  }

  get insuranceLimiter() {
    return this._insuranceLimiter;
  }

  set insuranceLimiter(value) {
    if (typeof value !== 'undefined' && !(value instanceof RateLimiterAbstract)) {
      throw new Error('insuranceLimiter must be instance of RateLimiterAbstract');
    }
    this._insuranceLimiter = value;
    if (this._insuranceLimiter) {
      this._insuranceLimiter.blockDuration = this.blockDuration;
      this._insuranceLimiter.execEvenly = this.execEvenly;
    }
  }

  _handleError(err, funcName, resolve, reject, params) {
    if (err instanceof RateLimiterRes) {
      reject(err);
    } else if (!(this.insuranceLimiter instanceof RateLimiterAbstract)) {
      reject(err);
    } else {
      this.insuranceLimiter[funcName](...params)
        .then((res) => {
          resolve(res);
        })
        .catch((res) => {
          reject(res);
        });
    }
  }

  _operation(funcName, params) {
    const promise = this[funcName](...params);
    return new Promise((resolve, reject) => {
      return promise.then((res) => {
          resolve(res);
        })
        .catch((err) => {
          if (funcName.startsWith('_')) {
            funcName = funcName.slice(1);
          }
          this._handleError(err, funcName, resolve, reject, params);
        });
    });
  }

  consume(key, pointsToConsume = 1, options = {}) {
    return this._operation('_consume', [key, pointsToConsume, options]);
  }

  penalty(key, points = 1, options = {}) {
    return this._operation('_penalty', [key, points, options]);
  }

  reward(key, points = 1, options = {}) {
    return this._operation('_reward', [key, points, options]);
  }

  get(key, options = {}) {
    return this._operation('_get', [key, options]);
  }

  set(key, points, secDuration, options = {}) {
    return this._operation('_set', [key, points, secDuration, options]);
  }

  block(key, secDuration, options = {}) {
    return this._operation('_block', [key, secDuration, options]);
  }

  delete(key, options = {}) {
    return this._operation('_delete', [key, options]);
  }

  _consume() {
    throw new Error("You have to implement the method '_consume'!");
  }

  _penalty() {
    throw new Error("You have to implement the method '_penalty'!");
  }

  _reward() {
    throw new Error("You have to implement the method '_reward'!");
  }

  _get() {
    throw new Error("You have to implement the method '_get'!");
  }

  _set() {
    throw new Error("You have to implement the method '_set'!");
  }

  _block() {
    throw new Error("You have to implement the method '_block'!");
  }

  _delete() {
    throw new Error("You have to implement the method '_delete'!");
  }

}


/***/ }),

/***/ 8747:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const RateLimiterStoreAbstract = __nccwpck_require__(5664);
const RateLimiterRes = __nccwpck_require__(9975);

class RateLimiterMemcache extends RateLimiterStoreAbstract {
  /**
   *
   * @param {Object} opts
   * Defaults {
   *   ... see other in RateLimiterStoreAbstract
   *
   *   storeClient: memcacheClient
   * }
   */
  constructor(opts) {
    super(opts);

    this.client = opts.storeClient;
  }

  _getRateLimiterRes(rlKey, changedPoints, result) {
    const res = new RateLimiterRes();
    res.consumedPoints = parseInt(result.consumedPoints);
    res.isFirstInDuration = result.consumedPoints === changedPoints;
    res.remainingPoints = Math.max(this.points - res.consumedPoints, 0);
    res.msBeforeNext = result.msBeforeNext;

    return res;
  }

  _upsert(rlKey, points, msDuration, forceExpire = false, options = {}) {
    return new Promise((resolve, reject) => {
      const nowMs = Date.now();
      const secDuration = Math.floor(msDuration / 1000);

      if (forceExpire) {
        this.client.set(rlKey, points, secDuration, (err) => {
          if (!err) {
            this.client.set(
              `${rlKey}_expire`,
              secDuration > 0 ? nowMs + (secDuration * 1000) : -1,
              secDuration,
              () => {
                const res = {
                  consumedPoints: points,
                  msBeforeNext: secDuration > 0 ? secDuration * 1000 : -1,
                };
                resolve(res);
              }
            );
          } else {
            reject(err);
          }
        });
      } else {
        this.client.incr(rlKey, points, (err, consumedPoints) => {
          if (err || consumedPoints === false) {
            this.client.add(rlKey, points, secDuration, (errAddKey, createdNew) => {
              if (errAddKey || !createdNew) {
                // Try to upsert again in case of race condition
                if (typeof options.attemptNumber === 'undefined' || options.attemptNumber < 3) {
                  const nextOptions = Object.assign({}, options);
                  nextOptions.attemptNumber = nextOptions.attemptNumber ? (nextOptions.attemptNumber + 1) : 1;

                  this._upsert(rlKey, points, msDuration, forceExpire, nextOptions)
                    .then(resUpsert => resolve(resUpsert))
                    .catch(errUpsert => reject(errUpsert));
                } else {
                  reject(new Error('Can not add key'));
                }
              } else {
                this.client.add(
                  `${rlKey}_expire`,
                  secDuration > 0 ? nowMs + (secDuration * 1000) : -1,
                  secDuration,
                  () => {
                    const res = {
                      consumedPoints: points,
                      msBeforeNext: secDuration > 0 ? secDuration * 1000 : -1,
                    };
                    resolve(res);
                  }
                );
              }
            });
          } else {
            this.client.get(`${rlKey}_expire`, (errGetExpire, resGetExpireMs) => {
              if (errGetExpire) {
                reject(errGetExpire);
              } else {
                const expireMs = resGetExpireMs === false ? 0 : resGetExpireMs;
                const res = {
                  consumedPoints,
                  msBeforeNext: expireMs >= 0 ? Math.max(expireMs - nowMs, 0) : -1,
                };
                resolve(res);
              }
            });
          }
        });
      }
    });
  }

  _get(rlKey) {
    return new Promise((resolve, reject) => {
      const nowMs = Date.now();

      this.client.get(rlKey, (err, consumedPoints) => {
        if (!consumedPoints) {
          resolve(null);
        } else {
          this.client.get(`${rlKey}_expire`, (errGetExpire, resGetExpireMs) => {
            if (errGetExpire) {
              reject(errGetExpire);
            } else {
              const expireMs = resGetExpireMs === false ? 0 : resGetExpireMs;
              const res = {
                consumedPoints,
                msBeforeNext: expireMs >= 0 ? Math.max(expireMs - nowMs, 0) : -1,
              };
              resolve(res);
            }
          });
        }
      });
    });
  }

  _delete(rlKey) {
    return new Promise((resolve, reject) => {
      this.client.del(rlKey, (err, res) => {
        if (err) {
          reject(err);
        } else if (res === false) {
          resolve(res);
        } else {
          this.client.del(`${rlKey}_expire`, (errDelExpire) => {
            if (errDelExpire) {
              reject(errDelExpire);
            } else {
              resolve(res);
            }
          });
        }
      });
    });
  }
}

module.exports = RateLimiterMemcache;


/***/ }),

/***/ 1351:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const RateLimiterAbstract = __nccwpck_require__(363);
const MemoryStorage = __nccwpck_require__(7774);
const RateLimiterRes = __nccwpck_require__(9975);

class RateLimiterMemory extends RateLimiterAbstract {
  constructor(opts = {}) {
    super(opts);

    this._memoryStorage = new MemoryStorage();
  }
  /**
   *
   * @param key
   * @param pointsToConsume
   * @param {Object} options
   * @returns {Promise<RateLimiterRes>}
   */
  consume(key, pointsToConsume = 1, options = {}) {
    return new Promise((resolve, reject) => {
      const rlKey = this.getKey(key);
      const secDuration = this._getKeySecDuration(options);
      let res = this._memoryStorage.incrby(rlKey, pointsToConsume, secDuration);
      res.remainingPoints = Math.max(this.points - res.consumedPoints, 0);

      if (res.consumedPoints > this.points) {
        // Block only first time when consumed more than points
        if (this.blockDuration > 0 && res.consumedPoints <= (this.points + pointsToConsume)) {
          // Block key
          res = this._memoryStorage.set(rlKey, res.consumedPoints, this.blockDuration);
        }
        reject(res);
      } else if (this.execEvenly && res.msBeforeNext > 0 && !res.isFirstInDuration) {
        // Execute evenly
        let delay = Math.ceil(res.msBeforeNext / (res.remainingPoints + 2));
        if (delay < this.execEvenlyMinDelayMs) {
          delay = res.consumedPoints * this.execEvenlyMinDelayMs;
        }

        setTimeout(resolve, delay, res);
      } else {
        resolve(res);
      }
    });
  }

  penalty(key, points = 1, options = {}) {
    const rlKey = this.getKey(key);
    return new Promise((resolve) => {
      const secDuration = this._getKeySecDuration(options);
      const res = this._memoryStorage.incrby(rlKey, points, secDuration);
      res.remainingPoints = Math.max(this.points - res.consumedPoints, 0);
      resolve(res);
    });
  }

  reward(key, points = 1, options = {}) {
    const rlKey = this.getKey(key);
    return new Promise((resolve) => {
      const secDuration = this._getKeySecDuration(options);
      const res = this._memoryStorage.incrby(rlKey, -points, secDuration);
      res.remainingPoints = Math.max(this.points - res.consumedPoints, 0);
      resolve(res);
    });
  }

  /**
   * Block any key for secDuration seconds
   *
   * @param key
   * @param secDuration
   */
  block(key, secDuration) {
    const msDuration = secDuration * 1000;
    const initPoints = this.points + 1;

    this._memoryStorage.set(this.getKey(key), initPoints, secDuration);
    return Promise.resolve(
      new RateLimiterRes(0, msDuration === 0 ? -1 : msDuration, initPoints)
    );
  }

  set(key, points, secDuration) {
    const msDuration = (secDuration >= 0 ? secDuration : this.duration) * 1000;

    this._memoryStorage.set(this.getKey(key), points, secDuration);
    return Promise.resolve(
      new RateLimiterRes(0, msDuration === 0 ? -1 : msDuration, points)
    );
  }

  get(key) {
    const res = this._memoryStorage.get(this.getKey(key));
    if (res !== null) {
      res.remainingPoints = Math.max(this.points - res.consumedPoints, 0);
    }

    return Promise.resolve(res);
  }

  delete(key) {
    return Promise.resolve(this._memoryStorage.delete(this.getKey(key)));
  }
}

module.exports = RateLimiterMemory;



/***/ }),

/***/ 978:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const RateLimiterStoreAbstract = __nccwpck_require__(5664);
const RateLimiterRes = __nccwpck_require__(9975);

/**
 * Get MongoDB driver version as upsert options differ
 * @params {Object} Client instance
 * @returns {Object} Version Object containing major, feature & minor versions.
 */
function getDriverVersion(client) {
  try {
    const _client = client.client ? client.client : client;

    let _v = [0, 0, 0];
    if (typeof _client.topology === 'undefined') {
      const { version } = _client.options.metadata.driver;
      _v = version.split('|', 1)[0].split('.').map(v => parseInt(v));
    } else {
      const { version } = _client.topology.s.options.metadata.driver;
      _v = version.split('.').map(v => parseInt(v));
    }

    return {
      major: _v[0],
      feature: _v[1],
      patch: _v[2],
    };
  } catch (err) {
    return { major: 0, feature: 0, patch: 0 };
  }
}

class RateLimiterMongo extends RateLimiterStoreAbstract {
  /**
   *
   * @param {Object} opts
   * Defaults {
   *   indexKeyPrefix: {attr1: 1, attr2: 1}
   *   ... see other in RateLimiterStoreAbstract
   *
   *   mongo: MongoClient
   * }
   */
  constructor(opts) {
    super(opts);

    this.dbName = opts.dbName;
    this.tableName = opts.tableName;
    this.indexKeyPrefix = opts.indexKeyPrefix;
    this.disableIndexesCreation = opts.disableIndexesCreation;

    if (opts.mongo) {
      this.client = opts.mongo;
    } else {
      this.client = opts.storeClient;
    }
    if (typeof this.client.then === 'function') {
      // If Promise
      this.client
        .then((conn) => {
          this.client = conn;
          this._initCollection();
          this._driverVersion = getDriverVersion(this.client);
        });
    } else {
      this._initCollection();
      this._driverVersion = getDriverVersion(this.client);
    }
  }

  get dbName() {
    return this._dbName;
  }

  set dbName(value) {
    this._dbName = typeof value === 'undefined' ? RateLimiterMongo.getDbName() : value;
  }

  static getDbName() {
    return 'node-rate-limiter-flexible';
  }

  get tableName() {
    return this._tableName;
  }

  set tableName(value) {
    this._tableName = typeof value === 'undefined' ? this.keyPrefix : value;
  }

  get client() {
    return this._client;
  }

  set client(value) {
    if (typeof value === 'undefined') {
      throw new Error('mongo is not set');
    }
    this._client = value;
  }

  get indexKeyPrefix() {
    return this._indexKeyPrefix;
  }

  set indexKeyPrefix(obj) {
    this._indexKeyPrefix = obj || {};
  }

  get disableIndexesCreation() {
    return this._disableIndexesCreation;
  }
  set disableIndexesCreation(value) {
    this._disableIndexesCreation = !!value;
  }

  async createIndexes() {
    const db = typeof this.client.db === 'function'
      ? this.client.db(this.dbName)
      : this.client;

    const collection = db.collection(this.tableName);
    await collection.createIndex({ expire: -1 }, { expireAfterSeconds: 0 });
    await collection.createIndex(Object.assign({}, this.indexKeyPrefix, { key: 1 }), { unique: true });
  }

  _initCollection() {
    const db = typeof this.client.db === 'function'
      ? this.client.db(this.dbName)
      : this.client;

    const collection = db.collection(this.tableName);
    if (!this.disableIndexesCreation) {
      this.createIndexes().catch((err) => {
        console.error(`Cannot create indexes for mongo collection ${this.tableName}`, err);
      });
    }

    this._collection = collection;
  }

  _getRateLimiterRes(rlKey, changedPoints, result) {
    const res = new RateLimiterRes();

    let doc;
    if (typeof result.value === 'undefined') {
      doc = result;
    } else {
      doc = result.value;
    }

    res.isFirstInDuration = doc.points === changedPoints;
    res.consumedPoints = doc.points;

    res.remainingPoints = Math.max(this.points - res.consumedPoints, 0);
    res.msBeforeNext = doc.expire !== null
      ? Math.max(new Date(doc.expire).getTime() - Date.now(), 0)
      : -1;

    return res;
  }

  _upsert(key, points, msDuration, forceExpire = false, options = {}) {
    if (!this._collection) {
      return Promise.reject(Error('Mongo connection is not established'));
    }

    const docAttrs = options.attrs || {};

    let where;
    let upsertData;
    if (forceExpire) {
      where = { key };
      where = Object.assign(where, docAttrs);
      upsertData = {
        $set: {
          key,
          points,
          expire: msDuration > 0 ? new Date(Date.now() + msDuration) : null,
        },
      };
      upsertData.$set = Object.assign(upsertData.$set, docAttrs);
    } else {
      where = {
        $or: [
          { expire: { $gt: new Date() } },
          { expire: { $eq: null } },
        ],
        key,
      };
      where = Object.assign(where, docAttrs);
      upsertData = {
        $setOnInsert: {
          key,
          expire: msDuration > 0 ? new Date(Date.now() + msDuration) : null,
        },
        $inc: { points },
      };
      upsertData.$setOnInsert = Object.assign(upsertData.$setOnInsert, docAttrs);
    }

    // Options for collection updates differ between driver versions
    const upsertOptions = {
      upsert: true,
    };
    if ((this._driverVersion.major >= 4) ||
        (this._driverVersion.major === 3 &&
          (this._driverVersion.feature >=7) ||
          (this._driverVersion.feature >= 6 &&
              this._driverVersion.patch >= 7 )))
    {
      upsertOptions.returnDocument = 'after';
    } else {
      upsertOptions.returnOriginal = false;
    }

    /*
     * 1. Find actual limit and increment points
     * 2. If limit expired, but Mongo doesn't clean doc by TTL yet, try to replace limit doc completely
     * 3. If 2 or more Mongo threads try to insert the new limit doc, only the first succeed
     * 4. Try to upsert from step 1. Actual limit is created now, points are incremented without problems
     */
    return new Promise((resolve, reject) => {
      this._collection.findOneAndUpdate(
        where,
        upsertData,
        upsertOptions
      ).then((res) => {
        resolve(res);
      }).catch((errUpsert) => {
        if (errUpsert && errUpsert.code === 11000) { // E11000 duplicate key error collection
          const replaceWhere = Object.assign({ // try to replace OLD limit doc
            $or: [
              { expire: { $lte: new Date() } },
              { expire: { $eq: null } },
            ],
            key,
          }, docAttrs);

          const replaceTo = {
            $set: Object.assign({
              key,
              points,
              expire: msDuration > 0 ? new Date(Date.now() + msDuration) : null,
            }, docAttrs)
          };

          this._collection.findOneAndUpdate(
            replaceWhere,
            replaceTo,
            upsertOptions
          ).then((res) => {
            resolve(res);
          }).catch((errReplace) => {
            if (errReplace && errReplace.code === 11000) { // E11000 duplicate key error collection
              this._upsert(key, points, msDuration, forceExpire)
                .then(res => resolve(res))
                .catch(err => reject(err));
            } else {
              reject(errReplace);
            }
          });
        } else {
          reject(errUpsert);
        }
      });
    });
  }

  _get(rlKey, options = {}) {
    if (!this._collection) {
      return Promise.reject(Error('Mongo connection is not established'));
    }

    const docAttrs = options.attrs || {};

    const where = Object.assign({
      key: rlKey,
      $or: [
        { expire: { $gt: new Date() } },
        { expire: { $eq: null } },
      ],
    }, docAttrs);

    return this._collection.findOne(where);
  }

  _delete(rlKey, options = {}) {
    if (!this._collection) {
      return Promise.reject(Error('Mongo connection is not established'));
    }

    const docAttrs = options.attrs || {};
    const where = Object.assign({ key: rlKey }, docAttrs);

    return this._collection.deleteOne(where)
      .then(res => res.deletedCount > 0);
  }
}

module.exports = RateLimiterMongo;


/***/ }),

/***/ 2532:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const RateLimiterStoreAbstract = __nccwpck_require__(5664);
const RateLimiterRes = __nccwpck_require__(9975);

class RateLimiterMySQL extends RateLimiterStoreAbstract {
  /**
   * @callback callback
   * @param {Object} err
   *
   * @param {Object} opts
   * @param {callback} cb
   * Defaults {
   *   ... see other in RateLimiterStoreAbstract
   *
   *   storeClient: anySqlClient,
   *   storeType: 'knex', // required only for Knex instance
   *   dbName: 'string',
   *   tableName: 'string',
   * }
   */
  constructor(opts, cb = null) {
    super(opts);

    this.client = opts.storeClient;
    this.clientType = opts.storeType;

    this.dbName = opts.dbName;
    this.tableName = opts.tableName;

    this.clearExpiredByTimeout = opts.clearExpiredByTimeout;

    this.tableCreated = opts.tableCreated;
    if (!this.tableCreated) {
      this._createDbAndTable()
        .then(() => {
          this.tableCreated = true;
          if (this.clearExpiredByTimeout) {
            this._clearExpiredHourAgo();
          }
          if (typeof cb === 'function') {
            cb();
          }
        })
        .catch((err) => {
          if (typeof cb === 'function') {
            cb(err);
          } else {
            throw err;
          }
        });
    } else {
      if (this.clearExpiredByTimeout) {
        this._clearExpiredHourAgo();
      }
      if (typeof cb === 'function') {
        cb();
      }
    }
  }

  clearExpired(expire) {
    return new Promise((resolve) => {
      this._getConnection()
        .then((conn) => {
          conn.query(`DELETE FROM ??.?? WHERE expire < ?`, [this.dbName, this.tableName, expire], () => {
            this._releaseConnection(conn);
            resolve();
          });
        })
        .catch(() => {
          resolve();
        });
    });
  }

  _clearExpiredHourAgo() {
    if (this._clearExpiredTimeoutId) {
      clearTimeout(this._clearExpiredTimeoutId);
    }
    this._clearExpiredTimeoutId = setTimeout(() => {
      this.clearExpired(Date.now() - 3600000) // Never rejected
        .then(() => {
          this._clearExpiredHourAgo();
        });
    }, 300000);
    this._clearExpiredTimeoutId.unref();
  }

  /**
   *
   * @return Promise<any>
   * @private
   */
  _getConnection() {
    switch (this.clientType) {
      case 'pool':
        return new Promise((resolve, reject) => {
          this.client.getConnection((errConn, conn) => {
            if (errConn) {
              return reject(errConn);
            }

            resolve(conn);
          });
        });
      case 'sequelize':
        return this.client.connectionManager.getConnection();
      case 'knex':
        return this.client.client.acquireConnection();
      default:
        return Promise.resolve(this.client);
    }
  }

  _releaseConnection(conn) {
    switch (this.clientType) {
      case 'pool':
        return conn.release();
      case 'sequelize':
        return this.client.connectionManager.releaseConnection(conn);
      case 'knex':
        return this.client.client.releaseConnection(conn);
      default:
        return true;
    }
  }

  /**
   *
   * @returns {Promise<any>}
   * @private
   */
  _createDbAndTable() {
    return new Promise((resolve, reject) => {
      this._getConnection()
        .then((conn) => {
          conn.query(`CREATE DATABASE IF NOT EXISTS \`${this.dbName}\`;`, (errDb) => {
            if (errDb) {
              this._releaseConnection(conn);
              return reject(errDb);
            }
            conn.query(this._getCreateTableStmt(), (err) => {
              if (err) {
                this._releaseConnection(conn);
                return reject(err);
              }
              this._releaseConnection(conn);
              resolve();
            });
          });
        })
        .catch((err) => {
          reject(err);
        });
    });
  }

  _getCreateTableStmt() {
    return `CREATE TABLE IF NOT EXISTS \`${this.dbName}\`.\`${this.tableName}\` (` +
      '`key` VARCHAR(255) CHARACTER SET utf8 NOT NULL,' +
      '`points` INT(9) NOT NULL default 0,' +
      '`expire` BIGINT UNSIGNED,' +
      'PRIMARY KEY (`key`)' +
      ') ENGINE = INNODB;';
  }

  get clientType() {
    return this._clientType;
  }

  set clientType(value) {
    if (typeof value === 'undefined') {
      if (this.client.constructor.name === 'Connection') {
        value = 'connection';
      } else if (this.client.constructor.name === 'Pool') {
        value = 'pool';
      } else if (this.client.constructor.name === 'Sequelize') {
        value = 'sequelize';
      } else {
        throw new Error('storeType is not defined');
      }
    }
    this._clientType = value.toLowerCase();
  }

  get dbName() {
    return this._dbName;
  }

  set dbName(value) {
    this._dbName = typeof value === 'undefined' ? 'rtlmtrflx' : value;
  }

  get tableName() {
    return this._tableName;
  }

  set tableName(value) {
    this._tableName = typeof value === 'undefined' ? this.keyPrefix : value;
  }

  get tableCreated() {
    return this._tableCreated
  }

  set tableCreated(value) {
    this._tableCreated = typeof value === 'undefined' ? false : !!value;
  }

  get clearExpiredByTimeout() {
    return this._clearExpiredByTimeout;
  }

  set clearExpiredByTimeout(value) {
    this._clearExpiredByTimeout = typeof value === 'undefined' ? true : Boolean(value);
  }

  _getRateLimiterRes(rlKey, changedPoints, result) {
    const res = new RateLimiterRes();
    const [row] = result;

    res.isFirstInDuration = changedPoints === row.points;
    res.consumedPoints = res.isFirstInDuration ? changedPoints : row.points;

    res.remainingPoints = Math.max(this.points - res.consumedPoints, 0);
    res.msBeforeNext = row.expire
      ? Math.max(row.expire - Date.now(), 0)
      : -1;

    return res;
  }

  _upsertTransaction(conn, key, points, msDuration, forceExpire) {
    return new Promise((resolve, reject) => {
      conn.query('BEGIN', (errBegin) => {
        if (errBegin) {
          conn.rollback();

          return reject(errBegin);
        }

        const dateNow = Date.now();
        const newExpire = msDuration > 0 ? dateNow + msDuration : null;

        let q;
        let values;
        if (forceExpire) {
          q = `INSERT INTO ??.?? VALUES (?, ?, ?)
          ON DUPLICATE KEY UPDATE 
            points = ?, 
            expire = ?;`;
          values = [
            this.dbName, this.tableName, key, points, newExpire,
            points,
            newExpire,
          ];
        } else {
          q = `INSERT INTO ??.?? VALUES (?, ?, ?)
          ON DUPLICATE KEY UPDATE 
            points = IF(expire <= ?, ?, points + (?)), 
            expire = IF(expire <= ?, ?, expire);`;
          values = [
            this.dbName, this.tableName, key, points, newExpire,
            dateNow, points, points,
            dateNow, newExpire,
          ];
        }

        conn.query(q, values, (errUpsert) => {
          if (errUpsert) {
            conn.rollback();

            return reject(errUpsert);
          }
          conn.query('SELECT points, expire FROM ??.?? WHERE `key` = ?;', [this.dbName, this.tableName, key], (errSelect, res) => {
            if (errSelect) {
              conn.rollback();

              return reject(errSelect);
            }

            conn.query('COMMIT', (err) => {
              if (err) {
                conn.rollback();

                return reject(err);
              }

              resolve(res);
            });
          });
        });
      });
    });
  }

  _upsert(key, points, msDuration, forceExpire = false) {
    if (!this.tableCreated) {
      return Promise.reject(Error('Table is not created yet'));
    }

    return new Promise((resolve, reject) => {
      this._getConnection()
        .then((conn) => {
          this._upsertTransaction(conn, key, points, msDuration, forceExpire)
            .then((res) => {
              resolve(res);
              this._releaseConnection(conn);
            })
            .catch((err) => {
              reject(err);
              this._releaseConnection(conn);
            });
        })
        .catch((err) => {
          reject(err);
        });
    });
  }

  _get(rlKey) {
    if (!this.tableCreated) {
      return Promise.reject(Error('Table is not created yet'));
    }

    return new Promise((resolve, reject) => {
      this._getConnection()
        .then((conn) => {
          conn.query(
            'SELECT points, expire FROM ??.?? WHERE `key` = ? AND (`expire` > ? OR `expire` IS NULL)',
            [this.dbName, this.tableName, rlKey, Date.now()],
            (err, res) => {
              if (err) {
                reject(err);
              } else if (res.length === 0) {
                resolve(null);
              } else {
                resolve(res);
              }

              this._releaseConnection(conn);
            } // eslint-disable-line
          );
        })
        .catch((err) => {
          reject(err);
        });
    });
  }

  _delete(rlKey) {
    if (!this.tableCreated) {
      return Promise.reject(Error('Table is not created yet'));
    }

    return new Promise((resolve, reject) => {
      this._getConnection()
        .then((conn) => {
          conn.query(
            'DELETE FROM ??.?? WHERE `key` = ?',
            [this.dbName, this.tableName, rlKey],
            (err, res) => {
              if (err) {
                reject(err);
              } else {
                resolve(res.affectedRows > 0);
              }

              this._releaseConnection(conn);
            } // eslint-disable-line
          );
        })
        .catch((err) => {
          reject(err);
        });
    });
  }
}

module.exports = RateLimiterMySQL;


/***/ }),

/***/ 414:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const RateLimiterStoreAbstract = __nccwpck_require__(5664);
const RateLimiterRes = __nccwpck_require__(9975);

class RateLimiterPostgres extends RateLimiterStoreAbstract {
  /**
   * @callback callback
   * @param {Object} err
   *
   * @param {Object} opts
   * @param {callback} cb
   * Defaults {
   *   ... see other in RateLimiterStoreAbstract
   *
   *   storeClient: postgresClient,
   *   storeType: 'knex', // required only for Knex instance
   *   tableName: 'string',
   *   schemaName: 'string', // optional
   * }
   */
  constructor(opts, cb = null) {
    super(opts);

    this.client = opts.storeClient;
    this.clientType = opts.storeType;

    this.tableName = opts.tableName;
    this.schemaName = opts.schemaName;

    this.clearExpiredByTimeout = opts.clearExpiredByTimeout;

    this.tableCreated = opts.tableCreated;
    if (!this.tableCreated) {
      this._createTable()
        .then(() => {
          this.tableCreated = true;
          if (this.clearExpiredByTimeout) {
            this._clearExpiredHourAgo();
          }
          if (typeof cb === 'function') {
            cb();
          }
        })
        .catch((err) => {
          if (typeof cb === 'function') {
            cb(err);
          } else {
            throw err;
          }
        });
    } else {
      if (this.clearExpiredByTimeout) {
        this._clearExpiredHourAgo();
      }
      if (typeof cb === 'function') {
        cb();
      }
    }
  }

  _getTableIdentifier() {
    return this.schemaName ? `"${this.schemaName}"."${this.tableName}"` : `"${this.tableName}"`;
  }

  clearExpired(expire) {
    return new Promise((resolve) => {
      const q = {
        name: 'rlflx-clear-expired',
        text: `DELETE FROM ${this._getTableIdentifier()} WHERE expire < $1`,
        values: [expire],
      };
      this._query(q)
        .then(() => {
          resolve();
        })
        .catch(() => {
          // Deleting expired query is not critical
          resolve();
        });
    });
  }

  /**
   * Delete all rows expired 1 hour ago once per 5 minutes
   *
   * @private
   */
  _clearExpiredHourAgo() {
    if (this._clearExpiredTimeoutId) {
      clearTimeout(this._clearExpiredTimeoutId);
    }
    this._clearExpiredTimeoutId = setTimeout(() => {
      this.clearExpired(Date.now() - 3600000) // Never rejected
        .then(() => {
          this._clearExpiredHourAgo();
        });
    }, 300000);
    this._clearExpiredTimeoutId.unref();
  }

  /**
   *
   * @return Promise<any>
   * @private
   */
  _getConnection() {
    switch (this.clientType) {
      case 'pool':
        return Promise.resolve(this.client);
      case 'sequelize':
        return this.client.connectionManager.getConnection();
      case 'knex':
        return this.client.client.acquireConnection();
      case 'typeorm':
        return Promise.resolve(this.client.driver.master);
      default:
        return Promise.resolve(this.client);
    }
  }

  _releaseConnection(conn) {
    switch (this.clientType) {
      case 'pool':
        return true;
      case 'sequelize':
        return this.client.connectionManager.releaseConnection(conn);
      case 'knex':
        return this.client.client.releaseConnection(conn);
      case 'typeorm':
        return true;
      default:
        return true;
    }
  }

  /**
   *
   * @returns {Promise<any>}
   * @private
   */
  _createTable() {
    return new Promise((resolve, reject) => {
      this._query({
        text: this._getCreateTableStmt(),
      })
        .then(() => {
          resolve();
        })
        .catch((err) => {
          if (err.code === '23505') {
            // Error: duplicate key value violates unique constraint "pg_type_typname_nsp_index"
            // Postgres doesn't handle concurrent table creation
            // It is supposed, that table is created by another worker
            resolve();
          } else {
            reject(err);
          }
        });
    });
  }

  _getCreateTableStmt() {
    return `CREATE TABLE IF NOT EXISTS ${this._getTableIdentifier()} (
      key varchar(255) PRIMARY KEY,
      points integer NOT NULL DEFAULT 0,
      expire bigint
    );`;
  }

  get clientType() {
    return this._clientType;
  }

  set clientType(value) {
    const constructorName = this.client.constructor.name;

    if (typeof value === 'undefined') {
      if (constructorName === 'Client') {
        value = 'client';
      } else if (
        constructorName === 'Pool' ||
        constructorName === 'BoundPool'
      ) {
        value = 'pool';
      } else if (constructorName === 'Sequelize') {
        value = 'sequelize';
      } else {
        throw new Error('storeType is not defined');
      }
    }

    this._clientType = value.toLowerCase();
  }

  get tableName() {
    return this._tableName;
  }

  set tableName(value) {
    this._tableName = typeof value === 'undefined' ? this.keyPrefix : value;
  }

  get schemaName() {
    return this._schemaName;
  }

  set schemaName(value) {
    this._schemaName = value;
  }

  get tableCreated() {
    return this._tableCreated;
  }

  set tableCreated(value) {
    this._tableCreated = typeof value === 'undefined' ? false : !!value;
  }

  get clearExpiredByTimeout() {
    return this._clearExpiredByTimeout;
  }

  set clearExpiredByTimeout(value) {
    this._clearExpiredByTimeout = typeof value === 'undefined' ? true : Boolean(value);
  }

  _getRateLimiterRes(rlKey, changedPoints, result) {
    const res = new RateLimiterRes();
    const row = result.rows[0];

    res.isFirstInDuration = changedPoints === row.points;
    res.consumedPoints = res.isFirstInDuration ? changedPoints : row.points;

    res.remainingPoints = Math.max(this.points - res.consumedPoints, 0);
    res.msBeforeNext = row.expire
      ? Math.max(row.expire - Date.now(), 0)
      : -1;

    return res;
  }

  _query(q) {
    const prefix = this.tableName.toLowerCase();
    const queryObj = { name: `${prefix}:${q.name}`, text: q.text, values: q.values };
    return new Promise((resolve, reject) => {
      this._getConnection()
        .then((conn) => {
          conn.query(queryObj)
            .then((res) => {
              resolve(res);
              this._releaseConnection(conn);
            })
            .catch((err) => {
              reject(err);
              this._releaseConnection(conn);
            });
        })
        .catch((err) => {
          reject(err);
        });
    });
  }

  _upsert(key, points, msDuration, forceExpire = false) {
    if (!this.tableCreated) {
      return Promise.reject(Error('Table is not created yet'));
    }

    const newExpire = msDuration > 0 ? Date.now() + msDuration : null;
    const expireQ = forceExpire
      ? ' $3 '
      : ` CASE
             WHEN ${this._getTableIdentifier()}.expire <= $4 THEN $3
             ELSE ${this._getTableIdentifier()}.expire
            END `;

    return this._query({
      name: forceExpire ? 'rlflx-upsert-force' : 'rlflx-upsert',
      text: `
            INSERT INTO ${this._getTableIdentifier()} VALUES ($1, $2, $3)
              ON CONFLICT(key) DO UPDATE SET
                points = CASE
                          WHEN (${this._getTableIdentifier()}.expire <= $4 OR 1=${forceExpire ? 1 : 0}) THEN $2
                          ELSE ${this._getTableIdentifier()}.points + ($2)
                         END,
                expire = ${expireQ}
            RETURNING points, expire;`,
      values: [key, points, newExpire, Date.now()],
    });
  }

  _get(rlKey) {
    if (!this.tableCreated) {
      return Promise.reject(Error('Table is not created yet'));
    }

    return new Promise((resolve, reject) => {
      this._query({
        name: 'rlflx-get',
        text: `
            SELECT points, expire FROM ${this._getTableIdentifier()} WHERE key = $1 AND (expire > $2 OR expire IS NULL);`,
        values: [rlKey, Date.now()],
      })
        .then((res) => {
          if (res.rowCount === 0) {
            res = null;
          }
          resolve(res);
        })
        .catch((err) => {
          reject(err);
        });
    });
  }

  _delete(rlKey) {
    if (!this.tableCreated) {
      return Promise.reject(Error('Table is not created yet'));
    }

    return this._query({
      name: 'rlflx-delete',
      text: `DELETE FROM ${this._getTableIdentifier()} WHERE key = $1`,
      values: [rlKey],
    })
      .then(res => res.rowCount > 0);
  }
}

module.exports = RateLimiterPostgres;


/***/ }),

/***/ 6930:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const RateLimiterStoreAbstract = __nccwpck_require__(5664);
const RateLimiterRes = __nccwpck_require__(9975);

class RateLimiterPrisma extends RateLimiterStoreAbstract {
  /**
   * Constructor for the rate limiter
   * @param {Object} opts - Options for the rate limiter
   */
  constructor(opts) {
    super(opts);

    this.modelName = opts.tableName || 'RateLimiterFlexible';
    this.prismaClient = opts.storeClient;
    this.clearExpiredByTimeout = opts.clearExpiredByTimeout || true;

    if (!this.prismaClient) {
      throw new Error('Prisma client is not provided');
    }

    if (this.clearExpiredByTimeout) {
      this._clearExpiredHourAgo();
    }
  }

  _getRateLimiterRes(rlKey, changedPoints, result) {
    const res = new RateLimiterRes();

    let doc = result;

    res.isFirstInDuration = doc.points === changedPoints;
    res.consumedPoints = doc.points;

    res.remainingPoints = Math.max(this.points - res.consumedPoints, 0);
    res.msBeforeNext = doc.expire !== null
      ? Math.max(new Date(doc.expire).getTime() - Date.now(), 0)
      : -1;

    return res;
  }

  _upsert(key, points, msDuration, forceExpire = false) {
    if (!this.prismaClient) {
      return Promise.reject(new Error('Prisma client is not established'));
    }

    const now = new Date();
    const newExpire = msDuration > 0 ? new Date(now.getTime() + msDuration) : null;

    return this.prismaClient.$transaction(async (prisma) => {
      const existingRecord = await prisma[this.modelName].findFirst({
        where: { key: key },
      });

      if (existingRecord) {
        // Determine if we should update the expire field
        const shouldUpdateExpire = forceExpire || !existingRecord.expire || existingRecord.expire <= now || newExpire === null;

        return prisma[this.modelName].update({
          where: { key: key },
          data: {
            points: !shouldUpdateExpire ? existingRecord.points + points : points,
            ...(shouldUpdateExpire && { expire: newExpire }),
          },
        });
      } else {
        return prisma[this.modelName].create({
          data: {
            key: key,
            points: points,
            expire: newExpire,
          },
        });
      }
    });
  }

  _get(rlKey) {
    if (!this.prismaClient) {
      return Promise.reject(new Error('Prisma client is not established'));
    }

    return this.prismaClient[this.modelName].findFirst({
      where: {
        AND: [
          { key: rlKey },
          {
            OR: [
              { expire: { gt: new Date() } },
              { expire: null },
            ],
          },
        ],
      },
    });
  }

  _delete(rlKey) {
    if (!this.prismaClient) {
      return Promise.reject(new Error('Prisma client is not established'));
    }

    return this.prismaClient[this.modelName].deleteMany({
      where: {
        key: rlKey,
      },
    }).then(res => res.count > 0);
  }

  _clearExpiredHourAgo() {
    if (this._clearExpiredTimeoutId) {
      clearTimeout(this._clearExpiredTimeoutId);
    }
    this._clearExpiredTimeoutId = setTimeout(async () => {
      await this.prismaClient[this.modelName].deleteMany({
        where: {
          expire: {
            lt: new Date(Date.now() - 3600000),
          },
        },
      });
      this._clearExpiredHourAgo();
    }, 300000); // Clear every 5 minutes
    this._clearExpiredTimeoutId.unref();
  }
}

module.exports = RateLimiterPrisma;


/***/ }),

/***/ 2967:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const RateLimiterQueueError = __nccwpck_require__(9636)
const MAX_QUEUE_SIZE = 4294967295;
const KEY_DEFAULT = 'limiter';

module.exports = class RateLimiterQueue {
  constructor(limiterFlexible, opts = {
    maxQueueSize: MAX_QUEUE_SIZE,
  }) {
    this._queueLimiters = {
      KEY_DEFAULT: new RateLimiterQueueInternal(limiterFlexible, opts)
    };
    this._limiterFlexible = limiterFlexible;
    this._maxQueueSize = opts.maxQueueSize
  }

  getTokensRemaining(key = KEY_DEFAULT) {
    if (this._queueLimiters[key]) {
      return this._queueLimiters[key].getTokensRemaining()
    } else {
      return Promise.resolve(this._limiterFlexible.points)
    }
  }

  removeTokens(tokens, key = KEY_DEFAULT) {
    if (!this._queueLimiters[key]) {
      this._queueLimiters[key] = new RateLimiterQueueInternal(
        this._limiterFlexible, {
          key,
          maxQueueSize: this._maxQueueSize,
        })
    }

    return this._queueLimiters[key].removeTokens(tokens)
  }
};

class RateLimiterQueueInternal {

  constructor(limiterFlexible, opts = {
    maxQueueSize: MAX_QUEUE_SIZE,
    key: KEY_DEFAULT,
  }) {
    this._key = opts.key;
    this._waitTimeout = null;
    this._queue = [];
    this._limiterFlexible = limiterFlexible;

    this._maxQueueSize = opts.maxQueueSize
  }

  getTokensRemaining() {
    return this._limiterFlexible.get(this._key)
      .then((rlRes) => {
        return rlRes !== null ? rlRes.remainingPoints : this._limiterFlexible.points;
      })
  }

  removeTokens(tokens) {
    const _this = this;

    return new Promise((resolve, reject) => {
      if (tokens > _this._limiterFlexible.points) {
        reject(new RateLimiterQueueError(`Requested tokens ${tokens} exceeds maximum ${_this._limiterFlexible.points} tokens per interval`));
        return
      }

      if (_this._queue.length > 0) {
        _this._queueRequest.call(_this, resolve, reject, tokens);
      } else {
        _this._limiterFlexible.consume(_this._key, tokens)
          .then((res) => {
            resolve(res.remainingPoints);
          })
          .catch((rej) => {
            if (rej instanceof Error) {
              reject(rej);
            } else {
              _this._queueRequest.call(_this, resolve, reject, tokens);
              if (_this._waitTimeout === null) {
                _this._waitTimeout = setTimeout(_this._processFIFO.bind(_this), rej.msBeforeNext);
              }
            }
          });
      }
    })
  }

  _queueRequest(resolve, reject, tokens) {
    const _this = this;
    if (_this._queue.length < _this._maxQueueSize) {
      _this._queue.push({resolve, reject, tokens});
    } else {
      reject(new RateLimiterQueueError(`Number of requests reached it's maximum ${_this._maxQueueSize}`))
    }
  }

  _processFIFO() {
    const _this = this;

    if (_this._waitTimeout !== null) {
      clearTimeout(_this._waitTimeout);
      _this._waitTimeout = null;
    }

    if (_this._queue.length === 0) {
      return;
    }

    const item = _this._queue.shift();
    _this._limiterFlexible.consume(_this._key, item.tokens)
      .then((res) => {
        item.resolve(res.remainingPoints);
        _this._processFIFO.call(_this);
      })
      .catch((rej) => {
        if (rej instanceof Error) {
          item.reject(rej);
          _this._processFIFO.call(_this);
        } else {
          _this._queue.unshift(item);
          if (_this._waitTimeout === null) {
            _this._waitTimeout = setTimeout(_this._processFIFO.bind(_this), rej.msBeforeNext);
          }
        }
      });
  }
}


/***/ }),

/***/ 6770:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const RateLimiterStoreAbstract = __nccwpck_require__(5664);
const RateLimiterRes = __nccwpck_require__(9975);

const incrTtlLuaScript = `redis.call('set', KEYS[1], 0, 'EX', ARGV[2], 'NX') \
local consumed = redis.call('incrby', KEYS[1], ARGV[1]) \
local ttl = redis.call('pttl', KEYS[1]) \
if ttl == -1 then \
  redis.call('expire', KEYS[1], ARGV[2]) \
  ttl = 1000 * ARGV[2] \
end \
return {consumed, ttl} \
`;

class RateLimiterRedis extends RateLimiterStoreAbstract {
  /**
   *
   * @param {Object} opts
   * Defaults {
   *   ... see other in RateLimiterStoreAbstract
   *
   *   redis: RedisClient
   *   rejectIfRedisNotReady: boolean = false - reject / invoke insuranceLimiter immediately when redis connection is not "ready"
   * }
   */
  constructor(opts) {
    super(opts);
    this.client = opts.storeClient;

    this._rejectIfRedisNotReady = !!opts.rejectIfRedisNotReady;
    this._incrTtlLuaScript = opts.customIncrTtlLuaScript || incrTtlLuaScript;

    this.useRedisPackage = opts.useRedisPackage || this.client.constructor.name === 'Commander' || false;
    this.useRedis3AndLowerPackage = opts.useRedis3AndLowerPackage;
    if (typeof this.client.defineCommand === 'function') {
      this.client.defineCommand("rlflxIncr", {
        numberOfKeys: 1,
        lua: this._incrTtlLuaScript,
      });
    }
  }

  /**
   * Prevent actual redis call if redis connection is not ready
   * Because of different connection state checks for ioredis and node-redis, only this clients would be actually checked.
   * For any other clients all the requests would be passed directly to redis client
   * @param {String} rlKey
   * @param {Boolean} isReadonly
   * @return {boolean}
   * @private
   */
  _isRedisReady(rlKey, isReadonly) {
    if (!this._rejectIfRedisNotReady) {
      return true;
    }
    // ioredis client
    if (this.client.status) {
      return this.client.status === 'ready';
    }
    // node-redis v3 client
    if (typeof this.client.isReady === 'function') {
      return this.client.isReady();
    }

    // node-redis v4+ (non-cluster) client
    if (typeof this.client.isReady === 'boolean') {
      return this.client.isReady === true;
    }

    // node-redis v4+ cluster client
    if (this.client._slots && typeof this.client._slots.getClient === 'function') {
      if (typeof this.client.isOpen === 'boolean' && this.client.isOpen !== true) {
        return false;
      }

      try {
        const slotClient = this.client._slots.getClient(rlKey, isReadonly);
        return slotClient && slotClient.isReady === true;
      } catch (error) {
        return false;
      }
    }
    return true;
  }

  _getRateLimiterRes(rlKey, changedPoints, result) {
    let [consumed, resTtlMs] = result;
    // Support ioredis results format
    if (Array.isArray(consumed)) {
      [, consumed] = consumed;
      [, resTtlMs] = resTtlMs;
    }

    const res = new RateLimiterRes();
    res.consumedPoints = parseInt(consumed);
    res.isFirstInDuration = res.consumedPoints === changedPoints;
    res.remainingPoints = Math.max(this.points - res.consumedPoints, 0);
    res.msBeforeNext = resTtlMs;

    return res;
  }

  async _upsert(rlKey, points, msDuration, forceExpire = false) {
    if(
      typeof points == 'string'
    ){
      if(!RegExp("^[1-9][0-9]*$").test(points)){
        throw new Error("Consuming string different than integer values is not supported by this package");
      }
    } else if (!Number.isInteger(points)){
      throw new Error("Consuming decimal number of points is not supported by this package");
    }

    if (!this._isRedisReady(rlKey, false)) {
      throw new Error('Redis connection is not ready');
    }

    const secDuration = Math.floor(msDuration / 1000);
    const multi = this.client.multi();

    if (forceExpire) {
      if (secDuration > 0) {
        if(!this.useRedisPackage && !this.useRedis3AndLowerPackage){
          multi.set(rlKey, points, "EX", secDuration);
        }else{
          multi.set(rlKey, points, { EX: secDuration });
        }
      } else {
        multi.set(rlKey, points);
      }

      if(!this.useRedisPackage && !this.useRedis3AndLowerPackage){
        return multi.pttl(rlKey).exec(true);
      }
      return multi.pTTL(rlKey).exec(true);
    }

    if (secDuration > 0) {
      if(!this.useRedisPackage && !this.useRedis3AndLowerPackage){
        return this.client.rlflxIncr(
          [rlKey].concat([String(points), String(secDuration), String(this.points), String(this.duration)]));
      }
      if (this.useRedis3AndLowerPackage) {
        return new Promise((resolve, reject) => {
          const incrCallback = function (err, result) {
            if (err) {
              return reject(err);
            }

            return resolve(result);
          };

          if (typeof this.client.rlflxIncr === 'function') {
            this.client.rlflxIncr(rlKey, points, secDuration, this.points, this.duration, incrCallback);
          } else {
            this.client.eval(this._incrTtlLuaScript, 1, rlKey, points, secDuration, this.points, this.duration, incrCallback);
          }
        });
      } else {
        return this.client.eval(this._incrTtlLuaScript, {
          keys: [rlKey],
          arguments: [String(points), String(secDuration), String(this.points), String(this.duration)],
        });
      }
    } else {
      if(!this.useRedisPackage && !this.useRedis3AndLowerPackage){
        return multi.incrby(rlKey, points).pttl(rlKey).exec(true);
      }

      return multi.incrBy(rlKey, points).pTTL(rlKey).exec(true);
    }
  }

  async _get(rlKey) {
    if (!this._isRedisReady(rlKey, true)) {
      throw new Error('Redis connection is not ready');
    }
    if(!this.useRedisPackage && !this.useRedis3AndLowerPackage){
      return this.client
        .multi()
        .get(rlKey)
        .pttl(rlKey)
        .exec()
        .then((result) => {
          const [[,points]] = result;
          if (points === null) return null;
          return result;
        });
    }

    return this.client
      .multi()
      .get(rlKey)
      .pTTL(rlKey)
      .exec(true)
      .then((result) => {
        const [points] = result;
        if (points === null) return null;
        return result;
      });
  }

  _delete(rlKey) {
    return this.client
      .del(rlKey)
      .then(result => result > 0);
  }
}

module.exports = RateLimiterRedis;


/***/ }),

/***/ 9975:
/***/ ((module) => {

module.exports = class RateLimiterRes {
  constructor(remainingPoints, msBeforeNext, consumedPoints, isFirstInDuration) {
    this.remainingPoints = typeof remainingPoints === 'undefined' ? 0 : remainingPoints; // Remaining points in current duration
    this.msBeforeNext = typeof msBeforeNext === 'undefined' ? 0 : msBeforeNext; // Milliseconds before next action
    this.consumedPoints = typeof consumedPoints === 'undefined' ? 0 : consumedPoints; // Consumed points in current duration
    this.isFirstInDuration = typeof isFirstInDuration === 'undefined' ? false : isFirstInDuration;
  }

  get msBeforeNext() {
    return this._msBeforeNext;
  }

  set msBeforeNext(ms) {
    this._msBeforeNext = ms;
    return this;
  }

  get remainingPoints() {
    return this._remainingPoints;
  }

  set remainingPoints(p) {
    this._remainingPoints = p;
    return this;
  }

  get consumedPoints() {
    return this._consumedPoints;
  }

  set consumedPoints(p) {
    this._consumedPoints = p;
    return this;
  }

  get isFirstInDuration() {
    return this._isFirstInDuration;
  }

  set isFirstInDuration(value) {
    this._isFirstInDuration = Boolean(value);
  }

  _getDecoratedProperties() {
    return {
      remainingPoints: this.remainingPoints,
      msBeforeNext: this.msBeforeNext,
      consumedPoints: this.consumedPoints,
      isFirstInDuration: this.isFirstInDuration,
    };
  }

  [Symbol.for("nodejs.util.inspect.custom")]() {
    return this._getDecoratedProperties();
  }

  toString() {
    return JSON.stringify(this._getDecoratedProperties());
  }

  toJSON() {
    return this._getDecoratedProperties();
  }
};


/***/ }),

/***/ 8901:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const RateLimiterStoreAbstract = __nccwpck_require__(5664);
const RateLimiterRes = __nccwpck_require__(9975);

class RateLimiterSQLite extends RateLimiterStoreAbstract {
  /**
   * Internal store type used to determine the SQLite client in use.
   * It can be one of the following:
   * - `"sqlite3".
   * - `"better-sqlite3".
   *
   * @type {("sqlite3" | "better-sqlite3" | null)}
   * @private
   */
  _internalStoreType = null;

  /**
   * @callback callback
   * @param {Object} err
   *
   * @param {Object} opts
   * @param {callback} cb
   * Defaults {
   *   ... see other in RateLimiterStoreAbstract
   *   storeClient: sqliteClient, // SQLite database instance (sqlite3, better-sqlite3, or knex instance)
   *   storeType: 'sqlite3' | 'better-sqlite3' | 'knex', // Optional, defaults to 'sqlite3'
   *   tableName: 'string',
   *   tableCreated: boolean,
   *   clearExpiredByTimeout: boolean,
   * }
   */
  constructor(opts, cb = null) {
    super(opts);

    this.client = opts.storeClient;
    this.storeType = opts.storeType || "sqlite3";
    this.tableName = opts.tableName;
    this.tableCreated = opts.tableCreated || false;
    this.clearExpiredByTimeout = opts.clearExpiredByTimeout;

    this._validateStoreTypes(cb);
    this._validateStoreClient(cb);
    this._setInternalStoreType(cb);
    this._validateTableName(cb);

    if (!this.tableCreated) {
      this._createDbAndTable()
        .then(() => {
          this.tableCreated = true;
          if (this.clearExpiredByTimeout) this._clearExpiredHourAgo();
          if (typeof cb === "function") cb();
        })
        .catch((err) => {
          if (typeof cb === "function") cb(err);
          else throw err;
        });
    } else {
      if (this.clearExpiredByTimeout) this._clearExpiredHourAgo();
      if (typeof cb === "function") cb();
    }
  }
  _validateStoreTypes(cb) {
    const validStoreTypes = ["sqlite3", "better-sqlite3", "knex"];
    if (!validStoreTypes.includes(this.storeType)) {
      const err = new Error(
        `storeType must be one of: ${validStoreTypes.join(", ")}`
      );
      if (typeof cb === "function") return cb(err);
      throw err;
    }
  }
  _validateStoreClient(cb) {
    if (this.storeType === "sqlite3") {
      if (typeof this.client.run !== "function") {
        const err = new Error(
          "storeClient must be an instance of sqlite3.Database when storeType is 'sqlite3' or no storeType was provided"
        );
        if (typeof cb === "function") return cb(err);
        throw err;
      }
    } else if (this.storeType === "better-sqlite3") {
      if (
        typeof this.client.prepare !== "function" ||
        typeof this.client.run !== "undefined"
      ) {
        const err = new Error(
          "storeClient must be an instance of better-sqlite3.Database when storeType is 'better-sqlite3'"
        );
        if (typeof cb === "function") return cb(err);
        throw err;
      }
    } else if (this.storeType === "knex") {
      if (typeof this.client.raw !== "function") {
        const err = new Error(
          "storeClient must be an instance of Knex when storeType is 'knex'"
        );
        if (typeof cb === "function") return cb(err);
        throw err;
      }
    }
  }
  _setInternalStoreType(cb) {
    if (this.storeType === "knex") {
      const knexClientType = this.client.client.config.client;
      if (knexClientType === "sqlite3") {
        this._internalStoreType = "sqlite3";
      } else if (knexClientType === "better-sqlite3") {
        this._internalStoreType = "better-sqlite3";
      } else {
        const err = new Error(
          "Knex must be configured with 'sqlite3' or 'better-sqlite3' for RateLimiterSQLite"
        );
        if (typeof cb === "function") return cb(err);
        throw err;
      }
    } else {
      this._internalStoreType = this.storeType;
    }
  }
  _validateTableName(cb) {
    if (!/^[A-Za-z0-9_]*$/.test(this.tableName)) {
      const err = new Error("Table name must contain only letters and numbers");
      if (typeof cb === "function") return cb(err);
      throw err;
    }
  }

  /**
   * Acquires the database connection based on the storeType.
   * @returns {Promise<Object>} The database client or connection
   */
  async _getConnection() {
    if (this.storeType === "knex") {
      return this.client.client.acquireConnection(); // Acquire raw connection from knex pool
    }
    return this.client; // For sqlite3 and better-sqlite3, return the client directly
  }

  /**
   * Releases the database connection if necessary.
   * @param {Object} conn The database client or connection
   */
  _releaseConnection(conn) {
    if (this.storeType === "knex") {
      this.client.client.releaseConnection(conn);
    }
    // No release needed for direct sqlite3 or better-sqlite3 clients
  }

  async _createDbAndTable() {
    const conn = await this._getConnection();
    try {
      switch (this._internalStoreType) {
        case "sqlite3":
          await new Promise((resolve, reject) => {
            conn.run(this._getCreateTableSQL(), (err) =>
              err ? reject(err) : resolve()
            );
          });
          break;
        case "better-sqlite3":
          conn.prepare(this._getCreateTableSQL()).run();
          break;
        default:
          throw new Error("Unsupported internalStoreType");
      }
    } finally {
      this._releaseConnection(conn);
    }
  }

  _getCreateTableSQL() {
    return `CREATE TABLE IF NOT EXISTS ${this.tableName} (
      key TEXT PRIMARY KEY,
      points INTEGER NOT NULL DEFAULT 0,
      expire INTEGER
    )`;
  }

  _clearExpiredHourAgo() {
    if (this._clearExpiredTimeoutId) clearTimeout(this._clearExpiredTimeoutId);
    this._clearExpiredTimeoutId = setTimeout(() => {
      this.clearExpired(Date.now() - 3600000) // 1 hour ago
        .then(() => this._clearExpiredHourAgo());
    }, 300000); // Every 5 minutes
    this._clearExpiredTimeoutId.unref();
  }

  async clearExpired(nowMs) {
    const sql = `DELETE FROM ${this.tableName} WHERE expire < ?`;
    const conn = await this._getConnection();
    try {
      switch (this._internalStoreType) {
        case "sqlite3":
          await new Promise((resolve, reject) => {
            conn.run(sql, [nowMs], (err) => (err ? reject(err) : resolve()));
          });
          break;
        case "better-sqlite3":
          conn.prepare(sql).run(nowMs);
          break;
        default:
          throw new Error("Unsupported internalStoreType");
      }
    } finally {
      this._releaseConnection(conn);
    }
  }

  _getRateLimiterRes(rlKey, changedPoints, result) {
    const res = new RateLimiterRes();
    res.isFirstInDuration = changedPoints === result.points;
    res.consumedPoints = res.isFirstInDuration ? changedPoints : result.points;
    res.remainingPoints = Math.max(this.points - res.consumedPoints, 0);
    res.msBeforeNext = result.expire
      ? Math.max(result.expire - Date.now(), 0)
      : -1;
    return res;
  }

  async _upsertTransactionSQLite3(conn, upsertQuery, upsertParams) {
    return await new Promise((resolve, reject) => {
      conn.serialize(() => {
        conn.run("SAVEPOINT rate_limiter_trx;", (err) => {
          if (err) return reject(err);
          conn.get(upsertQuery, upsertParams, (err, row) => {
            if (err) {
              conn.run("ROLLBACK TO SAVEPOINT rate_limiter_trx;", () =>
                reject(err)
              );
              return;
            }
            conn.run("RELEASE SAVEPOINT rate_limiter_trx;", () => resolve(row));
          });
        });
      });
    });
  }

  async _upsertTransactionBetterSQLite3(conn, upsertQuery, upsertParams) {
    return conn.transaction(() =>
      conn.prepare(upsertQuery).get(...upsertParams)
    )();
  }
  async _upsertTransaction(rlKey, points, msDuration, forceExpire) {
    const dateNow = Date.now();
    const newExpire = msDuration > 0 ? dateNow + msDuration : null;
    const upsertQuery = forceExpire
      ? `INSERT OR REPLACE INTO ${this.tableName} (key, points, expire) VALUES (?, ?, ?) RETURNING points, expire`
      : `INSERT INTO ${this.tableName} (key, points, expire)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           points = CASE WHEN expire IS NULL OR expire > ? THEN points + excluded.points ELSE excluded.points END,
           expire = CASE WHEN expire IS NULL OR expire > ? THEN expire ELSE excluded.expire END
         RETURNING points, expire`;
    const upsertParams = forceExpire
      ? [rlKey, points, newExpire]
      : [rlKey, points, newExpire, dateNow, dateNow];

    const conn = await this._getConnection();
    try {
      switch (this._internalStoreType) {
        case "sqlite3":
          return this._upsertTransactionSQLite3(
            conn,
            upsertQuery,
            upsertParams
          );
        case "better-sqlite3":
          return this._upsertTransactionBetterSQLite3(
            conn,
            upsertQuery,
            upsertParams
          );
        default:
          throw new Error("Unsupported internalStoreType");
      }
    } finally {
      this._releaseConnection(conn);
    }
  }

  _upsert(rlKey, points, msDuration, forceExpire = false) {
    if (!this.tableCreated) {
      return Promise.reject(new Error("Table is not created yet"));
    }
    return this._upsertTransaction(rlKey, points, msDuration, forceExpire);
  }

  async _get(rlKey) {
    const sql = `SELECT points, expire FROM ${this.tableName} WHERE key = ? AND (expire > ? OR expire IS NULL)`;
    const now = Date.now();
    const conn = await this._getConnection();
    try {
      switch (this._internalStoreType) {
        case "sqlite3":
          return await new Promise((resolve, reject) => {
            conn.get(sql, [rlKey, now], (err, row) =>
              err ? reject(err) : resolve(row || null)
            );
          });
        case "better-sqlite3":
          return conn.prepare(sql).get(rlKey, now) || null;
        default:
          throw new Error("Unsupported internalStoreType");
      }
    } finally {
      this._releaseConnection(conn);
    }
  }

  async _delete(rlKey) {
    if (!this.tableCreated) {
      return Promise.reject(new Error("Table is not created yet"));
    }
    const sql = `DELETE FROM ${this.tableName} WHERE key = ?`;
    const conn = await this._getConnection();
    try {
      switch (this._internalStoreType) {
        case "sqlite3":
          return await new Promise((resolve, reject) => {
            conn.run(sql, [rlKey], function (err) {
              if (err) reject(err);
              else resolve(this.changes > 0);
            });
          });
        case "better-sqlite3":
          const result = conn.prepare(sql).run(rlKey);
          return result.changes > 0;
        default:
          throw new Error("Unsupported internalStoreType");
      }
    } finally {
      this._releaseConnection(conn);
    }
  }
}

module.exports = RateLimiterSQLite;


/***/ }),

/***/ 5664:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const RateLimiterAbstract = __nccwpck_require__(363);
const BlockedKeys = __nccwpck_require__(7905);
const RateLimiterRes = __nccwpck_require__(9975);
const RateLimiterInsuredAbstract = __nccwpck_require__(2813);

module.exports = class RateLimiterStoreAbstract extends RateLimiterInsuredAbstract {
  /**
   *
   * @param opts Object Defaults {
   *   ... see other in RateLimiterAbstract
   *
   *   inMemoryBlockOnConsumed: 40, // Number of points when key is blocked
   *   inMemoryBlockDuration: 10, // Block duration in seconds
   *   insuranceLimiter: RateLimiterAbstract
   * }
   */
  constructor(opts = {}) {
    super(opts);

    this.inMemoryBlockOnConsumed = opts.inMemoryBlockOnConsumed;
    this.inMemoryBlockDuration = opts.inMemoryBlockDuration;
    this._inMemoryBlockedKeys = new BlockedKeys();
  }

  get client() {
    return this._client;
  }

  set client(value) {
    if (typeof value === 'undefined') {
      throw new Error('storeClient is not set');
    }
    this._client = value;
  }

  /**
   * Have to be launched after consume
   * It blocks key and execute evenly depending on result from store
   *
   * It uses _getRateLimiterRes function to prepare RateLimiterRes from store result
   *
   * @param resolve
   * @param reject
   * @param rlKey
   * @param changedPoints
   * @param storeResult
   * @param {Object} options
   * @private
   */
  _afterConsume(resolve, reject, rlKey, changedPoints, storeResult, options = {}) {
    const res = this._getRateLimiterRes(rlKey, changedPoints, storeResult);

    if (this.inMemoryBlockOnConsumed > 0 && !(this.inMemoryBlockDuration > 0)
      && res.consumedPoints >= this.inMemoryBlockOnConsumed
    ) {
      this._inMemoryBlockedKeys.addMs(rlKey, res.msBeforeNext);
      if (res.consumedPoints > this.points) {
        return reject(res);
      } else {
        return resolve(res)
      }
    } else if (res.consumedPoints > this.points) {
      let blockPromise = Promise.resolve();
      // Block only first time when consumed more than points
      if (this.blockDuration > 0 && res.consumedPoints <= (this.points + changedPoints)) {
        res.msBeforeNext = this.msBlockDuration;
        blockPromise = this._block(rlKey, res.consumedPoints, this.msBlockDuration, options);
      }

      if (this.inMemoryBlockOnConsumed > 0 && res.consumedPoints >= this.inMemoryBlockOnConsumed) {
        // Block key for this.inMemoryBlockDuration seconds
        this._inMemoryBlockedKeys.add(rlKey, this.inMemoryBlockDuration);
        res.msBeforeNext = this.msInMemoryBlockDuration;
      }

      blockPromise
        .then(() => {
          reject(res);
        })
        .catch((err) => {
          reject(err);
        });
    } else if (this.execEvenly && res.msBeforeNext > 0 && !res.isFirstInDuration) {
      let delay = Math.ceil(res.msBeforeNext / (res.remainingPoints + 2));
      if (delay < this.execEvenlyMinDelayMs) {
        delay = res.consumedPoints * this.execEvenlyMinDelayMs;
      }

      setTimeout(resolve, delay, res);
    } else {
      resolve(res);
    }
  }

  getInMemoryBlockMsBeforeExpire(rlKey) {
    if (this.inMemoryBlockOnConsumed > 0) {
      return this._inMemoryBlockedKeys.msBeforeExpire(rlKey);
    }

    return 0;
  }

  get inMemoryBlockOnConsumed() {
    return this._inMemoryBlockOnConsumed;
  }

  set inMemoryBlockOnConsumed(value) {
    this._inMemoryBlockOnConsumed = value ? parseInt(value) : 0;
    if (this.inMemoryBlockOnConsumed > 0 && this.points > this.inMemoryBlockOnConsumed) {
      throw new Error('inMemoryBlockOnConsumed option must be greater or equal "points" option');
    }
  }

  get inMemoryBlockDuration() {
    return this._inMemoryBlockDuration;
  }

  set inMemoryBlockDuration(value) {
    this._inMemoryBlockDuration = value ? parseInt(value) : 0;
    if (this.inMemoryBlockDuration > 0 && this.inMemoryBlockOnConsumed === 0) {
      throw new Error('inMemoryBlockOnConsumed option must be set up');
    }
  }

  get msInMemoryBlockDuration() {
    return this._inMemoryBlockDuration * 1000;
  }

  /**
   * Block any key for secDuration seconds
   *
   * @param key
   * @param secDuration
   * @param {Object} options
   *
   * @return Promise<RateLimiterRes>
   */
  block(key, secDuration, options = {}) {
    const msDuration = secDuration * 1000;
    return this._block(this.getKey(key), this.points + 1, msDuration, options);
  }

  /**
   * Set points by key for any duration
   *
   * @param key
   * @param points
   * @param secDuration
   * @param {Object} options
   *
   * @return Promise<RateLimiterRes>
   */
  set(key, points, secDuration, options = {}) {
    const msDuration = (secDuration >= 0 ? secDuration : this.duration) * 1000;
    return this._block(this.getKey(key), points, msDuration, options);
  }

  /**
   *
   * @param key
   * @param pointsToConsume
   * @param {Object} options
   * @returns Promise<RateLimiterRes>
   */
  _consume(key, pointsToConsume = 1, options = {}) {
    return new Promise((resolve, reject) => {
      const rlKey = this.getKey(key);

      const inMemoryBlockMsBeforeExpire = this.getInMemoryBlockMsBeforeExpire(rlKey);
      if (inMemoryBlockMsBeforeExpire > 0) {
        return reject(new RateLimiterRes(0, inMemoryBlockMsBeforeExpire));
      }

      this._upsert(rlKey, pointsToConsume, this._getKeySecDuration(options) * 1000, false, options)
        .then((res) => {
          this._afterConsume(resolve, reject, rlKey, pointsToConsume, res);
        })
        .catch((err) => reject(err));
    });
  }

  /**
   *
   * @param key
   * @param points
   * @param {Object} options
   * @returns Promise<RateLimiterRes>
   */
  _penalty(key, points = 1, options = {}) {
    const rlKey = this.getKey(key);
    return new Promise((resolve, reject) => {
      this._upsert(rlKey, points, this._getKeySecDuration(options) * 1000, false, options)
        .then((res) => {
          resolve(this._getRateLimiterRes(rlKey, points, res));
        })
        .catch((res) => reject(res));
    });
  }

  /**
   *
   * @param key
   * @param points
   * @param {Object} options
   * @returns Promise<RateLimiterRes>
   */
  _reward(key, points = 1, options = {}) {
    const rlKey = this.getKey(key);
    return new Promise((resolve, reject) => {
      this._upsert(rlKey, -points, this._getKeySecDuration(options) * 1000, false, options)
        .then((res) => {
          resolve(this._getRateLimiterRes(rlKey, -points, res));
        })
        .catch((res) => reject(res));
    });
  }

  /**
   *
   * @param key
   * @param {Object} options
   * @returns Promise<RateLimiterRes>|null
   */
  get(key, options = {}) {
    const rlKey = this.getKey(key);
    return new Promise((resolve, reject) => {
      this._get(rlKey, options)
        .then((res) => {
          if (res === null || typeof res === 'undefined') {
            resolve(null);
          } else {
            resolve(this._getRateLimiterRes(rlKey, 0, res));
          }
        })
        .catch((err) => {
          this._handleError(err, 'get', resolve, reject, [key, options]);
        });
    });
  }

  /**
   *
   * @param key
   * @param {Object} options
   * @returns Promise<boolean>
   */
  delete(key, options = {}) {
    const rlKey = this.getKey(key);
    return new Promise((resolve, reject) => {
      this._delete(rlKey, options)
        .then((res) => {
          this._inMemoryBlockedKeys.delete(rlKey);
          resolve(res);
        })
        .catch((err) => {
          this._handleError(err, 'delete', resolve, reject, [key, options]);
        });
    });
  }

  /**
   * Cleanup keys no-matter expired or not.
   */
  deleteInMemoryBlockedAll() {
    this._inMemoryBlockedKeys.delete();
  }

  /**
   * Get RateLimiterRes object filled depending on storeResult, which specific for exact store
   *
   * @param rlKey
   * @param changedPoints
   * @param storeResult
   * @private
   */
  _getRateLimiterRes(rlKey, changedPoints, storeResult) { // eslint-disable-line no-unused-vars
    throw new Error("You have to implement the method '_getRateLimiterRes'!");
  }

  /**
   * Block key for this.msBlockDuration milliseconds
   * Usually, it just prolongs lifetime of key
   *
   * @param rlKey
   * @param initPoints
   * @param msDuration
   * @param {Object} options
   *
   * @return Promise<any>
   */
  _block(rlKey, initPoints, msDuration, options = {}) {
    return new Promise((resolve, reject) => {
      this._upsert(rlKey, initPoints, msDuration, true, options)
        .then(() => {
          resolve(new RateLimiterRes(0, msDuration > 0 ? msDuration : -1, initPoints));
        })
        .catch((err) => {
          this._handleError(err, 'block', resolve, reject, [this.parseKey(rlKey), msDuration / 1000, options]);
        });
    });
  }

  /**
   * Have to be implemented in every limiter
   * Resolve with raw result from Store OR null if rlKey is not set
   * or Reject with error
   *
   * @param rlKey
   * @param {Object} options
   * @private
   *
   * @return Promise<any>
   */
  _get(rlKey, options = {}) { // eslint-disable-line no-unused-vars
    throw new Error("You have to implement the method '_get'!");
  }

  /**
   * Have to be implemented
   * Resolve with true OR false if rlKey doesn't exist
   * or Reject with error
   *
   * @param rlKey
   * @param {Object} options
   * @private
   *
   * @return Promise<any>
   */
  _delete(rlKey, options = {}) { // eslint-disable-line no-unused-vars
    throw new Error("You have to implement the method '_delete'!");
  }

  /**
   * Have to be implemented
   * Resolve with object used for {@link _getRateLimiterRes} to generate {@link RateLimiterRes}
   *
   * @param {string} rlKey
   * @param {number} points
   * @param {number} msDuration
   * @param {boolean} forceExpire
   * @param {Object} options
   * @abstract
   *
   * @return Promise<Object>
   */
  _upsert(rlKey, points, msDuration, forceExpire = false, options = {}) {
    throw new Error("You have to implement the method '_upsert'!");
  }
};


/***/ }),

/***/ 5373:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const RateLimiterAbstract = __nccwpck_require__(363);

module.exports = class RateLimiterUnion {
  constructor(...limiters) {
    if (limiters.length < 1) {
      throw new Error('RateLimiterUnion: at least one limiter have to be passed');
    }
    limiters.forEach((limiter) => {
      if (!(limiter instanceof RateLimiterAbstract)) {
        throw new Error('RateLimiterUnion: all limiters have to be instance of RateLimiterAbstract');
      }
    });

    this._limiters = limiters;
  }

  consume(key, points = 1) {
    return new Promise((resolve, reject) => {
      const promises = [];
      this._limiters.forEach((limiter) => {
        promises.push(limiter.consume(key, points).catch(rej => ({ rejected: true, rej })));
      });

      Promise.all(promises)
        .then((res) => {
          const resObj = {};
          let rejected = false;

          res.forEach((item) => {
            if (item.rejected === true) {
              rejected = true;
            }
          });

          for (let i = 0; i < res.length; i++) {
            if (rejected && res[i].rejected === true) {
              resObj[this._limiters[i].keyPrefix] = res[i].rej;
            } else if (!rejected) {
              resObj[this._limiters[i].keyPrefix] = res[i];
            }
          }

          if (rejected) {
            reject(resObj);
          } else {
            resolve(resObj);
          }
        });
    });
  }
};


/***/ }),

/***/ 9830:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const RateLimiterStoreAbstract = __nccwpck_require__(5664);
const RateLimiterRes = __nccwpck_require__(9975);

const incrTtlLuaScript = `
server.call('set', KEYS[1], 0, 'EX', ARGV[2], 'NX')
local consumed = server.call('incrby', KEYS[1], ARGV[1])
local ttl = server.call('pttl', KEYS[1])
return {consumed, ttl}
`;

class RateLimiterValkey extends RateLimiterStoreAbstract {
  /**
   *
   * @param {Object} opts
   * Defaults {
   *   ... see other in RateLimiterStoreAbstract
   *
   *   storeClient: ValkeyClient
   *   rejectIfValkeyNotReady: boolean = false - reject / invoke insuranceLimiter immediately when valkey connection is not "ready"
   * }
   */
  constructor(opts) {
    super(opts);
    this.client = opts.storeClient;

    this._rejectIfValkeyNotReady = !!opts.rejectIfValkeyNotReady;
    this._incrTtlLuaScript = opts.customIncrTtlLuaScript || incrTtlLuaScript;

    this.client.defineCommand('rlflxIncr', {
      numberOfKeys: 1,
      lua: this._incrTtlLuaScript,
    });
  }

  /**
   * Prevent actual valkey call if valkey connection is not ready
   * @return {boolean}
   * @private
   */
  _isValkeyReady() {
    if (!this._rejectIfValkeyNotReady) {
      return true;
    }

    return this.client.status === 'ready';
  }

  _getRateLimiterRes(rlKey, changedPoints, result) {
    let consumed;
    let resTtlMs;

    if (Array.isArray(result[0])) {
      [[, consumed], [, resTtlMs]] = result;
    } else {
      [consumed, resTtlMs] = result;
    }

    const res = new RateLimiterRes();
    res.consumedPoints = +consumed;
    res.isFirstInDuration = res.consumedPoints === changedPoints;
    res.remainingPoints = Math.max(this.points - res.consumedPoints, 0);
    res.msBeforeNext = resTtlMs;

    return res;
  }

  _upsert(rlKey, points, msDuration, forceExpire = false) {
    if (!this._isValkeyReady()) {
      throw new Error('Valkey connection is not ready');
    }

    const secDuration = Math.floor(msDuration / 1000);

    if (forceExpire) {
      const multi = this.client.multi();

      if (secDuration > 0) {
        multi.set(rlKey, points, 'EX', secDuration);
      } else {
        multi.set(rlKey, points);
      }

      return multi.pttl(rlKey).exec();
    }

    if (secDuration > 0) {
      return this.client.rlflxIncr([rlKey, String(points), String(secDuration), String(this.points), String(this.duration)]);
    }

    return this.client.multi().incrby(rlKey, points).pttl(rlKey).exec();
  }

  _get(rlKey) {
    if (!this._isValkeyReady()) {
      throw new Error('Valkey connection is not ready');
    }

    return this.client
      .multi()
      .get(rlKey)
      .pttl(rlKey)
      .exec()
      .then((result) => {
        const [[, points]] = result;
        if (points === null) return null;
        return result;
      });
  }

  _delete(rlKey) {
    return this.client
      .del(rlKey)
      .then(result => result > 0);
  }
}

module.exports = RateLimiterValkey;


/***/ }),

/***/ 2721:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

/* eslint-disable no-unused-vars */
const RateLimiterStoreAbstract = __nccwpck_require__(5664);
const RateLimiterRes = __nccwpck_require__(9975);

/**
 * @typedef {import('@valkey/valkey-glide').GlideClient} GlideClient
 * @typedef {import('@valkey/valkey-glide').GlideClusterClient} GlideClusterClient
 */

const DEFAULT_LIBRARY_NAME = 'ratelimiterflexible';

const DEFAULT_VALKEY_SCRIPT = `local key = KEYS[1]
local pointsToConsume = tonumber(ARGV[1])
if tonumber(ARGV[2]) > 0 then
  server.call('set', key, "0", 'EX', ARGV[2], 'NX')
  local consumed = server.call('incrby', key, pointsToConsume)
  local pttl = server.call('pttl', key)
  return {consumed, pttl}
end
local consumed = server.call('incrby', key, pointsToConsume)
local pttl = server.call('pttl', key)
return {consumed, pttl}`;

const GET_VALKEY_SCRIPT = `local key = KEYS[1]
local value = server.call('get', key)
if value == nil then
  return value
end
local pttl = server.call('pttl', key)
return {tonumber(value), pttl}`;

class RateLimiterValkeyGlide extends RateLimiterStoreAbstract {
  /**
   * Constructor for RateLimiterValkeyGlide
   *
   * @param {Object} opts - Configuration options
   * @param {GlideClient|GlideClusterClient} opts.storeClient - Valkey Glide client instance (required)
   * @param {number} [opts.points=4] - Maximum number of points that can be consumed over duration
   * @param {number} [opts.duration=1] - Duration in seconds before points are reset
   * @param {number} [opts.blockDuration=0] - Duration in seconds that a key will be blocked for if consumed more than points
   * @param {boolean} [opts.rejectIfValkeyNotReady=false] - Whether to reject requests if Valkey is not ready
   * @param {boolean} [opts.execEvenly=false] - Delay actions to distribute them evenly over duration
   * @param {number} [opts.execEvenlyMinDelayMs] - Minimum delay between actions when execEvenly is true
   * @param {string} [opts.customFunction] - Custom Lua script for rate limiting logic
   * @param {number} [opts.inMemoryBlockOnConsumed] - Points threshold for in-memory blocking
   * @param {number} [opts.inMemoryBlockDuration] - Duration in seconds for in-memory blocking
   * @param {string} [opts.customFunctionLibName] - Custom name for the function library, defaults to 'ratelimiter'.
   * The name is used to identify the library of the lua function. An custom name should be used only if you
   * you want to use different libraries for different rate limiters, otherwise it is not needed.
   * @param {RateLimiterAbstract} [opts.insuranceLimiter] - Backup limiter to use when the primary client fails
   *
   * @example
   * const rateLimiter = new RateLimiterValkeyGlide({
   *   storeClient: glideClient,
   *   points: 5,
   *   duration: 1
   * });
   *
   * @example <caption>With custom Lua function</caption>
   * const customScript = `local key = KEYS[1]
   * local pointsToConsume = tonumber(ARGV[1]) or 0
   * local secDuration = tonumber(ARGV[2]) or 0
   *
   * -- Custom implementation
   * -- ...
   *
   * -- Must return exactly two values: [consumed_points, ttl_in_ms]
   * return {consumed, ttl}`
   *
   * const rateLimiter = new RateLimiterValkeyGlide({
   *   storeClient: glideClient,
   *   points: 5,
   *   customFunction: customScript
   * });
   *
   * @example <caption>With insurance limiter</caption>
   * const rateLimiter = new RateLimiterValkeyGlide({
   *   storeClient: primaryGlideClient,
   *   points: 5,
   *   duration: 2,
   *   insuranceLimiter: new RateLimiterMemory({
   *     points: 5,
   *     duration: 2
   *   })
   * });
   *
   * @description
   * When providing a custom Lua script via `opts.customFunction`, it must:
   *
   * 1. Accept parameters:
   *    - KEYS[1]: The key being rate limited
   *    - ARGV[1]: Points to consume (as string, use tonumber() to convert)
   *    - ARGV[2]: Duration in seconds (as string, use tonumber() to convert)
   *
   * 2. Return an array with exactly two elements:
   *    - [0]: Consumed points (number)
   *    - [1]: TTL in milliseconds (number)
   *
   * 3. Handle scenarios:
   *    - New key creation: Initialize with expiry for fixed windows
   *    - Key updates: Increment existing counters
   */
  constructor(opts) {
    super(opts);
    this.client = opts.storeClient;
    this._scriptLoaded = false;
    this._getScriptLoaded = false;
    this._rejectIfValkeyNotReady = !!opts.rejectIfValkeyNotReady;
    this._luaScript = opts.customFunction || DEFAULT_VALKEY_SCRIPT;
    this._libraryName = opts.customFunctionLibName || DEFAULT_LIBRARY_NAME;
  }

  /**
   * Ensure scripts are loaded in the Valkey server
   * @returns {Promise<boolean>} True if scripts are loaded
   * @private
   */
  async _loadScripts() {
    if (this._scriptLoaded && this._getScriptLoaded) {
      return true;
    }
    if (!this.client) {
      throw new Error('Valkey client is not set');
    }
    const promises = [];
    if (!this._scriptLoaded) {
      const script = Buffer.from(`#!lua name=${this._libraryName}
        local function consume(KEYS, ARGV)
          ${this._luaScript.trim()}
        end
        server.register_function('consume', consume)`);
      promises.push(this.client.functionLoad(script, { replace: true }));
    } else promises.push(Promise.resolve(this._libraryName));

    if (!this._getScriptLoaded) {
      const script = Buffer.from(`#!lua name=ratelimiter_get
        local function getValue(KEYS, ARGV)
          ${GET_VALKEY_SCRIPT.trim()}
        end
        server.register_function('getValue', getValue)`);
      promises.push(this.client.functionLoad(script, { replace: true }));
    } else promises.push(Promise.resolve('ratelimiter_get'));

    const results = await Promise.all(promises);
    this._scriptLoaded = results[0] === this._libraryName;
    this._getScriptLoaded = results[1] === 'ratelimiter_get';

    if ((!this._scriptLoaded || !this._getScriptLoaded)) {
      throw new Error('Valkey connection is not ready, scripts not loaded');
    }
    return true;
  }

  /**
   * Update or insert the rate limiter record
   *
   * @param {string} rlKey - The rate limiter key
   * @param {number} pointsToConsume - Points to be consumed
   * @param {number} msDuration - Duration in milliseconds
   * @param {boolean} [forceExpire=false] - Whether to force expiration
   * @param {Object} [options={}] - Additional options
   * @returns {Promise<Array>} Array containing consumed points and TTL
   * @private
   */
  async _upsert(rlKey, pointsToConsume, msDuration, forceExpire = false, options = {}) {
    await this._loadScripts();
    const secDuration = Math.floor(msDuration / 1000);
    if (forceExpire) {
      if (secDuration > 0) {
        await this.client.set(
          rlKey,
          String(pointsToConsume),
          { expiry: { type: 'EX', count: secDuration } },
        );
        return [pointsToConsume, secDuration * 1000];
      }
      await this.client.set(rlKey, String(pointsToConsume));
      return [pointsToConsume, -1];
    }
    const result = await this.client.fcall(
      'consume',
      [rlKey],
      [String(pointsToConsume), String(secDuration)],
    );
    return result;
  }

  /**
   * Get the rate limiter record
   *
   * @param {string} rlKey - The rate limiter key
   * @param {Object} [options={}] - Additional options
   * @returns {Promise<Array|null>} Array containing consumed points and TTL, or null if not found
   * @private
   */
  async _get(rlKey, options = {}) {
    await this._loadScripts();
    const res = await this.client.fcall('getValue', [rlKey], []);
    return res.length > 0 ? res : null;
  }

  /**
   * Delete the rate limiter record
   *
   * @param {string} rlKey - The rate limiter key
   * @param {Object} [options={}] - Additional options
   * @returns {Promise<boolean>} True if successful, false otherwise
   * @private
   */
  async _delete(rlKey, options = {}) {
    const result = await this.client.del([rlKey]);
    return result > 0;
  }

  /**
   * Convert raw result to RateLimiterRes object
   *
   * @param {string} rlKey - The rate limiter key
   * @param {number} changedPoints - Points changed in this operation
   * @param {Array|null} result - Result from Valkey operation
   * @returns {RateLimiterRes|null} RateLimiterRes object or null if result is null
   * @private
   */
  _getRateLimiterRes(rlKey, changedPoints, result) {
    if (result === null) {
      return null;
    }
    const res = new RateLimiterRes();
    const [consumedPointsStr, pttl] = result;
    const consumedPoints = Number(consumedPointsStr);

    // Handle consumed points
    res.isFirstInDuration = consumedPoints === changedPoints;
    res.consumedPoints = consumedPoints;
    res.remainingPoints = Math.max(this.points - res.consumedPoints, 0);
    res.msBeforeNext = pttl;
    return res;
  }

  /**
   * Close the rate limiter and release resources
   * Note: The method won't going to close the Valkey client, as it may be shared with other instances.
   * @returns {Promise<void>} Promise that resolves when the rate limiter is closed
   */
  async close() {
    if (this._scriptLoaded) {
      await this.client.functionDelete(this._libraryName);
      this._scriptLoaded = false;
    }
    if (this._getScriptLoaded) {
      await this.client.functionDelete('ratelimiter_get');
      this._getScriptLoaded = false;
    }
    if (this.insuranceLimiter) {
      try {
        await this.insuranceLimiter.close();
      } catch (e) {
        // We can't assume that insuranceLimiter is a Valkey client or any
        // other insuranceLimiter type which implement close method.
      }
    }
    // Clear instance properties to let garbage collector free memory
    this.client = null;
    this._scriptLoaded = false;
    this._getScriptLoaded = false;
    this._rejectIfValkeyNotReady = false;
    this._luaScript = null;
    this._libraryName = null;
    this.insuranceLimiter = null;
  }
}

module.exports = RateLimiterValkeyGlide;


/***/ }),

/***/ 8733:
/***/ ((module) => {

module.exports = class BlockedKeys {
  constructor() {
    this._keys = {}; // {'key': 1526279430331}
    this._addedKeysAmount = 0;
  }

  collectExpired() {
    const now = Date.now();

    Object.keys(this._keys).forEach((key) => {
      if (this._keys[key] <= now) {
        delete this._keys[key];
      }
    });

    this._addedKeysAmount = Object.keys(this._keys).length;
  }

  /**
   * Add new blocked key
   *
   * @param key String
   * @param sec Number
   */
  add(key, sec) {
    this.addMs(key, sec * 1000);
  }

  /**
   * Add new blocked key for ms
   *
   * @param key String
   * @param ms Number
   */
  addMs(key, ms) {
    this._keys[key] = Date.now() + ms;
    this._addedKeysAmount++;
    if (this._addedKeysAmount > 999) {
      this.collectExpired();
    }
  }

  /**
   * 0 means not blocked
   *
   * @param key
   * @returns {number}
   */
  msBeforeExpire(key) {
    const expire = this._keys[key];

    if (expire && expire >= Date.now()) {
      this.collectExpired();
      const now = Date.now();
      return expire >= now ? expire - now : 0;
    }

    return 0;
  }

  /**
   * If key is not given, delete all data in memory
   * 
   * @param {string|undefined} key
   */
  delete(key) {
    if (key) {
      delete this._keys[key];
    } else {
      Object.keys(this._keys).forEach((key) => {
        delete this._keys[key];
      });
    }
  }
};


/***/ }),

/***/ 7905:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const BlockedKeys = __nccwpck_require__(8733);

module.exports = BlockedKeys;


/***/ }),

/***/ 7774:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const Record = __nccwpck_require__(532);
const RateLimiterRes = __nccwpck_require__(9975);

module.exports = class MemoryStorage {
  constructor() {
    /**
     * @type {Object.<string, Record>}
     * @private
     */
    this._storage = {};
  }

  incrby(key, value, durationSec) {
    if (this._storage[key]) {
      const msBeforeExpires = this._storage[key].expiresAt
        ? this._storage[key].expiresAt.getTime() - new Date().getTime()
        : -1;
      if (!this._storage[key].expiresAt || msBeforeExpires > 0) {
        // Change value
        this._storage[key].value = this._storage[key].value + value;

        return new RateLimiterRes(0, msBeforeExpires, this._storage[key].value, false);
      }

      return this.set(key, value, durationSec);
    }
    return this.set(key, value, durationSec);
  }

  set(key, value, durationSec) {
    const durationMs = durationSec * 1000;

    if (this._storage[key] && this._storage[key].timeoutId) {
      clearTimeout(this._storage[key].timeoutId);
    }

    this._storage[key] = new Record(
      value,
      durationMs > 0 ? new Date(Date.now() + durationMs) : null
    );
    if (durationMs > 0) {
      this._storage[key].timeoutId = setTimeout(() => {
        delete this._storage[key];
      }, durationMs);
      if (this._storage[key].timeoutId.unref) {
        this._storage[key].timeoutId.unref();
      }
    }

    return new RateLimiterRes(0, durationMs === 0 ? -1 : durationMs, this._storage[key].value, true);
  }

  /**
   *
   * @param key
   * @returns {*}
   */
  get(key) {
    if (this._storage[key]) {
      const msBeforeExpires = this._storage[key].expiresAt
        ? this._storage[key].expiresAt.getTime() - new Date().getTime()
        : -1;
      return new RateLimiterRes(0, msBeforeExpires, this._storage[key].value, false);
    }
    return null;
  }

  /**
   *
   * @param key
   * @returns {boolean}
   */
  delete(key) {
    if (this._storage[key]) {
      if (this._storage[key].timeoutId) {
        clearTimeout(this._storage[key].timeoutId);
      }
      delete this._storage[key];
      return true;
    }
    return false;
  }
};


/***/ }),

/***/ 532:
/***/ ((module) => {

module.exports = class Record {
  /**
   *
   * @param value int
   * @param expiresAt Date|int
   * @param timeoutId
   */
  constructor(value, expiresAt, timeoutId = null) {
    this.value = value;
    this.expiresAt = expiresAt;
    this.timeoutId = timeoutId;
  }

  get value() {
    return this._value;
  }

  set value(value) {
    this._value = parseInt(value);
  }

  get expiresAt() {
    return this._expiresAt;
  }

  set expiresAt(value) {
    if (!(value instanceof Date) && Number.isInteger(value)) {
      value = new Date(value);
    }
    this._expiresAt = value;
  }

  get timeoutId() {
    return this._timeoutId;
  }

  set timeoutId(value) {
    this._timeoutId = value;
  }
};


/***/ }),

/***/ 7854:
/***/ ((module) => {

module.exports = class RateLimiterEtcdTransactionFailedError extends Error {
  constructor(message) {
    super();
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
    this.name = 'RateLimiterEtcdTransactionFailedError';
    this.message = message;
  }
};


/***/ }),

/***/ 9636:
/***/ ((module) => {

module.exports = class RateLimiterQueueError extends Error {
  constructor(message, extra) {
    super();
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
    this.name = 'CustomError';
    this.message = message;
    if (extra) {
      this.extra = extra;
    }
  }
};


/***/ }),

/***/ 2653:
/***/ ((module) => {

module.exports = class RateLimiterSetupError extends Error {
  constructor(message) {
    super();
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
    this.name = 'RateLimiterSetupError';
    this.message = message;
  }
};


/***/ }),

/***/ 8206:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

"use strict";


var inspect = __nccwpck_require__(504);

var $TypeError = __nccwpck_require__(6361);

/*
* This function traverses the list returning the node corresponding to the given key.
*
* That node is also moved to the head of the list, so that if it's accessed again we don't need to traverse the whole list.
* By doing so, all the recently used nodes can be accessed relatively quickly.
*/
/** @type {import('./list.d.ts').listGetNode} */
// eslint-disable-next-line consistent-return
var listGetNode = function (list, key, isDelete) {
	/** @type {typeof list | NonNullable<(typeof list)['next']>} */
	var prev = list;
	/** @type {(typeof list)['next']} */
	var curr;
	// eslint-disable-next-line eqeqeq
	for (; (curr = prev.next) != null; prev = curr) {
		if (curr.key === key) {
			prev.next = curr.next;
			if (!isDelete) {
				// eslint-disable-next-line no-extra-parens
				curr.next = /** @type {NonNullable<typeof list.next>} */ (list.next);
				list.next = curr; // eslint-disable-line no-param-reassign
			}
			return curr;
		}
	}
};

/** @type {import('./list.d.ts').listGet} */
var listGet = function (objects, key) {
	if (!objects) {
		return void undefined;
	}
	var node = listGetNode(objects, key);
	return node && node.value;
};
/** @type {import('./list.d.ts').listSet} */
var listSet = function (objects, key, value) {
	var node = listGetNode(objects, key);
	if (node) {
		node.value = value;
	} else {
		// Prepend the new node to the beginning of the list
		objects.next = /** @type {import('./list.d.ts').ListNode<typeof value, typeof key>} */ ({ // eslint-disable-line no-param-reassign, no-extra-parens
			key: key,
			next: objects.next,
			value: value
		});
	}
};
/** @type {import('./list.d.ts').listHas} */
var listHas = function (objects, key) {
	if (!objects) {
		return false;
	}
	return !!listGetNode(objects, key);
};
/** @type {import('./list.d.ts').listDelete} */
// eslint-disable-next-line consistent-return
var listDelete = function (objects, key) {
	if (objects) {
		return listGetNode(objects, key, true);
	}
};

/** @type {import('.')} */
module.exports = function getSideChannelList() {
	/** @typedef {ReturnType<typeof getSideChannelList>} Channel */
	/** @typedef {Parameters<Channel['get']>[0]} K */
	/** @typedef {Parameters<Channel['set']>[1]} V */

	/** @type {import('./list.d.ts').RootNode<V, K> | undefined} */ var $o;

	/** @type {Channel} */
	var channel = {
		assert: function (key) {
			if (!channel.has(key)) {
				throw new $TypeError('Side channel does not contain ' + inspect(key));
			}
		},
		'delete': function (key) {
			var deletedNode = listDelete($o, key);
			if (deletedNode && $o && !$o.next) {
				$o = void undefined;
			}
			return !!deletedNode;
		},
		get: function (key) {
			return listGet($o, key);
		},
		has: function (key) {
			return listHas($o, key);
		},
		set: function (key, value) {
			if (!$o) {
				// Initialize the linked list as an empty node, so that we don't have to special-case handling of the first node: we can always refer to it as (previous node).next, instead of something like (list).head
				$o = {
					next: void undefined
				};
			}
			// eslint-disable-next-line no-extra-parens
			listSet(/** @type {NonNullable<typeof $o>} */ ($o), key, value);
		}
	};
	return channel;
};


/***/ }),

/***/ 2172:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

"use strict";


var GetIntrinsic = __nccwpck_require__(4538);
var callBound = __nccwpck_require__(1785);
var inspect = __nccwpck_require__(504);

var $TypeError = __nccwpck_require__(6361);
var $Map = GetIntrinsic('%Map%', true);

/** @type {<K, V>(thisArg: Map<K, V>, key: K) => V} */
var $mapGet = callBound('Map.prototype.get', true);
/** @type {<K, V>(thisArg: Map<K, V>, key: K, value: V) => void} */
var $mapSet = callBound('Map.prototype.set', true);
/** @type {<K, V>(thisArg: Map<K, V>, key: K) => boolean} */
var $mapHas = callBound('Map.prototype.has', true);
/** @type {<K, V>(thisArg: Map<K, V>, key: K) => boolean} */
var $mapDelete = callBound('Map.prototype.delete', true);
/** @type {<K, V>(thisArg: Map<K, V>) => number} */
var $mapSize = callBound('Map.prototype.size', true);

/** @type {import('.')} */
module.exports = !!$Map && /** @type {Exclude<import('.'), false>} */ function getSideChannelMap() {
	/** @typedef {ReturnType<typeof getSideChannelMap>} Channel */
	/** @typedef {Parameters<Channel['get']>[0]} K */
	/** @typedef {Parameters<Channel['set']>[1]} V */

	/** @type {Map<K, V> | undefined} */ var $m;

	/** @type {Channel} */
	var channel = {
		assert: function (key) {
			if (!channel.has(key)) {
				throw new $TypeError('Side channel does not contain ' + inspect(key));
			}
		},
		'delete': function (key) {
			if ($m) {
				var result = $mapDelete($m, key);
				if ($mapSize($m) === 0) {
					$m = void undefined;
				}
				return result;
			}
			return false;
		},
		get: function (key) { // eslint-disable-line consistent-return
			if ($m) {
				return $mapGet($m, key);
			}
		},
		has: function (key) {
			if ($m) {
				return $mapHas($m, key);
			}
			return false;
		},
		set: function (key, value) {
			if (!$m) {
				// @ts-expect-error TS can't handle narrowing a variable inside a closure
				$m = new $Map();
			}
			$mapSet($m, key, value);
		}
	};

	// @ts-expect-error TODO: figure out why TS is erroring here
	return channel;
};


/***/ }),

/***/ 1012:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

"use strict";


var GetIntrinsic = __nccwpck_require__(4538);
var callBound = __nccwpck_require__(1785);
var inspect = __nccwpck_require__(504);
var getSideChannelMap = __nccwpck_require__(2172);

var $TypeError = __nccwpck_require__(6361);
var $WeakMap = GetIntrinsic('%WeakMap%', true);

/** @type {<K extends object, V>(thisArg: WeakMap<K, V>, key: K) => V} */
var $weakMapGet = callBound('WeakMap.prototype.get', true);
/** @type {<K extends object, V>(thisArg: WeakMap<K, V>, key: K, value: V) => void} */
var $weakMapSet = callBound('WeakMap.prototype.set', true);
/** @type {<K extends object, V>(thisArg: WeakMap<K, V>, key: K) => boolean} */
var $weakMapHas = callBound('WeakMap.prototype.has', true);
/** @type {<K extends object, V>(thisArg: WeakMap<K, V>, key: K) => boolean} */
var $weakMapDelete = callBound('WeakMap.prototype.delete', true);

/** @type {import('.')} */
module.exports = $WeakMap
	? /** @type {Exclude<import('.'), false>} */ function getSideChannelWeakMap() {
		/** @typedef {ReturnType<typeof getSideChannelWeakMap>} Channel */
		/** @typedef {Parameters<Channel['get']>[0]} K */
		/** @typedef {Parameters<Channel['set']>[1]} V */

		/** @type {WeakMap<K & object, V> | undefined} */ var $wm;
		/** @type {Channel | undefined} */ var $m;

		/** @type {Channel} */
		var channel = {
			assert: function (key) {
				if (!channel.has(key)) {
					throw new $TypeError('Side channel does not contain ' + inspect(key));
				}
			},
			'delete': function (key) {
				if ($WeakMap && key && (typeof key === 'object' || typeof key === 'function')) {
					if ($wm) {
						return $weakMapDelete($wm, key);
					}
				} else if (getSideChannelMap) {
					if ($m) {
						return $m['delete'](key);
					}
				}
				return false;
			},
			get: function (key) {
				if ($WeakMap && key && (typeof key === 'object' || typeof key === 'function')) {
					if ($wm) {
						return $weakMapGet($wm, key);
					}
				}
				return $m && $m.get(key);
			},
			has: function (key) {
				if ($WeakMap && key && (typeof key === 'object' || typeof key === 'function')) {
					if ($wm) {
						return $weakMapHas($wm, key);
					}
				}
				return !!$m && $m.has(key);
			},
			set: function (key, value) {
				if ($WeakMap && key && (typeof key === 'object' || typeof key === 'function')) {
					if (!$wm) {
						$wm = new $WeakMap();
					}
					$weakMapSet($wm, key, value);
				} else if (getSideChannelMap) {
					if (!$m) {
						$m = getSideChannelMap();
					}
					// eslint-disable-next-line no-extra-parens
					/** @type {NonNullable<typeof $m>} */ ($m).set(key, value);
				}
			}
		};

		// @ts-expect-error TODO: figure out why this is erroring
		return channel;
	}
	: getSideChannelMap;


/***/ }),

/***/ 4334:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

"use strict";


var $TypeError = __nccwpck_require__(6361);
var inspect = __nccwpck_require__(504);
var getSideChannelList = __nccwpck_require__(8206);
var getSideChannelMap = __nccwpck_require__(2172);
var getSideChannelWeakMap = __nccwpck_require__(1012);

var makeChannel = getSideChannelWeakMap || getSideChannelMap || getSideChannelList;

/** @type {import('.')} */
module.exports = function getSideChannel() {
	/** @typedef {ReturnType<typeof getSideChannel>} Channel */

	/** @type {Channel | undefined} */ var $channelData;

	/** @type {Channel} */
	var channel = {
		assert: function (key) {
			if (!channel.has(key)) {
				var keyDesc = key && Object(key) === key
					? 'the given object key'
					: inspect(key);
				throw new $TypeError('Side channel does not contain ' + keyDesc);
			}
		},
		'delete': function (key) {
			return !!$channelData && $channelData['delete'](key);
		},
		get: function (key) {
			return $channelData && $channelData.get(key);
		},
		has: function (key) {
			return !!$channelData && $channelData.has(key);
		},
		set: function (key, value) {
			if (!$channelData) {
				$channelData = makeChannel();
			}

			$channelData.set(key, value);
		}
	};

	return channel;
};


/***/ }),

/***/ 7020:
/***/ ((__unused_webpack_module, exports) => {

"use strict";
var __webpack_unused_export__;


__webpack_unused_export__ = ({
  value: true
});

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol ? "symbol" : typeof obj; };

function isLower(char) {
  return char >= 0x61 /* 'a' */ && char <= 0x7a /* 'z' */;
}

function isUpper(char) {
  return char >= 0x41 /* 'A' */ && char <= 0x5a /* 'Z' */;
}

function isDigit(char) {
  return char >= 0x30 /* '0' */ && char <= 0x39 /* '9' */;
}

function toUpper(char) {
  return char - 0x20;
}

function toUpperSafe(char) {
  if (isLower(char)) {
    return char - 0x20;
  }
  return char;
}

function toLower(char) {
  return char + 0x20;
}

function camelize$1(str, separator) {
  var firstChar = str.charCodeAt(0);
  if (isDigit(firstChar) || isUpper(firstChar) || firstChar == separator) {
    return str;
  }
  var out = [];
  var changed = false;
  if (isUpper(firstChar)) {
    changed = true;
    out.push(toLower(firstChar));
  } else {
    out.push(firstChar);
  }

  var length = str.length;
  for (var i = 1; i < length; ++i) {
    var c = str.charCodeAt(i);
    if (c === separator) {
      changed = true;
      c = str.charCodeAt(++i);
      if (isNaN(c)) {
        return str;
      }
      out.push(toUpperSafe(c));
    } else {
      out.push(c);
    }
  }
  return changed ? String.fromCharCode.apply(undefined, out) : str;
}

function decamelize$1(str, separator) {
  var firstChar = str.charCodeAt(0);
  if (!isLower(firstChar)) {
    return str;
  }
  var length = str.length;
  var changed = false;
  var out = [];
  for (var i = 0; i < length; ++i) {
    var c = str.charCodeAt(i);
    if (isUpper(c)) {
      out.push(separator);
      out.push(toLower(c));
      changed = true;
    } else {
      out.push(c);
    }
  }
  return changed ? String.fromCharCode.apply(undefined, out) : str;
}

function pascalize$1(str, separator) {
  var firstChar = str.charCodeAt(0);
  if (isDigit(firstChar) || firstChar == separator) {
    return str;
  }
  var length = str.length;
  var changed = false;
  var out = [];
  for (var i = 0; i < length; ++i) {
    var c = str.charCodeAt(i);
    if (c === separator) {
      changed = true;
      c = str.charCodeAt(++i);
      if (isNaN(c)) {
        return str;
      }
      out.push(toUpperSafe(c));
    } else if (i === 0 && isLower(c)) {
      changed = true;
      out.push(toUpper(c));
    } else {
      out.push(c);
    }
  }
  return changed ? String.fromCharCode.apply(undefined, out) : str;
}

function depascalize$1(str, separator) {
  var firstChar = str.charCodeAt(0);
  if (!isUpper(firstChar)) {
    return str;
  }
  var length = str.length;
  var changed = false;
  var out = [];
  for (var i = 0; i < length; ++i) {
    var c = str.charCodeAt(i);
    if (isUpper(c)) {
      if (i > 0) {
        out.push(separator);
      }
      out.push(toLower(c));
      changed = true;
    } else {
      out.push(c);
    }
  }
  return changed ? String.fromCharCode.apply(undefined, out) : str;
}

function shouldProcessValue(value) {
  return value && (typeof value === 'undefined' ? 'undefined' : _typeof(value)) == 'object' && !(value instanceof Date) && !(value instanceof Function);
}

function processKeys(obj, fun, opts) {
  var obj2 = void 0;
  if (obj instanceof Array) {
    obj2 = [];
  } else {
    if (typeof obj.prototype !== 'undefined') {
      // return non-plain object unchanged
      return obj;
    }
    obj2 = {};
  }
  for (var key in obj) {
    var value = obj[key];
    if (typeof key === 'string') key = fun(key, opts && opts.separator);
    if (shouldProcessValue(value)) {
      obj2[key] = processKeys(value, fun, opts);
    } else {
      obj2[key] = value;
    }
  }
  return obj2;
}

function processKeysInPlace(obj, fun, opts) {
  var keys = Object.keys(obj);
  for (var idx = 0; idx < keys.length; ++idx) {
    var key = keys[idx];
    var value = obj[key];
    var newKey = fun(key, opts && opts.separator);
    if (newKey !== key) {
      delete obj[key];
    }
    if (shouldProcessValue(value)) {
      obj[newKey] = processKeys(value, fun, opts);
    } else {
      obj[newKey] = value;
    }
  }
  return obj;
}

function camelize$$1(str, separator) {
  return camelize$1(str, separator && separator.charCodeAt(0) || 0x5f /* _ */);
}

function decamelize$$1(str, separator) {
  return decamelize$1(str, separator && separator.charCodeAt(0) || 0x5f /* _ */);
}

function pascalize$$1(str, separator) {
  return pascalize$1(str, separator && separator.charCodeAt(0) || 0x5f /* _ */);
}

function depascalize$$1(str, separator) {
  return depascalize$1(str, separator && separator.charCodeAt(0) || 0x5f /* _ */);
}

function camelizeKeys(obj, opts) {
  opts = opts || {};
  if (!shouldProcessValue(obj)) return obj;
  if (opts.inPlace) return processKeysInPlace(obj, camelize$$1, opts);
  return processKeys(obj, camelize$$1, opts);
}

function decamelizeKeys(obj, opts) {
  opts = opts || {};
  if (!shouldProcessValue(obj)) return obj;
  if (opts.inPlace) return processKeysInPlace(obj, decamelize$$1, opts);
  return processKeys(obj, decamelize$$1, opts);
}

function pascalizeKeys(obj, opts) {
  opts = opts || {};
  if (!shouldProcessValue(obj)) return obj;
  if (opts.inPlace) return processKeysInPlace(obj, pascalize$$1, opts);
  return processKeys(obj, pascalize$$1, opts);
}

function depascalizeKeys(obj, opts) {
  opts = opts || {};
  if (!shouldProcessValue(obj)) return obj;
  if (opts.inPlace) return processKeysInPlace(obj, depascalize$$1, opts);
  return processKeys(obj, depascalize$$1, opts);
}

__webpack_unused_export__ = camelize$$1;
__webpack_unused_export__ = decamelize$$1;
__webpack_unused_export__ = pascalize$$1;
__webpack_unused_export__ = depascalize$$1;
exports.k5 = camelizeKeys;
exports.iF = decamelizeKeys;
__webpack_unused_export__ = pascalizeKeys;
__webpack_unused_export__ = depascalizeKeys;


/***/ }),

/***/ 7668:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

var map = {
	"./BurstyRateLimiter": [
		6779
	],
	"./BurstyRateLimiter.js": [
		6779
	],
	"./ExpressBruteFlexible": [
		6474,
		474
	],
	"./ExpressBruteFlexible.js": [
		6474,
		474
	],
	"./RLWrapperBlackAndWhite": [
		2533
	],
	"./RLWrapperBlackAndWhite.js": [
		2533
	],
	"./RLWrapperTimeouts": [
		8731
	],
	"./RLWrapperTimeouts.js": [
		8731
	],
	"./RateLimiterAbstract": [
		363
	],
	"./RateLimiterAbstract.js": [
		363
	],
	"./RateLimiterCluster": [
		397
	],
	"./RateLimiterCluster.js": [
		397
	],
	"./RateLimiterDrizzle": [
		7726
	],
	"./RateLimiterDrizzle.js": [
		7726
	],
	"./RateLimiterDrizzleNonAtomic": [
		7762
	],
	"./RateLimiterDrizzleNonAtomic.js": [
		7762
	],
	"./RateLimiterDynamo": [
		9766
	],
	"./RateLimiterDynamo.js": [
		9766
	],
	"./RateLimiterEtcd": [
		8810
	],
	"./RateLimiterEtcd.js": [
		8810
	],
	"./RateLimiterEtcdNonAtomic": [
		5721
	],
	"./RateLimiterEtcdNonAtomic.js": [
		5721
	],
	"./RateLimiterInsuredAbstract": [
		2813
	],
	"./RateLimiterInsuredAbstract.js": [
		2813
	],
	"./RateLimiterMemcache": [
		8747
	],
	"./RateLimiterMemcache.js": [
		8747
	],
	"./RateLimiterMemory": [
		1351
	],
	"./RateLimiterMemory.js": [
		1351
	],
	"./RateLimiterMongo": [
		978
	],
	"./RateLimiterMongo.js": [
		978
	],
	"./RateLimiterMySQL": [
		2532
	],
	"./RateLimiterMySQL.js": [
		2532
	],
	"./RateLimiterPostgres": [
		414
	],
	"./RateLimiterPostgres.js": [
		414
	],
	"./RateLimiterPrisma": [
		6930
	],
	"./RateLimiterPrisma.js": [
		6930
	],
	"./RateLimiterQueue": [
		2967
	],
	"./RateLimiterQueue.js": [
		2967
	],
	"./RateLimiterRedis": [
		6770
	],
	"./RateLimiterRedis.js": [
		6770
	],
	"./RateLimiterRes": [
		9975
	],
	"./RateLimiterRes.js": [
		9975
	],
	"./RateLimiterSQLite": [
		8901
	],
	"./RateLimiterSQLite.js": [
		8901
	],
	"./RateLimiterStoreAbstract": [
		5664
	],
	"./RateLimiterStoreAbstract.js": [
		5664
	],
	"./RateLimiterUnion": [
		5373
	],
	"./RateLimiterUnion.js": [
		5373
	],
	"./RateLimiterValkey": [
		9830
	],
	"./RateLimiterValkey.js": [
		9830
	],
	"./RateLimiterValkeyGlide": [
		2721
	],
	"./RateLimiterValkeyGlide.js": [
		2721
	],
	"./component/BlockedKeys": [
		7905
	],
	"./component/BlockedKeys/": [
		7905
	],
	"./component/BlockedKeys/BlockedKeys": [
		8733
	],
	"./component/BlockedKeys/BlockedKeys.js": [
		8733
	],
	"./component/BlockedKeys/index": [
		7905
	],
	"./component/BlockedKeys/index.js": [
		7905
	],
	"./component/MemoryStorage": [
		2398,
		398
	],
	"./component/MemoryStorage/": [
		2398,
		398
	],
	"./component/MemoryStorage/MemoryStorage": [
		7774
	],
	"./component/MemoryStorage/MemoryStorage.js": [
		7774
	],
	"./component/MemoryStorage/Record": [
		532
	],
	"./component/MemoryStorage/Record.js": [
		532
	],
	"./component/MemoryStorage/index": [
		2398,
		398
	],
	"./component/MemoryStorage/index.js": [
		2398,
		398
	],
	"./component/RateLimiterEtcdTransactionFailedError": [
		7854
	],
	"./component/RateLimiterEtcdTransactionFailedError.js": [
		7854
	],
	"./component/RateLimiterQueueError": [
		9636
	],
	"./component/RateLimiterQueueError.js": [
		9636
	],
	"./component/RateLimiterSetupError": [
		2653
	],
	"./component/RateLimiterSetupError.js": [
		2653
	],
	"./constants": [
		5467,
		467
	],
	"./constants.js": [
		5467,
		467
	]
};
function webpackAsyncContext(req) {
	if(!__nccwpck_require__.o(map, req)) {
		return Promise.resolve().then(() => {
			var e = new Error("Cannot find module '" + req + "'");
			e.code = 'MODULE_NOT_FOUND';
			throw e;
		});
	}

	var ids = map[req], id = ids[0];
	return Promise.all(ids.slice(1).map(__nccwpck_require__.e)).then(() => {
		return __nccwpck_require__.t(id, 7 | 16);
	});
}
webpackAsyncContext.keys = () => (Object.keys(map));
webpackAsyncContext.id = 7668;
module.exports = webpackAsyncContext;

/***/ }),

/***/ 5001:
/***/ ((module) => {

"use strict";
module.exports = require("cluster");

/***/ }),

/***/ 6113:
/***/ ((module) => {

"use strict";
module.exports = require("crypto");

/***/ }),

/***/ 3837:
/***/ ((module) => {

"use strict";
module.exports = require("util");

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __nccwpck_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		var threw = true;
/******/ 		try {
/******/ 			__webpack_modules__[moduleId](module, module.exports, __nccwpck_require__);
/******/ 			threw = false;
/******/ 		} finally {
/******/ 			if(threw) delete __webpack_module_cache__[moduleId];
/******/ 		}
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__nccwpck_require__.m = __webpack_modules__;
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/create fake namespace object */
/******/ 	(() => {
/******/ 		var getProto = Object.getPrototypeOf ? (obj) => (Object.getPrototypeOf(obj)) : (obj) => (obj.__proto__);
/******/ 		var leafPrototypes;
/******/ 		// create a fake namespace object
/******/ 		// mode & 1: value is a module id, require it
/******/ 		// mode & 2: merge all properties of value into the ns
/******/ 		// mode & 4: return value when already ns object
/******/ 		// mode & 16: return value when it's Promise-like
/******/ 		// mode & 8|1: behave like require
/******/ 		__nccwpck_require__.t = function(value, mode) {
/******/ 			if(mode & 1) value = this(value);
/******/ 			if(mode & 8) return value;
/******/ 			if(typeof value === 'object' && value) {
/******/ 				if((mode & 4) && value.__esModule) return value;
/******/ 				if((mode & 16) && typeof value.then === 'function') return value;
/******/ 			}
/******/ 			var ns = Object.create(null);
/******/ 			__nccwpck_require__.r(ns);
/******/ 			var def = {};
/******/ 			leafPrototypes = leafPrototypes || [null, getProto({}), getProto([]), getProto(getProto)];
/******/ 			for(var current = mode & 2 && value; typeof current == 'object' && !~leafPrototypes.indexOf(current); current = getProto(current)) {
/******/ 				Object.getOwnPropertyNames(current).forEach((key) => (def[key] = () => (value[key])));
/******/ 			}
/******/ 			def['default'] = () => (value);
/******/ 			__nccwpck_require__.d(ns, def);
/******/ 			return ns;
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/define property getters */
/******/ 	(() => {
/******/ 		// define getter functions for harmony exports
/******/ 		__nccwpck_require__.d = (exports, definition) => {
/******/ 			for(var key in definition) {
/******/ 				if(__nccwpck_require__.o(definition, key) && !__nccwpck_require__.o(exports, key)) {
/******/ 					Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 				}
/******/ 			}
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/ensure chunk */
/******/ 	(() => {
/******/ 		__nccwpck_require__.f = {};
/******/ 		// This file contains only the entry chunk.
/******/ 		// The chunk loading function for additional chunks
/******/ 		__nccwpck_require__.e = (chunkId) => {
/******/ 			return Promise.all(Object.keys(__nccwpck_require__.f).reduce((promises, key) => {
/******/ 				__nccwpck_require__.f[key](chunkId, promises);
/******/ 				return promises;
/******/ 			}, []));
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/get javascript chunk filename */
/******/ 	(() => {
/******/ 		// This function allow to reference async chunks
/******/ 		__nccwpck_require__.u = (chunkId) => {
/******/ 			// return url for filenames based on template
/******/ 			return "" + chunkId + ".index.js";
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/hasOwnProperty shorthand */
/******/ 	(() => {
/******/ 		__nccwpck_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/make namespace object */
/******/ 	(() => {
/******/ 		// define __esModule on exports
/******/ 		__nccwpck_require__.r = (exports) => {
/******/ 			if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 				Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 			}
/******/ 			Object.defineProperty(exports, '__esModule', { value: true });
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/compat */
/******/ 	
/******/ 	if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = __dirname + "/";
/******/ 	
/******/ 	/* webpack/runtime/require chunk loading */
/******/ 	(() => {
/******/ 		// no baseURI
/******/ 		
/******/ 		// object to store loaded chunks
/******/ 		// "1" means "loaded", otherwise not loaded yet
/******/ 		var installedChunks = {
/******/ 			179: 1
/******/ 		};
/******/ 		
/******/ 		// no on chunks loaded
/******/ 		
/******/ 		var installChunk = (chunk) => {
/******/ 			var moreModules = chunk.modules, chunkIds = chunk.ids, runtime = chunk.runtime;
/******/ 			for(var moduleId in moreModules) {
/******/ 				if(__nccwpck_require__.o(moreModules, moduleId)) {
/******/ 					__nccwpck_require__.m[moduleId] = moreModules[moduleId];
/******/ 				}
/******/ 			}
/******/ 			if(runtime) runtime(__nccwpck_require__);
/******/ 			for(var i = 0; i < chunkIds.length; i++)
/******/ 				installedChunks[chunkIds[i]] = 1;
/******/ 		
/******/ 		};
/******/ 		
/******/ 		// require() chunk loading for javascript
/******/ 		__nccwpck_require__.f.require = (chunkId, promises) => {
/******/ 			// "1" is the signal for "already loaded"
/******/ 			if(!installedChunks[chunkId]) {
/******/ 				if(true) { // all chunks have JS
/******/ 					installChunk(require("./" + __nccwpck_require__.u(chunkId)));
/******/ 				} else installedChunks[chunkId] = 1;
/******/ 			}
/******/ 		};
/******/ 		
/******/ 		// no external install chunk
/******/ 		
/******/ 		// no HMR
/******/ 		
/******/ 		// no HMR manifest
/******/ 	})();
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry need to be wrapped in an IIFE because it need to be in strict mode.
(() => {
"use strict";
// ESM COMPAT FLAG
__nccwpck_require__.r(__webpack_exports__);

// EXPORTS
__nccwpck_require__.d(__webpack_exports__, {
  "run": () => (/* binding */ run)
});

// NAMESPACE OBJECT: ./node_modules/@gitbeaker/core/dist/index.mjs
var core_dist_namespaceObject = {};
__nccwpck_require__.r(core_dist_namespaceObject);
__nccwpck_require__.d(core_dist_namespaceObject, {
  "AccessLevel": () => (AccessLevel),
  "Agents": () => (Agents),
  "AlertManagement": () => (AlertManagement),
  "ApplicationAppearance": () => (ApplicationAppearance),
  "ApplicationPlanLimits": () => (ApplicationPlanLimits),
  "ApplicationSettings": () => (ApplicationSettings),
  "ApplicationStatistics": () => (ApplicationStatistics),
  "Applications": () => (Applications),
  "AuditEvents": () => (AuditEvents),
  "Avatar": () => (Avatar),
  "Branches": () => (Branches),
  "BroadcastMessages": () => (BroadcastMessages),
  "CodeSuggestions": () => (CodeSuggestions),
  "CommitDiscussions": () => (CommitDiscussions),
  "Commits": () => (Commits),
  "Composer": () => (Composer),
  "Conan": () => (Conan),
  "ContainerRegistry": () => (ContainerRegistry),
  "DashboardAnnotations": () => (DashboardAnnotations),
  "Debian": () => (Debian),
  "DependencyProxy": () => (DependencyProxy),
  "DeployKeys": () => (DeployKeys),
  "DeployTokens": () => (DeployTokens),
  "Deployments": () => (Deployments),
  "DockerfileTemplates": () => (DockerfileTemplates),
  "Environments": () => (Environments),
  "EpicAwardEmojis": () => (EpicAwardEmojis),
  "EpicDiscussions": () => (EpicDiscussions),
  "EpicIssues": () => (EpicIssues),
  "EpicLabelEvents": () => (EpicLabelEvents),
  "EpicLinks": () => (EpicLinks),
  "EpicNotes": () => (EpicNotes),
  "Epics": () => (Epics),
  "ErrorTrackingClientKeys": () => (ErrorTrackingClientKeys),
  "ErrorTrackingSettings": () => (ErrorTrackingSettings),
  "Events": () => (Events),
  "Experiments": () => (Experiments),
  "ExternalStatusChecks": () => (ExternalStatusChecks),
  "FeatureFlagUserLists": () => (FeatureFlagUserLists),
  "FeatureFlags": () => (FeatureFlags),
  "FreezePeriods": () => (FreezePeriods),
  "GeoNodes": () => (GeoNodes),
  "GeoSites": () => (GeoSites),
  "GitLabCIYMLTemplates": () => (GitLabCIYMLTemplates),
  "GitignoreTemplates": () => (GitignoreTemplates),
  "Gitlab": () => (Gitlab),
  "GitlabPages": () => (GitlabPages),
  "GoProxy": () => (GoProxy),
  "GroupAccessRequests": () => (GroupAccessRequests),
  "GroupAccessTokens": () => (GroupAccessTokens),
  "GroupActivityAnalytics": () => (GroupActivityAnalytics),
  "GroupBadges": () => (GroupBadges),
  "GroupCustomAttributes": () => (GroupCustomAttributes),
  "GroupDORA4Metrics": () => (GroupDORA4Metrics),
  "GroupEpicBoards": () => (GroupEpicBoards),
  "GroupHooks": () => (GroupHooks),
  "GroupImportExports": () => (GroupImportExports),
  "GroupInvitations": () => (GroupInvitations),
  "GroupIssueBoards": () => (GroupIssueBoards),
  "GroupIterations": () => (GroupIterations),
  "GroupLDAPLinks": () => (GroupLDAPLinks),
  "GroupLabels": () => (GroupLabels),
  "GroupMarkdownUploads": () => (GroupMarkdownUploads),
  "GroupMemberRoles": () => (GroupMemberRoles),
  "GroupMembers": () => (GroupMembers),
  "GroupMilestones": () => (GroupMilestones),
  "GroupProtectedEnvironments": () => (GroupProtectedEnvironments),
  "GroupPushRules": () => (GroupPushRules),
  "GroupRelationExports": () => (GroupRelationExports),
  "GroupReleases": () => (GroupReleases),
  "GroupRepositoryStorageMoves": () => (GroupRepositoryStorageMoves),
  "GroupSAMLIdentities": () => (GroupSAMLIdentities),
  "GroupSAMLLinks": () => (GroupSAMLLinks),
  "GroupSCIMIdentities": () => (GroupSCIMIdentities),
  "GroupServiceAccounts": () => (GroupServiceAccounts),
  "GroupVariables": () => (GroupVariables),
  "GroupWikis": () => (GroupWikis),
  "Groups": () => (Groups),
  "Helm": () => (Helm),
  "Import": () => (Import),
  "InstanceLevelCICDVariables": () => (InstanceLevelCICDVariables),
  "Integrations": () => (Integrations),
  "IssueAwardEmojis": () => (IssueAwardEmojis),
  "IssueDiscussions": () => (IssueDiscussions),
  "IssueIterationEvents": () => (IssueIterationEvents),
  "IssueLabelEvents": () => (IssueLabelEvents),
  "IssueLinks": () => (IssueLinks),
  "IssueMilestoneEvents": () => (IssueMilestoneEvents),
  "IssueNoteAwardEmojis": () => (IssueNoteAwardEmojis),
  "IssueNotes": () => (IssueNotes),
  "IssueStateEvents": () => (IssueStateEvents),
  "IssueWeightEvents": () => (IssueWeightEvents),
  "Issues": () => (Issues),
  "IssuesStatistics": () => (IssuesStatistics),
  "JobArtifacts": () => (JobArtifacts),
  "Jobs": () => (Jobs),
  "Keys": () => (Keys),
  "License": () => (License),
  "LicenseTemplates": () => (LicenseTemplates),
  "LinkedEpics": () => (LinkedEpics),
  "Lint": () => (Lint),
  "Markdown": () => (Markdown),
  "Maven": () => (Maven),
  "MergeRequestApprovals": () => (MergeRequestApprovals),
  "MergeRequestAwardEmojis": () => (MergeRequestAwardEmojis),
  "MergeRequestContextCommits": () => (MergeRequestContextCommits),
  "MergeRequestDiscussions": () => (MergeRequestDiscussions),
  "MergeRequestDraftNotes": () => (MergeRequestDraftNotes),
  "MergeRequestLabelEvents": () => (MergeRequestLabelEvents),
  "MergeRequestMilestoneEvents": () => (MergeRequestMilestoneEvents),
  "MergeRequestNoteAwardEmojis": () => (MergeRequestNoteAwardEmojis),
  "MergeRequestNotes": () => (MergeRequestNotes),
  "MergeRequests": () => (MergeRequests),
  "MergeTrains": () => (MergeTrains),
  "Metadata": () => (Metadata),
  "Migrations": () => (Migrations),
  "NPM": () => (NPM),
  "Namespaces": () => (Namespaces),
  "NotificationSettings": () => (NotificationSettings),
  "NuGet": () => (NuGet),
  "PackageRegistry": () => (PackageRegistry),
  "Packages": () => (Packages),
  "PagesDomains": () => (PagesDomains),
  "PersonalAccessTokens": () => (PersonalAccessTokens),
  "PipelineScheduleVariables": () => (PipelineScheduleVariables),
  "PipelineSchedules": () => (PipelineSchedules),
  "PipelineTriggerTokens": () => (PipelineTriggerTokens),
  "Pipelines": () => (Pipelines),
  "ProductAnalytics": () => (ProductAnalytics),
  "ProjectAccessRequests": () => (ProjectAccessRequests),
  "ProjectAccessTokens": () => (ProjectAccessTokens),
  "ProjectAliases": () => (ProjectAliases),
  "ProjectBadges": () => (ProjectBadges),
  "ProjectCustomAttributes": () => (ProjectCustomAttributes),
  "ProjectDORA4Metrics": () => (ProjectDORA4Metrics),
  "ProjectHooks": () => (ProjectHooks),
  "ProjectImportExports": () => (ProjectImportExports),
  "ProjectInvitations": () => (ProjectInvitations),
  "ProjectIssueBoards": () => (ProjectIssueBoards),
  "ProjectIterations": () => (ProjectIterations),
  "ProjectJobTokenScopes": () => (ProjectJobTokenScopes),
  "ProjectLabels": () => (ProjectLabels),
  "ProjectMarkdownUploads": () => (ProjectMarkdownUploads),
  "ProjectMembers": () => (ProjectMembers),
  "ProjectMilestones": () => (ProjectMilestones),
  "ProjectProtectedEnvironments": () => (ProjectProtectedEnvironments),
  "ProjectPushRules": () => (ProjectPushRules),
  "ProjectRelationsExport": () => (ProjectRelationsExport),
  "ProjectReleases": () => (ProjectReleases),
  "ProjectRemoteMirrors": () => (ProjectRemoteMirrors),
  "ProjectRepositoryStorageMoves": () => (ProjectRepositoryStorageMoves),
  "ProjectSnippetAwardEmojis": () => (ProjectSnippetAwardEmojis),
  "ProjectSnippetDiscussions": () => (ProjectSnippetDiscussions),
  "ProjectSnippetNotes": () => (ProjectSnippetNotes),
  "ProjectSnippets": () => (ProjectSnippets),
  "ProjectStatistics": () => (ProjectStatistics),
  "ProjectTemplates": () => (ProjectTemplates),
  "ProjectTerraformState": () => (ProjectTerraformState),
  "ProjectVariables": () => (ProjectVariables),
  "ProjectVulnerabilities": () => (ProjectVulnerabilities),
  "ProjectWikis": () => (ProjectWikis),
  "Projects": () => (Projects),
  "ProtectedBranches": () => (ProtectedBranches),
  "ProtectedTags": () => (ProtectedTags),
  "PyPI": () => (PyPI),
  "ReleaseLinks": () => (ReleaseLinks),
  "Repositories": () => (Repositories),
  "RepositoryFiles": () => (RepositoryFiles),
  "RepositorySubmodules": () => (RepositorySubmodules),
  "ResourceGroups": () => (ResourceGroups),
  "RubyGems": () => (RubyGems),
  "Runners": () => (Runners),
  "Search": () => (Search),
  "SearchAdmin": () => (SearchAdmin),
  "SecureFiles": () => (SecureFiles),
  "ServiceAccounts": () => (ServiceAccounts),
  "ServiceData": () => (ServiceData),
  "SidekiqMetrics": () => (SidekiqMetrics),
  "SidekiqQueues": () => (SidekiqQueues),
  "SnippetRepositoryStorageMoves": () => (SnippetRepositoryStorageMoves),
  "Snippets": () => (Snippets),
  "Suggestions": () => (Suggestions),
  "SystemHooks": () => (SystemHooks),
  "Tags": () => (Tags),
  "TodoLists": () => (TodoLists),
  "Topics": () => (Topics),
  "UserCustomAttributes": () => (UserCustomAttributes),
  "UserEmails": () => (UserEmails),
  "UserGPGKeys": () => (UserGPGKeys),
  "UserImpersonationTokens": () => (UserImpersonationTokens),
  "UserSSHKeys": () => (UserSSHKeys),
  "UserStarredMetricsDashboard": () => (UserStarredMetricsDashboard),
  "Users": () => (Users)
});

;// CONCATENATED MODULE: external "fs"
const external_fs_namespaceObject = require("fs");
;// CONCATENATED MODULE: ./lib/platform/execution-context.js
/**
 * platform/execution-context.ts - 平台无关执行上下文（ARCH-001 / ARCH-002）
 *
 * 业务层（review.ts / commenter.ts / commands/** 等）只允许通过 ExecutionContext
 * 获取"这次运行是谁在哪个平台对哪个 PR/MR 做了什么"，不得直接 import
 * `@actions/github` 或读取 `process.env.GITHUB_EVENT_NAME` / `process.env.TRIGGER_PAYLOAD`。
 * 平台专有细节一律封装进 `raw`，仅供对应 adapter（GitHub adapter / GitLab adapter，
 * ARCH-016+ 任务）内部使用。
 *
 * 参考 docs/tasks/execution-context-design.md 第 3 节。
 */
/**
 * payload 缺失、格式错误或事件未知时抛出（ARCH-006 fail-closed）。
 *
 * `ignorable_event` 与 `unknown_event` 都应被调用方（gitlab-trigger.ts）当作
 * 优雅跳过（exit 0）处理，区别在于语义：`unknown_event` 是"完全不认识的
 * object_kind"，`ignorable_event` 是"认识这个事件类型，但结构合法且业务上
 * 明确不需要处理"（如 note 编辑/删除、system note、非 MR note，见 EVENT-016/017、
 * Issue #66）。拆分出独立 reason 是为了和真正的校验失败（`missing_required_field`，
 * 仍应 fail closed）区分开。
 */
class ExecutionContextError extends Error {
    platform;
    reason;
    constructor(message, platform, reason) {
        super(message);
        this.platform = platform;
        this.reason = reason;
        this.name = 'ExecutionContextError';
    }
}

;// CONCATENATED MODULE: ./lib/platform/gitlab-execution-context.js
/**
 * platform/gitlab-execution-context.ts - GitLab ExecutionContext 工厂（ARCH-004）
 *
 * ⚠️ 边界说明：GitLab trigger CLI 目前完全不存在（EVENT-001~005 尚未开始），
 * 本文件交付的是类型定义 + 从"已解析 payload 对象"构造 ExecutionContext 的纯函数，
 * 不包含读取 TRIGGER_PAYLOAD 文件、校验 project ID/HEAD SHA、CLI 入口本身——
 * 那些属于 EVENT-002/EVENT-003 任务，届时只需要"解析出 payload JSON 后调用
 * 本文件的函数"，不需要重新设计字段映射。
 *
 * `isBot` 恒为 false：GitLab MVP 使用个人 PAT 身份评论，没有天然的 bot 账号标记；
 * 真正的自反馈过滤需要将 actor.login 与配置好的 PAT 用户名比较（EVENT-018，
 * 见 `gitlab-note-hook-rules.ts` 的 `isSelfNote()`），故意不放进 ExecutionContext
 * 构造阶段判断——构造阶段不应依赖外部配置输入（呼应 ARCH-002 的字段设计边界）。
 *
 * GitLab Webhook 字段映射依据 GitLab 官方 Webhook events 文档整理，尚未经真实
 * Webhook 验证（ai-reviewer-test 项目尚未接入），EVENT-002 对接真实环境时需要
 * 用真实 payload 复核字段名，如有出入回填 docs/tasks/execution-context-design.md
 * 第 5.1 节。参考该文档第 5 节。
 */

/**
 * 输入为已由 EVENT-002 任务解析出的 GitLab webhook payload 对象
 * （对应 TRIGGER_PAYLOAD 文件反序列化后的 JSON）。本函数不做文件 IO。
 *
 * @throws {ExecutionContextError} payload 缺失/非对象、object_kind 不支持，或缺少必需字段时
 */
function createGitLabExecutionContext(payload) {
    if (payload == null || typeof payload !== 'object') {
        throw new ExecutionContextError('TRIGGER_PAYLOAD is empty or not an object', 'gitlab', 'missing_payload');
    }
    const p = payload;
    const kind = p.object_kind;
    if (kind === 'merge_request') {
        return buildFromMergeRequestHook(p);
    }
    if (kind === 'note') {
        return buildFromNoteHook(p);
    }
    throw new ExecutionContextError(`Unsupported GitLab object_kind: ${String(kind)}`, 'gitlab', 'unknown_event');
}
function buildFromMergeRequestHook(p) {
    const attrs = p.object_attributes;
    const project = p.project;
    if (attrs == null || project == null || attrs.iid == null) {
        throw new ExecutionContextError('merge_request payload missing object_attributes/project/iid', 'gitlab', 'missing_required_field');
    }
    const eventKind = mapMergeRequestAction(attrs, p.changes);
    return {
        platform: 'gitlab',
        projectPath: project.path_with_namespace,
        projectId: String(project.id),
        changeRequestId: attrs.iid,
        eventKind,
        actor: { login: p.user?.username ?? '', isBot: false },
        baseSha: attrs.oldrev ?? '',
        headSha: attrs.last_commit?.id ?? '',
        raw: p
    };
}
function buildFromNoteHook(p) {
    const attrs = p.object_attributes;
    const mr = p.merge_request;
    // 结构缺失：真正的校验失败，fail closed（区别于下面的 ignorable_event）
    if (attrs == null || mr == null) {
        throw new ExecutionContextError('note payload missing object_attributes/merge_request', 'gitlab', 'missing_required_field');
    }
    // 结构合法但业务上不需要处理：优雅跳过（EVENT-016/017，修复 Issue #66——
    // 此前这三种情形跟"字段真正缺失"共用 missing_required_field，导致
    // gitlab-trigger.ts 对编辑/删除评论等 fail closed 而非优雅跳过）
    if (attrs.action !== 'create') {
        throw new ExecutionContextError(`note action is '${attrs.action}', not 'create' — ignorable`, 'gitlab', 'ignorable_event');
    }
    if (attrs.system === true) {
        throw new ExecutionContextError('system note — ignorable', 'gitlab', 'ignorable_event');
    }
    if (attrs.noteable_type !== 'MergeRequest') {
        throw new ExecutionContextError(`noteable_type '${attrs.noteable_type}' is not MergeRequest — ignorable`, 'gitlab', 'ignorable_event');
    }
    return {
        platform: 'gitlab',
        projectPath: p.project?.path_with_namespace ?? '',
        projectId: String(p.project_id ?? p.project?.id ?? ''),
        changeRequestId: mr.iid,
        eventKind: attrs.discussion_id ? 'review_comment_created' : 'comment_created',
        actor: { login: p.user?.username ?? '', isBot: false },
        baseSha: '',
        headSha: mr.diff_head_sha ?? '',
        comment: {
            kind: attrs.discussion_id ? 'review_thread' : 'top_level',
            id: attrs.id,
            threadId: attrs.discussion_id
        },
        raw: p
    };
}
function mapMergeRequestAction(attrs, changes) {
    if (attrs.action === 'open')
        return 'pr_opened';
    if (attrs.action === 'reopen')
        return 'pr_reopened';
    if (attrs.action === 'update') {
        const headChanged = changes?.last_commit != null || changes?.source_branch != null;
        return headChanged ? 'pr_synchronize' : 'metadata_updated';
    }
    return 'unknown';
}

;// CONCATENATED MODULE: ./lib/platform/gitlab-logger.js
/**
 * platform/gitlab-logger.ts - GitLab CI Logger（ARCH-014）
 *
 * 输出到 stdout/stderr，不 import @actions/core（ARCH-015）。
 * GitLab CI job log 天然支持 ANSI 颜色，但 MVP 阶段只输出纯文本。
 */
class GitLabLogger {
    info(msg) {
        // eslint-disable-next-line no-console
        console.log(msg);
    }
    warning(msg) {
        // eslint-disable-next-line no-console
        console.warn(`[WARNING] ${msg}`);
    }
    error(msg) {
        // eslint-disable-next-line no-console
        console.error(`[ERROR] ${msg}`);
    }
    debug(msg) {
        if (process.env.AI_REVIEWER_DEBUG === 'true') {
            // eslint-disable-next-line no-console
            console.log(`[DEBUG] ${msg}`);
        }
    }
}

// EXTERNAL MODULE: ./node_modules/qs/lib/index.js
var lib = __nccwpck_require__(2760);
// EXTERNAL MODULE: ./node_modules/xcase/es5/index.js
var es5 = __nccwpck_require__(7020);
// EXTERNAL MODULE: ./node_modules/rate-limiter-flexible/index.js
var rate_limiter_flexible = __nccwpck_require__(1045);
// EXTERNAL MODULE: ./node_modules/picomatch-browser/index.js
var picomatch_browser = __nccwpck_require__(4274);
;// CONCATENATED MODULE: ./node_modules/@gitbeaker/requester-utils/dist/index.mjs





// src/RequesterUtils.ts
var { isMatch: isGlobMatch } = picomatch_browser;
function generateRateLimiterFn(limit, interval) {
  const limiter = new rate_limiter_flexible.RateLimiterQueue(
    new rate_limiter_flexible.RateLimiterMemory({ points: limit, duration: interval })
  );
  return () => limiter.removeTokens(1);
}
function formatQuery(params = {}) {
  const decamelized = (0,es5/* decamelizeKeys */.iF)(params);
  return (0,lib.stringify)(decamelized, { arrayFormat: "brackets" });
}
async function defaultOptionsHandler(resourceOptions, {
  body,
  searchParams,
  sudo,
  signal,
  asStream = false,
  method = "GET"
} = {}) {
  const { headers: preconfiguredHeaders, authHeaders, url, agent } = resourceOptions;
  const defaultOptions = {
    method,
    asStream,
    signal,
    prefixUrl: url,
    agent
  };
  defaultOptions.headers = { ...preconfiguredHeaders };
  if (sudo) defaultOptions.headers.sudo = `${sudo}`;
  if (body) {
    if (body instanceof FormData) {
      defaultOptions.body = body;
    } else {
      defaultOptions.body = JSON.stringify((0,es5/* decamelizeKeys */.iF)(body));
      defaultOptions.headers["content-type"] = "application/json";
    }
  }
  if (Object.keys(authHeaders).length > 0) {
    const [authHeaderKey, authHeaderFn] = Object.entries(authHeaders)[0];
    defaultOptions.headers[authHeaderKey] = await authHeaderFn();
  }
  const q = formatQuery(searchParams);
  if (q) defaultOptions.searchParams = q;
  return Promise.resolve(defaultOptions);
}
function createRateLimiters(rateLimitOptions = {}, rateLimitDuration = 60) {
  const rateLimiters = {};
  Object.entries(rateLimitOptions).forEach(([key, config]) => {
    if (typeof config === "number")
      rateLimiters[key] = generateRateLimiterFn(config, rateLimitDuration);
    else
      rateLimiters[key] = {
        method: config.method.toUpperCase(),
        limit: generateRateLimiterFn(config.limit, rateLimitDuration)
      };
  });
  return rateLimiters;
}
function createRequesterFn(optionsHandler, requestHandler) {
  const methods = ["get", "post", "put", "patch", "delete"];
  return (serviceOptions) => {
    const requester = {};
    const rateLimiters = createRateLimiters(
      serviceOptions.rateLimits,
      serviceOptions.rateLimitDuration
    );
    methods.forEach((m) => {
      requester[m] = async (endpoint, options) => {
        const defaultRequestOptions = await defaultOptionsHandler(serviceOptions, {
          ...options,
          method: m.toUpperCase()
        });
        const requestOptions = await optionsHandler(serviceOptions, defaultRequestOptions);
        return requestHandler(endpoint, { ...requestOptions, rateLimiters });
      };
    });
    return requester;
  };
}
function createPresetConstructor(Constructor, presetConfig) {
  return class extends Constructor {
    constructor(...args) {
      const [config, ...rest] = args;
      super({ ...presetConfig, ...config }, ...rest);
    }
  };
}
function presetResourceArguments(resources, customConfig = {}) {
  const result = {};
  Object.entries(resources).forEach(([key, Constructor]) => {
    if (typeof Constructor === "function") {
      result[key] = createPresetConstructor(
        Constructor,
        customConfig
      );
    } else {
      result[key] = Constructor;
    }
  });
  return result;
}
function getMatchingRateLimiter(endpoint, rateLimiters = {}, method = "GET") {
  const sortedEndpoints = Object.keys(rateLimiters).sort().reverse();
  const match = sortedEndpoints.find((ep) => isGlobMatch(endpoint, ep));
  const rateLimitConfig = match && rateLimiters[match];
  if (typeof rateLimitConfig === "function") return rateLimitConfig;
  if (rateLimitConfig && rateLimitConfig?.method?.toUpperCase() === method.toUpperCase()) {
    return rateLimitConfig.limit;
  }
  return generateRateLimiterFn(3e3, 60);
}

// src/BaseResource.ts
function getDynamicToken(tokenArgument) {
  return tokenArgument instanceof Function ? tokenArgument() : Promise.resolve(tokenArgument);
}
var DEFAULT_RATE_LIMITS = Object.freeze({
  // Default rate limit
  "**": 3e3,
  // Import/Export
  "projects/import": 6,
  "projects/*/export": 6,
  "projects/*/download": 1,
  "groups/import": 6,
  "groups/*/export": 6,
  "groups/*/download": 1,
  // Note creation
  "projects/*/issues/*/notes": {
    method: "post",
    limit: 300
  },
  "projects/*/snippets/*/notes": {
    method: "post",
    limit: 300
  },
  "projects/*/merge_requests/*/notes": {
    method: "post",
    limit: 300
  },
  "groups/*/epics/*/notes": {
    method: "post",
    limit: 300
  },
  // Repositories - get file archive
  "projects/*/repository/archive*": 5,
  // Project Jobs
  "projects/*/jobs": 600,
  // Member deletion
  "projects/*/members": 60,
  "groups/*/members": 60
});
var BaseResource = class {
  url;
  requester;
  queryTimeout;
  headers;
  authHeaders;
  camelize;
  constructor({
    sudo,
    profileToken,
    camelize,
    requesterFn,
    agent,
    profileMode = "execution",
    host = "https://gitlab.com",
    prefixUrl = "",
    queryTimeout = 3e5,
    rateLimitDuration = 60,
    rateLimits = DEFAULT_RATE_LIMITS,
    ...tokens
  }) {
    if (!requesterFn) throw new ReferenceError("requesterFn must be passed");
    this.url = [host, "api", "v4", prefixUrl].join("/");
    this.headers = {};
    this.authHeaders = {};
    this.camelize = camelize;
    this.queryTimeout = queryTimeout;
    if ("oauthToken" in tokens)
      this.authHeaders.authorization = async () => {
        const token = await getDynamicToken(tokens.oauthToken);
        return `Bearer ${token}`;
      };
    else if ("jobToken" in tokens)
      this.authHeaders["job-token"] = async () => getDynamicToken(tokens.jobToken);
    else if ("token" in tokens)
      this.authHeaders["private-token"] = async () => getDynamicToken(tokens.token);
    if (profileToken) {
      this.headers["X-Profile-Token"] = profileToken;
      this.headers["X-Profile-Mode"] = profileMode;
    }
    if (sudo) this.headers.Sudo = `${sudo}`;
    this.requester = requesterFn({ ...this, rateLimits, rateLimitDuration, agent });
  }
};

// src/GitbeakerError.ts
var GitbeakerRequestError = class extends Error {
  cause;
  constructor(message, options) {
    super(message, options);
    this.cause = options?.cause;
    this.name = "GitbeakerRequestError";
  }
};
var GitbeakerTimeoutError = class extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "GitbeakerTimeoutError";
  }
};
var GitbeakerRetryError = class extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "GitbeakerRetryError";
  }
};



;// CONCATENATED MODULE: ./node_modules/@gitbeaker/core/dist/index.mjs




// src/resources/Agents.ts
function appendFormFromObject(object) {
  const form = new FormData();
  Object.entries(object).forEach(([k, v]) => {
    if (v == null) return;
    if (Array.isArray(v)) form.append(k, v[0], v[1]);
    else form.append(k, v);
  });
  return form;
}
var RawPathSegment = class {
  value;
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
};
function endpoint(strings, ...values) {
  return values.reduce((result, value, index) => {
    const encodedValue = value instanceof RawPathSegment ? value.value : encodeURIComponent(String(value));
    return result + encodedValue + strings[index + 1];
  }, strings[0]);
}
function parseLinkHeader(linkString) {
  const output = {};
  const regex = /<([^>]+)>; rel="([^"]+)"/g;
  let m;
  while (m = regex.exec(linkString)) {
    const [, v, k] = m;
    output[k] = v;
  }
  return output;
}
function reformatObjectOptions(obj, prefixKey, decamelizeValues = false) {
  const formatted = decamelizeValues ? (0,es5/* decamelizeKeys */.iF)(obj) : obj;
  return lib.stringify({ [prefixKey]: formatted }, { encode: false }).split("&").reduce((acc, cur) => {
    const [key, val] = cur.split(/=(.*)/);
    acc[key] = val;
    return acc;
  }, {});
}
function packageResponse(response, showExpanded) {
  return showExpanded ? {
    data: response.body,
    status: response.status,
    headers: response.headers
  } : response.body;
}
function getStream(response, showExpanded) {
  return packageResponse(response, showExpanded);
}
function getSingle(camelize, response, showExpanded) {
  const { status, headers } = response;
  let { body } = response;
  if (camelize) body = (0,es5/* camelizeKeys */.k5)(body);
  return packageResponse({ body, status, headers }, showExpanded);
}
async function getManyMore(camelize, getFn, endpoint2, response, requestOptions, acc) {
  const { sudo, showExpanded, maxPages, pagination, page, perPage, idAfter, orderBy, sort } = requestOptions;
  if (camelize) response.body = (0,es5/* camelizeKeys */.k5)(response?.body);
  const newAcc = [...acc || [], ...response.body];
  const withinBounds = maxPages && perPage ? newAcc.length / +perPage < maxPages : true;
  const { next = "" } = parseLinkHeader(response.headers.link);
  if (!(page && (acc || []).length === 0) && next && withinBounds) {
    const parsedQueryString = (0,lib.parse)(next.split("?")[1]);
    const qs = { ...(0,es5/* camelizeKeys */.k5)(parsedQueryString) };
    const newOpts = {
      ...qs,
      maxPages,
      sudo,
      showExpanded
    };
    const nextResponse = await getFn(endpoint2, {
      searchParams: qs,
      sudo
    });
    return getManyMore(camelize, getFn, endpoint2, nextResponse, newOpts, newAcc);
  }
  if (!showExpanded) return newAcc;
  const paginationInfo = pagination === "keyset" ? {
    idAfter: idAfter ? +idAfter : null,
    perPage: perPage ? +perPage : null,
    orderBy,
    sort
  } : {
    total: parseInt(response.headers["x-total"], 10),
    next: parseInt(response.headers["x-next-page"], 10) || null,
    current: parseInt(response.headers["x-page"], 10) || 1,
    previous: parseInt(response.headers["x-prev-page"], 10) || null,
    perPage: parseInt(response.headers["x-per-page"], 10),
    totalPages: parseInt(response.headers["x-total-pages"], 10)
  };
  return {
    data: newAcc,
    paginationInfo
  };
}
function get() {
  return async (service, endpoint2, options) => {
    const { asStream, sudo, showExpanded, maxPages, ...searchParams } = options || {};
    const signal = service.queryTimeout ? AbortSignal.timeout(service.queryTimeout) : void 0;
    const response = await service.requester.get(endpoint2, {
      searchParams,
      sudo,
      asStream,
      signal
    });
    const camelizeResponseBody = service.camelize || false;
    if (asStream) return getStream(response, showExpanded);
    if (!Array.isArray(response.body))
      return getSingle(
        camelizeResponseBody,
        response,
        showExpanded
      );
    const reqOpts = {
      sudo,
      showExpanded,
      maxPages,
      ...searchParams
    };
    return getManyMore(
      camelizeResponseBody,
      (ep, op) => service.requester.get(ep, { ...op, signal }),
      endpoint2,
      response,
      reqOpts
    );
  };
}
function post() {
  return async (service, endpoint2, { searchParams, isForm, sudo, showExpanded, ...options } = {}) => {
    const body = isForm ? appendFormFromObject(options) : options;
    const response = await service.requester.post(endpoint2, {
      searchParams,
      body,
      sudo,
      signal: service.queryTimeout ? AbortSignal.timeout(service.queryTimeout) : void 0
    });
    if (service.camelize) response.body = (0,es5/* camelizeKeys */.k5)(response.body);
    return packageResponse(response, showExpanded);
  };
}
function put() {
  return async (service, endpoint2, { searchParams, isForm, sudo, showExpanded, ...options } = {}) => {
    const body = isForm ? appendFormFromObject(options) : options;
    const response = await service.requester.put(endpoint2, {
      body,
      searchParams,
      sudo,
      signal: service.queryTimeout ? AbortSignal.timeout(service.queryTimeout) : void 0
    });
    if (service.camelize) response.body = (0,es5/* camelizeKeys */.k5)(response.body);
    return packageResponse(response, showExpanded);
  };
}
function patch() {
  return async (service, endpoint2, { searchParams, isForm, sudo, showExpanded, ...options } = {}) => {
    const body = isForm ? appendFormFromObject(options) : options;
    const response = await service.requester.patch(endpoint2, {
      body,
      searchParams,
      sudo,
      signal: service.queryTimeout ? AbortSignal.timeout(service.queryTimeout) : void 0
    });
    if (service.camelize) response.body = (0,es5/* camelizeKeys */.k5)(response.body);
    return packageResponse(response, showExpanded);
  };
}
function del() {
  return async (service, endpoint2, { sudo, showExpanded, searchParams, ...options } = {}) => {
    const response = await service.requester.delete(endpoint2, {
      body: options,
      searchParams,
      sudo,
      signal: service.queryTimeout ? AbortSignal.timeout(service.queryTimeout) : void 0
    });
    return packageResponse(response, showExpanded);
  };
}
var RequestHelper = {
  post,
  put,
  patch,
  get,
  del
};

// src/resources/Agents.ts
var Agents = class extends BaseResource {
  all(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/cluster_agents`,
      options
    );
  }
  allTokens(projectId, agentId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/cluster_agents/${agentId}/tokens`,
      options
    );
  }
  createToken(projectId, agentId, name, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/cluster_agents/${agentId}/tokens`,
      {
        name,
        ...options
      }
    );
  }
  show(projectId, agentId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/cluster_agents/${agentId}`,
      options
    );
  }
  showToken(projectId, agentId, tokenId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/cluster_agents/${agentId}/tokens/${tokenId}`,
      options
    );
  }
  register(projectId, name, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/cluster_agents`,
      {
        name,
        ...options
      }
    );
  }
  removeToken(projectId, agentId, tokenId, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/cluster_agents/${agentId}/tokens/${tokenId}`,
      options
    );
  }
  unregister(projectId, agentId, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/cluster_agents/${agentId}`,
      options
    );
  }
};
var AlertManagement = class extends BaseResource {
  allMetricImages(projectId, alertIId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/alert_management_alerts/${alertIId}/metric_images`,
      options
    );
  }
  editMetricImage(projectId, alertIId, imageId, options) {
    return RequestHelper.put()(
      this,
      endpoint`projects/${projectId}/alert_management_alerts/${alertIId}/metric_images/${imageId}`,
      options
    );
  }
  removeMetricImage(projectId, alertIId, imageId, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/alert_management_alerts/${alertIId}/metric_images/${imageId}`,
      options
    );
  }
  uploadMetricImage(projectId, alertIId, metricImage, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/alert_management_alerts/${alertIId}/metric_images`,
      {
        isForm: true,
        file: [metricImage.content, metricImage.filename],
        ...options
      }
    );
  }
};
var ApplicationAppearance = class extends BaseResource {
  show(options) {
    return RequestHelper.get()(
      this,
      "application/appearence",
      options
    );
  }
  edit({
    logo,
    pwaIcon,
    ...options
  } = {}) {
    if (logo || pwaIcon) {
      const opts = {
        ...options,
        isForm: true
      };
      if (logo) opts.logo = [logo.content, logo.filename];
      if (pwaIcon) opts.pwaIcon = [pwaIcon.content, pwaIcon.filename];
      return RequestHelper.put()(this, "application/appearence", opts);
    }
    return RequestHelper.put()(
      this,
      "application/appearence",
      options
    );
  }
};
var ApplicationPlanLimits = class extends BaseResource {
  show(options) {
    return RequestHelper.get()(
      this,
      "application/plan_limits",
      options
    );
  }
  edit(planName, options = {}) {
    const {
      ciPipelineSize,
      ciActiveJobs,
      ciActivePipelines,
      ciProjectSubscriptions,
      ciPipelineSchedules,
      ciNeedsSizeLimit,
      ciRegisteredGroupRunners,
      ciRegisteredProjectRunners,
      conanMaxFileSize,
      genericPackagesMaxFileSize,
      helmMaxFileSize,
      mavenMaxFileSize,
      npmMaxFileSize,
      nugetMaxFileSize,
      pypiMaxFileSize,
      terraformModuleMaxFileSize,
      storageSizeLimit,
      ...opts
    } = options;
    return RequestHelper.put()(this, "application/plan_limits", {
      ...opts,
      searchParams: {
        planName,
        ciPipelineSize,
        ciActiveJobs,
        ciActivePipelines,
        ciProjectSubscriptions,
        ciPipelineSchedules,
        ciNeedsSizeLimit,
        ciRegisteredGroupRunners,
        ciRegisteredProjectRunners,
        conanMaxFileSize,
        genericPackagesMaxFileSize,
        helmMaxFileSize,
        mavenMaxFileSize,
        npmMaxFileSize,
        nugetMaxFileSize,
        pypiMaxFileSize,
        terraformModuleMaxFileSize,
        storageSizeLimit
      }
    });
  }
};
var ApplicationSettings = class extends BaseResource {
  show(options) {
    return RequestHelper.get()(this, "application/settings", options);
  }
  edit(options) {
    return RequestHelper.put()(this, "application/settings", options);
  }
};
var ApplicationStatistics = class extends BaseResource {
  show(options) {
    return RequestHelper.get()(this, "application/statistics", options);
  }
};
var Applications = class extends BaseResource {
  all(options) {
    return RequestHelper.get()(this, "applications", options);
  }
  create(name, redirectUri, scopes, options) {
    return RequestHelper.post()(this, "applications", {
      name,
      redirectUri,
      scopes,
      ...options
    });
  }
  remove(applicationId, options) {
    return RequestHelper.del()(this, `applications/${applicationId}`, options);
  }
};
function url({
  projectId,
  groupId
} = {}) {
  let prefix = "";
  if (projectId) prefix = endpoint`projects/${projectId}/`;
  else if (groupId) prefix = endpoint`groups/${groupId}/`;
  return `${prefix}audit_events`;
}
var AuditEvents = class extends BaseResource {
  all({
    projectId,
    groupId,
    ...options
  } = {}) {
    const uri = url({ projectId, groupId });
    return RequestHelper.get()(
      this,
      uri,
      options
    );
  }
  show(auditEventId, {
    projectId,
    groupId,
    ...options
  } = {}) {
    const uri = url({ projectId, groupId });
    return RequestHelper.get()(this, `${uri}/${auditEventId}`, options);
  }
};
var Avatar = class extends BaseResource {
  show(email, options) {
    return RequestHelper.get()(this, "avatar", { email, ...options });
  }
};
var BroadcastMessages = class extends BaseResource {
  all(options) {
    return RequestHelper.get()(this, "broadcast_messages", options);
  }
  create(options) {
    return RequestHelper.post()(this, "broadcast_messages", options);
  }
  edit(broadcastMessageId, options) {
    return RequestHelper.put()(
      this,
      `broadcast_messages/${broadcastMessageId}`,
      options
    );
  }
  remove(broadcastMessageId, options) {
    return RequestHelper.del()(this, `broadcast_messages/${broadcastMessageId}`, options);
  }
  show(broadcastMessageId, options) {
    return RequestHelper.get()(
      this,
      `broadcast_messages/${broadcastMessageId}`,
      options
    );
  }
};
var CodeSuggestions = class extends BaseResource {
  createAccessToken(options) {
    return RequestHelper.post()(this, "code_suggestions/tokens", options);
  }
  generateCompletion(options) {
    return RequestHelper.post()(
      this,
      "code_suggestions/completions",
      options
    );
  }
};
var Composer = class extends BaseResource {
  create(projectId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/packages/composer`,
      options
    );
  }
  download(projectId, packageName, sha, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/packages/composer/archives/${packageName}`,
      {
        searchParams: { sha },
        ...options
      }
    );
  }
  showMetadata(groupId, packageName, options) {
    let url12;
    if (options && options.sha) {
      url12 = endpoint`groups/${groupId}/-/packages/composer/${packageName}$${options.sha}`;
    } else {
      url12 = endpoint`groups/${groupId}/-/packages/composer/p2/${packageName}`;
    }
    return RequestHelper.get()(this, url12, options);
  }
  showPackages(groupId, sha, options) {
    return RequestHelper.get()(
      this,
      endpoint`groups/${groupId}/-/packages/composer/p/${sha}`,
      options
    );
  }
  showBaseRepository(groupId, options) {
    const clonedService = { ...this };
    if (options && options.composerVersion === "2") {
      clonedService.headers["User-Agent"] = "Composer/2";
    }
    return RequestHelper.get()(
      clonedService,
      endpoint`groups/${groupId}/-/packages/composer/packages`,
      options
    );
  }
};
function url2(projectId) {
  return projectId ? endpoint`projects/${projectId}/packages/conan/v1` : "packages/conan/v1";
}
var Conan = class extends BaseResource {
  authenticate({
    projectId,
    ...options
  } = {}) {
    return RequestHelper.get()(this, `${url2(projectId)}/users/authenticate`, options);
  }
  checkCredentials({
    projectId,
    ...options
  } = {}) {
    const prefix = url2(projectId);
    return RequestHelper.get()(this, `${prefix}/users/check_credentials`, options);
  }
  downloadPackageFile(packageName, packageVersion, packageUsername, packageChannel, conanPackageReference, recipeRevision, packageRevision, filename, { projectId, ...options } = {}) {
    const prefix = url2(projectId);
    return RequestHelper.get()(
      this,
      `${prefix}/conans/${packageName}/${packageVersion}/${packageUsername}/${packageChannel}/${recipeRevision}/package/${conanPackageReference}/${packageRevision}/${filename}`,
      options
    );
  }
  downloadRecipeFile(packageName, packageVersion, packageUsername, packageChannel, recipeRevision, filename, { projectId, ...options } = {}) {
    const prefix = url2(projectId);
    return RequestHelper.get()(
      this,
      `${prefix}/conans/${packageName}/${packageVersion}/${packageUsername}/${packageChannel}/${recipeRevision}/export/${filename}`,
      options
    );
  }
  showPackageUploadUrls(packageName, packageVersion, packageUsername, packageChannel, conanPackageReference, { projectId, ...options } = {}) {
    const prefix = url2(projectId);
    return RequestHelper.get()(
      this,
      `${prefix}/conans/${packageName}/${packageVersion}/${packageUsername}/${packageChannel}/packages/${conanPackageReference}/upload_urls`,
      options
    );
  }
  showPackageDownloadUrls(packageName, packageVersion, packageUsername, packageChannel, conanPackageReference, { projectId, ...options } = {}) {
    const prefix = url2(projectId);
    return RequestHelper.get()(
      this,
      `${prefix}/conans/${packageName}/${packageVersion}/${packageUsername}/${packageChannel}/packages/${conanPackageReference}/download_urls`,
      options
    );
  }
  showPackageManifest(packageName, packageVersion, packageUsername, packageChannel, conanPackageReference, { projectId, ...options } = {}) {
    const prefix = url2(projectId);
    return RequestHelper.get()(
      this,
      `${prefix}/conans/${packageName}/${packageVersion}/${packageUsername}/${packageChannel}/packages/${conanPackageReference}/digest`,
      options
    );
  }
  showPackageSnapshot(packageName, packageVersion, packageUsername, packageChannel, conanPackageReference, { projectId, ...options } = {}) {
    const prefix = url2(projectId);
    return RequestHelper.get()(
      this,
      `${prefix}/conans/${packageName}/${packageVersion}/${packageUsername}/${packageChannel}/packages/${conanPackageReference}`,
      options
    );
  }
  ping({
    projectId,
    ...options
  } = {}) {
    return RequestHelper.post()(this, `${url2(projectId)}/ping`, options);
  }
  showRecipeUploadUrls(packageName, packageVersion, packageUsername, packageChannel, { projectId, ...options } = {}) {
    const prefix = url2(projectId);
    return RequestHelper.get()(
      this,
      `${prefix}/conans/${packageName}/${packageVersion}/${packageUsername}/${packageChannel}/upload_urls`,
      options
    );
  }
  showRecipeDownloadUrls(packageName, packageVersion, packageUsername, packageChannel, { projectId, ...options } = {}) {
    const prefix = url2(projectId);
    return RequestHelper.get()(
      this,
      `${prefix}/conans/${packageName}/${packageVersion}/${packageUsername}/${packageChannel}/download_urls`,
      options
    );
  }
  showRecipeManifest(packageName, packageVersion, packageUsername, packageChannel, { projectId, ...options } = {}) {
    const prefix = url2(projectId);
    return RequestHelper.get()(
      this,
      `${prefix}/conans/${packageName}/${packageVersion}/${packageUsername}/${packageChannel}/digest`,
      options
    );
  }
  showRecipeSnapshot(packageName, packageVersion, packageUsername, packageChannel, { projectId, ...options } = {}) {
    const prefix = url2(projectId);
    return RequestHelper.get()(
      this,
      `${prefix}/conans/${packageName}/${packageVersion}/${packageUsername}/${packageChannel}`,
      options
    );
  }
  removePackageFile(packageName, packageVersion, packageUsername, packageChannel, { projectId, ...options } = {}) {
    const prefix = url2(projectId);
    return RequestHelper.get()(
      this,
      `${prefix}/conans/${packageName}/${packageVersion}/${packageUsername}/${packageChannel}`,
      options
    );
  }
  search({
    projectId,
    ...options
  } = {}) {
    const prefix = url2(projectId);
    return RequestHelper.get()(this, `${prefix}/conans/search`, options);
  }
  uploadPackageFile(packageFile, packageName, packageVersion, packageUsername, packageChannel, conanPackageReference, recipeRevision, packageRevision, options) {
    const prefix = url2();
    return RequestHelper.get()(
      this,
      `${prefix}/files/${packageName}/${packageVersion}/${packageUsername}/${packageChannel}/${recipeRevision}/package/${conanPackageReference}/${packageRevision}/${packageFile.filename}`,
      {
        isForm: true,
        ...options,
        file: [packageFile.content, packageFile.filename]
      }
    );
  }
  uploadRecipeFile(packageFile, packageName, packageVersion, packageUsername, packageChannel, recipeRevision, options) {
    const prefix = url2();
    return RequestHelper.get()(
      this,
      `${prefix}/files/${packageName}/${packageVersion}/${packageUsername}/${packageChannel}/${recipeRevision}/export/${packageFile.filename}`,
      {
        isForm: true,
        ...options,
        file: [packageFile.content, packageFile.filename]
      }
    );
  }
};
var DashboardAnnotations = class extends BaseResource {
  create(dashboardPath, startingAt, description, {
    environmentId,
    clusterId,
    ...options
  } = {}) {
    let url12;
    if (environmentId) url12 = endpoint`environments/${environmentId}/metrics_dashboard/annotations`;
    else if (clusterId) url12 = endpoint`clusters/${clusterId}/metrics_dashboard/annotations`;
    else
      throw new Error(
        "Missing required argument. Please supply a environmentId or a cluserId in the options parameter."
      );
    return RequestHelper.post()(this, url12, {
      dashboardPath,
      startingAt,
      description,
      ...options
    });
  }
};
function url3({
  projectId,
  groupId
} = {}) {
  if (projectId) return endpoint`/projects/${projectId}/packages/debian`;
  if (groupId) return endpoint`/groups/${groupId}/-/packages/debian`;
  throw new Error(
    "Missing required argument. Please supply a projectId or a groupId in the options parameter"
  );
}
var Debian = class extends BaseResource {
  downloadBinaryFileIndex(distribution, component, architecture, {
    projectId,
    groupId,
    ...options
  }) {
    const prefix = url3({
      projectId,
      groupId
    });
    return RequestHelper.get()(
      this,
      `${prefix}/dists/${distribution}/${component}/binary-${architecture}/Packages`,
      options
    );
  }
  downloadDistributionReleaseFile(distribution, {
    projectId,
    groupId,
    ...options
  }) {
    const prefix = url3({
      projectId,
      groupId
    });
    return RequestHelper.get()(
      this,
      `${prefix}/dists/${distribution}/Release`,
      options
    );
  }
  downloadSignedDistributionReleaseFile(distribution, {
    projectId,
    groupId,
    ...options
  }) {
    const prefix = url3({
      projectId,
      groupId
    });
    return RequestHelper.get()(
      this,
      `${prefix}/dists/${distribution}/InRelease`,
      options
    );
  }
  downloadReleaseFileSignature(distribution, {
    projectId,
    groupId,
    ...options
  }) {
    const prefix = url3({
      projectId,
      groupId
    });
    return RequestHelper.get()(
      this,
      `${prefix}/dists/${distribution}/Release.gpg`,
      options
    );
  }
  downloadPackageFile(projectId, distribution, letter, packageName, packageVersion, filename, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/packages/debian/pool/${distribution}/${letter}/${packageName}/${packageVersion}/${filename}`,
      options
    );
  }
  uploadPackageFile(projectId, packageFile, options) {
    return RequestHelper.put()(
      this,
      endpoint`projects/${projectId}/packages/debian/${packageFile.filename}`,
      {
        isForm: true,
        ...options,
        file: [packageFile.content, packageFile.filename]
      }
    );
  }
};
var DependencyProxy = class extends BaseResource {
  remove(groupId, options) {
    return RequestHelper.post()(this, `groups/${groupId}/dependency_proxy/cache`, options);
  }
};
var DeployKeys = class extends BaseResource {
  all({
    projectId,
    userId,
    ...options
  } = {}) {
    let url12;
    if (projectId) {
      url12 = endpoint`projects/${projectId}/deploy_keys`;
    } else if (userId) {
      url12 = endpoint`users/${userId}/project_deploy_keys`;
    } else {
      url12 = "deploy_keys";
    }
    return RequestHelper.get()(this, url12, options);
  }
  create(projectId, title, key, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/deploy_keys`,
      {
        title,
        key,
        ...options
      }
    );
  }
  edit(projectId, keyId, options) {
    return RequestHelper.put()(
      this,
      endpoint`projects/${projectId}/deploy_keys/${keyId}`,
      options
    );
  }
  enable(projectId, keyId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/deploy_keys/${keyId}/enable`,
      options
    );
  }
  remove(projectId, keyId, options) {
    return RequestHelper.del()(this, endpoint`projects/${projectId}/deploy_keys/${keyId}`, options);
  }
  show(projectId, keyId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/deploy_keys/${keyId}`,
      options
    );
  }
};
var DeployTokens = class extends BaseResource {
  all({
    projectId,
    groupId,
    ...options
  } = {}) {
    let url12;
    if (projectId) url12 = endpoint`projects/${projectId}/deploy_tokens`;
    else if (groupId) url12 = endpoint`groups/${groupId}/deploy_tokens`;
    else url12 = "deploy_tokens";
    return RequestHelper.get()(this, url12, options);
  }
  create(name, scopes, {
    projectId,
    groupId,
    ...options
  } = {}) {
    let url12;
    if (projectId) url12 = endpoint`projects/${projectId}/deploy_tokens`;
    else if (groupId) url12 = endpoint`groups/${groupId}/deploy_tokens`;
    else {
      throw new Error(
        "Missing required argument. Please supply a projectId or a groupId in the options parameter."
      );
    }
    return RequestHelper.post()(this, url12, {
      name,
      scopes,
      ...options
    });
  }
  remove(tokenId, {
    projectId,
    groupId,
    ...options
  } = {}) {
    let url12;
    if (projectId) url12 = endpoint`projects/${projectId}/deploy_tokens/${tokenId}`;
    else if (groupId) url12 = endpoint`groups/${groupId}/deploy_tokens/${tokenId}`;
    else {
      throw new Error(
        "Missing required argument. Please supply a projectId or a groupId in the options parameter."
      );
    }
    return RequestHelper.del()(this, url12, options);
  }
  show(tokenId, {
    projectId,
    groupId,
    ...options
  } = {}) {
    let url12;
    if (projectId) url12 = endpoint`projects/${projectId}/deploy_tokens/${tokenId}`;
    else if (groupId) url12 = endpoint`groups/${groupId}/deploy_tokens/${tokenId}`;
    else {
      throw new Error(
        "Missing required argument. Please supply a projectId or a groupId in the options parameter."
      );
    }
    return RequestHelper.get()(
      this,
      url12,
      options
    );
  }
};
var ResourceAccessRequests = class extends BaseResource {
  constructor(resourceType, options) {
    super({ prefixUrl: resourceType, ...options });
  }
  all(resourceId, options) {
    return RequestHelper.get()(
      this,
      endpoint`${resourceId}/access_requests`,
      options
    );
  }
  request(resourceId, options) {
    return RequestHelper.post()(
      this,
      endpoint`${resourceId}/access_requests`,
      options
    );
  }
  approve(resourceId, userId, options) {
    return RequestHelper.put()(
      this,
      endpoint`${resourceId}/access_requests/${userId}/approve`,
      options
    );
  }
  deny(resourceId, userId, options) {
    return RequestHelper.del()(this, endpoint`${resourceId}/access_requests/${userId}`, options);
  }
};
var ResourceAccessTokens = class extends BaseResource {
  constructor(resourceType, options) {
    super({ prefixUrl: resourceType, ...options });
  }
  all(resourceId, options) {
    return RequestHelper.get()(
      this,
      endpoint`${resourceId}/access_tokens`,
      options
    );
  }
  create(resourceId, name, scopes, expiresAt, options) {
    return RequestHelper.post()(
      this,
      endpoint`${resourceId}/access_tokens`,
      {
        name,
        scopes,
        expiresAt,
        ...options
      }
    );
  }
  revoke(resourceId, tokenId, options) {
    return RequestHelper.del()(this, endpoint`${resourceId}/access_tokens/${tokenId}`, options);
  }
  rotate(resourceId, tokenId, options) {
    return RequestHelper.post()(
      this,
      endpoint`${resourceId}/access_tokens/${tokenId}/rotate`,
      options
    );
  }
  show(resourceId, tokenId, options) {
    return RequestHelper.get()(
      this,
      endpoint`${resourceId}/access_tokens/${tokenId}`,
      options
    );
  }
};
function url4(resourceId, resourceType2, resourceId2, awardId) {
  const [rId, rId2] = [resourceId, resourceId2].map(encodeURIComponent);
  const output = [rId, resourceType2, rId2];
  output.push("award_emoji");
  if (awardId) output.push(awardId);
  return output.join("/");
}
var ResourceAwardEmojis = class extends BaseResource {
  resourceType2;
  constructor(resourceType1, resourceType2, options) {
    super({ prefixUrl: resourceType1, ...options });
    this.resourceType2 = resourceType2;
  }
  all(resourceId, resourceIId, options) {
    return RequestHelper.get()(
      this,
      url4(resourceId, this.resourceType2, resourceIId),
      options
    );
  }
  award(resourceId, resourceIId, name, options) {
    return RequestHelper.post()(
      this,
      url4(resourceId, this.resourceType2, resourceIId),
      {
        name,
        ...options
      }
    );
  }
  remove(resourceId, resourceIId, awardId, options) {
    return RequestHelper.del()(
      this,
      url4(resourceId, this.resourceType2, resourceIId, awardId),
      options
    );
  }
  show(resourceId, resourceIId, awardId, options) {
    return RequestHelper.get()(
      this,
      url4(resourceId, this.resourceType2, resourceIId, awardId),
      options
    );
  }
};
function url5(resourceId, resourceType2, resourceId2, noteId, awardId) {
  const [rId, rId2] = [resourceId, resourceId2].map(encodeURIComponent);
  const output = [rId, resourceType2, rId2];
  output.push("notes");
  output.push(noteId);
  output.push("award_emoji");
  if (awardId) output.push(awardId);
  return output.join("/");
}
var ResourceNoteAwardEmojis = class extends BaseResource {
  resourceType;
  constructor(resourceType, options) {
    super({ prefixUrl: "projects", ...options });
    this.resourceType = resourceType;
  }
  all(projectId, resourceIId, noteId, options) {
    return RequestHelper.get()(
      this,
      url5(projectId, this.resourceType, resourceIId, noteId),
      options
    );
  }
  award(projectId, resourceIId, noteId, name, options) {
    return RequestHelper.post()(
      this,
      url5(projectId, this.resourceType, resourceIId, noteId),
      {
        name,
        ...options
      }
    );
  }
  remove(projectId, resourceIId, noteId, awardId, options) {
    return RequestHelper.del()(
      this,
      url5(projectId, this.resourceType, resourceIId, noteId, awardId),
      options
    );
  }
  show(projectId, resourceIId, noteId, awardId, options) {
    return RequestHelper.get()(
      this,
      url5(projectId, this.resourceType, resourceIId, noteId, awardId),
      options
    );
  }
};
var ResourceBadges = class extends BaseResource {
  constructor(resourceType, options) {
    super({ prefixUrl: resourceType, ...options });
  }
  add(resourceId, linkUrl, imageUrl, options) {
    return RequestHelper.post()(this, endpoint`${resourceId}/badges`, {
      linkUrl,
      imageUrl,
      ...options
    });
  }
  all(resourceId, options) {
    return RequestHelper.get()(this, endpoint`${resourceId}/badges`, options);
  }
  edit(resourceId, badgeId, options) {
    return RequestHelper.put()(
      this,
      endpoint`${resourceId}/badges/${badgeId}`,
      options
    );
  }
  preview(resourceId, linkUrl, imageUrl, options) {
    return RequestHelper.get()(this, endpoint`${resourceId}/badges/render`, {
      linkUrl,
      imageUrl,
      ...options
    });
  }
  remove(resourceId, badgeId, options) {
    return RequestHelper.del()(this, endpoint`${resourceId}/badges/${badgeId}`, options);
  }
  show(resourceId, badgeId, options) {
    return RequestHelper.get()(
      this,
      endpoint`${resourceId}/badges/${badgeId}`,
      options
    );
  }
};
var ResourceCustomAttributes = class extends BaseResource {
  constructor(resourceType, options) {
    super({ prefixUrl: resourceType, ...options });
  }
  all(resourceId, options) {
    return RequestHelper.get()(
      this,
      endpoint`${resourceId}/custom_attributes`,
      options
    );
  }
  remove(resourceId, customAttributeId, options) {
    return RequestHelper.del()(
      this,
      endpoint`${resourceId}/custom_attributes/${customAttributeId}`,
      options
    );
  }
  set(resourceId, customAttributeId, value, options) {
    return RequestHelper.put()(
      this,
      endpoint`${resourceId}/custom_attributes/${customAttributeId}`,
      {
        value,
        ...options
      }
    );
  }
  show(resourceId, customAttributeId, options) {
    return RequestHelper.get()(
      this,
      endpoint`${resourceId}/custom_attributes/${customAttributeId}`,
      options
    );
  }
};
var ResourceDORA4Metrics = class extends BaseResource {
  constructor(resourceType, options) {
    super({ prefixUrl: resourceType, ...options });
  }
  all(resourceId, metric, options) {
    return RequestHelper.get()(this, endpoint`${resourceId}/dora/metrics`, {
      metric,
      ...options
    });
  }
};
var ResourceDiscussions = class extends BaseResource {
  resource2Type;
  constructor(resourceType, resource2Type, options) {
    super({ prefixUrl: resourceType, ...options });
    this.resource2Type = resource2Type;
  }
  addNote(resourceId, resource2Id, discussionId, body, options) {
    return RequestHelper.post()(
      this,
      endpoint`${resourceId}/${this.resource2Type}/${resource2Id}/discussions/${discussionId}/notes`,
      { ...options, body }
    );
  }
  all(resourceId, resource2Id, options) {
    return RequestHelper.get()(
      this,
      endpoint`${resourceId}/${this.resource2Type}/${resource2Id}/discussions`,
      options
    );
  }
  create(resourceId, resource2Id, body, {
    position,
    ...options
  } = {}) {
    const opts = { ...options, body };
    if (position) {
      Object.assign(opts, reformatObjectOptions(position, "position", true));
      opts.isForm = true;
    }
    return RequestHelper.post()(
      this,
      endpoint`${resourceId}/${this.resource2Type}/${resource2Id}/discussions`,
      opts
    );
  }
  editNote(resourceId, resource2Id, discussionId, noteId, options) {
    return RequestHelper.put()(
      this,
      endpoint`${resourceId}/${this.resource2Type}/${resource2Id}/discussions/${discussionId}/notes/${noteId}`,
      options
    );
  }
  removeNote(resourceId, resource2Id, discussionId, noteId, options) {
    return RequestHelper.del()(
      this,
      endpoint`${resourceId}/${this.resource2Type}/${resource2Id}/discussions/${discussionId}/notes/${noteId}`,
      options
    );
  }
  show(resourceId, resource2Id, discussionId, options) {
    return RequestHelper.get()(
      this,
      endpoint`${resourceId}/${this.resource2Type}/${resource2Id}/discussions/${discussionId}`,
      options
    );
  }
};
var ResourceIssueBoards = class extends BaseResource {
  constructor(resourceType, options) {
    super({ prefixUrl: resourceType, ...options });
  }
  all(resourceId, options) {
    return RequestHelper.get()(this, endpoint`${resourceId}/boards`, options);
  }
  allLists(resourceId, boardId, options) {
    return RequestHelper.get()(
      this,
      endpoint`${resourceId}/boards/${boardId}/lists`,
      options
    );
  }
  create(resourceId, name, options) {
    return RequestHelper.post()(this, endpoint`${resourceId}/boards`, {
      name,
      ...options
    });
  }
  createList(resourceId, boardId, options) {
    return RequestHelper.post()(
      this,
      endpoint`${resourceId}/boards/${boardId}/lists`,
      options
    );
  }
  edit(resourceId, boardId, options) {
    return RequestHelper.put()(
      this,
      endpoint`${resourceId}/boards/${boardId}`,
      options
    );
  }
  editList(resourceId, boardId, listId, position, options) {
    return RequestHelper.put()(
      this,
      endpoint`${resourceId}/boards/${boardId}/lists/${listId}`,
      {
        position,
        ...options
      }
    );
  }
  remove(resourceId, boardId, options) {
    return RequestHelper.del()(this, endpoint`${resourceId}/boards/${boardId}`, options);
  }
  removeList(resourceId, boardId, listId, options) {
    return RequestHelper.del()(
      this,
      endpoint`${resourceId}/boards/${boardId}/lists/${listId}`,
      options
    );
  }
  show(resourceId, boardId, options) {
    return RequestHelper.get()(
      this,
      endpoint`${resourceId}/boards/${boardId}`,
      options
    );
  }
  showList(resourceId, boardId, listId, options) {
    return RequestHelper.get()(
      this,
      endpoint`${resourceId}/boards/${boardId}/lists/${listId}`,
      options
    );
  }
};
var ResourceLabels = class extends BaseResource {
  constructor(resourceType, options) {
    super({ prefixUrl: resourceType, ...options });
  }
  all(resourceId, options) {
    return RequestHelper.get()(this, endpoint`${resourceId}/labels`, options);
  }
  create(resourceId, labelName, color, options) {
    return RequestHelper.post()(this, endpoint`${resourceId}/labels`, {
      name: labelName,
      color,
      ...options
    });
  }
  edit(resourceId, labelId, options) {
    if (!options?.newName && !options?.color)
      throw new Error(
        "Missing required argument. Please supply a color or a newName in the options parameter."
      );
    return RequestHelper.put()(
      this,
      endpoint`${resourceId}/labels/${labelId}`,
      options
    );
  }
  promote(resourceId, labelId, options) {
    return RequestHelper.put()(
      this,
      endpoint`${resourceId}/labels/${labelId}/promote`,
      options
    );
  }
  remove(resourceId, labelId, options) {
    return RequestHelper.del()(this, endpoint`${resourceId}/labels/${labelId}`, options);
  }
  show(resourceId, labelId, options) {
    return RequestHelper.get()(
      this,
      endpoint`${resourceId}/labels/${labelId}`,
      options
    );
  }
  subscribe(resourceId, labelId, options) {
    return RequestHelper.post()(
      this,
      endpoint`${resourceId}/issues/${labelId}/subscribe`,
      options
    );
  }
  unsubscribe(resourceId, labelId, options) {
    return RequestHelper.post()(
      this,
      endpoint`${resourceId}/issues/${labelId}/unsubscribe`,
      options
    );
  }
};
var ResourceMarkdownUploads = class extends BaseResource {
  constructor(resourceType, options) {
    super({ prefixUrl: resourceType, ...options });
  }
  all(resourceId, options) {
    return RequestHelper.get()(
      this,
      endpoint`${resourceId}/uploads`,
      options
    );
  }
  download(resourceId, uploadIdOrSecret, filename, options) {
    if (filename && typeof filename === "string") {
      return RequestHelper.get()(
        this,
        endpoint`${resourceId}/uploads/${uploadIdOrSecret}/${filename}`,
        options
      );
    }
    return RequestHelper.get()(
      this,
      endpoint`${resourceId}/uploads/${uploadIdOrSecret}`,
      options
    );
  }
  remove(resourceId, uploadIdOrSecret, filename, options) {
    if (filename && typeof filename === "string") {
      return RequestHelper.del()(
        this,
        endpoint`${resourceId}/uploads/${uploadIdOrSecret}/${filename}`,
        options
      );
    }
    return RequestHelper.del()(this, endpoint`${resourceId}/uploads/${uploadIdOrSecret}`, options);
  }
};
var ResourceMembers = class extends BaseResource {
  constructor(resourceType, options) {
    super({ prefixUrl: resourceType, ...options });
  }
  add(resourceId, accessLevel, options) {
    return RequestHelper.post()(this, endpoint`${resourceId}/members`, {
      accessLevel,
      ...options
    });
  }
  all(resourceId, {
    includeInherited,
    ...options
  } = {}) {
    let url12 = endpoint`${resourceId}/members`;
    if (includeInherited) url12 += "/all";
    return RequestHelper.get()(this, url12, options);
  }
  edit(resourceId, userId, accessLevel, options) {
    return RequestHelper.put()(this, endpoint`${resourceId}/members/${userId}`, {
      accessLevel,
      ...options
    });
  }
  show(resourceId, userId, { includeInherited, ...options } = {}) {
    const [rId, uId] = [resourceId, userId].map(encodeURIComponent);
    const url12 = [rId, "members"];
    if (includeInherited) url12.push("all");
    url12.push(uId);
    return RequestHelper.get()(this, url12.join("/"), options);
  }
  remove(resourceId, userId, options) {
    return RequestHelper.del()(this, endpoint`${resourceId}/members/${userId}`, options);
  }
};
var ResourceMilestones = class extends BaseResource {
  constructor(resourceType, options) {
    super({ prefixUrl: resourceType, ...options });
  }
  all(resourceId, options) {
    return RequestHelper.get()(
      this,
      endpoint`${resourceId}/milestones`,
      options
    );
  }
  allAssignedIssues(resourceId, milestoneId, options) {
    return RequestHelper.get()(
      this,
      endpoint`${resourceId}/milestones/${milestoneId}/issues`,
      options
    );
  }
  allAssignedMergeRequests(resourceId, milestoneId, options) {
    return RequestHelper.get()(
      this,
      endpoint`${resourceId}/milestones/${milestoneId}/merge_requests`,
      options
    );
  }
  allBurndownChartEvents(resourceId, milestoneId, options) {
    return RequestHelper.get()(
      this,
      endpoint`${resourceId}/milestones/${milestoneId}/burndown_events`,
      options
    );
  }
  create(resourceId, title, options) {
    return RequestHelper.post()(this, endpoint`${resourceId}/milestones`, {
      title,
      ...options
    });
  }
  edit(resourceId, milestoneId, options) {
    return RequestHelper.put()(
      this,
      endpoint`${resourceId}/milestones/${milestoneId}`,
      options
    );
  }
  remove(resourceId, milestoneId, options) {
    return RequestHelper.del()(this, endpoint`${resourceId}/milestones/${milestoneId}`, options);
  }
  show(resourceId, milestoneId, options) {
    return RequestHelper.get()(
      this,
      endpoint`${resourceId}/milestones/${milestoneId}`,
      options
    );
  }
};
var ResourceNotes = class extends BaseResource {
  resource2Type;
  constructor(resourceType, resource2Type, options) {
    super({ prefixUrl: resourceType, ...options });
    this.resource2Type = resource2Type;
  }
  all(resourceId, resource2Id, options) {
    return RequestHelper.get()(
      this,
      endpoint`${resourceId}/${this.resource2Type}/${resource2Id}/notes`,
      options
    );
  }
  create(resourceId, resource2Id, body, options) {
    return RequestHelper.post()(
      this,
      endpoint`${resourceId}/${this.resource2Type}/${resource2Id}/notes`,
      {
        body,
        ...options
      }
    );
  }
  edit(resourceId, resource2Id, noteId, options) {
    return RequestHelper.put()(
      this,
      endpoint`${resourceId}/${this.resource2Type}/${resource2Id}/notes/${noteId}`,
      options
    );
  }
  remove(resourceId, resource2Id, noteId, options) {
    return RequestHelper.del()(
      this,
      endpoint`${resourceId}/${this.resource2Type}/${resource2Id}/notes/${noteId}`,
      options
    );
  }
  show(resourceId, resource2Id, noteId, options) {
    return RequestHelper.get()(
      this,
      endpoint`${resourceId}/${this.resource2Type}/${resource2Id}/notes/${noteId}`,
      options
    );
  }
};
var ResourceTemplates = class extends BaseResource {
  constructor(resourceType, options) {
    super({ prefixUrl: ["templates", resourceType].join("/"), ...options });
  }
  all(options) {
    process.emitWarning(
      'This API will be deprecated as of Gitlabs v5 API. Please make the switch to "ProjectTemplates".',
      "DeprecationWarning"
    );
    return RequestHelper.get()(this, "", options);
  }
  show(key, options) {
    process.emitWarning(
      'This API will be deprecated as of Gitlabs v5 API. Please make the switch to "ProjectTemplates".',
      "DeprecationWarning"
    );
    return RequestHelper.get()(this, encodeURIComponent(key), options);
  }
};
var ResourceVariables = class extends BaseResource {
  constructor(resourceType, options) {
    super({ prefixUrl: resourceType, ...options });
  }
  all(resourceId, options) {
    return RequestHelper.get()(this, endpoint`${resourceId}/variables`, options);
  }
  create(resourceId, key, value, options) {
    return RequestHelper.post()(this, endpoint`${resourceId}/variables`, {
      key,
      value,
      ...options
    });
  }
  edit(resourceId, key, value, options) {
    return RequestHelper.put()(this, endpoint`${resourceId}/variables/${key}`, {
      value,
      ...options
    });
  }
  show(resourceId, key, options) {
    return RequestHelper.get()(
      this,
      endpoint`${resourceId}/variables/${key}`,
      options
    );
  }
  remove(resourceId, key, options) {
    return RequestHelper.del()(this, endpoint`${resourceId}/variables/${key}`, options);
  }
};
var ResourceWikis = class extends BaseResource {
  constructor(resourceType, options) {
    super({ prefixUrl: resourceType, ...options });
  }
  all(resourceId, options) {
    return RequestHelper.get()(this, endpoint`${resourceId}/wikis`, options);
  }
  create(resourceId, content, title, options) {
    return RequestHelper.post()(this, endpoint`${resourceId}/wikis`, {
      content,
      title,
      ...options
    });
  }
  edit(resourceId, slug, options) {
    return RequestHelper.put()(this, endpoint`${resourceId}/wikis/${slug}`, options);
  }
  remove(resourceId, slug, options) {
    return RequestHelper.del()(this, endpoint`${resourceId}/wikis/${slug}`, options);
  }
  show(resourceId, slug, options) {
    return RequestHelper.get()(this, endpoint`${resourceId}/wikis/${slug}`, options);
  }
  uploadAttachment(resourceId, file, options) {
    return RequestHelper.post()(
      this,
      endpoint`${resourceId}/wikis/attachments`,
      {
        ...options,
        isForm: true,
        file: [file.content, file.filename]
      }
    );
  }
};
var ResourceHooks = class extends BaseResource {
  constructor(resourceType, options) {
    super({ prefixUrl: resourceType, ...options });
  }
  add(resourceId, url12, options) {
    return RequestHelper.post()(this, endpoint`${resourceId}/hooks`, {
      url: url12,
      ...options
    });
  }
  all(resourceId, options) {
    return RequestHelper.get()(this, endpoint`${resourceId}/hooks`, options);
  }
  edit(resourceId, hookId, url12, options) {
    return RequestHelper.put()(this, endpoint`${resourceId}/hooks/${hookId}`, {
      url: url12,
      ...options
    });
  }
  remove(resourceId, hookId, options) {
    return RequestHelper.del()(this, endpoint`${resourceId}/hooks/${hookId}`, options);
  }
  show(resourceId, hookId, options) {
    return RequestHelper.get()(
      this,
      endpoint`${resourceId}/hooks/${hookId}`,
      options
    );
  }
};
var ResourcePushRules = class extends BaseResource {
  constructor(resourceType, options) {
    super({ prefixUrl: resourceType, ...options });
  }
  create(resourceId, options) {
    return RequestHelper.post()(this, endpoint`${resourceId}/push_rule`, options);
  }
  edit(resourceId, options) {
    return RequestHelper.put()(this, endpoint`${resourceId}/push_rule`, options);
  }
  remove(resourceId, options) {
    return RequestHelper.del()(this, endpoint`${resourceId}/push_rule`, options);
  }
  show(resourceId, options) {
    return RequestHelper.get()(this, endpoint`${resourceId}/push_rule`, options);
  }
};
var ResourceRepositoryStorageMoves = class extends BaseResource {
  resourceType;
  resourceTypeSingular;
  constructor(resourceType, options) {
    super(options);
    this.resourceType = resourceType;
    this.resourceTypeSingular = resourceType.substring(0, resourceType.length - 1);
  }
  all(options) {
    const resourceId = options?.[`${this.resourceTypeSingular}Id`];
    const url12 = resourceId ? endpoint`${this.resourceType}/${resourceId}/repository_storage_moves` : `${this.resourceTypeSingular}_repository_storage_moves`;
    return RequestHelper.get()(this, url12, options);
  }
  show(repositoryStorageId, options) {
    const resourceId = options?.[`${this.resourceTypeSingular}Id`];
    const url12 = resourceId ? endpoint`${this.resourceType}/${resourceId}/repository_storage_moves` : `${this.resourceTypeSingular}_repository_storage_moves`;
    return RequestHelper.get()(
      this,
      `${url12}/${repositoryStorageId}`,
      options
    );
  }
  schedule(sourceStorageName, options) {
    const resourceId = options?.[`${this.resourceTypeSingular}Id`];
    const url12 = resourceId ? endpoint`${this.resourceType}/${resourceId}/repository_storage_moves` : `${this.resourceTypeSingular}_repository_storage_moves`;
    return RequestHelper.post()(this, url12, {
      sourceStorageName,
      ...options
    });
  }
};
var ResourceInvitations = class extends BaseResource {
  constructor(resourceType, options) {
    super({ prefixUrl: resourceType, ...options });
  }
  add(resourceId, accessLevel, options) {
    if (!options?.email && !options?.userId)
      throw new Error(
        "Missing required argument. Please supply a email or a userId in the options parameter."
      );
    return RequestHelper.post()(this, endpoint`${resourceId}/invitations`, {
      accessLevel,
      ...options
    });
  }
  all(resourceId, options) {
    return RequestHelper.get()(
      this,
      endpoint`${resourceId}/invitations`,
      options
    );
  }
  edit(resourceId, email, options) {
    return RequestHelper.put()(
      this,
      endpoint`${resourceId}/invitations/${email}`,
      options
    );
  }
  remove(resourceId, email, options) {
    return RequestHelper.del()(
      this,
      endpoint`${resourceId}/invitations/${email}`,
      options
    );
  }
};
var ResourceIterations = class extends BaseResource {
  constructor(resourceType, options) {
    super({ prefixUrl: resourceType, ...options });
  }
  all(resourceId, options) {
    return RequestHelper.get()(
      this,
      endpoint`${resourceId}/iterations`,
      options
    );
  }
};
var ResourceProtectedEnvironments = class extends BaseResource {
  constructor(resourceType, options) {
    super({ prefixUrl: resourceType, ...options });
  }
  all(resourceId, options) {
    return RequestHelper.get()(
      this,
      `${resourceId}/protected_environments`,
      options
    );
  }
  create(resourceId, name, deployAccessLevels, options) {
    return RequestHelper.post()(
      this,
      `${resourceId}/protected_environments`,
      {
        name,
        deployAccessLevels,
        ...options
      }
    );
  }
  edit(resourceId, name, options) {
    return RequestHelper.put()(
      this,
      `${resourceId}/protected_environments/${name}`,
      options
    );
  }
  show(resourceId, name, options) {
    return RequestHelper.get()(
      this,
      `${resourceId}/protected_environments/${name}`,
      options
    );
  }
  remove(resourceId, name, options) {
    return RequestHelper.del()(this, `${resourceId}/protected_environments/${name}`, options);
  }
};
var ResourceIterationEvents = class extends BaseResource {
  resource2Type;
  constructor(resourceType, resource2Type, options) {
    super({ prefixUrl: resourceType, ...options });
    this.resource2Type = resource2Type;
  }
  all(resourceId, resource2Id, options) {
    return RequestHelper.get()(
      this,
      endpoint`${resourceId}/${this.resource2Type}/${resource2Id}/resource_iteration_events`,
      options
    );
  }
  show(resourceId, resource2Id, iterationEventId, options) {
    return RequestHelper.get()(
      this,
      endpoint`${resourceId}/${this.resource2Type}/${resource2Id}/resource_iteration_events/${iterationEventId}`,
      options
    );
  }
};
var ResourceLabelEvents = class extends BaseResource {
  resource2Type;
  constructor(resourceType, resource2Type, options) {
    super({ prefixUrl: resourceType, ...options });
    this.resource2Type = resource2Type;
  }
  all(resourceId, resource2Id, options) {
    return RequestHelper.get()(
      this,
      endpoint`${resourceId}/${this.resource2Type}/${resource2Id}/resource_label_events`,
      options
    );
  }
  show(resourceId, resource2Id, labelEventId, options) {
    return RequestHelper.get()(
      this,
      endpoint`${resourceId}/${this.resource2Type}/${resource2Id}/resource_label_events/${labelEventId}`,
      options
    );
  }
};
var ResourceMilestoneEvents = class extends BaseResource {
  resource2Type;
  constructor(resourceType, resource2Type, options) {
    super({ prefixUrl: resourceType, ...options });
    this.resource2Type = resource2Type;
  }
  all(resourceId, resource2Id, options) {
    return RequestHelper.get()(
      this,
      endpoint`${resourceId}/${this.resource2Type}/${resource2Id}/resource_milestone_events`,
      options
    );
  }
  show(resourceId, resource2Id, milestoneEventId, options) {
    return RequestHelper.get()(
      this,
      endpoint`${resourceId}/${this.resource2Type}/${resource2Id}/resource_milestone_events/${milestoneEventId}`,
      options
    );
  }
};
var ResourceStateEvents = class extends BaseResource {
  resource2Type;
  constructor(resourceType, resource2Type, options) {
    super({ prefixUrl: resourceType, ...options });
    this.resource2Type = resource2Type;
  }
  all(resourceId, resource2Id, options) {
    return RequestHelper.get()(
      this,
      endpoint`${resourceId}/${this.resource2Type}/${resource2Id}/resource_state_events`,
      options
    );
  }
  show(resourceId, resource2Id, stateEventId, options) {
    return RequestHelper.get()(
      this,
      endpoint`${resourceId}/${this.resource2Type}/${resource2Id}/resource_state_events/${stateEventId}`,
      options
    );
  }
};

// src/resources/DockerfileTemplates.ts
var DockerfileTemplates = class extends ResourceTemplates {
  constructor(options) {
    super("dockerfiles", options);
  }
};
var Events = class extends BaseResource {
  all({
    projectId,
    userId,
    ...options
  } = {}) {
    let url12;
    if (projectId) url12 = endpoint`projects/${projectId}/events`;
    else if (userId) url12 = endpoint`users/${userId}/events`;
    else url12 = "events";
    return RequestHelper.get()(this, url12, options);
  }
};
var Experiments = class extends BaseResource {
  all(options) {
    return RequestHelper.get()(this, "experiments", options);
  }
};
var GeoNodes = class extends BaseResource {
  all(options) {
    return RequestHelper.get()(this, "geo_nodes", options);
  }
  allStatuses(options) {
    return RequestHelper.get()(this, "geo_nodes/statuses", options);
  }
  allFailures(options) {
    return RequestHelper.get()(this, "geo_nodes/current/failures", options);
  }
  create(name, url12, options) {
    return RequestHelper.post()(this, "geo_nodes", { name, url: url12, ...options });
  }
  edit(geonodeId, options) {
    return RequestHelper.put()(this, `geo_nodes/${geonodeId}`, options);
  }
  repair(geonodeId, options) {
    return RequestHelper.post()(this, `geo_nodes/${geonodeId}/repair`, options);
  }
  remove(geonodeId, options) {
    return RequestHelper.del()(this, `geo_nodes/${geonodeId}`, options);
  }
  show(geonodeId, options) {
    return RequestHelper.get()(this, `geo_nodes/${geonodeId}`, options);
  }
  showStatus(geonodeId, options) {
    return RequestHelper.get()(this, `geo_nodes/${geonodeId}/status`, options);
  }
};
var GeoSites = class extends BaseResource {
  all(options) {
    return RequestHelper.get()(this, "geo_sites", options);
  }
  allStatuses(options) {
    return RequestHelper.get()(this, "geo_sites/statuses", options);
  }
  allFailures(options) {
    return RequestHelper.get()(this, "geo_sites/current/failures", options);
  }
  create(name, url12, options) {
    return RequestHelper.post()(this, "geo_sites", { name, url: url12, ...options });
  }
  edit(geositeId, options) {
    return RequestHelper.put()(this, `geo_sites/${geositeId}`, options);
  }
  repair(geositeId, options) {
    return RequestHelper.post()(this, `geo_sites/${geositeId}/repair`, options);
  }
  remove(geositeId, options) {
    return RequestHelper.del()(this, `geo_sites/${geositeId}`, options);
  }
  show(geositeId, options) {
    return RequestHelper.get()(this, `geo_sites/${geositeId}`, options);
  }
  showStatus(geositeId, options) {
    return RequestHelper.get()(this, `geo_sites/${geositeId}/status`, options);
  }
};

// src/resources/GitLabCIYMLTemplates.ts
var GitLabCIYMLTemplates = class extends ResourceTemplates {
  constructor(options) {
    super("gitlab_ci_ymls", options);
  }
};

// src/resources/GitignoreTemplates.ts
var GitignoreTemplates = class extends ResourceTemplates {
  constructor(options) {
    super("gitignores", options);
  }
};
var Import = class extends BaseResource {
  importGithubRepository(personalAccessToken, repositoryId, targetNamespace, options) {
    return RequestHelper.post()(this, "import/github", {
      personalAccessToken,
      repoId: repositoryId,
      targetNamespace,
      ...options
    });
  }
  cancelGithubRepositoryImport(projectId, options) {
    return RequestHelper.post()(this, "import/github/cancel", {
      projectId,
      ...options
    });
  }
  importGithubGists(personalAccessToken, options) {
    return RequestHelper.post()(this, "import/github/gists", {
      personalAccessToken,
      ...options
    });
  }
  importBitbucketServerRepository(bitbucketServerUrl, bitbucketServerUsername, personalAccessToken, bitbucketServerProject, bitbucketServerRepository, options) {
    return RequestHelper.post()(this, "import/bitbucket_server", {
      bitbucketServerUrl,
      bitbucketServerUsername,
      personalAccessToken,
      bitbucketServerProject,
      bitbucketServerRepo: bitbucketServerRepository,
      ...options
    });
  }
};
var InstanceLevelCICDVariables = class extends BaseResource {
  all(options) {
    return RequestHelper.get()(this, "admin/ci/variables", options);
  }
  create(key, value, options) {
    return RequestHelper.post()(this, "admin/ci/variables", {
      key,
      value,
      ...options
    });
  }
  edit(keyId, value, options) {
    return RequestHelper.put()(this, endpoint`admin/ci/variables/${keyId}`, {
      value,
      ...options
    });
  }
  show(keyId, options) {
    return RequestHelper.get()(
      this,
      endpoint`admin/ci/variables/${keyId}`,
      options
    );
  }
  remove(keyId, options) {
    return RequestHelper.get()(this, endpoint`admin/ci/variables/${keyId}`, options);
  }
};
var Keys = class extends BaseResource {
  show({
    keyId,
    fingerprint,
    ...options
  } = {}) {
    let url12;
    if (keyId) url12 = `keys/${keyId}`;
    else if (fingerprint) url12 = `keys?fingerprint=${fingerprint}`;
    else {
      throw new Error(
        "Missing required argument. Please supply a fingerprint or a keyId in the options parameter"
      );
    }
    return RequestHelper.get()(this, url12, options);
  }
};
var License = class extends BaseResource {
  add(license, options) {
    return RequestHelper.post()(this, "license", {
      searchParams: { license },
      ...options
    });
  }
  all(options) {
    return RequestHelper.get()(this, "licenses", options);
  }
  show(options) {
    return RequestHelper.get()(this, "license", options);
  }
  remove(licenceId, options) {
    return RequestHelper.del()(this, `license/${licenceId}`, options);
  }
  recalculateBillableUsers(licenceId, options) {
    return RequestHelper.put()(
      this,
      `license/${licenceId}/refresh_billable_users`,
      options
    );
  }
};

// src/resources/LicenseTemplates.ts
var LicenseTemplates = class extends ResourceTemplates {
  constructor(options) {
    super("Licenses", options);
  }
};
var Lint = class extends BaseResource {
  check(projectId, options) {
    return RequestHelper.get()(this, endpoint`projects/${projectId}/ci/lint`, options);
  }
  lint(projectId, content, options) {
    return RequestHelper.post()(this, endpoint`projects/${projectId}/ci/lint`, {
      ...options,
      content
    });
  }
};
var Markdown = class extends BaseResource {
  render(text, options) {
    return RequestHelper.post()(this, "markdown", { text, ...options });
  }
};
var Maven = class extends BaseResource {
  downloadPackageFile(path, filename, {
    projectId,
    groupId,
    ...options
  }) {
    let url12 = endpoint`packages/maven/${path}/${filename}`;
    if (projectId) url12 = endpoint`projects/${projectId}/${url12}`;
    else if (groupId) url12 = endpoint`groups/${groupId}/-/${url12}`;
    return RequestHelper.get()(this, url12, options);
  }
  uploadPackageFile(projectId, path, packageFile, options) {
    return RequestHelper.put()(
      this,
      endpoint`projects/${projectId}/packages/maven/${path}/${packageFile.filename}`,
      {
        isForm: true,
        ...options,
        file: [packageFile.content, packageFile.filename]
      }
    );
  }
};
var Metadata = class extends BaseResource {
  show(options) {
    return RequestHelper.get()(this, "metadata", options);
  }
};
var Migrations = class extends BaseResource {
  all(options) {
    return RequestHelper.get()(this, "bulk_imports", options);
  }
  create(configuration, entities, options) {
    return RequestHelper.post()(this, "bulk_imports", {
      configuration,
      entities,
      ...options
    });
  }
  allEntities({
    bulkImportId,
    ...options
  } = {}) {
    const url12 = bulkImportId ? endpoint`bulk_imports/${bulkImportId}/entities` : "bulk_imports/entities";
    return RequestHelper.get()(this, url12, options);
  }
  show(bulkImportId, options) {
    return RequestHelper.get()(
      this,
      `bulk_imports/${bulkImportId}`,
      options
    );
  }
  showEntity(bulkImportId, entitityId, options) {
    return RequestHelper.get()(
      this,
      `bulk_imports/${bulkImportId}/entities/${entitityId}`,
      options
    );
  }
};
function url6(projectId) {
  return projectId ? endpoint`/projects/${projectId}/packages/npm` : "packages/npm";
}
var NPM = class extends BaseResource {
  downloadPackageFile(projectId, packageName, filename, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/packages/npm/${packageName}/-/${filename}`,
      options
    );
  }
  removeDistTag(packageName, tag, options) {
    const prefix = url6(options?.projectId);
    return RequestHelper.del()(
      this,
      `${prefix}/-/package/${packageName}/dist-tags/${tag}`,
      options
    );
  }
  setDistTag(packageName, tag, options) {
    const prefix = url6(options?.projectId);
    return RequestHelper.put()(
      this,
      `${prefix}/-/package/${packageName}/dist-tags/${tag}`,
      options
    );
  }
  showDistTags(packageName, options) {
    const prefix = url6(options?.projectId);
    return RequestHelper.get()(
      this,
      `${prefix}/-/package/${packageName}/dist-tags`,
      options
    );
  }
  showMetadata(packageName, options) {
    const prefix = url6(options?.projectId);
    return RequestHelper.get()(this, `${prefix}/${packageName}`, options);
  }
  uploadPackageFile(projectId, packageName, versions, metadata, options) {
    return RequestHelper.put()(
      this,
      endpoint`projects/${projectId}/packages/npm/${packageName}`,
      {
        ...options,
        versions,
        ...metadata
      }
    );
  }
};
var Namespaces = class extends BaseResource {
  all(options) {
    return RequestHelper.get()(this, "namespaces", options);
  }
  exists(namespace, options) {
    return RequestHelper.get()(
      this,
      endpoint`namespaces/${namespace}/exists`,
      options
    );
  }
  show(namespaceId, options) {
    return RequestHelper.get()(this, endpoint`namespaces/${namespaceId}`, options);
  }
};
function url7({
  projectId,
  groupId
} = {}) {
  let prefix = "";
  if (projectId) prefix = endpoint`projects/${projectId}/`;
  if (groupId) prefix = endpoint`groups/${groupId}/`;
  return `${prefix}notification_settings`;
}
var NotificationSettings = class extends BaseResource {
  edit({
    groupId,
    projectId,
    ...options
  } = {}) {
    const uri = url7({ groupId, projectId });
    return RequestHelper.put()(this, uri, options);
  }
  show({
    groupId,
    projectId,
    ...options
  } = {}) {
    const uri = url7({ groupId, projectId });
    return RequestHelper.get()(this, uri, options);
  }
};
function url8({
  projectId,
  groupId
} = {}) {
  if (projectId) return endpoint`/projects/${projectId}/packages/nuget`;
  if (groupId) return endpoint`/groups/${groupId}/-/packages/nuget`;
  throw new Error(
    "Missing required argument. Please supply a projectId or a groupId in the options parameter"
  );
}
var NuGet = class extends BaseResource {
  downloadPackageFile(projectId, packageName, packageVersion, filename, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/packages/nuget/download/${packageName}/${packageVersion}/${filename}`,
      options
    );
  }
  search(q, {
    projectId,
    groupId,
    ...options
  }) {
    const uri = url8({ projectId, groupId });
    return RequestHelper.get()(this, `${uri}/query`, { q, ...options });
  }
  showMetadata(packageName, {
    projectId,
    groupId,
    ...options
  }) {
    const uri = url8({ projectId, groupId });
    return RequestHelper.get()(
      this,
      `${uri}/metadata/${packageName}/index`,
      options
    );
  }
  showPackageIndex(projectId, packageName, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/packages/nuget/download/${packageName}/index`,
      options
    );
  }
  showServiceIndex({
    projectId,
    groupId,
    ...options
  }) {
    const uri = url8({ projectId, groupId });
    return RequestHelper.get()(
      this,
      `${uri}/index`,
      options
    );
  }
  showVersionMetadata(packageName, packageVersion, {
    projectId,
    groupId,
    ...options
  }) {
    const uri = url8({ projectId, groupId });
    return RequestHelper.get()(
      this,
      `${uri}/metadata/${packageName}/${packageVersion}`,
      options
    );
  }
  uploadPackageFile(projectId, packageName, packageVersion, packageFile, options) {
    return RequestHelper.put()(this, endpoint`projects/${projectId}/packages/nuget`, {
      isForm: true,
      ...options,
      packageName,
      packageVersion,
      file: [packageFile.content, packageFile.filename]
    });
  }
  uploadSymbolPackage(projectId, packageName, packageVersion, packageFile, options) {
    return RequestHelper.put()(
      this,
      endpoint`projects/${projectId}/packages/nuget/symbolpackage`,
      {
        isForm: true,
        ...options,
        packageName,
        packageVersion,
        file: [packageFile.content, packageFile.filename]
      }
    );
  }
};
var PersonalAccessTokens = class extends BaseResource {
  all(options) {
    return RequestHelper.get()(
      this,
      "personal_access_tokens",
      options
    );
  }
  // Convience method - Also located in Users
  create(userId, name, scopes, options) {
    return RequestHelper.post()(
      this,
      endpoint`users/${userId}/personal_access_tokens`,
      {
        name,
        scopes,
        ...options
      }
    );
  }
  remove({
    tokenId,
    ...options
  } = {}) {
    const url12 = tokenId ? endpoint`personal_access_tokens/${tokenId}` : "personal_access_tokens/self";
    return RequestHelper.del()(this, url12, options);
  }
  rotate(tokenId, options) {
    return RequestHelper.post()(
      this,
      endpoint`personal_access_tokens/${tokenId}/rotate`,
      options
    );
  }
  show({
    tokenId,
    ...options
  } = {}) {
    const url12 = tokenId ? endpoint`personal_access_tokens/${tokenId}` : "personal_access_tokens/self";
    return RequestHelper.get()(this, url12, options);
  }
};
var PyPI = class extends BaseResource {
  downloadPackageFile(sha, fileIdentifier, {
    projectId,
    groupId,
    ...options
  } = {}) {
    let url12;
    if (projectId) {
      url12 = endpoint`projects/${projectId}/packages/pypi/files/${sha}/${fileIdentifier}`;
    } else if (groupId) {
      url12 = endpoint`groups/${groupId}/packages/pypi/files/${sha}/${fileIdentifier}`;
    } else {
      throw new Error(
        "Missing required argument. Please supply a projectId or a groupId in the options parameter"
      );
    }
    return RequestHelper.get()(this, url12, options);
  }
  showPackageDescriptor(packageName, {
    projectId,
    groupId,
    ...options
  }) {
    let url12;
    if (projectId) {
      url12 = endpoint`projects/${projectId}/packages/pypi/simple/${packageName}`;
    } else if (groupId) {
      url12 = endpoint`groups/${groupId}/packages/pypi/simple/${packageName}`;
    } else {
      throw new Error(
        "Missing required argument. Please supply a projectId or a groupId in the options parameter"
      );
    }
    return RequestHelper.get()(this, url12, options);
  }
  uploadPackageFile(projectId, packageFile, options) {
    return RequestHelper.put()(this, endpoint`projects/${projectId}/packages/pypi`, {
      ...options,
      isForm: true,
      file: [packageFile.content, packageFile.filename]
    });
  }
};
var RubyGems = class extends BaseResource {
  allDependencies(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/packages/rubygems/api/v1/dependencies`,
      options
    );
  }
  downloadGemFile(projectId, fileName, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/packages/rubygems/gems/${fileName}`,
      options
    );
  }
  uploadGemFile(projectId, packageFile, options) {
    return RequestHelper.post()(this, `projects/${projectId}/packages/rubygems/api/v1/gems`, {
      isForm: true,
      ...options,
      file: [packageFile.content, packageFile.filename]
    });
  }
};
var Search = class extends BaseResource {
  all(scope, search, options) {
    const { projectId, groupId, ...opts } = options || {};
    let url12;
    if (projectId) url12 = endpoint`projects/${projectId}/`;
    else if (groupId) url12 = endpoint`groups/${groupId}/`;
    else url12 = "";
    return RequestHelper.get()(this, `${url12}search`, {
      scope,
      search,
      ...opts
    });
  }
};
var SearchAdmin = class extends BaseResource {
  all(options) {
    return RequestHelper.get()(this, "admin/search/migrations", options);
  }
  show(versionOrName, options) {
    return RequestHelper.get()(
      this,
      endpoint`admin/search/migrations/${versionOrName}`,
      options
    );
  }
};
var ServiceAccounts = class extends BaseResource {
  create(options) {
    return RequestHelper.post()(this, endpoint`service_accounts`, options);
  }
};
var ServiceData = class extends BaseResource {
  showMetricDefinitions(options) {
    return RequestHelper.get()(this, "usage_data/metric_definitions", options);
  }
  showServicePingSQLQueries(options) {
    return RequestHelper.get()(this, "usage_data/queries", options);
  }
  showUsageDataNonSQLMetrics(options) {
    return RequestHelper.get()(
      this,
      "usage_data/non_sql_metrics",
      options
    );
  }
};
var SidekiqMetrics = class extends BaseResource {
  queueMetrics() {
    return RequestHelper.get()(this, "sidekiq/queue_metrics");
  }
  processMetrics() {
    return RequestHelper.get()(this, "sidekiq/process_metrics");
  }
  jobStats() {
    return RequestHelper.get()(this, "sidekiq/job_stats");
  }
  compoundMetrics() {
    return RequestHelper.get()(this, "sidekiq/compound_metrics");
  }
};
var SidekiqQueues = class extends BaseResource {
  remove(queueName, options) {
    return RequestHelper.get()(
      this,
      endpoint`admin/sidekiq/queues/${queueName}`,
      options
    );
  }
};

// src/resources/SnippetRepositoryStorageMoves.ts
var SnippetRepositoryStorageMoves = class extends ResourceRepositoryStorageMoves {
  constructor(options) {
    super("snippets", options);
  }
};
var Snippets = class extends BaseResource {
  all({
    public: ppublic,
    ...options
  } = {}) {
    const url12 = ppublic ? "snippets/public" : "snippets";
    return RequestHelper.get()(this, url12, options);
  }
  create(title, options) {
    return RequestHelper.post()(this, "snippets", {
      title,
      ...options
    });
  }
  edit(snippetId, options) {
    return RequestHelper.put()(this, `snippets/${snippetId}`, options);
  }
  remove(snippetId, options) {
    return RequestHelper.del()(this, `snippets/${snippetId}`, options);
  }
  show(snippetId, options) {
    return RequestHelper.get()(this, `snippets/${snippetId}`, options);
  }
  showContent(snippetId, options) {
    return RequestHelper.get()(this, `snippets/${snippetId}/raw`, options);
  }
  showRepositoryFileContent(snippetId, ref, filePath, options) {
    return RequestHelper.get()(
      this,
      endpoint`snippets/${snippetId}/files/${ref}/${filePath}/raw`,
      options
    );
  }
  showUserAgentDetails(snippetId, options) {
    return RequestHelper.get()(
      this,
      `snippets/${snippetId}/user_agent_detail`,
      options
    );
  }
};
var Suggestions = class extends BaseResource {
  edit(suggestionId, options) {
    return RequestHelper.put()(
      this,
      `suggestions/${suggestionId}/apply`,
      options
    );
  }
  editBatch(suggestionIds, options) {
    return RequestHelper.put()(this, `suggestions/batch_apply`, {
      ...options,
      ids: suggestionIds
    });
  }
};
var SystemHooks = class extends BaseResource {
  all(options) {
    return RequestHelper.get()(this, "hooks", options);
  }
  // Convenience method
  add(url12, options) {
    return this.create(url12, options);
  }
  create(url12, options) {
    return RequestHelper.post()(this, "hooks", {
      url: url12,
      ...options
    });
  }
  test(hookId, options) {
    return RequestHelper.post()(this, `hooks/${hookId}`, options);
  }
  remove(hookId, options) {
    return RequestHelper.del()(this, `hooks/${hookId}`, options);
  }
  show(hookId, options) {
    return RequestHelper.post()(this, `hooks/${hookId}`, options);
  }
};
var TodoLists = class extends BaseResource {
  all(options) {
    return RequestHelper.get()(this, "todos", options);
  }
  done({
    todoId,
    ...options
  } = {}) {
    let prefix = "todos";
    if (todoId) prefix += `/${todoId}`;
    return RequestHelper.post()(
      this,
      `${prefix}/mark_as_done`,
      options
    );
  }
};
var Topics = class extends BaseResource {
  all(options) {
    return RequestHelper.get()(this, "topics", options);
  }
  create(name, {
    avatar,
    ...options
  } = {}) {
    const opts = {
      name,
      ...options
    };
    if (avatar) {
      opts.isForm = true;
      opts.file = [avatar.content, avatar.filename];
    }
    return RequestHelper.post()(this, "topics", opts);
  }
  edit(topicId, {
    avatar,
    ...options
  } = {}) {
    const opts = { ...options };
    if (avatar) {
      opts.isForm = true;
      opts.file = [avatar.content, avatar.filename];
    }
    return RequestHelper.put()(this, `topics/${topicId}`, opts);
  }
  merge(sourceTopicId, targetTopicId, options) {
    return RequestHelper.post()(this, `topics/merge`, {
      sourceTopicId,
      targetTopicId,
      ...options
    });
  }
  remove(topicId, options) {
    return RequestHelper.del()(this, `topics/${topicId}`, options);
  }
  show(topicId, options) {
    return RequestHelper.get()(this, `topics/${topicId}`, options);
  }
};
var Branches = class extends BaseResource {
  all(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/repository/branches`,
      options
    );
  }
  create(projectId, branchName, ref, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/repository/branches`,
      {
        branch: branchName,
        ref,
        ...options
      }
    );
  }
  remove(projectId, branchName, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/repository/branches/${branchName}`,
      options
    );
  }
  removeMerged(projectId, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/repository/merged_branches`,
      options
    );
  }
  show(projectId, branchName, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/repository/branches/${branchName}`,
      options
    );
  }
};

// src/resources/CommitDiscussions.ts
var CommitDiscussions = class extends ResourceDiscussions {
  constructor(options) {
    super("projects", new RawPathSegment("repository/commits"), options);
  }
};
var Commits = class extends BaseResource {
  all(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/repository/commits`,
      options
    );
  }
  allComments(projectId, sha, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/repository/commits/${sha}/comments`,
      options
    );
  }
  allDiscussions(projectId, sha, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/repository/commits/${sha}/discussions`,
      options
    );
  }
  allMergeRequests(projectId, sha, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/repository/commits/${sha}/merge_requests`,
      options
    );
  }
  allReferences(projectId, sha, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/repository/commits/${sha}/refs`,
      options
    );
  }
  allStatuses(projectId, sha, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/repository/commits/${sha}/statuses`,
      options
    );
  }
  cherryPick(projectId, sha, branch, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/repository/commits/${sha}/cherry_pick`,
      {
        branch,
        ...options
      }
    );
  }
  create(projectId, branch, message, actions = [], options = {}) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/repository/commits`,
      {
        branch,
        commitMessage: message,
        actions,
        ...options
      }
    );
  }
  createComment(projectId, sha, note, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/repository/commits/${sha}/comments`,
      {
        note,
        ...options
      }
    );
  }
  editStatus(projectId, sha, state, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/statuses/${sha}`,
      {
        state,
        ...options
      }
    );
  }
  revert(projectId, sha, branch, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/repository/commits/${sha}/revert`,
      {
        ...options,
        branch
      }
    );
  }
  show(projectId, sha, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/repository/commits/${sha}`,
      options
    );
  }
  showDiff(projectId, sha, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/repository/commits/${sha}/diff`,
      options
    );
  }
  showGPGSignature(projectId, sha, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/repository/commits/${sha}/signature`,
      options
    );
  }
  showSequence(projectId, sha, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/repository/commits/${sha}/sequence`,
      options
    );
  }
};
var ContainerRegistry = class extends BaseResource {
  allRepositories({
    groupId,
    projectId,
    ...options
  } = {}) {
    let url12;
    if (groupId) url12 = endpoint`groups/${groupId}/registry/repositories`;
    else if (projectId) url12 = endpoint`projects/${projectId}/registry/repositories`;
    else
      throw new Error(
        "Missing required argument. Please supply a groupId or a projectId in the options parameter."
      );
    return RequestHelper.get()(this, url12, options);
  }
  allTags(projectId, repositoryId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/registry/repositories/${repositoryId}/tags`,
      options
    );
  }
  editRegistryVisibility(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}`,
      options
    );
  }
  removeRepository(projectId, repositoryId, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/registry/repositories/${repositoryId}`,
      options
    );
  }
  removeTag(projectId, repositoryId, tagName, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/registry/repositories/${repositoryId}/tags/${tagName}`,
      options
    );
  }
  removeTags(projectId, repositoryId, nameRegexDelete, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/registry/repositories/${repositoryId}/tags`,
      {
        nameRegexDelete,
        ...options
      }
    );
  }
  showRepository(repositoryId, options) {
    return RequestHelper.get()(
      this,
      endpoint`registry/repositories/${repositoryId}`,
      options
    );
  }
  showTag(projectId, repositoryId, tagName, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/registry/repositories/${repositoryId}/tags/${tagName}`,
      options
    );
  }
};
var Deployments = class extends BaseResource {
  all(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/deployments`,
      options
    );
  }
  allMergeRequests(projectId, deploymentId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/deployments/${deploymentId}/merge_requests`,
      options
    );
  }
  create(projectId, environment, sha, ref, tag, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/deployments`,
      {
        environment,
        sha,
        ref,
        tag,
        ...options
      }
    );
  }
  edit(projectId, deploymentId, status, options) {
    return RequestHelper.put()(
      this,
      endpoint`projects/${projectId}/deployments/${deploymentId}`,
      {
        ...options,
        status
      }
    );
  }
  remove(projectId, deploymentId, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/deployments/${deploymentId}`,
      options
    );
  }
  setApproval(projectId, deploymentId, status, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/deployments/${deploymentId}/approval`,
      {
        ...options,
        status
      }
    );
  }
  show(projectId, deploymentId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/deployments/${deploymentId}`,
      options
    );
  }
};
var Environments = class extends BaseResource {
  all(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/environments`,
      options
    );
  }
  create(projectId, name, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/environments`,
      {
        name,
        ...options
      }
    );
  }
  edit(projectId, environmentId, options) {
    return RequestHelper.put()(
      this,
      endpoint`projects/${projectId}/environments/${environmentId}`,
      options
    );
  }
  remove(projectId, environmentId, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/environments/${environmentId}`,
      options
    );
  }
  removeReviewApps(projectId, options) {
    return RequestHelper.del()(this, endpoint`projects/${projectId}/environments/review_apps`, options);
  }
  show(projectId, environmentId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/environments/${environmentId}`,
      options
    );
  }
  stop(projectId, environmentId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/environments/${environmentId}/stop`,
      options
    );
  }
  stopStale(projectId, before, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/environments/stop_stale`,
      {
        searchParams: { before },
        ...options
      }
    );
  }
};
var ErrorTrackingClientKeys = class extends BaseResource {
  all(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/error_tracking/client_keys`,
      options
    );
  }
  create(projectId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/error_tracking/client_keys`,
      options
    );
  }
  remove(projectId, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/error_tracking/client_keys`,
      options
    );
  }
};
var ErrorTrackingSettings = class extends BaseResource {
  create(projectId, active, integrated, options) {
    return RequestHelper.put()(
      this,
      endpoint`projects/${projectId}/error_tracking/settings`,
      {
        searchParams: {
          active,
          integrated
        },
        ...options
      }
    );
  }
  edit(projectId, active, { integrated, ...options } = {}) {
    return RequestHelper.patch()(
      this,
      endpoint`projects/${projectId}/error_tracking/settings`,
      {
        searchParams: {
          active,
          integrated
        },
        ...options
      }
    );
  }
  show(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/error_tracking/settings`,
      options
    );
  }
};
var ExternalStatusChecks = class extends BaseResource {
  all(projectId, options) {
    const { mergerequestIId, ...opts } = options || {};
    let url12 = endpoint`projects/${projectId}`;
    if (mergerequestIId) {
      url12 += endpoint`/merge_requests/${mergerequestIId}/status_checks`;
    } else {
      url12 += "/external_status_checks";
    }
    return RequestHelper.get()(this, url12, opts);
  }
  create(projectId, name, externalUrl, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/external_status_checks`,
      {
        name,
        externalUrl,
        ...options
      }
    );
  }
  edit(projectId, externalStatusCheckId, options) {
    return RequestHelper.put()(
      this,
      endpoint`projects/${projectId}/external_status_checks/${externalStatusCheckId}`,
      options
    );
  }
  remove(projectId, externalStatusCheckId, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/external_status_checks/${externalStatusCheckId}`,
      options
    );
  }
  set(projectId, mergerequestIId, sha, externalStatusCheckId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/status_check_responses`,
      {
        sha,
        externalStatusCheckId,
        ...options
      }
    );
  }
};
var FeatureFlagUserLists = class extends BaseResource {
  all(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/feature_flags_user_lists`,
      options
    );
  }
  create(projectId, name, userXids, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/feature_flags_user_lists`,
      {
        name,
        userXids,
        ...options
      }
    );
  }
  edit(projectId, featureFlagUserListIId, options) {
    return RequestHelper.put()(
      this,
      endpoint`projects/${projectId}/feature_flags_user_lists/${featureFlagUserListIId}`,
      options
    );
  }
  remove(projectId, featureFlagUserListIId, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/feature_flags_user_lists/${featureFlagUserListIId}`,
      options
    );
  }
  show(projectId, featureFlagUserListIId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/feature_flags_user_lists/${featureFlagUserListIId}`,
      options
    );
  }
};
var FeatureFlags = class extends BaseResource {
  all(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/feature_flags`,
      options
    );
  }
  create(projectId, flagName, version, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/feature_flags`,
      {
        name: flagName,
        version,
        ...options
      }
    );
  }
  edit(projectId, featureFlagName, options) {
    return RequestHelper.put()(
      this,
      endpoint`projects/${projectId}/feature_flags/${featureFlagName}`,
      options
    );
  }
  remove(projectId, flagName, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/feature_flags/${flagName}`,
      options
    );
  }
  show(projectId, flagName, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/feature_flags/${flagName}`,
      options
    );
  }
};
var FreezePeriods = class extends BaseResource {
  all(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/freeze_periods`,
      options
    );
  }
  create(projectId, freezeStart, freezeEnd, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/freeze_periods`,
      {
        freezeStart,
        freezeEnd,
        ...options
      }
    );
  }
  edit(projectId, freezePeriodId, options) {
    return RequestHelper.put()(
      this,
      endpoint`projects/${projectId}/freeze_periods/${freezePeriodId}`,
      options
    );
  }
  remove(projectId, freezePeriodId, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/freeze_periods/${freezePeriodId}`,
      options
    );
  }
  show(projectId, freezePeriodId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/freeze_periods/${freezePeriodId}`,
      options
    );
  }
};
var GitlabPages = class extends BaseResource {
  remove(projectId, options) {
    return RequestHelper.del()(this, endpoint`projects/${projectId}/pages`, options);
  }
  showSettings(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/pages`,
      options
    );
  }
};
var GoProxy = class extends BaseResource {
  all(projectId, moduleName, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/packages/go/${moduleName}/@v/list`,
      options
    );
  }
  showVersionMetadata(projectId, moduleName, moduleVersion, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/packages/go/${moduleName}/@v/${moduleVersion}.info`,
      options
    );
  }
  downloadModuleFile(projectId, moduleName, moduleVersion, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/packages/go/${moduleName}/@v/${moduleVersion}.mod`,
      options
    );
  }
  downloadModuleSource(projectId, moduleName, moduleVersion, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/packages/go/${moduleName}/@v/${moduleVersion}.zip`,
      options
    );
  }
};
var Helm = class extends BaseResource {
  downloadChartIndex(projectId, channel, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/packages/helm/${channel}/index.yaml`,
      options
    );
  }
  downloadChart(projectId, channel, filename, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/packages/helm/${channel}/charts/${filename}.tgz`,
      options
    );
  }
  import(projectId, channel, chart, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/packages/helm/api/${channel}/charts`,
      {
        isForm: true,
        ...options,
        chart: [chart.content, chart.filename]
      }
    );
  }
};
var Integrations = class extends BaseResource {
  all(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/integrations`,
      options
    );
  }
  edit(projectId, integrationName, options) {
    return RequestHelper.put()(
      this,
      endpoint`projects/${projectId}/integrations/${integrationName}`,
      options
    );
  }
  disable(projectId, integrationName, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/integrations/${integrationName}`,
      options
    );
  }
  show(projectId, integrationName, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/integrations/${integrationName}`,
      options
    );
  }
};

// src/resources/IssueAwardEmojis.ts
var IssueAwardEmojis = class extends ResourceAwardEmojis {
  constructor(options) {
    super("projects", "issues", options);
  }
};

// src/resources/IssueDiscussions.ts
var IssueDiscussions = class extends ResourceDiscussions {
  constructor(options) {
    super("projects", "issues", options);
  }
};

// src/resources/IssueIterationEvents.ts
var IssueIterationEvents = class extends ResourceIterationEvents {
  constructor(options) {
    super("projects", "issues", options);
  }
};

// src/resources/IssueLabelEvents.ts
var IssueLabelEvents = class extends ResourceLabelEvents {
  constructor(options) {
    super("projects", "issues", options);
  }
};
var IssueLinks = class extends BaseResource {
  all(projectId, issueIId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/issues/${issueIId}/links`,
      options
    );
  }
  create(projectId, issueIId, targetProjectId, targetIssueIId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/issues/${issueIId}/links`,
      {
        targetProjectId,
        targetIssueIid: targetIssueIId,
        ...options
      }
    );
  }
  remove(projectId, issueIId, issueLinkId, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/issues/${issueIId}/links/${issueLinkId}`,
      options
    );
  }
};

// src/resources/IssueMilestoneEvents.ts
var IssueMilestoneEvents = class extends ResourceMilestoneEvents {
  constructor(options) {
    super("projects", "issues", options);
  }
};

// src/resources/IssueNoteAwardEmojis.ts
var IssueNoteAwardEmojis = class extends ResourceNoteAwardEmojis {
  constructor(options) {
    super("issues", options);
  }
};

// src/resources/IssueNotes.ts
var IssueNotes = class extends ResourceNotes {
  constructor(options) {
    super("projects", "issues", options);
  }
};

// src/resources/IssueStateEvents.ts
var IssueStateEvents = class extends ResourceStateEvents {
  constructor(options) {
    super("projects", "issues", options);
  }
};

// src/resources/IssueWeightEvents.ts
var IssueWeightEvents = class extends ResourceStateEvents {
  constructor(options) {
    super("projects", "issues", options);
  }
};
var Issues = class extends BaseResource {
  addSpentTime(projectId, issueIId, duration, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/issues/${issueIId}/add_spent_time`,
      {
        duration,
        ...options
      }
    );
  }
  addTimeEstimate(projectId, issueIId, duration, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/issues/${issueIId}/time_estimate`,
      {
        duration,
        ...options
      }
    );
  }
  all({
    projectId,
    groupId,
    ...options
  } = {}) {
    let url12;
    if (projectId) url12 = endpoint`projects/${projectId}/issues`;
    else if (groupId) url12 = endpoint`groups/${groupId}/issues`;
    else url12 = "issues";
    return RequestHelper.get()(this, url12, options);
  }
  allMetricImages(projectId, issueIId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/issues/${issueIId}/metric_images`,
      options
    );
  }
  allParticipants(projectId, issueIId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/issues/${issueIId}/participants`,
      options
    );
  }
  allRelatedMergeRequests(projectId, issueIId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/issues/${issueIId}/related_merge_requests`,
      options
    );
  }
  create(projectId, title, options) {
    return RequestHelper.post()(this, endpoint`projects/${projectId}/issues`, {
      ...options,
      title
    });
  }
  createTodo(projectId, issueIId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/issues/${issueIId}/todo`,
      options
    );
  }
  clone(projectId, issueIId, destinationProjectId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/issues/${issueIId}/clone`,
      {
        toProjectId: destinationProjectId,
        ...options
      }
    );
  }
  edit(projectId, issueIId, options) {
    return RequestHelper.put()(
      this,
      endpoint`projects/${projectId}/issues/${issueIId}`,
      options
    );
  }
  editMetricImage(projectId, issueIId, imageId, options) {
    return RequestHelper.put()(
      this,
      endpoint`projects/${projectId}/issues/${issueIId}/metric_images/${imageId}`,
      options
    );
  }
  move(projectId, issueIId, destinationProjectId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/issues/${issueIId}/move`,
      {
        toProjectId: destinationProjectId,
        ...options
      }
    );
  }
  // Includes /promote already!
  promote(projectId, issueIId, body, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/issues/${issueIId}/notes`,
      {
        searchParams: {
          body: `${body} 
 /promote`
        },
        ...options
      }
    );
  }
  remove(projectId, issueIId, options) {
    return RequestHelper.del()(this, endpoint`projects/${projectId}/issues/${issueIId}`, options);
  }
  removeMetricImage(projectId, issueIId, imageId, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/issues/${issueIId}/metric_images/${imageId}`,
      options
    );
  }
  reorder(projectId, issueIId, options) {
    return RequestHelper.put()(
      this,
      endpoint`projects/${projectId}/issues/${issueIId}/reorder`,
      options
    );
  }
  resetSpentTime(projectId, issueIId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/issues/${issueIId}/reset_spent_time`,
      options
    );
  }
  resetTimeEstimate(projectId, issueIId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/issues/${issueIId}/reset_time_estimate`,
      options
    );
  }
  show(issueId, { projectId, ...options } = {}) {
    const url12 = projectId ? endpoint`projects/${projectId}/issues/${issueId}` : `issues/${issueId}`;
    return RequestHelper.get()(this, url12, options);
  }
  subscribe(projectId, issueIId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/issues/${issueIId}/subscribe`,
      options
    );
  }
  allClosedByMergeRequestst(projectId, issueIId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/issues/${issueIId}/closed_by`,
      options
    );
  }
  showTimeStats(projectId, issueIId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/issues/${issueIId}/time_stats`,
      options
    );
  }
  unsubscribe(projectId, issueIId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/issues/${issueIId}/unsubscribe`,
      options
    );
  }
  uploadMetricImage(projectId, issueIId, metricImage, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/issues/${issueIId}/metric_images`,
      {
        isForm: true,
        ...options,
        file: [metricImage.content, metricImage.filename]
      }
    );
  }
  showUserAgentDetails(projectId, issueIId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/issues/${issueIId}/user_agent_details`,
      options
    );
  }
};
var IssuesStatistics = class extends BaseResource {
  all({
    projectId,
    groupId,
    ...options
  } = {}) {
    let url12;
    if (projectId) url12 = endpoint`projects/${projectId}/issues_statistics`;
    else if (groupId) url12 = endpoint`groups/${groupId}/issues_statistics`;
    else url12 = "issues_statistics";
    return RequestHelper.get()(this, url12, options);
  }
};
function generateDownloadPathForJob(projectId, jobId, artifactPath) {
  let url12 = endpoint`projects/${projectId}/jobs/${jobId}/artifacts`;
  if (artifactPath) url12 += `/${artifactPath}`;
  return url12;
}
function generateDownloadPath(projectId, ref, artifactPath) {
  let url12 = endpoint`projects/${projectId}/jobs/artifacts/${ref}`;
  if (artifactPath) {
    url12 += endpoint`/raw/${artifactPath}`;
  } else {
    url12 += endpoint`/download`;
  }
  return url12;
}
var JobArtifacts = class extends BaseResource {
  downloadArchive(projectId, {
    jobId,
    artifactPath,
    ref,
    ...options
  } = {}) {
    let url12;
    if (jobId) url12 = generateDownloadPathForJob(projectId, jobId, artifactPath);
    else if (options?.job && ref) url12 = generateDownloadPath(projectId, ref, artifactPath);
    else
      throw new Error(
        "Missing one of the required parameters. See typing documentation for available arguments."
      );
    return RequestHelper.get()(this, url12, options);
  }
  keep(projectId, jobId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/jobs/${jobId}/artifacts/keep`,
      options
    );
  }
  remove(projectId, { jobId, ...options } = {}) {
    let url12;
    if (jobId) {
      url12 = endpoint`projects/${projectId}/jobs/${jobId}/artifacts`;
    } else {
      url12 = endpoint`projects/${projectId}/artifacts`;
    }
    return RequestHelper.del()(this, url12, options);
  }
};
var Jobs = class extends BaseResource {
  all(projectId, {
    pipelineId,
    ...options
  } = {}) {
    const url12 = pipelineId ? endpoint`projects/${projectId}/pipelines/${pipelineId}/jobs` : endpoint`projects/${projectId}/jobs`;
    return RequestHelper.get()(this, url12, options);
  }
  allPipelineBridges(projectId, pipelineId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/pipelines/${pipelineId}/bridges`,
      options
    );
  }
  cancel(projectId, jobId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/jobs/${jobId}/cancel`,
      options
    );
  }
  erase(projectId, jobId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/jobs/${jobId}/erase`,
      options
    );
  }
  play(projectId, jobId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/jobs/${jobId}/play`,
      options
    );
  }
  retry(projectId, jobId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/jobs/${jobId}/retry`,
      options
    );
  }
  show(projectId, jobId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/jobs/${jobId}`,
      options
    );
  }
  showConnectedJob(options) {
    if (!this.headers["job-token"]) throw new Error('Missing required header "job-token"');
    return RequestHelper.get()(this, "job", options);
  }
  showConnectedJobK8Agents(options) {
    if (!this.headers["job-token"]) throw new Error('Missing required header "job-token"');
    return RequestHelper.get()(this, "job/allowed_agents", options);
  }
  showLog(projectId, jobId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/jobs/${jobId}/trace`,
      options
    );
  }
};
var MergeRequestApprovals = class extends BaseResource {
  allApprovalRules(projectId, { mergerequestIId, ...options } = {}) {
    let url12;
    if (mergerequestIId) {
      url12 = endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/approval_rules`;
    } else {
      url12 = endpoint`projects/${projectId}/approval_rules`;
    }
    return RequestHelper.get()(this, url12, options);
  }
  approve(projectId, mergerequestIId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/approve`,
      options
    );
  }
  createApprovalRule(projectId, name, approvalsRequired, {
    mergerequestIId,
    ...options
  } = {}) {
    let url12;
    if (mergerequestIId) {
      url12 = endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/approval_rules`;
    } else {
      url12 = endpoint`projects/${projectId}/approval_rules`;
    }
    return RequestHelper.post()(this, url12, { name, approvalsRequired, ...options });
  }
  editApprovalRule(projectId, approvalRuleId, name, approvalsRequired, {
    mergerequestIId,
    ...options
  } = {}) {
    let url12;
    if (mergerequestIId) {
      url12 = endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/approval_rules/${approvalRuleId}`;
    } else {
      url12 = endpoint`projects/${projectId}/approval_rules/${approvalRuleId}`;
    }
    return RequestHelper.put()(this, url12, { name, approvalsRequired, ...options });
  }
  editConfiguration(projectId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/approvals`,
      options
    );
  }
  removeApprovalRule(projectId, approvalRuleId, {
    mergerequestIId,
    ...options
  } = {}) {
    let url12;
    if (mergerequestIId) {
      url12 = endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/approval_rules/${approvalRuleId}`;
    } else {
      url12 = endpoint`projects/${projectId}/approval_rules/${approvalRuleId}`;
    }
    return RequestHelper.del()(this, url12, options);
  }
  showApprovalRule(projectId, approvalRuleId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/approval_rules/${approvalRuleId}`,
      options
    );
  }
  showApprovalState(projectId, mergerequestIId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/approval_state`,
      options
    );
  }
  showConfiguration(projectId, { mergerequestIId, ...options } = {}) {
    let url12;
    if (mergerequestIId) {
      url12 = endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/approvals`;
    } else {
      url12 = endpoint`projects/${projectId}/approvals`;
    }
    return RequestHelper.get()(this, url12, options);
  }
  unapprove(projectId, mergerequestIId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/unapprove`,
      options
    );
  }
};

// src/resources/MergeRequestAwardEmojis.ts
var MergeRequestAwardEmojis = class extends ResourceAwardEmojis {
  constructor(options) {
    super("projects", "merge_requests", options);
  }
};
var MergeRequestContextCommits = class extends BaseResource {
  all(projectId, mergerequestIId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/context_commits`,
      options
    );
  }
  create(projectId, commits, { mergerequestIId, ...options } = {}) {
    const prefix = endpoint`projects/${projectId}/merge_requests`;
    const url12 = mergerequestIId ? `${prefix}/${mergerequestIId}/context_commits` : prefix;
    return RequestHelper.post()(this, url12, {
      commits,
      ...options
    });
  }
  remove(projectId, mergerequestIId, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/context_commits`,
      options
    );
  }
};

// src/resources/MergeRequestDiscussions.ts
var MergeRequestDiscussions = class extends ResourceDiscussions {
  constructor(options) {
    super("projects", "merge_requests", options);
  }
  resolve(projectId, mergerequestId, discussionId, resolved, options) {
    return RequestHelper.put()(
      this,
      endpoint`${projectId}/merge_requests/${mergerequestId}/discussions/${discussionId}`,
      {
        searchParams: { resolved },
        ...options
      }
    );
  }
};
var MergeRequestDraftNotes = class extends BaseResource {
  all(projectId, mergerequestIId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/draft_notes`,
      options
    );
  }
  create(projectId, mergerequestIId, note, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/draft_notes`,
      {
        ...options,
        note
      }
    );
  }
  edit(projectId, mergerequestIId, draftNoteId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/draft_notes/${draftNoteId}`,
      options
    );
  }
  publish(projectId, mergerequestIId, draftNoteId, options) {
    return RequestHelper.put()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/draft_notes/${draftNoteId}/publish`,
      options
    );
  }
  publishBulk(projectId, mergerequestIId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/draft_notes/bulk_publish`,
      options
    );
  }
  remove(projectId, mergerequestIId, draftNoteId, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/draft_notes/${draftNoteId}`,
      options
    );
  }
  show(projectId, mergerequestIId, draftNoteId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/draft_notes/${draftNoteId}`,
      options
    );
  }
};

// src/resources/MergeRequestLabelEvents.ts
var MergeRequestLabelEvents = class extends ResourceLabelEvents {
  constructor(options) {
    super("projects", "merge_requests", options);
  }
};

// src/resources/MergeRequestMilestoneEvents.ts
var MergeRequestMilestoneEvents = class extends ResourceMilestoneEvents {
  constructor(options) {
    super("projects", "merge_requests", options);
  }
};

// src/resources/MergeRequestNoteAwardEmojis.ts
var MergeRequestNoteAwardEmojis = class extends ResourceNoteAwardEmojis {
  constructor(options) {
    super("merge_requests", options);
  }
};

// src/resources/MergeRequestNotes.ts
var MergeRequestNotes = class extends ResourceNotes {
  constructor(options) {
    super("projects", "merge_requests", options);
  }
};
var MergeRequests = class extends BaseResource {
  // convenience method
  accept(projectId, mergerequestIId, options) {
    return this.merge(projectId, mergerequestIId, options);
  }
  addSpentTime(projectId, mergerequestIId, duration, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/add_spent_time`,
      {
        duration,
        ...options
      }
    );
  }
  all({
    projectId,
    groupId,
    ...options
  } = {}) {
    let prefix = "";
    if (projectId) {
      prefix = endpoint`projects/${projectId}/`;
    } else if (groupId) {
      prefix = endpoint`groups/${groupId}/`;
    }
    return RequestHelper.get()(this, `${prefix}merge_requests`, options);
  }
  allDiffs(projectId, mergerequestIId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/diffs`,
      options
    );
  }
  allCommits(projectId, mergerequestIId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/commits`,
      options
    );
  }
  allDiffVersions(projectId, mergerequestIId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/versions`,
      options
    );
  }
  allIssuesClosed(projectId, mergerequestIId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/closes_issues`,
      options
    );
  }
  allIssuesRelated(projectId, mergerequestIId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/related_issues`,
      options
    );
  }
  allParticipants(projectId, mergerequestIId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/participants`,
      options
    );
  }
  allPipelines(projectId, mergerequestIId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/pipelines`,
      options
    );
  }
  cancelOnPipelineSuccess(projectId, mergerequestIId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/cancel_merge_when_pipeline_succeeds`,
      options
    );
  }
  create(projectId, sourceBranch, targetBranch, title, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/merge_requests`,
      {
        sourceBranch,
        targetBranch,
        title,
        ...options
      }
    );
  }
  createPipeline(projectId, mergerequestIId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/pipelines`,
      options
    );
  }
  createTodo(projectId, mergerequestIId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/todo`,
      options
    );
  }
  edit(projectId, mergerequestIId, options) {
    return RequestHelper.put()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}`,
      options
    );
  }
  merge(projectId, mergerequestIId, options) {
    return RequestHelper.put()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/merge`,
      options
    );
  }
  mergeToDefault(projectId, mergerequestIId, options) {
    return RequestHelper.put()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/merge_ref`,
      options
    );
  }
  rebase(projectId, mergerequestIId, { skipCI, ...options } = {}) {
    return RequestHelper.put()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/rebase`,
      {
        ...options,
        skipCi: skipCI
      }
    );
  }
  remove(projectId, mergerequestIId, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}`,
      options
    );
  }
  resetSpentTime(projectId, mergerequestIId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/reset_spent_time`,
      options
    );
  }
  resetTimeEstimate(projectId, mergerequestIId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/reset_time_estimate`,
      options
    );
  }
  setTimeEstimate(projectId, mergerequestIId, duration, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/time_estimate`,
      {
        duration,
        ...options
      }
    );
  }
  show(projectId, mergerequestIId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}`,
      options
    );
  }
  showChanges(projectId, mergerequestIId, options) {
    process.emitWarning(
      'This endpoint was deprecated in GitLab API 15.7 and will be removed in API v5. Please use the "allDiffs" function instead.',
      "DeprecationWarning"
    );
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/changes`,
      options
    );
  }
  showDiffVersion(projectId, mergerequestIId, versionId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/versions/${versionId}`,
      options
    );
  }
  showTimeStats(projectId, mergerequestIId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/time_stats`,
      options
    );
  }
  subscribe(projectId, mergerequestIId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/subscribe`,
      options
    );
  }
  unsubscribe(projectId, mergerequestIId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/unsubscribe`,
      options
    );
  }
  showReviewers(projectId, mergerequestIId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/merge_requests/${mergerequestIId}/reviewers`,
      options
    );
  }
};
var MergeTrains = class extends BaseResource {
  all(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/merge_trains`,
      options
    );
  }
  showStatus(projectId, mergeRequestIId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/merge_trains/merge_requests/${mergeRequestIId}`,
      options
    );
  }
  addMergeRequest(projectId, mergeRequestIId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/merge_trains/merge_requests/${mergeRequestIId}`,
      options
    );
  }
};
var PackageRegistry = class extends BaseResource {
  publish(projectId, packageName, packageVersion, packageFile, {
    contentType,
    ...options
  } = {}) {
    return RequestHelper.put()(
      this,
      endpoint`projects/${projectId}/packages/generic/${packageName}/${packageVersion}/${packageFile.filename}`,
      {
        isForm: true,
        file: [packageFile.content, packageFile.filename],
        ...options
      }
    );
  }
  download(projectId, packageName, packageVersion, filename, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/packages/generic/${packageName}/${packageVersion}/${filename}`,
      options
    );
  }
};
var Packages = class extends BaseResource {
  all({
    projectId,
    groupId,
    ...options
  } = {}) {
    let url12;
    if (projectId) url12 = endpoint`projects/${projectId}/packages`;
    else if (groupId) url12 = endpoint`groups/${groupId}/packages`;
    else {
      throw new Error(
        "Missing required argument. Please supply a projectId or a groupId in the options parameter."
      );
    }
    return RequestHelper.get()(this, url12, options);
  }
  allFiles(projectId, packageId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/packages/${packageId}/package_files`,
      options
    );
  }
  remove(projectId, packageId, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/packages/${packageId}`,
      options
    );
  }
  removeFile(projectId, packageId, projectFileId, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/packages/${packageId}/package_files/${projectFileId}`,
      options
    );
  }
  show(projectId, packageId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/packages/${packageId}`,
      options
    );
  }
};
var PagesDomains = class extends BaseResource {
  all({
    projectId,
    ...options
  } = {}) {
    const prefix = projectId ? endpoint`projects/${projectId}/` : "";
    return RequestHelper.get()(this, `${prefix}pages/domains`, options);
  }
  create(projectId, domain, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/pages/domains`,
      {
        domain,
        ...options
      }
    );
  }
  edit(projectId, domain, options) {
    return RequestHelper.put()(
      this,
      endpoint`projects/${projectId}/pages/domains/${domain}`,
      options
    );
  }
  show(projectId, domain, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/pages/domains/${domain}`,
      options
    );
  }
  remove(projectId, domain, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/pages/domains/${domain}`,
      options
    );
  }
};
var PipelineScheduleVariables = class extends BaseResource {
  all(projectId, pipelineScheduleId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/pipeline_schedules/${pipelineScheduleId}/variables`,
      options
    );
  }
  create(projectId, pipelineScheduleId, key, value, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/pipeline_schedules/${pipelineScheduleId}/variables`,
      {
        ...options,
        key,
        value
      }
    );
  }
  edit(projectId, pipelineScheduleId, key, value, options) {
    return RequestHelper.put()(
      this,
      endpoint`projects/${projectId}/pipeline_schedules/${pipelineScheduleId}/variables/${key}`,
      {
        ...options,
        value
      }
    );
  }
  remove(projectId, pipelineScheduleId, key, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/pipeline_schedules/${pipelineScheduleId}/variables/${key}`,
      options
    );
  }
};
var PipelineSchedules = class extends BaseResource {
  all(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/pipeline_schedules`,
      options
    );
  }
  allTriggeredPipelines(projectId, pipelineScheduleId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/pipeline_schedules/${pipelineScheduleId}/pipelines`,
      options
    );
  }
  create(projectId, description, ref, cron, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/pipeline_schedules`,
      {
        description,
        ref,
        cron,
        ...options
      }
    );
  }
  edit(projectId, pipelineScheduleId, options) {
    return RequestHelper.put()(
      this,
      endpoint`projects/${projectId}/pipeline_schedules/${pipelineScheduleId}`,
      options
    );
  }
  remove(projectId, pipelineScheduleId, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/pipeline_schedules/${pipelineScheduleId}`,
      options
    );
  }
  run(projectId, pipelineScheduleId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/pipeline_schedules/${pipelineScheduleId}/play`,
      options
    );
  }
  show(projectId, pipelineScheduleId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/pipeline_schedules/${pipelineScheduleId}`,
      options
    );
  }
  takeOwnership(projectId, pipelineScheduleId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/pipeline_schedules/${pipelineScheduleId}/take_ownership`,
      options
    );
  }
};
var PipelineTriggerTokens = class extends BaseResource {
  all(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/triggers`,
      options
    );
  }
  create(projectId, description, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/triggers`,
      {
        description,
        ...options
      }
    );
  }
  edit(projectId, triggerId, options) {
    return RequestHelper.put()(
      this,
      endpoint`projects/${projectId}/triggers/${triggerId}`,
      options
    );
  }
  remove(projectId, triggerId, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/triggers/${triggerId}`,
      options
    );
  }
  show(projectId, triggerId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/triggers/${triggerId}`,
      options
    );
  }
  trigger(projectId, ref, token, { variables, ...options } = {}) {
    const opts = {
      ...options,
      searchParams: {
        token,
        ref
      }
    };
    if (variables) {
      opts.isForm = true;
      Object.assign(opts, reformatObjectOptions(variables, "variables"));
    }
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/trigger/pipeline`,
      opts
    );
  }
};
var Pipelines = class extends BaseResource {
  all(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/pipelines`,
      options
    );
  }
  allVariables(projectId, pipelineId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/pipelines/${pipelineId}/variables`,
      options
    );
  }
  cancel(projectId, pipelineId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/pipelines/${pipelineId}/cancel`,
      options
    );
  }
  create(projectId, ref, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/pipeline`,
      {
        ref,
        ...options
      }
    );
  }
  remove(projectId, pipelineId, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/pipelines/${pipelineId}`,
      options
    );
  }
  retry(projectId, pipelineId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/pipelines/${pipelineId}/retry`,
      options
    );
  }
  show(projectId, pipelineId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/pipelines/${pipelineId}`,
      options
    );
  }
  showLatest(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/pipelines/latest`,
      options
    );
  }
  showTestReport(projectId, pipelineId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/pipelines/${pipelineId}/test_report`,
      options
    );
  }
  showTestReportSummary(projectId, pipelineId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/pipelines/${pipelineId}/test_report_summary`,
      options
    );
  }
};
var ProductAnalytics = class extends BaseResource {
  allFunnels(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/product_analytics/funnels`,
      options
    );
  }
  load(projectId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/product_analytics/request/load`,
      options
    );
  }
  dryRun(projectId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/product_analytics/request/dry-run`,
      options
    );
  }
  showMetadata(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/product_analytics/request/meta`,
      options
    );
  }
};

// src/resources/ProjectAccessRequests.ts
var ProjectAccessRequests = class extends ResourceAccessRequests {
  constructor(options) {
    super("projects", options);
  }
};

// src/resources/ProjectAccessTokens.ts
var ProjectAccessTokens = class extends ResourceAccessTokens {
  constructor(options) {
    super("projects", options);
  }
};
var ProjectAliases = class extends BaseResource {
  all(options) {
    return RequestHelper.get()(this, "project_aliases", options);
  }
  create(projectId, name, options) {
    return RequestHelper.post()(this, "project_aliases", {
      name,
      projectId,
      ...options
    });
  }
  edit(name, options) {
    return RequestHelper.post()(this, `project_aliases/${name}`, options);
  }
  remove(name, options) {
    return RequestHelper.del()(this, `project_aliases/${name}`, options);
  }
};

// src/resources/ProjectBadges.ts
var ProjectBadges = class extends ResourceBadges {
  constructor(options) {
    super("projects", options);
  }
};

// src/resources/ProjectCustomAttributes.ts
var ProjectCustomAttributes = class extends ResourceCustomAttributes {
  constructor(options) {
    super("projects", options);
  }
};

// src/resources/ProjectDORA4Metrics.ts
var ProjectDORA4Metrics = class extends ResourceDORA4Metrics {
  constructor(options) {
    super("projects", options);
  }
};

// src/resources/ProjectHooks.ts
var ProjectHooks = class extends ResourceHooks {
  constructor(options) {
    super("projects", options);
  }
};
var ProjectImportExports = class extends BaseResource {
  download(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/export/download`,
      options
    );
  }
  import(file, path, options) {
    return RequestHelper.post()(this, "projects/import", {
      isForm: true,
      ...options,
      file: [file.content, file.filename],
      path
    });
  }
  importRemote(url12, path, options) {
    return RequestHelper.post()(this, "projects/remote-import", {
      ...options,
      path,
      url: url12
    });
  }
  importRemoteS3(accessKeyId, bucketName, fileKey, path, region, secretAccessKey, options) {
    return RequestHelper.post()(this, "projects/remote-import", {
      ...options,
      accessKeyId,
      bucketName,
      fileKey,
      path,
      region,
      secretAccessKey
    });
  }
  showExportStatus(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/export`,
      options
    );
  }
  showImportStatus(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/import`,
      options
    );
  }
  scheduleExport(projectId, uploadConfig, options) {
    return RequestHelper.post()(this, endpoint`projects/${projectId}/export`, {
      ...options,
      upload: uploadConfig
    });
  }
};

// src/resources/ProjectInvitations.ts
var ProjectInvitations = class extends ResourceInvitations {
  constructor(options) {
    super("projects", options);
  }
};

// src/resources/ProjectIssueBoards.ts
var ProjectIssueBoards = class extends ResourceIssueBoards {
  constructor(options) {
    super("projects", options);
  }
};

// src/resources/ProjectIterations.ts
var ProjectIterations = class extends ResourceIterations {
  constructor(options) {
    super("project", options);
  }
};
var ProjectJobTokenScopes = class extends BaseResource {
  show(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/job_token_scope`,
      options
    );
  }
  edit(projectId, enabled, options) {
    return RequestHelper.patch()(
      this,
      endpoint`projects/${projectId}/job_token_scope`,
      { ...options, enabled }
    );
  }
  showInboundAllowList(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/job_token_scope/allowlist`,
      options
    );
  }
  addToInboundAllowList(projectId, targetProjectId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/job_token_scope/allowlist`,
      { ...options, targetProjectId }
    );
  }
  removeFromInboundAllowList(projectId, targetProjectId, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/job_token_scope/allowlist/${targetProjectId}`,
      options
    );
  }
  showGroupsAllowList(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/job_token_scope/groups_allowlist`,
      options
    );
  }
  addToGroupsAllowList(projectId, targetGroupId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/job_token_scope/groups_allowlist`,
      { ...options, targetGroupId }
    );
  }
  removeFromGroupsAllowList(projectId, targetGroupId, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/job_token_scope/groups_allowlist/${targetGroupId}`,
      options
    );
  }
};

// src/resources/ProjectLabels.ts
var ProjectLabels = class extends ResourceLabels {
  constructor(options) {
    super("projects", options);
  }
};

// src/resources/ProjectMarkdownUploads.ts
var ProjectMarkdownUploads = class extends ResourceMarkdownUploads {
  constructor(options) {
    super("projects", options);
  }
  create(projectId, file, options) {
    return RequestHelper.post()(this, endpoint`${projectId}/uploads`, {
      isForm: true,
      ...options,
      file: [file.content, file.filename]
    });
  }
};

// src/resources/ProjectMembers.ts
var ProjectMembers = class extends ResourceMembers {
  constructor(options) {
    super("projects", options);
  }
};

// src/resources/ProjectMilestones.ts
var ProjectMilestones = class extends ResourceMilestones {
  constructor(options) {
    super("projects", options);
  }
  promote(projectId, milestoneId, options) {
    return RequestHelper.post()(
      this,
      endpoint`${projectId}/milestones/${milestoneId}/promote`,
      options
    );
  }
};

// src/resources/ProjectProtectedEnvironments.ts
var ProjectProtectedEnvironments = class extends ResourceProtectedEnvironments {
  constructor(options) {
    super("projects", options);
  }
};

// src/resources/ProjectPushRules.ts
var ProjectPushRules = class extends ResourcePushRules {
  constructor(options) {
    super("projects", options);
  }
};
var ProjectRelationsExport = class extends BaseResource {
  download(projectId, relation, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/export_relations/download`,
      {
        relation,
        ...options
      }
    );
  }
  showExportStatus(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/export_relations/status`,
      options
    );
  }
  scheduleExport(projectId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/export_relations`,
      options
    );
  }
};
var ProjectReleases = class extends BaseResource {
  all(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/releases`,
      options
    );
  }
  create(projectId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/releases`,
      options
    );
  }
  createEvidence(projectId, tagName, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/releases/${tagName}/evidence`,
      options
    );
  }
  edit(projectId, tagName, options) {
    return RequestHelper.put()(
      this,
      endpoint`projects/${projectId}/releases/${tagName}`,
      options
    );
  }
  download(projectId, tagName, filepath, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/releases/${tagName}/downloads/${filepath}`,
      options
    );
  }
  downloadLatest(projectId, filepath, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/releases/permalink/latest/downloads/${filepath}`,
      options
    );
  }
  remove(projectId, tagName, options) {
    return RequestHelper.del()(this, endpoint`projects/${projectId}/releases/${tagName}`, options);
  }
  show(projectId, tagName, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/releases/${tagName}`,
      options
    );
  }
  showLatest(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/releases/permalink/latest`,
      options
    );
  }
  showLatestEvidence(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/releases/permalink/latest/evidence`,
      options
    );
  }
};
var ProjectRemoteMirrors = class extends BaseResource {
  all(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/remote_mirrors`,
      options
    );
  }
  // Helper method - Duplicated from Projects
  createPullMirror(projectId, url12, mirror, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/mirror/pull`,
      {
        importUrl: url12,
        mirror,
        ...options
      }
    );
  }
  createPushMirror(projectId, url12, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/remote_mirrors`,
      {
        url: url12,
        ...options
      }
    );
  }
  edit(projectId, mirrorId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/remote_mirrors/${mirrorId}`,
      options
    );
  }
  remove(projectId, mirrorId, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/remote_mirrors/${mirrorId}`,
      options
    );
  }
  show(projectId, mirrorId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/remote_mirrors/${mirrorId}`,
      options
    );
  }
  sync(projectId, mirrorId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/remote_mirrors/${mirrorId}/sync`,
      options
    );
  }
};

// src/resources/ProjectRepositoryStorageMoves.ts
var ProjectRepositoryStorageMoves = class extends ResourceRepositoryStorageMoves {
  constructor(options) {
    super("projects", options);
  }
};

// src/resources/ProjectSnippetAwardEmojis.ts
var ProjectSnippetAwardEmojis = class extends ResourceAwardEmojis {
  constructor(options) {
    super("projects", "snippets", options);
  }
};

// src/resources/ProjectSnippetDiscussions.ts
var ProjectSnippetDiscussions = class extends ResourceDiscussions {
  constructor(options) {
    super("projects", "snippets", options);
  }
};

// src/resources/ProjectSnippetNotes.ts
var ProjectSnippetNotes = class extends ResourceNotes {
  constructor(options) {
    super("projects", "snippets", options);
  }
};
var ProjectSnippets = class extends BaseResource {
  all(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/snippets`,
      options
    );
  }
  create(projectId, title, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/snippets`,
      {
        title,
        ...options
      }
    );
  }
  edit(projectId, snippetId, options) {
    return RequestHelper.put()(
      this,
      endpoint`projects/${projectId}/snippets/${snippetId}`,
      options
    );
  }
  remove(projectId, snippetId, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/snippets/${snippetId}`,
      options
    );
  }
  show(projectId, snippetId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/snippets/${snippetId}`,
      options
    );
  }
  showContent(projectId, snippetId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/snippets/${snippetId}/raw`,
      options
    );
  }
  showRepositoryFileContent(projectId, snippetId, ref, filePath, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/snippets/${snippetId}/files/${ref}/${filePath}/raw`,
      options
    );
  }
  showUserAgentDetails(projectId, snippetId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/snippets/${snippetId}/user_agent_detail`,
      options
    );
  }
};
var ProjectStatistics = class extends BaseResource {
  show(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/statistics`,
      options
    );
  }
};
var ProjectTemplates = class extends BaseResource {
  all(projectId, type, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/templates/${type}`,
      options
    );
  }
  show(projectId, type, name, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/templates/${type}/${name}`,
      options
    );
  }
};
var ProjectTerraformState = class extends BaseResource {
  show(projectId, name, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/terraform/state/${name}`,
      options
    );
  }
  showVersion(projectId, name, serial, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/terraform/state/${name}/versions/${serial}`,
      options
    );
  }
  removeVersion(projectId, name, serial, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/terraform/state/${name}/versions/${serial}`,
      options
    );
  }
  remove(projectId, name, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/terraform/state/${name}`,
      options
    );
  }
  removeTerraformStateLock(projectId, name, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/terraform/state/${name}/lock`,
      options
    );
  }
  createVersion(projectId, name, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/terraform/state/${name}`,
      options
    );
  }
};

// src/resources/ProjectVariables.ts
var ProjectVariables = class extends ResourceVariables {
  constructor(options) {
    super("projects", options);
  }
};
var ProjectVulnerabilities = class extends BaseResource {
  all(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/vulnerabilities`,
      options
    );
  }
  create(projectId, findingId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/vulnerabilities`,
      {
        ...options,
        searchParams: {
          findingId
        }
      }
    );
  }
};

// src/resources/ProjectWikis.ts
var ProjectWikis = class extends ResourceWikis {
  constructor(options) {
    super("projects", options);
  }
};
var Projects = class extends BaseResource {
  all({
    userId,
    starredOnly,
    ...options
  } = {}) {
    let uri;
    if (userId && starredOnly) uri = endpoint`users/${userId}/starred_projects`;
    else if (userId) uri = endpoint`users/${userId}/projects`;
    else uri = "projects";
    return RequestHelper.get()(this, uri, options);
  }
  allTransferLocations(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/transfer_locations`,
      options
    );
  }
  allUsers(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/users`,
      options
    );
  }
  allGroups(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/groups`,
      options
    );
  }
  allInvitedGroups(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/invited_groups`,
      options
    );
  }
  allSharableGroups(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/share_locations`,
      options
    );
  }
  allForks(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/forks`,
      options
    );
  }
  allStarrers(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/starrers`,
      options
    );
  }
  allStoragePaths(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/storage`,
      options
    );
  }
  archive(projectId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/archive`,
      options
    );
  }
  create({
    userId,
    avatar,
    ...options
  } = {}) {
    const url12 = userId ? `projects/user/${userId}` : "projects";
    if (avatar) {
      return RequestHelper.post()(this, url12, {
        ...options,
        isForm: true,
        avatar: [avatar.content, avatar.filename]
      });
    }
    return RequestHelper.post()(this, url12, { ...options, avatar });
  }
  createForkRelationship(projectId, forkedFromId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/fork/${forkedFromId}`,
      options
    );
  }
  // Helper method - Duplicated from ProjectRemoteMirrors
  createPullMirror(projectId, url12, mirror, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/mirror/pull`,
      {
        importUrl: url12,
        mirror,
        ...options
      }
    );
  }
  downloadSnapshot(projectId, options) {
    return RequestHelper.get()(this, endpoint`projects/${projectId}/snapshot`, options);
  }
  edit(projectId, { avatar, ...options } = {}) {
    const url12 = endpoint`projects/${projectId}`;
    if (avatar) {
      return RequestHelper.put()(this, url12, {
        ...options,
        isForm: true,
        avatar: [avatar.content, avatar.filename]
      });
    }
    return RequestHelper.put()(this, url12, { ...options, avatar });
  }
  fork(projectId, options) {
    return RequestHelper.post()(this, endpoint`projects/${projectId}/fork`, options);
  }
  housekeeping(projectId, options) {
    return RequestHelper.post()(this, endpoint`projects/${projectId}/housekeeping`, options);
  }
  importProjectMembers(projectId, sourceProjectId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/import_project_members/${sourceProjectId}`,
      options
    );
  }
  remove(projectId, options) {
    return RequestHelper.del()(this, endpoint`projects/${projectId}`, options);
  }
  removeForkRelationship(projectId, options) {
    return RequestHelper.del()(this, endpoint`projects/${projectId}/fork`, options);
  }
  removeAvatar(projectId, options) {
    return RequestHelper.put()(this, endpoint`projects/${projectId}`, {
      ...options,
      avatar: ""
    });
  }
  restore(projectId, options) {
    return RequestHelper.post()(this, endpoint`projects/${projectId}/restore`, options);
  }
  search(projectName, options) {
    return RequestHelper.get()(this, "projects", {
      search: projectName,
      ...options
    });
  }
  share(projectId, groupId, groupAccess, options) {
    return RequestHelper.post()(this, endpoint`projects/${projectId}/share`, {
      groupId,
      groupAccess,
      ...options
    });
  }
  show(projectId, options) {
    return RequestHelper.get()(this, endpoint`projects/${projectId}`, options);
  }
  showLanguages(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/languages`,
      options
    );
  }
  showPullMirror(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/mirror/pull`,
      options
    );
  }
  star(projectId, options) {
    return RequestHelper.post()(this, endpoint`projects/${projectId}/star`, options);
  }
  transfer(projectId, namespaceId, options) {
    return RequestHelper.put()(this, endpoint`projects/${projectId}/transfer`, {
      ...options,
      namespace: namespaceId
    });
  }
  unarchive(projectId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/unarchive`,
      options
    );
  }
  unshare(projectId, groupId, options) {
    return RequestHelper.del()(this, endpoint`projects/${projectId}/share/${groupId}`, options);
  }
  unstar(projectId, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/unstar`,
      options
    );
  }
  /* Upload file to be used a reference within an issue, merge request or
     comment
  */
  uploadForReference(projectId, file, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/uploads`,
      {
        ...options,
        isForm: true,
        file: [file.content, file.filename]
      }
    );
  }
  uploadAvatar(projectId, avatar, options) {
    return RequestHelper.put()(this, endpoint`projects/${projectId}`, {
      ...options,
      isForm: true,
      avatar: [avatar.content, avatar.filename]
    });
  }
};
var ProtectedBranches = class extends BaseResource {
  all(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/protected_branches`,
      options
    );
  }
  create(projectId, branchName, options) {
    const { sudo, showExpanded, ...opts } = options || {};
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/protected_branches`,
      {
        searchParams: {
          ...opts,
          name: branchName
        },
        sudo,
        showExpanded
      }
    );
  }
  // Convenience method - create
  protect(projectId, branchName, options) {
    return this.create(projectId, branchName, options);
  }
  edit(projectId, branchName, options) {
    return RequestHelper.patch()(
      this,
      endpoint`projects/${projectId}/protected_branches/${branchName}`,
      options
    );
  }
  show(projectId, branchName, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/protected_branches/${branchName}`,
      options
    );
  }
  remove(projectId, branchName, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/protected_branches/${branchName}`,
      options
    );
  }
  // Convenience method - remove
  unprotect(projectId, branchName, options) {
    return this.remove(projectId, branchName, options);
  }
};
var ProtectedTags = class extends BaseResource {
  all(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/protected_tags`,
      options
    );
  }
  create(projectId, tagName, options) {
    const { sudo, showExpanded, ...opts } = options || {};
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/protected_tags`,
      {
        searchParams: {
          name: tagName,
          ...opts
        },
        sudo,
        showExpanded
      }
    );
  }
  // Convenience method - create
  protect(projectId, tagName, options) {
    return this.create(projectId, tagName, options);
  }
  show(projectId, tagName, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/protected_tags/${tagName}`,
      options
    );
  }
  remove(projectId, tagName, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/protected_tags/${tagName}`,
      options
    );
  }
  // Convenience method - remove
  unprotect(projectId, tagName, options) {
    return this.remove(projectId, tagName, options);
  }
};
var ReleaseLinks = class extends BaseResource {
  all(projectId, tagName, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/releases/${tagName}/assets/links`,
      options
    );
  }
  create(projectId, tagName, name, url12, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/releases/${tagName}/assets/links`,
      {
        name,
        url: url12,
        ...options
      }
    );
  }
  edit(projectId, tagName, linkId, options) {
    return RequestHelper.put()(
      this,
      endpoint`projects/${projectId}/releases/${tagName}/assets/links/${linkId}`,
      options
    );
  }
  remove(projectId, tagName, linkId, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/releases/${tagName}/assets/links/${linkId}`,
      options
    );
  }
  show(projectId, tagName, linkId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/releases/${tagName}/assets/links/${linkId}`,
      options
    );
  }
};
var Repositories = class extends BaseResource {
  allContributors(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/repository/contributors`,
      options
    );
  }
  allRepositoryTrees(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/repository/tree`,
      options
    );
  }
  compare(projectId, from, to, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/repository/compare`,
      {
        from,
        to,
        ...options
      }
    );
  }
  editChangelog(projectId, version, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/repository/changelog`,
      { ...options, version }
    );
  }
  mergeBase(projectId, refs, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/repository/merge_base`,
      {
        ...options,
        refs
      }
    );
  }
  showArchive(projectId, {
    fileType = "tar.gz",
    ...options
  } = {}) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/repository/archive.${fileType}`,
      options
    );
  }
  showBlob(projectId, sha, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/repository/blobs/${sha}`,
      options
    );
  }
  showBlobRaw(projectId, sha, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/repository/blobs/${sha}/raw`,
      options
    );
  }
  showChangelog(projectId, version, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/repository/changelog`,
      { ...options, version }
    );
  }
};
var RepositoryFiles = class extends BaseResource {
  allFileBlames(projectId, filePath, ref, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/repository/files/${filePath}/blame`,
      {
        ref,
        ...options
      }
    );
  }
  create(projectId, filePath, branch, content, commitMessage, options) {
    return RequestHelper.post()(
      this,
      endpoint`projects/${projectId}/repository/files/${filePath}`,
      {
        branch,
        content,
        commitMessage,
        ...options
      }
    );
  }
  edit(projectId, filePath, branch, content, commitMessage, options) {
    return RequestHelper.put()(
      this,
      endpoint`projects/${projectId}/repository/files/${filePath}`,
      {
        branch,
        content,
        commitMessage,
        ...options
      }
    );
  }
  remove(projectId, filePath, branch, commitMessage, options) {
    return RequestHelper.del()(this, endpoint`projects/${projectId}/repository/files/${filePath}`, {
      branch,
      commitMessage,
      ...options
    });
  }
  show(projectId, filePath, ref, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/repository/files/${filePath}`,
      {
        ref,
        ...options
      }
    );
  }
  showRaw(projectId, filePath, ref, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/repository/files/${filePath}/raw`,
      {
        ref,
        ...options
      }
    );
  }
};
var RepositorySubmodules = class extends BaseResource {
  edit(projectId, submodule, branch, commitSha, options) {
    return RequestHelper.put()(
      this,
      endpoint`projects/${projectId}/repository/submodules/${submodule}`,
      {
        branch,
        commitSha,
        ...options
      }
    );
  }
};
var ResourceGroups = class extends BaseResource {
  all(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/resource_groups`,
      options
    );
  }
  edit(projectId, key, options) {
    return RequestHelper.put()(
      this,
      endpoint`projects/${projectId}/resource_groups/${key}`,
      options
    );
  }
  show(projectId, key, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/resource_groups/${key}`,
      options
    );
  }
  allUpcomingJobs(projectId, key, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/resource_groups/${key}/upcoming_jobs`,
      options
    );
  }
};
var Runners = class extends BaseResource {
  all({
    projectId,
    groupId,
    owned,
    ...options
  } = {}) {
    let url12;
    if (projectId) url12 = endpoint`projects/${projectId}/runners`;
    else if (groupId) url12 = endpoint`groups/${groupId}/runners`;
    else if (owned) url12 = "runners";
    else url12 = "runners/all";
    return RequestHelper.get()(this, url12, options);
  }
  allJobs(runnerId, options) {
    return RequestHelper.get()(this, `runners/${runnerId}/jobs`, options);
  }
  // https://docs.gitlab.com/15.9/ee/api/runners.html#register-a-new-runner
  create(token, options) {
    return RequestHelper.post()(this, `runners`, {
      token,
      ...options
    });
  }
  edit(runnerId, options) {
    return RequestHelper.put()(this, `runners/${runnerId}`, options);
  }
  enable(projectId, runnerId, options) {
    return RequestHelper.post()(this, endpoint`projects/${projectId}/runners`, {
      runnerId,
      ...options
    });
  }
  disable(projectId, runnerId, options) {
    return RequestHelper.del()(this, endpoint`projects/${projectId}/runners/${runnerId}`, options);
  }
  // Create - Convenience method
  register(token, options) {
    return this.create(token, options);
  }
  remove({
    runnerId,
    token,
    ...options
  }) {
    let url12;
    if (runnerId) url12 = `runners/${runnerId}`;
    else if (token) {
      url12 = "runners";
    } else
      throw new Error(
        "Missing required argument. Please supply a runnerId or a token in the options parameter"
      );
    return RequestHelper.del()(this, url12, {
      token,
      ...options
    });
  }
  resetRegistrationToken({
    runnerId,
    token,
    ...options
  } = {}) {
    let url12;
    if (runnerId) url12 = endpoint`runners/${runnerId}/reset_registration_token`;
    else if (token) url12 = "runners/reset_registration_token";
    else {
      throw new Error("Missing either runnerId or token parameters");
    }
    return RequestHelper.post()(this, url12, {
      token,
      ...options
    });
  }
  show(runnerId, options) {
    return RequestHelper.get()(this, `runners/${runnerId}`, options);
  }
  verify(options) {
    return RequestHelper.post()(this, `runners/verify`, options);
  }
};
var SecureFiles = class extends BaseResource {
  all(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/secure_files`,
      options
    );
  }
  create(projectId, name, file, options) {
    return RequestHelper.post()(this, `projects/${projectId}/secure_files`, {
      isForm: true,
      ...options,
      file: [file.content, file.filename],
      name
    });
  }
  download(projectId, secureFileId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/secure_files/${secureFileId}/download`,
      options
    );
  }
  remove(projectId, secureFileId, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/secure_files/${secureFileId}`,
      options
    );
  }
  show(projectId, secureFileId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/secure_files/${secureFileId}`,
      options
    );
  }
};
var Tags = class extends BaseResource {
  all(projectId, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/repository/tags`,
      options
    );
  }
  create(projectId, tagName, ref, options) {
    return RequestHelper.post()(this, endpoint`projects/${projectId}/repository/tags`, {
      searchParams: {
        tagName,
        ref
      },
      ...options
    });
  }
  remove(projectId, tagName, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/repository/tags/${tagName}`,
      options
    );
  }
  show(projectId, tagName, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/repository/tags/${tagName}`,
      options
    );
  }
  showSignature(projectId, tagName, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/repository/tags/${tagName}/signature`,
      options
    );
  }
};
var UserStarredMetricsDashboard = class extends BaseResource {
  create(projectId, dashboardPath, options) {
    return RequestHelper.get()(
      this,
      endpoint`projects/${projectId}/metrics/user_starred_dashboards`,
      {
        dashboardPath,
        ...options
      }
    );
  }
  remove(projectId, options) {
    return RequestHelper.del()(
      this,
      endpoint`projects/${projectId}/metrics/user_starred_dashboards`,
      options
    );
  }
};

// src/resources/EpicAwardEmojis.ts
var EpicAwardEmojis = class extends ResourceAwardEmojis {
  constructor(options) {
    super("epics", "issues", options);
  }
};

// src/resources/EpicDiscussions.ts
var EpicDiscussions = class extends ResourceDiscussions {
  constructor(options) {
    super("groups", "epics", options);
  }
};
var EpicIssues = class extends BaseResource {
  all(groupId, epicIId, options) {
    return RequestHelper.get()(
      this,
      endpoint`groups/${groupId}/epics/${epicIId}/issues`,
      options
    );
  }
  assign(groupId, epicIId, epicIssueId, options) {
    return RequestHelper.post()(
      this,
      endpoint`groups/${groupId}/epics/${epicIId}/issues/${epicIssueId}`,
      options
    );
  }
  edit(groupId, epicIId, epicIssueId, options) {
    return RequestHelper.put()(
      this,
      endpoint`groups/${groupId}/epics/${epicIId}/issues/${epicIssueId}`,
      options
    );
  }
  remove(groupId, epicIId, epicIssueId, options) {
    return RequestHelper.del()(
      this,
      endpoint`groups/${groupId}/epics/${epicIId}/issues/${epicIssueId}`,
      options
    );
  }
};

// src/resources/EpicLabelEvents.ts
var EpicLabelEvents = class extends ResourceLabelEvents {
  constructor(options) {
    super("groups", "epics", options);
  }
};
var EpicLinks = class extends BaseResource {
  all(groupId, epicIId, options) {
    return RequestHelper.get()(
      this,
      endpoint`groups/${groupId}/epics/${epicIId}/links`,
      options
    );
  }
  assign(groupId, epicIId, childEpicId, options) {
    return RequestHelper.post()(
      this,
      endpoint`groups/${groupId}/epics/${epicIId}/links/${childEpicId}`,
      options
    );
  }
  create(groupId, epicIId, title, options) {
    return RequestHelper.post()(
      this,
      endpoint`groups/${groupId}/epics/${epicIId}/links`,
      {
        searchParams: {
          title
        },
        ...options
      }
    );
  }
  reorder(groupId, epicIId, childEpicId, options) {
    return RequestHelper.put()(
      this,
      endpoint`groups/${groupId}/epics/${epicIId}/links/${childEpicId}`,
      options
    );
  }
  unassign(groupId, epicIId, childEpicId, options) {
    return RequestHelper.del()(
      this,
      endpoint`groups/${groupId}/epics/${epicIId}/links/${childEpicId}`,
      options
    );
  }
};

// src/resources/EpicNotes.ts
var EpicNotes = class extends ResourceNotes {
  constructor(options) {
    super("groups", "epics", options);
  }
};
var Epics = class extends BaseResource {
  all(groupId, options) {
    return RequestHelper.get()(this, endpoint`groups/${groupId}/epics`, options);
  }
  create(groupId, title, options) {
    return RequestHelper.post()(this, endpoint`groups/${groupId}/epics`, {
      title,
      ...options
    });
  }
  createTodo(groupId, epicIId, options) {
    return RequestHelper.post()(
      this,
      endpoint`groups/${groupId}/epics/${epicIId}/todos`,
      options
    );
  }
  edit(groupId, epicIId, options) {
    return RequestHelper.put()(
      this,
      endpoint`groups/${groupId}/epics/${epicIId}`,
      options
    );
  }
  remove(groupId, epicIId, options) {
    return RequestHelper.del()(this, endpoint`groups/${groupId}/epics/${epicIId}`, options);
  }
  show(groupId, epicIId, options) {
    return RequestHelper.get()(
      this,
      endpoint`groups/${groupId}/epics/${epicIId}`,
      options
    );
  }
};

// src/resources/GroupAccessRequests.ts
var GroupAccessRequests = class extends ResourceAccessRequests {
  constructor(options) {
    super("groups", options);
  }
};

// src/resources/GroupAccessTokens.ts
var GroupAccessTokens = class extends ResourceAccessTokens {
  constructor(options) {
    super("groups", options);
  }
};
var GroupActivityAnalytics = class extends BaseResource {
  showIssuesCount(groupPath, options) {
    return RequestHelper.get()(
      this,
      "analytics/group_activity/issues_count",
      {
        searchParams: {
          groupPath
        },
        ...options
      }
    );
  }
  showMergeRequestsCount(groupPath, options) {
    return RequestHelper.get()(
      this,
      "analytics/group_activity/merge_requests_count",
      {
        searchParams: {
          groupPath
        },
        ...options
      }
    );
  }
  showNewMembersCount(groupPath, options) {
    return RequestHelper.get()(
      this,
      "analytics/group_activity/new_members_count",
      {
        searchParams: {
          groupPath
        },
        ...options
      }
    );
  }
};

// src/resources/GroupBadges.ts
var GroupBadges = class extends ResourceBadges {
  constructor(options) {
    super("groups", options);
  }
};

// src/resources/GroupCustomAttributes.ts
var GroupCustomAttributes = class extends ResourceCustomAttributes {
  constructor(options) {
    super("groups", options);
  }
};

// src/resources/GroupDORA4Metrics.ts
var GroupDORA4Metrics = class extends ResourceDORA4Metrics {
  constructor(options) {
    super("groups", options);
  }
};
var GroupEpicBoards = class extends BaseResource {
  all(groupId, options) {
    return RequestHelper.get()(
      this,
      endpoint`groups/${groupId}/epic_boards`,
      options
    );
  }
  allLists(groupId, boardId, options) {
    return RequestHelper.get()(
      this,
      endpoint`groups/${groupId}/epic_boards/${boardId}/lists`,
      options
    );
  }
  show(groupId, boardId, options) {
    return RequestHelper.get()(
      this,
      endpoint`groups/${groupId}/epic_boards/${boardId}`,
      options
    );
  }
  showList(groupId, boardId, listId, options) {
    return RequestHelper.get()(
      this,
      endpoint`groups/${groupId}/epic_boards/${boardId}/lists/${listId}`,
      options
    );
  }
};

// src/resources/GroupHooks.ts
var GroupHooks = class extends ResourceHooks {
  constructor(options) {
    super("groups", options);
  }
};
var GroupImportExports = class extends BaseResource {
  download(groupId, options) {
    return RequestHelper.get()(
      this,
      endpoint`groups/${groupId}/export/download`,
      options
    );
  }
  import(file, path, { parentId, name, ...options }) {
    return RequestHelper.post()(this, "groups/import", {
      isForm: true,
      ...options,
      file: [file.content, file.filename],
      path,
      name: name || path.split("/").at(0),
      parentId
    });
  }
  scheduleExport(groupId, options) {
    return RequestHelper.post()(
      this,
      endpoint`groups/${groupId}/export`,
      options
    );
  }
};

// src/resources/GroupInvitations.ts
var GroupInvitations = class extends ResourceInvitations {
  constructor(options) {
    super("groups", options);
  }
};

// src/resources/GroupIssueBoards.ts
var GroupIssueBoards = class extends ResourceIssueBoards {
  constructor(options) {
    super("groups", options);
  }
};

// src/resources/GroupIterations.ts
var GroupIterations = class extends ResourceIterations {
  constructor(options) {
    super("groups", options);
  }
};
var GroupLDAPLinks = class extends BaseResource {
  add(groupId, groupAccess, provider, options) {
    return RequestHelper.post()(this, endpoint`groups/${groupId}/ldap_group_links`, {
      groupAccess,
      provider,
      ...options
    });
  }
  all(groupId, options) {
    return RequestHelper.get()(
      this,
      endpoint`groups/${groupId}/ldap_group_links`,
      options
    );
  }
  remove(groupId, provider, options) {
    return RequestHelper.del()(this, endpoint`groups/${groupId}/ldap_group_links`, {
      provider,
      ...options
    });
  }
  sync(groupId, options) {
    return RequestHelper.post()(this, endpoint`groups/${groupId}/ldap_sync`, options);
  }
};

// src/resources/GroupLabels.ts
var GroupLabels = class extends ResourceLabels {
  constructor(options) {
    super("groups", options);
  }
};

// src/resources/GroupMarkdownUploads.ts
var GroupMarkdownUploads = class extends ResourceMarkdownUploads {
  constructor(options) {
    super("groups", options);
  }
};
var GroupMemberRoles = class extends BaseResource {
  add(groupId, baseAccessLevel, options) {
    return RequestHelper.post()(this, endpoint`groups/${groupId}/members`, {
      baseAccessLevel,
      ...options
    });
  }
  all(groupId, options) {
    return RequestHelper.get()(
      this,
      endpoint`groups/${groupId}/member_roles`,
      options
    );
  }
  remove(groupId, memberRoleId, options) {
    return RequestHelper.del()(
      this,
      endpoint`groups/${groupId}/member_roles/${memberRoleId}`,
      options
    );
  }
};

// src/resources/GroupMembers.ts
var GroupMembers = class extends ResourceMembers {
  constructor(options) {
    super("groups", options);
  }
  allBillable(groupId, options) {
    return RequestHelper.get()(
      this,
      endpoint`${groupId}/billable_members`,
      options
    );
  }
  allPending(groupId, options) {
    return RequestHelper.get()(this, endpoint`${groupId}/pending_members`, options);
  }
  allBillableMemberships(groupId, userId, options) {
    return RequestHelper.get()(
      this,
      endpoint`${groupId}/billable_members/${userId}/memberships`,
      options
    );
  }
  approve(groupId, userId, options) {
    return RequestHelper.put()(
      this,
      endpoint`${groupId}/members/${userId}/approve`,
      options
    );
  }
  approveAll(groupId, options) {
    return RequestHelper.put()(
      this,
      endpoint`${groupId}/members/approve_all`,
      options
    );
  }
  removeBillable(groupId, userId, options) {
    return RequestHelper.del()(this, endpoint`${groupId}/billable_members/${userId}`, options);
  }
  removeOverrideFlag(groupId, userId, options) {
    return RequestHelper.del()(
      this,
      endpoint`${groupId}/members/${userId}/override`,
      options
    );
  }
  setOverrideFlag(groupId, userId, options) {
    return RequestHelper.post()(
      this,
      endpoint`${groupId}/members/${userId}/override`,
      options
    );
  }
};

// src/resources/GroupMilestones.ts
var GroupMilestones = class extends ResourceMilestones {
  constructor(options) {
    super("groups", options);
  }
};

// src/resources/GroupProtectedEnvironments.ts
var GroupProtectedEnvironments = class extends ResourceProtectedEnvironments {
  constructor(options) {
    super("groups", options);
  }
};

// src/resources/GroupPushRules.ts
var GroupPushRules = class extends ResourcePushRules {
  constructor(options) {
    super("groups", options);
  }
};
var GroupRelationExports = class extends BaseResource {
  download(groupId, relation, options) {
    return RequestHelper.get()(this, endpoint`groups/${groupId}/export_relations/download`, {
      searchParams: { relation },
      ...options
    });
  }
  exportStatus(groupId, options) {
    return RequestHelper.get()(
      this,
      endpoint`groups/${groupId}/export_relations`,
      options
    );
  }
  scheduleExport(groupId, options) {
    return RequestHelper.post()(
      this,
      endpoint`groups/${groupId}/export_relations`,
      options
    );
  }
};
var GroupReleases = class extends BaseResource {
  all(groupId, options) {
    return RequestHelper.get()(
      this,
      endpoint`groups/${groupId}/releases`,
      options
    );
  }
};

// src/resources/GroupRepositoryStorageMoves.ts
var GroupRepositoryStorageMoves = class extends ResourceRepositoryStorageMoves {
  constructor(options) {
    super("groups", options);
  }
};
var GroupSAMLIdentities = class extends BaseResource {
  all(groupId, options) {
    return RequestHelper.get()(
      this,
      endpoint`groups/${groupId}/saml/identities`,
      options
    );
  }
  edit(groupId, identityId, options) {
    return RequestHelper.patch()(
      this,
      endpoint`groups/${groupId}/saml/${identityId}`,
      options
    );
  }
};
var GroupSAMLLinks = class extends BaseResource {
  all(groupId, options) {
    return RequestHelper.get()(
      this,
      endpoint`groups/${groupId}/saml_group_links`,
      options
    );
  }
  create(groupId, samlGroupName, accessLevel, options) {
    return RequestHelper.post()(
      this,
      endpoint`groups/${groupId}/saml_group_links`,
      {
        accessLevel,
        samlGroupName,
        ...options
      }
    );
  }
  remove(groupId, samlGroupName, options) {
    return RequestHelper.del()(
      this,
      endpoint`groups/${groupId}/saml_group_links/${samlGroupName}`,
      options
    );
  }
  show(groupId, samlGroupName, options) {
    return RequestHelper.get()(
      this,
      endpoint`groups/${groupId}/saml_group_links/${samlGroupName}`,
      options
    );
  }
};
var GroupSCIMIdentities = class extends BaseResource {
  all(groupId, options) {
    return RequestHelper.get()(
      this,
      endpoint`groups/${groupId}/scim/identities`,
      options
    );
  }
  edit(groupId, identityId, options) {
    return RequestHelper.patch()(
      this,
      endpoint`groups/${groupId}/scim/${identityId}`,
      options
    );
  }
};
var GroupServiceAccounts = class extends BaseResource {
  create(groupId, options) {
    return RequestHelper.post()(
      this,
      endpoint`groups/${groupId}/service_accounts`,
      options
    );
  }
  // @deprecated In favor of `createPersonalAccessToken`
  addPersonalAccessToken(groupId, serviceAccountId, options) {
    return this.createPersonalAccessToken(groupId, serviceAccountId, options);
  }
  createPersonalAccessToken(groupId, serviceAccountId, options) {
    return RequestHelper.post()(
      this,
      endpoint`groups/${groupId}/service_accounts/${serviceAccountId}`,
      options
    );
  }
  rotatePersonalAccessToken(groupId, serviceAccountId, tokenId, options) {
    return RequestHelper.post()(
      this,
      endpoint`groups/${groupId}/service_accounts/${serviceAccountId}/personal_access_tokens/${tokenId}/rotate`,
      options
    );
  }
};

// src/resources/GroupVariables.ts
var GroupVariables = class extends ResourceVariables {
  constructor(options) {
    super("groups", options);
  }
};

// src/resources/GroupWikis.ts
var GroupWikis = class extends ResourceWikis {
  constructor(options) {
    super("groups", options);
  }
};
var Groups = class extends BaseResource {
  all(options) {
    return RequestHelper.get()(this, "groups", options);
  }
  allDescendantGroups(groupId, options) {
    return RequestHelper.get()(
      this,
      endpoint`groups/${groupId}/descendant_groups`,
      options
    );
  }
  allProjects(groupId, options) {
    return RequestHelper.get()(
      this,
      endpoint`groups/${groupId}/projects`,
      options
    );
  }
  allSharedProjects(groupId, options) {
    return RequestHelper.get()(
      this,
      endpoint`groups/${groupId}/projects/shared`,
      options
    );
  }
  allSubgroups(groupId, options) {
    return RequestHelper.get()(this, endpoint`groups/${groupId}/subgroups`, options);
  }
  allProvisionedUsers(groupId, options) {
    return RequestHelper.get()(
      this,
      endpoint`groups/${groupId}/provisioned_users`,
      options
    );
  }
  allTransferLocations(groupId, options) {
    return RequestHelper.get()(
      this,
      endpoint`groups/${groupId}/transfer_locations`,
      options
    );
  }
  create(name, path, { avatar, ...options } = {}) {
    if (avatar) {
      return RequestHelper.post()(this, "groups", {
        ...options,
        isForm: true,
        avatar: [avatar.content, avatar.filename],
        name,
        path
      });
    }
    return RequestHelper.post()(this, "groups", { name, path, ...options });
  }
  downloadAvatar(groupId, options) {
    return RequestHelper.get()(this, endpoint`groups/${groupId}/avatar`, options);
  }
  edit(groupId, { avatar, ...options } = {}) {
    if (avatar) {
      return RequestHelper.post()(this, endpoint`groups/${groupId}`, {
        ...options,
        isForm: true,
        avatar: [avatar.content, avatar.filename]
      });
    }
    return RequestHelper.put()(this, endpoint`groups/${groupId}`, options);
  }
  remove(groupId, options) {
    return RequestHelper.del()(this, endpoint`groups/${groupId}`, options);
  }
  removeAvatar(groupId, options) {
    return RequestHelper.put()(this, endpoint`groups/${groupId}`, {
      ...options,
      avatar: ""
    });
  }
  restore(groupId, options) {
    return RequestHelper.post()(this, endpoint`groups/${groupId}/restore`, options);
  }
  search(nameOrPath, options) {
    return RequestHelper.get()(this, "groups", {
      search: nameOrPath,
      ...options
    });
  }
  share(groupId, sharedGroupId, groupAccess, options) {
    return RequestHelper.post()(this, endpoint`groups/${groupId}/share`, {
      groupId: sharedGroupId,
      groupAccess,
      ...options
    });
  }
  show(groupId, options) {
    return RequestHelper.get()(this, endpoint`groups/${groupId}`, options);
  }
  transfer(groupId, options) {
    return RequestHelper.post()(this, endpoint`groups/${groupId}/transfer`, options);
  }
  transferProject(groupId, projectId, options) {
    return RequestHelper.post()(
      this,
      endpoint`groups/${groupId}/projects/${projectId}`,
      options
    );
  }
  unshare(groupId, sharedGroupId, options) {
    return RequestHelper.del()(this, endpoint`groups/${groupId}/share/${sharedGroupId}`, options);
  }
  uploadAvatar(groupId, content, { filename, ...options } = {}) {
    return RequestHelper.put()(this, endpoint`groups/${groupId}/avatar`, {
      isForm: true,
      ...options,
      file: [content, filename]
    });
  }
};
var LinkedEpics = class extends BaseResource {
  all(groupId, epicIId, options) {
    return RequestHelper.get()(
      this,
      endpoint`groups/${groupId}/epics/${epicIId}/related_epics`,
      options
    );
  }
  create(groupId, epicIId, targetEpicIId, targetGroupId, options) {
    return RequestHelper.post()(
      this,
      endpoint`groups/${groupId}/epics/${epicIId}/related_epics`,
      {
        searchParams: {
          targetGroupId,
          targetEpicIid: targetEpicIId
        },
        ...options
      }
    );
  }
  remove(groupId, epicIId, relatedEpicLinkId, options) {
    return RequestHelper.del()(
      this,
      endpoint`groups/${groupId}/epics/${epicIId}/related_epics/${relatedEpicLinkId}`,
      options
    );
  }
};

// src/resources/UserCustomAttributes.ts
var UserCustomAttributes = class extends ResourceCustomAttributes {
  constructor(options) {
    super("users", options);
  }
};
var url9 = (userId) => userId ? `users/${userId}/emails` : "user/emails";
var UserEmails = class extends BaseResource {
  // Convenience method for create
  add(email, options) {
    return this.create(email, options);
  }
  all({
    userId,
    ...options
  } = {}) {
    return RequestHelper.get()(
      this,
      url9(userId),
      options
    );
  }
  create(email, {
    userId,
    ...options
  } = {}) {
    return RequestHelper.post()(this, url9(userId), {
      email,
      ...options
    });
  }
  show(emailId, options) {
    return RequestHelper.get()(this, `user/emails/${emailId}`, options);
  }
  remove(emailId, { userId, ...options } = {}) {
    return RequestHelper.del()(
      this,
      `${url9(userId)}/${emailId}`,
      options
    );
  }
};
var url10 = (userId) => userId ? `users/${userId}/gpg_keys` : "user/gpg_keys";
var UserGPGKeys = class extends BaseResource {
  // Convienence method
  add(key, options) {
    return this.create(key, options);
  }
  all({
    userId,
    ...options
  } = {}) {
    return RequestHelper.get()(this, url10(userId), options);
  }
  create(key, { userId, ...options } = {}) {
    return RequestHelper.post()(this, url10(userId), {
      key,
      ...options
    });
  }
  show(keyId, { userId, ...options } = {}) {
    return RequestHelper.get()(this, `${url10(userId)}/${keyId}`, options);
  }
  remove(keyId, { userId, ...options } = {}) {
    return RequestHelper.del()(this, `${url10(userId)}/${keyId}`, options);
  }
};
var UserImpersonationTokens = class extends BaseResource {
  all(userId, options) {
    return RequestHelper.get()(
      this,
      `users/${userId}/impersonation_tokens`,
      options
    );
  }
  create(userId, name, scopes, options) {
    return RequestHelper.post()(
      this,
      `users/${userId}/impersonation_tokens`,
      {
        name,
        scopes,
        ...options
      }
    );
  }
  show(userId, tokenId, options) {
    return RequestHelper.get()(
      this,
      `users/${userId}/impersonation_tokens/${tokenId}`,
      options
    );
  }
  remove(userId, tokenId, options) {
    return RequestHelper.del()(this, `users/${userId}/impersonation_tokens/${tokenId}`, options);
  }
  // Convienence method
  revoke(userId, tokenId, options) {
    return this.remove(userId, tokenId, options);
  }
};
var url11 = (userId) => userId ? `users/${userId}/keys` : "user/keys";
var UserSSHKeys = class extends BaseResource {
  // Convienence method for create
  add(title, key, options) {
    return this.create(title, key, options);
  }
  all({
    userId,
    ...options
  } = {}) {
    return RequestHelper.get()(
      this,
      url11(userId),
      options
    );
  }
  create(title, key, {
    userId,
    ...options
  } = {}) {
    return RequestHelper.post()(this, url11(userId), {
      title,
      key,
      ...options
    });
  }
  show(keyId, { userId, ...options } = {}) {
    return RequestHelper.get()(
      this,
      `${url11(userId)}/${keyId}`,
      options
    );
  }
  remove(keyId, { userId, ...options } = {}) {
    return RequestHelper.del()(this, `${url11(userId)}/${keyId}`, options);
  }
};
var Users = class extends BaseResource {
  activate(userId, options) {
    return RequestHelper.post()(this, endpoint`users/${userId}/activate`, options);
  }
  all(options) {
    return RequestHelper.get()(
      this,
      "users",
      options
    );
  }
  allActivities(options) {
    return RequestHelper.get()(this, "user/activities", options);
  }
  allEvents(userId, options) {
    return RequestHelper.get()(this, endpoint`users/${userId}/events`, options);
  }
  allFollowers(userId, options) {
    return RequestHelper.get()(
      this,
      endpoint`users/${userId}/followers`,
      options
    );
  }
  allFollowing(userId, options) {
    return RequestHelper.get()(
      this,
      endpoint`users/${userId}/following`,
      options
    );
  }
  allMemberships(userId, options) {
    return RequestHelper.get()(
      this,
      endpoint`users/${userId}/memberships`,
      options
    );
  }
  allProjects(userId, options) {
    return RequestHelper.get()(this, endpoint`users/${userId}/projects`, options);
  }
  allContributedProjects(userId, options) {
    return RequestHelper.get()(
      this,
      endpoint`users/${userId}/contributed_projects`,
      options
    );
  }
  allStarredProjects(userId, options) {
    return RequestHelper.get()(
      this,
      endpoint`users/${userId}/starred_projects`,
      options
    );
  }
  approve(userId, options) {
    return RequestHelper.post()(
      this,
      endpoint`users/${userId}/approve`,
      options
    );
  }
  ban(userId, options) {
    return RequestHelper.post()(this, endpoint`users/${userId}/ban`, options);
  }
  block(userId, options) {
    return RequestHelper.post()(this, endpoint`users/${userId}/block`, options);
  }
  create(options) {
    return RequestHelper.post()(this, "users", options);
  }
  createPersonalAccessToken(userId, name, scopes, options) {
    return RequestHelper.post()(
      this,
      endpoint`users/${userId}/personal_access_tokens`,
      {
        name,
        scopes,
        ...options
      }
    );
  }
  createCIRunner(runnerType, options) {
    return RequestHelper.post()(this, "user/runners", {
      ...options,
      runnerType
    });
  }
  deactivate(userId, options) {
    return RequestHelper.post()(this, endpoint`users/${userId}/deactivate`, options);
  }
  disableTwoFactor(userId, options) {
    return RequestHelper.patch()(this, endpoint`users/${userId}/disable_two_factor`, options);
  }
  edit(userId, { avatar, ...options } = {}) {
    const opts = {
      ...options,
      isForm: true
    };
    if (avatar) opts.avatar = [avatar.content, avatar.filename];
    return RequestHelper.put()(this, endpoint`users/${userId}`, opts);
  }
  editStatus(options) {
    return RequestHelper.put()(this, "user/status", options);
  }
  editCurrentUserPreferences(viewDiffsFileByFile, showWhitespaceInDiffs, options) {
    return RequestHelper.put()(this, "user/preferences", {
      viewDiffsFileByFile,
      showWhitespaceInDiffs,
      ...options
    });
  }
  follow(userId, options) {
    return RequestHelper.post()(this, endpoint`users/${userId}/follow`, options);
  }
  reject(userId, options) {
    return RequestHelper.post()(
      this,
      endpoint`users/${userId}/reject`,
      options
    );
  }
  show(userId, options) {
    return RequestHelper.get()(
      this,
      endpoint`users/${userId}`,
      options
    );
  }
  showCount(options) {
    return RequestHelper.get()(this, "user_counts", options);
  }
  showAssociationsCount(userId, options) {
    return RequestHelper.get()(
      this,
      `users/${userId}/associations_count`,
      options
    );
  }
  showCurrentUser(options) {
    return RequestHelper.get()(
      this,
      "user",
      options
    );
  }
  showCurrentUserPreferences(options) {
    return RequestHelper.get()(this, "user/preferences", options);
  }
  showStatus({
    iDOrUsername,
    ...options
  } = {}) {
    let url12;
    if (iDOrUsername) url12 = `users/${iDOrUsername}/status`;
    else url12 = "user/status";
    return RequestHelper.get()(this, url12, options);
  }
  remove(userId, options) {
    return RequestHelper.del()(this, endpoint`users/${userId}`, options);
  }
  removeAuthenticationIdentity(userId, provider, options) {
    return RequestHelper.del()(this, endpoint`users/${userId}/identities/${provider}`, options);
  }
  unban(userId, options) {
    return RequestHelper.post()(this, endpoint`users/${userId}/unban`, options);
  }
  unblock(userId, options) {
    return RequestHelper.post()(this, endpoint`users/${userId}/unblock`, options);
  }
  unfollow(userId, options) {
    return RequestHelper.post()(this, endpoint`users/${userId}/unfollow`, options);
  }
};

// src/resources/MergeRequestStateEvents.ts
var MergeRequestStateEvents = class extends ResourceStateEvents {
  constructor(options) {
    super("projects", "merge_requests", options);
  }
};

// src/resources/EpicStateEvents.ts
var EpicStateEvents = class extends ResourceStateEvents {
  constructor(options) {
    super("groups", "epics", options);
  }
};

// src/resources/Gitlab.ts
var resources = {
  Agents,
  AlertManagement,
  ApplicationAppearance,
  ApplicationPlanLimits,
  Applications,
  ApplicationSettings,
  ApplicationStatistics,
  AuditEvents,
  Avatar,
  BroadcastMessages,
  CodeSuggestions,
  Composer,
  Conan,
  DashboardAnnotations,
  Debian,
  DependencyProxy,
  DeployKeys,
  DeployTokens,
  DockerfileTemplates,
  Events,
  Experiments,
  GeoNodes,
  GeoSites,
  GitignoreTemplates,
  GitLabCIYMLTemplates,
  Import,
  InstanceLevelCICDVariables,
  Keys,
  License,
  LicenseTemplates,
  Lint,
  Markdown,
  Maven,
  Metadata,
  Migrations,
  Namespaces,
  NotificationSettings,
  NPM,
  NuGet,
  PersonalAccessTokens,
  PyPI,
  RubyGems,
  Search,
  SearchAdmin,
  ServiceAccounts,
  ServiceData,
  SidekiqMetrics,
  SidekiqQueues,
  SnippetRepositoryStorageMoves,
  Snippets,
  Suggestions,
  SystemHooks,
  TodoLists,
  Topics,
  Branches,
  CommitDiscussions,
  Commits,
  ContainerRegistry,
  Deployments,
  Environments,
  ErrorTrackingClientKeys,
  ErrorTrackingSettings,
  ExternalStatusChecks,
  FeatureFlags,
  FeatureFlagUserLists,
  FreezePeriods,
  GitlabPages,
  GoProxy,
  Helm,
  Integrations,
  IssueAwardEmojis,
  IssueDiscussions,
  IssueIterationEvents,
  IssueLabelEvents,
  IssueLinks,
  IssueMilestoneEvents,
  IssueNoteAwardEmojis,
  IssueNotes,
  Issues,
  IssuesStatistics,
  IssueStateEvents,
  IssueWeightEvents,
  JobArtifacts,
  Jobs,
  MergeRequestApprovals,
  MergeRequestAwardEmojis,
  MergeRequestContextCommits,
  MergeRequestDiscussions,
  MergeRequestLabelEvents,
  MergeRequestMilestoneEvents,
  MergeRequestStateEvents,
  MergeRequestDraftNotes,
  MergeRequestNotes,
  MergeRequestNoteAwardEmojis,
  MergeRequests,
  MergeTrains,
  PackageRegistry,
  Packages,
  PagesDomains,
  Pipelines,
  PipelineSchedules,
  PipelineScheduleVariables,
  PipelineTriggerTokens,
  ProductAnalytics,
  ProjectAccessRequests,
  ProjectAccessTokens,
  ProjectAliases,
  ProjectBadges,
  ProjectCustomAttributes,
  ProjectDORA4Metrics,
  ProjectHooks,
  ProjectImportExports,
  ProjectInvitations,
  ProjectIssueBoards,
  ProjectIterations,
  ProjectJobTokenScopes,
  ProjectLabels,
  ProjectMarkdownUploads,
  ProjectMembers,
  ProjectMilestones,
  ProjectProtectedEnvironments,
  ProjectPushRules,
  ProjectRelationsExport,
  ProjectReleases,
  ProjectRemoteMirrors,
  ProjectRepositoryStorageMoves,
  Projects,
  ProjectSnippetAwardEmojis,
  ProjectSnippetDiscussions,
  ProjectSnippetNotes,
  ProjectSnippets,
  ProjectStatistics,
  ProjectTemplates,
  ProjectTerraformState,
  ProjectVariables,
  ProjectVulnerabilities,
  ProjectWikis,
  ProtectedBranches,
  ProtectedTags,
  ReleaseLinks,
  Repositories,
  RepositoryFiles,
  RepositorySubmodules,
  ResourceGroups,
  Runners,
  SecureFiles,
  Tags,
  UserStarredMetricsDashboard,
  EpicAwardEmojis,
  EpicDiscussions,
  EpicIssues,
  EpicLabelEvents,
  EpicLinks,
  EpicNotes,
  Epics,
  EpicStateEvents,
  GroupAccessRequests,
  GroupAccessTokens,
  GroupActivityAnalytics,
  GroupBadges,
  GroupCustomAttributes,
  GroupDORA4Metrics,
  GroupEpicBoards,
  GroupHooks,
  GroupImportExports,
  GroupInvitations,
  GroupIssueBoards,
  GroupIterations,
  GroupLabels,
  GroupLDAPLinks,
  GroupMarkdownUploads,
  GroupMembers,
  GroupMemberRoles,
  GroupMilestones,
  GroupProtectedEnvironments,
  GroupPushRules,
  GroupRelationExports,
  GroupReleases,
  GroupRepositoryStorageMoves,
  Groups,
  GroupSAMLIdentities,
  GroupSAMLLinks,
  GroupSCIMIdentities,
  GroupServiceAccounts,
  GroupVariables,
  GroupWikis,
  LinkedEpics,
  UserCustomAttributes,
  UserEmails,
  UserGPGKeys,
  UserImpersonationTokens,
  Users,
  UserSSHKeys
};
var Gitlab = class extends BaseResource {
  constructor(options) {
    super(options);
    Object.keys(resources).forEach((s) => {
      this[s] = new resources[s](options);
    });
  }
};

// src/constants.ts
var AccessLevel = /* @__PURE__ */ ((AccessLevel2) => {
  AccessLevel2[AccessLevel2["NO_ACCESS"] = 0] = "NO_ACCESS";
  AccessLevel2[AccessLevel2["MINIMAL_ACCESS"] = 5] = "MINIMAL_ACCESS";
  AccessLevel2[AccessLevel2["GUEST"] = 10] = "GUEST";
  AccessLevel2[AccessLevel2["REPORTER"] = 20] = "REPORTER";
  AccessLevel2[AccessLevel2["DEVELOPER"] = 30] = "DEVELOPER";
  AccessLevel2[AccessLevel2["MAINTAINER"] = 40] = "MAINTAINER";
  AccessLevel2[AccessLevel2["OWNER"] = 50] = "OWNER";
  AccessLevel2[AccessLevel2["ADMIN"] = 60] = "ADMIN";
  return AccessLevel2;
})(AccessLevel || {});



;// CONCATENATED MODULE: ./node_modules/@gitbeaker/rest/dist/index.mjs




// src/index.ts
async function processBody(response) {
  const contentType = (response.headers.get("content-type") || "").split(";")[0].trim();
  if (contentType === "application/json") {
    return response.json().then((v) => v || {});
  }
  if (contentType.startsWith("text/")) {
    return response.text().then((t) => t || "");
  }
  return response.blob();
}
function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
async function parseResponse(response, asStream = false) {
  const { status, headers: rawHeaders } = response;
  const headers = Object.fromEntries(rawHeaders.entries());
  let body;
  if (asStream) {
    body = response.body;
  } else {
    body = status === 204 ? null : await processBody(response);
  }
  return { body, headers, status };
}
async function throwFailedRequestError(request, response) {
  const content = await response.text();
  const contentType = response.headers.get("Content-Type");
  let description;
  if (contentType?.includes("application/json")) {
    const output = JSON.parse(content);
    const contentProperty = output?.error || output?.message || "";
    description = typeof contentProperty === "string" ? contentProperty : JSON.stringify(contentProperty);
  } else {
    description = content;
  }
  throw new GitbeakerRequestError(description, {
    cause: {
      description,
      request,
      response
    }
  });
}
function getConditionalMode(endpoint) {
  if (endpoint.includes("repository/archive")) return "same-origin";
  return void 0;
}
async function defaultRequestHandler(endpoint, options) {
  const retryCodes = [429, 502];
  const maxRetries = 10;
  const { rateLimiters, agent, asStream, prefixUrl, searchParams, method, ...opts } = options || {};
  const rateLimit = getMatchingRateLimiter(endpoint, rateLimiters, method);
  let lastStatus;
  let baseUrl;
  if (prefixUrl) baseUrl = prefixUrl.endsWith("/") ? prefixUrl : `${prefixUrl}/`;
  const url = new URL(endpoint, baseUrl);
  url.search = searchParams || "";
  const mode = getConditionalMode(endpoint);
  for (let i = 0; i < maxRetries; i += 1) {
    const request = new Request(url, { ...opts, method, mode });
    const fetchArgs = [request];
    if (agent) fetchArgs.push({ dispatcher: agent });
    await rateLimit();
    const response = await fetch(...fetchArgs).catch((e) => {
      if (e.name === "TimeoutError" || e.name === "AbortError") {
        throw new GitbeakerTimeoutError("Query timeout was reached");
      }
      throw e;
    });
    if (response.ok) return parseResponse(response, asStream);
    if (!retryCodes.includes(response.status)) await throwFailedRequestError(request, response);
    lastStatus = response.status;
    await delay(2 ** i * 0.25);
    continue;
  }
  throw new GitbeakerRetryError(
    `Could not successfully complete this request after ${maxRetries} retries, last status code: ${lastStatus}. ${lastStatus === 429 ? "Check the applicable rate limits for this endpoint" : "Verify the status of the endpoint"}.`
  );
}
var requesterFn = createRequesterFn(
  (_, reqo) => Promise.resolve(reqo),
  defaultRequestHandler
);
var { AccessLevel: dist_AccessLevel, ...Resources } = core_dist_namespaceObject;
var API = presetResourceArguments(Resources, { requesterFn });
var { Agents: dist_Agents } = API;
var { AlertManagement: dist_AlertManagement } = API;
var { ApplicationAppearance: dist_ApplicationAppearance } = API;
var { ApplicationPlanLimits: dist_ApplicationPlanLimits } = API;
var { Applications: dist_Applications } = API;
var { ApplicationSettings: dist_ApplicationSettings } = API;
var { ApplicationStatistics: dist_ApplicationStatistics } = API;
var { AuditEvents: dist_AuditEvents } = API;
var { Avatar: dist_Avatar } = API;
var { Branches: dist_Branches } = API;
var { BroadcastMessages: dist_BroadcastMessages } = API;
var { CodeSuggestions: dist_CodeSuggestions } = API;
var { CommitDiscussions: dist_CommitDiscussions } = API;
var { Commits: dist_Commits } = API;
var { Composer: dist_Composer } = API;
var { Conan: dist_Conan } = API;
var { ContainerRegistry: dist_ContainerRegistry } = API;
var { DashboardAnnotations: dist_DashboardAnnotations } = API;
var { Debian: dist_Debian } = API;
var { DependencyProxy: dist_DependencyProxy } = API;
var { DeployKeys: dist_DeployKeys } = API;
var { DeployTokens: dist_DeployTokens } = API;
var { Deployments: dist_Deployments } = API;
var { DockerfileTemplates: dist_DockerfileTemplates } = API;
var { Environments: dist_Environments } = API;
var { EpicAwardEmojis: dist_EpicAwardEmojis } = API;
var { EpicDiscussions: dist_EpicDiscussions } = API;
var { EpicIssues: dist_EpicIssues } = API;
var { EpicLabelEvents: dist_EpicLabelEvents } = API;
var { EpicLinks: dist_EpicLinks } = API;
var { EpicNotes: dist_EpicNotes } = API;
var { Epics: dist_Epics } = API;
var { ErrorTrackingClientKeys: dist_ErrorTrackingClientKeys } = API;
var { ErrorTrackingSettings: dist_ErrorTrackingSettings } = API;
var { Events: dist_Events } = API;
var { Experiments: dist_Experiments } = API;
var { ExternalStatusChecks: dist_ExternalStatusChecks } = API;
var { FeatureFlags: dist_FeatureFlags } = API;
var { FeatureFlagUserLists: dist_FeatureFlagUserLists } = API;
var { FreezePeriods: dist_FreezePeriods } = API;
var { GeoNodes: dist_GeoNodes } = API;
var { GeoSites: dist_GeoSites } = API;
var { GitignoreTemplates: dist_GitignoreTemplates } = API;
var { GitLabCIYMLTemplates: dist_GitLabCIYMLTemplates } = API;
var { GitlabPages: dist_GitlabPages } = API;
var { GoProxy: dist_GoProxy } = API;
var { GroupAccessRequests: dist_GroupAccessRequests } = API;
var { GroupAccessTokens: dist_GroupAccessTokens } = API;
var { GroupActivityAnalytics: dist_GroupActivityAnalytics } = API;
var { GroupBadges: dist_GroupBadges } = API;
var { GroupCustomAttributes: dist_GroupCustomAttributes } = API;
var { GroupDORA4Metrics: dist_GroupDORA4Metrics } = API;
var { GroupEpicBoards: dist_GroupEpicBoards } = API;
var { GroupHooks: dist_GroupHooks } = API;
var { GroupImportExports: dist_GroupImportExports } = API;
var { GroupInvitations: dist_GroupInvitations } = API;
var { GroupIssueBoards: dist_GroupIssueBoards } = API;
var { GroupIterations: dist_GroupIterations } = API;
var { GroupLabels: dist_GroupLabels } = API;
var { GroupLDAPLinks: dist_GroupLDAPLinks } = API;
var { GroupMarkdownUploads: dist_GroupMarkdownUploads } = API;
var { GroupMemberRoles: dist_GroupMemberRoles } = API;
var { GroupMembers: dist_GroupMembers } = API;
var { GroupMilestones: dist_GroupMilestones } = API;
var { GroupProtectedEnvironments: dist_GroupProtectedEnvironments } = API;
var { GroupPushRules: dist_GroupPushRules } = API;
var { GroupRelationExports: dist_GroupRelationExports } = API;
var { GroupReleases: dist_GroupReleases } = API;
var { GroupRepositoryStorageMoves: dist_GroupRepositoryStorageMoves } = API;
var { Groups: dist_Groups } = API;
var { GroupSAMLIdentities: dist_GroupSAMLIdentities } = API;
var { GroupSAMLLinks: dist_GroupSAMLLinks } = API;
var { GroupSCIMIdentities: dist_GroupSCIMIdentities } = API;
var { GroupServiceAccounts: dist_GroupServiceAccounts } = API;
var { GroupVariables: dist_GroupVariables } = API;
var { GroupWikis: dist_GroupWikis } = API;
var { Helm: dist_Helm } = API;
var { Import: dist_Import } = API;
var { InstanceLevelCICDVariables: dist_InstanceLevelCICDVariables } = API;
var { Integrations: dist_Integrations } = API;
var { IssueAwardEmojis: dist_IssueAwardEmojis } = API;
var { IssueDiscussions: dist_IssueDiscussions } = API;
var { IssueIterationEvents: dist_IssueIterationEvents } = API;
var { IssueLabelEvents: dist_IssueLabelEvents } = API;
var { IssueLinks: dist_IssueLinks } = API;
var { IssueMilestoneEvents: dist_IssueMilestoneEvents } = API;
var { IssueNoteAwardEmojis: dist_IssueNoteAwardEmojis } = API;
var { IssueNotes: dist_IssueNotes } = API;
var { Issues: dist_Issues } = API;
var { IssuesStatistics: dist_IssuesStatistics } = API;
var { IssueStateEvents: dist_IssueStateEvents } = API;
var { IssueWeightEvents: dist_IssueWeightEvents } = API;
var { JobArtifacts: dist_JobArtifacts } = API;
var { Jobs: dist_Jobs } = API;
var { Keys: dist_Keys } = API;
var { License: dist_License } = API;
var { LicenseTemplates: dist_LicenseTemplates } = API;
var { LinkedEpics: dist_LinkedEpics } = API;
var { Lint: dist_Lint } = API;
var { Markdown: dist_Markdown } = API;
var { Maven: dist_Maven } = API;
var { MergeRequestApprovals: dist_MergeRequestApprovals } = API;
var { MergeRequestAwardEmojis: dist_MergeRequestAwardEmojis } = API;
var { MergeRequestContextCommits: dist_MergeRequestContextCommits } = API;
var { MergeRequestDiscussions: dist_MergeRequestDiscussions } = API;
var { MergeRequestDraftNotes: dist_MergeRequestDraftNotes } = API;
var { MergeRequestLabelEvents: dist_MergeRequestLabelEvents } = API;
var { MergeRequestMilestoneEvents: dist_MergeRequestMilestoneEvents } = API;
var { MergeRequestNoteAwardEmojis: dist_MergeRequestNoteAwardEmojis } = API;
var { MergeRequestNotes: dist_MergeRequestNotes } = API;
var { MergeRequests: dist_MergeRequests } = API;
var { MergeTrains: dist_MergeTrains } = API;
var { Metadata: dist_Metadata } = API;
var { Migrations: dist_Migrations } = API;
var { Namespaces: dist_Namespaces } = API;
var { NotificationSettings: dist_NotificationSettings } = API;
var { NPM: dist_NPM } = API;
var { NuGet: dist_NuGet } = API;
var { PackageRegistry: dist_PackageRegistry } = API;
var { Packages: dist_Packages } = API;
var { PagesDomains: dist_PagesDomains } = API;
var { PersonalAccessTokens: dist_PersonalAccessTokens } = API;
var { PipelineSchedules: dist_PipelineSchedules } = API;
var { PipelineScheduleVariables: dist_PipelineScheduleVariables } = API;
var { Pipelines: dist_Pipelines } = API;
var { PipelineTriggerTokens: dist_PipelineTriggerTokens } = API;
var { ProductAnalytics: dist_ProductAnalytics } = API;
var { ProjectAccessRequests: dist_ProjectAccessRequests } = API;
var { ProjectAccessTokens: dist_ProjectAccessTokens } = API;
var { ProjectAliases: dist_ProjectAliases } = API;
var { ProjectBadges: dist_ProjectBadges } = API;
var { ProjectCustomAttributes: dist_ProjectCustomAttributes } = API;
var { ProjectDORA4Metrics: dist_ProjectDORA4Metrics } = API;
var { ProjectHooks: dist_ProjectHooks } = API;
var { ProjectImportExports: dist_ProjectImportExports } = API;
var { ProjectInvitations: dist_ProjectInvitations } = API;
var { ProjectIssueBoards: dist_ProjectIssueBoards } = API;
var { ProjectIterations: dist_ProjectIterations } = API;
var { ProjectJobTokenScopes: dist_ProjectJobTokenScopes } = API;
var { ProjectLabels: dist_ProjectLabels } = API;
var { ProjectMarkdownUploads: dist_ProjectMarkdownUploads } = API;
var { ProjectMembers: dist_ProjectMembers } = API;
var { ProjectMilestones: dist_ProjectMilestones } = API;
var { ProjectProtectedEnvironments: dist_ProjectProtectedEnvironments } = API;
var { ProjectPushRules: dist_ProjectPushRules } = API;
var { ProjectRelationsExport: dist_ProjectRelationsExport } = API;
var { ProjectReleases: dist_ProjectReleases } = API;
var { ProjectRemoteMirrors: dist_ProjectRemoteMirrors } = API;
var { ProjectRepositoryStorageMoves: dist_ProjectRepositoryStorageMoves } = API;
var { Projects: dist_Projects } = API;
var { ProjectSnippetAwardEmojis: dist_ProjectSnippetAwardEmojis } = API;
var { ProjectSnippetDiscussions: dist_ProjectSnippetDiscussions } = API;
var { ProjectSnippetNotes: dist_ProjectSnippetNotes } = API;
var { ProjectSnippets: dist_ProjectSnippets } = API;
var { ProjectStatistics: dist_ProjectStatistics } = API;
var { ProjectTemplates: dist_ProjectTemplates } = API;
var { ProjectTerraformState: dist_ProjectTerraformState } = API;
var { ProjectVariables: dist_ProjectVariables } = API;
var { ProjectVulnerabilities: dist_ProjectVulnerabilities } = API;
var { ProjectWikis: dist_ProjectWikis } = API;
var { ProtectedBranches: dist_ProtectedBranches } = API;
var { ProtectedTags: dist_ProtectedTags } = API;
var { PyPI: dist_PyPI } = API;
var { ReleaseLinks: dist_ReleaseLinks } = API;
var { Repositories: dist_Repositories } = API;
var { RepositoryFiles: dist_RepositoryFiles } = API;
var { RepositorySubmodules: dist_RepositorySubmodules } = API;
var { ResourceGroups: dist_ResourceGroups } = API;
var { RubyGems: dist_RubyGems } = API;
var { Runners: dist_Runners } = API;
var { Search: dist_Search } = API;
var { SearchAdmin: dist_SearchAdmin } = API;
var { SecureFiles: dist_SecureFiles } = API;
var { ServiceAccounts: dist_ServiceAccounts } = API;
var { ServiceData: dist_ServiceData } = API;
var { SidekiqMetrics: dist_SidekiqMetrics } = API;
var { SidekiqQueues: dist_SidekiqQueues } = API;
var { SnippetRepositoryStorageMoves: dist_SnippetRepositoryStorageMoves } = API;
var { Snippets: dist_Snippets } = API;
var { Suggestions: dist_Suggestions } = API;
var { SystemHooks: dist_SystemHooks } = API;
var { Tags: dist_Tags } = API;
var { TodoLists: dist_TodoLists } = API;
var { Topics: dist_Topics } = API;
var { UserCustomAttributes: dist_UserCustomAttributes } = API;
var { UserEmails: dist_UserEmails } = API;
var { UserGPGKeys: dist_UserGPGKeys } = API;
var { UserImpersonationTokens: dist_UserImpersonationTokens } = API;
var { Users: dist_Users } = API;
var { UserSSHKeys: dist_UserSSHKeys } = API;
var { UserStarredMetricsDashboard: dist_UserStarredMetricsDashboard } = API;
var { Gitlab: dist_Gitlab } = API;



;// CONCATENATED MODULE: ./lib/platform/gitlab-client.js
/**
 * platform/gitlab-client.ts — 统一 GitLab client factory（GLAPI-029/030/031/032）
 *
 * 唯一构造 `@gitbeaker/rest` 实例的地方：
 * - GLAPI-029：host / PAT / timeout 只从受信任配置（CI 环境变量）读取并校验；
 *   任何日志输出都不含 token，也不含带 token 的 URL/Header。
 * - GLAPI-030：adapter 通过本 factory 返回的实例调用 Projects、Merge Requests、
 *   Repository Files/Tree、Notes、Discussions、Members、Award Emoji API。
 * - GLAPI-031：业务层与 adapter 都不直接 `fetch`；确需 fallback 时也必须复用
 *   本文件的 host/认证/timeout 与 gitlab-errors/gitlab-retry 的错误与重试语义。
 * - GLAPI-024/032：分页不依赖 SDK 默认值，统一由 listOptions() 给出显式契约。
 *
 * @gitbeaker/rest 的实例与类型只存在于本文件和 GitLab adapter 内（ARCH-024）。
 */

const GITLAB_CLIENT_DEFAULTS = {
    host: 'https://gitlab.com',
    timeoutMS: 30_000,
    minTimeoutMS: 1_000,
    maxTimeoutMS: 300_000
};
/**
 * GLAPI-024/032：list API 的显式分页契约。
 *
 * gitbeaker 的 `all*()` 只有在「不传 page」时才会沿 Link header 自动翻页，
 * 且默认 perPage=20。这里固定 perPage=100 并用 maxPages 兜底，避免
 * 「SDK 默认行为 == IGitPlatform 语义」的隐式假设：
 * - 不传 `page`（传了会退化为单页）
 * - perPage 100 是 GitLab REST API 上限
 * - maxPages 给超大 MR/仓库一个有上限的请求数，避免无界翻页
 */
const PAGINATION_DEFAULTS = {
    perPage: 100,
    maxPages: 50
};
/**
 * 构造 list API 的分页参数。调用方传入的 `page` 会被丢弃（会破坏自动翻页契约）。
 */
function listOptions(extra) {
    const rest = { ...(extra ?? {}) };
    delete rest.page;
    return {
        ...rest,
        perPage: PAGINATION_DEFAULTS.perPage,
        maxPages: PAGINATION_DEFAULTS.maxPages
    };
}
/** 配置非法时抛出（fail closed，不回退到默认 host/token） */
class GitLabClientConfigError extends Error {
    constructor(message) {
        super(message);
        this.name = 'GitLabClientConfigError';
    }
}
/**
 * 校验 host：必须是 http/https URL，且不得内嵌凭据或 token query。
 * 内嵌凭据的 URL 一旦进入日志就是明文泄露，直接 fail closed。
 */
function validateGitLabHost(raw) {
    const value = raw.trim();
    if (value === '')
        throw new GitLabClientConfigError('GitLab host is empty');
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new GitLabClientConfigError(`GitLab host is not a valid URL: ${value}`);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new GitLabClientConfigError(`GitLab host must use http/https: ${url.protocol}`);
    }
    if (url.username !== '' || url.password !== '') {
        throw new GitLabClientConfigError('GitLab host must not embed credentials');
    }
    if (url.searchParams.has('private_token') || url.searchParams.has('token')) {
        throw new GitLabClientConfigError('GitLab host must not carry a token query parameter');
    }
    // 去掉结尾 '/'，避免 gitbeaker 拼出 '//api/v4'
    return value.replace(/\/+$/, '');
}
/** 校验 timeout：必须是正整数毫秒且落在允许区间内 */
function validateGitLabTimeoutMS(raw) {
    const value = raw.trim();
    if (!/^\d+$/.test(value)) {
        throw new GitLabClientConfigError(`GitLab timeout must be a positive integer (ms): ${value}`);
    }
    const ms = Number(value);
    if (ms < GITLAB_CLIENT_DEFAULTS.minTimeoutMS || ms > GITLAB_CLIENT_DEFAULTS.maxTimeoutMS) {
        throw new GitLabClientConfigError(`GitLab timeout ${ms}ms out of range ` +
            `[${GITLAB_CLIENT_DEFAULTS.minTimeoutMS}, ${GITLAB_CLIENT_DEFAULTS.maxTimeoutMS}]`);
    }
    return ms;
}
/**
 * 从受信任配置（CI 环境变量）解析 client 配置（GLAPI-029）。
 *
 * - host：`CI_SERVER_URL`，默认 https://gitlab.com
 * - 凭据：`GITLAB_PAT` 优先，为空时 fallback `CI_JOB_TOKEN`
 * - timeout：`AI_REVIEWER_GITLAB_TIMEOUT_MS`，默认 30s
 *
 * 凭据缺失或配置非法时抛 GitLabClientConfigError（fail closed）。
 */
function resolveGitLabClientConfig(env = process.env) {
    const host = validateGitLabHost(env.CI_SERVER_URL ?? GITLAB_CLIENT_DEFAULTS.host);
    const pat = (env.GITLAB_PAT ?? '').trim();
    const jobToken = (env.CI_JOB_TOKEN ?? '').trim();
    const credential = pat !== ''
        ? { type: 'pat', value: pat }
        : jobToken !== ''
            ? { type: 'job_token', value: jobToken }
            : null;
    if (credential == null) {
        throw new GitLabClientConfigError('GITLAB_PAT or CI_JOB_TOKEN is required');
    }
    const timeoutMS = validateGitLabTimeoutMS(env.AI_REVIEWER_GITLAB_TIMEOUT_MS ?? String(GITLAB_CLIENT_DEFAULTS.timeoutMS));
    return { host, credential, timeoutMS };
}
/**
 * 生成可安全打印的配置摘要（GLAPI-029：绝不输出 token 或带 token 的 URL）。
 * 只输出 host、凭据类型和 timeout，不输出凭据值，也不输出其长度前缀等可推断信息。
 */
function describeGitLabClientConfig(config) {
    return `host=${config.host} credential=${config.credential.type} timeout=${config.timeoutMS}ms`;
}
/**
 * 统一 client factory：所有 GitLab API 调用都必须使用这里创建的实例。
 *
 * `queryTimeout` 把 timeout 下沉到每个请求的 AbortSignal，
 * 超时表现为 GitbeakerTimeoutError，由 gitlab-errors 归一化为 'timeout'。
 */
function createGitLabClient(config) {
    const host = validateGitLabHost(config.host);
    const queryTimeout = config.timeoutMS;
    return config.credential.type === 'job_token'
        ? new dist_Gitlab({ host, jobToken: config.credential.value, queryTimeout })
        : new dist_Gitlab({ host, token: config.credential.value, queryTimeout });
}

;// CONCATENATED MODULE: ./lib/platform/git-platform.js
/**
 * platform/git-platform.ts - 平台无关 Git 服务接口（ARCH-016 / ARCH-017）
 *
 * 定义 GitHub 和 GitLab 共用的 Git 平台操作抽象。业务层（review.ts、commenter.ts、
 * commands/**、conversation.ts 等）通过此接口访问平台 API，不得直接 import
 * octokit / @gitbeaker/rest。
 *
 * 方法签名以"需要什么数据"为导向，而非"哪个 REST endpoint"。GitHub adapter
 * 和 GitLab adapter 各自负责把调用翻译到对应平台 API。
 *
 * ARCH-021: PR number / MR IID 统一为 changeRequestId（number），
 *   comment/note ID 统一为 commentId（number），
 *   thread node ID / discussion ID 统一为 threadId（string）。
 *
 * ARCH-022: 所有方法在遇到平台 API 错误时抛出 GitPlatformError，
 *   业务层按 errorKind 分支处理。
 */
class GitPlatformError extends Error {
    errorKind;
    statusCode;
    cause;
    constructor(message, errorKind, statusCode, cause) {
        super(message);
        this.errorKind = errorKind;
        this.statusCode = statusCode;
        this.cause = cause;
        this.name = 'GitPlatformError';
    }
}
// ─── 平台单例（ARCH-018）────────────────────────────────────────────────
let _platform = null;
/** 获取当前平台实例。未设置时抛错（入口文件必须先调用 setPlatform） */
function getPlatform() {
    if (_platform == null) {
        throw new Error('getPlatform() called before setPlatform(). ' +
            'Entry point (main.ts / gitlab-trigger.ts) must call setPlatform() first.');
    }
    return _platform;
}
/** 设置全局平台实例（入口文件调用） */
function setPlatform(platform) {
    _platform = platform;
}
/** 重置为未初始化状态（仅供测试使用） */
function resetPlatform() {
    _platform = null;
}

;// CONCATENATED MODULE: ./lib/gitlab-trigger-redact.js
/**
 * gitlab-trigger-redact.ts - 错误日志脱敏（EVENT-005）
 *
 * 只处理字符串形态的错误信息，覆盖当前已知会出现在 gitlab-trigger 错误路径里的
 * token 形态：GitLab PAT（glpat-）、Bearer token、URL query 中的 token 参数。
 * 不是通用脱敏框架——覆盖 HTTP Header/环境变量/异常对象任意嵌套字段是 SEC-008
 * 的范围，不在本任务内。
 *
 * 参考 docs/tasks/gitlab-trigger-cli-design.md 第 6 节。
 */
function redact(input) {
    return input
        .replace(/glpat-[A-Za-z0-9_-]+/g, 'glpat-***')
        .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***')
        .replace(/([?&]token=)[^&\s]+/gi, '$1***')
        .replace(/([?&]private_token=)[^&\s]+/gi, '$1***');
}

;// CONCATENATED MODULE: ./lib/platform/gitlab-errors.js
/**
 * platform/gitlab-errors.ts — GitLab 错误归一化契约（GLAPI-025/026/032）
 *
 * gitbeaker 的错误对象不是 IGitPlatform 语义，必须显式建立适配层契约：
 * - GitbeakerRequestError：`cause.response` 是 fetch Response（含 status/headers）
 * - GitbeakerTimeoutError：只有 name，没有 status（queryTimeout 触发）
 * - GitbeakerRetryError：SDK 内部对 429/502 重试耗尽后抛出，status 只在 message 里
 * - 原生网络错误：ECONNRESET/ETIMEDOUT/ENOTFOUND 等只有 message
 *
 * 归一化后：
 * - GLAPI-025：429 / 5xx / timeout / 网络错误 → 可重试
 * - GLAPI-026：401 / 403 → 不可重试，附带权限诊断
 * - 所有 message 经 redact() 脱敏后才进入 GitPlatformError（A5 日志脱敏）
 */


/** 可重试的错误类别（GLAPI-025） */
const RETRYABLE_KINDS = new Set([
    'rate_limited',
    'server_error',
    'timeout'
]);
function isRetryableErrorKind(kind) {
    return RETRYABLE_KINDS.has(kind);
}
/** 从各种 gitbeaker/fetch 错误形态中提取 HTTP status */
function extractStatus(e) {
    const anyErr = e;
    const candidates = [
        anyErr?.cause?.response?.status,
        anyErr?.response?.status,
        anyErr?.status,
        anyErr?.statusCode
    ];
    for (const c of candidates) {
        if (typeof c === 'number' && Number.isFinite(c))
            return c;
    }
    // GitbeakerRetryError：状态码只出现在 message 里
    const msg = e instanceof Error ? e.message : String(e);
    const m = /last status code:\s*(\d{3})/i.exec(msg);
    if (m)
        return Number(m[1]);
    return undefined;
}
/**
 * 提取 Retry-After（秒或 HTTP-date），返回毫秒。
 * 429 常带该 header，尊重它比盲目指数退避更快恢复，也更礼貌。
 */
function extractRetryAfterMS(e, now = Date.now()) {
    const headers = e?.cause?.response?.headers ?? e?.response?.headers;
    if (headers == null)
        return undefined;
    let raw;
    if (typeof headers.get === 'function')
        raw = headers.get('retry-after');
    else
        raw = headers['retry-after'] ?? headers['Retry-After'];
    if (raw == null || raw === '')
        return undefined;
    if (/^\d+$/.test(String(raw).trim()))
        return Number(raw) * 1000;
    const at = Date.parse(String(raw));
    if (Number.isNaN(at))
        return undefined;
    return Math.max(0, at - now);
}
/** 判断是否为网络层错误（无 HTTP status） */
function isNetworkErrorMessage(msg) {
    return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|socket hang up|network|fetch failed|timed?\s?out/i.test(msg);
}
/**
 * GLAPI-026：401/403 的权限诊断。
 *
 * 不重试，并给出可操作的排查方向；不输出 token 本身。
 */
function permissionDiagnostics(status, detail) {
    const base = status === 401
        ? 'GitLab authentication failed (401): token is missing, expired, or revoked'
        : 'GitLab authorization failed (403): token lacks the required scope or project access level';
    const hints = status === 401
        ? 'check GITLAB_PAT / CI_JOB_TOKEN is set on the trigger job and still valid'
        : 'check the token has `api` scope and at least Reporter (read) / Developer (write) on the project';
    const suffix = detail.trim() === '' ? '' : ` — ${detail.trim()}`;
    return `${base}${suffix}; ${hints}. Not retrying.`;
}
/**
 * 把任意 GitLab 侧错误归一化为 GitPlatformError（GLAPI-032）。
 *
 * 已经是 GitPlatformError 的直接返回，避免多层包装丢失原始 kind。
 */
function normalizeGitLabError(e, operation) {
    if (e instanceof GitPlatformError)
        return e;
    const rawMsg = e instanceof Error ? e.message : String(e);
    const name = e instanceof Error ? e.name : '';
    const status = extractStatus(e);
    let kind = 'unknown';
    if (status === 401 || status === 403)
        kind = 'forbidden';
    else if (status === 404)
        kind = 'not_found';
    else if (status === 409)
        kind = 'conflict';
    else if (status === 429)
        kind = 'rate_limited';
    else if (status != null && status >= 500)
        kind = 'server_error';
    else if (status == null) {
        if (name === 'GitbeakerTimeoutError' || name === 'TimeoutError' || name === 'AbortError') {
            kind = 'timeout';
        }
        else if (isNetworkErrorMessage(rawMsg)) {
            kind = 'timeout';
        }
    }
    const detail = redact(rawMsg);
    const prefix = operation == null || operation === '' ? '' : `${operation}: `;
    const message = status === 401 || status === 403
        ? `${prefix}${permissionDiagnostics(status, detail)}`
        : `${prefix}${detail}`;
    return new GitPlatformError(message, kind, status, e);
}

;// CONCATENATED MODULE: ./lib/platform/logger.js
/**
 * platform/logger.ts - 平台无关 Logger 接口（ARCH-012）
 *
 * 定义统一的日志接口，替换共享核心中对 @actions/core info/warning/error 的直接依赖。
 * 入口文件（main.ts / gitlab-trigger.ts）在启动时调用 setLogger() 设置平台实现，
 * 共享核心通过 getLogger() 或便捷函数（logger.info 等）输出日志。
 *
 * ARCH-015：GitLab-only 启动不得初始化 @actions/core，因此 GitLabLogger
 * 不 import @actions/core，只使用 console。
 */
/**
 * 控制台 Logger（默认 fallback）。
 * 在 setLogger() 调用前或未初始化时使用，保证日志不会丢失。
 */
const consoleLogger = {
    // eslint-disable-next-line no-console
    info: (msg) => console.log(msg),
    // eslint-disable-next-line no-console
    warning: (msg) => console.warn(msg),
    // eslint-disable-next-line no-console
    error: (msg) => console.error(msg),
    // eslint-disable-next-line no-console
    debug: (msg) => console.log(`[DEBUG] ${msg}`)
};
let _logger = consoleLogger;
/** 设置全局 Logger 实例（入口文件调用） */
function setLogger(logger) {
    _logger = logger;
}
/** 获取当前 Logger 实例 */
function getLogger() {
    return _logger;
}
/** 重置为默认 console logger（仅供测试使用） */
function resetLogger() {
    _logger = consoleLogger;
}

;// CONCATENATED MODULE: ./lib/platform/gitlab-retry.js
/**
 * platform/gitlab-retry.ts — GitLab API 有上限退避重试（GLAPI-025/026/027）
 *
 * - GLAPI-025：429 / 5xx / 网络超时按指数退避重试，次数和单次等待都有上限；
 *   429 带 Retry-After 时优先尊重该值，超过上限则直接放弃而不是长时间空等。
 * - GLAPI-026：401/403 立即失败并带权限诊断，绝不重试（重试只会加剧锁定风险）。
 * - GLAPI-027：回调收到 attempt 序号，写操作可在 attempt > 1 时先按 marker 探测
 *   上一次是否其实已写入成功，避免超时重试产生重复内容。
 *
 * 注意 gitbeaker 自身对 429/502 也有内部重试（最多 10 次），本层是在其之上的
 * 兜底：因此 maxAttempts 保持小值，避免两层重试相乘放大等待时间。
 */


const GITLAB_RETRY_DEFAULTS = {
    maxAttempts: 3,
    baseDelayMS: 500,
    maxDelayMS: 5_000,
    maxRetryAfterMS: 30_000
};
function defaultSleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/**
 * 进程级策略覆盖。入口可按运行环境收紧/放宽重试预算；
 * 测试用它注入确定性 random 与 no-op sleep，避免真实等待。
 */
let policyOverrides = {};
function configureGitLabRetry(overrides) {
    policyOverrides = { ...policyOverrides, ...overrides };
}
function resetGitLabRetryPolicy() {
    policyOverrides = {};
}
/**
 * 计算第 attempt 次失败后的退避时长（attempt 从 1 开始）。
 *
 * 指数退避 + 全抖动（full jitter）：delay = random() * min(base * 2^(attempt-1), maxDelay)。
 * 全抖动可以避免多个并发请求在同一时刻重试造成二次冲击。
 */
function computeBackoffMS(attempt, policy = GITLAB_RETRY_DEFAULTS) {
    const random = policy.random ?? Math.random;
    const exponential = policy.baseDelayMS * 2 ** Math.max(0, attempt - 1);
    const capped = Math.min(exponential, policy.maxDelayMS);
    return Math.round(random() * capped);
}
/**
 * 执行一次 GitLab API 调用，按统一策略归一化错误并做有上限的退避重试。
 *
 * 所有 GitLab adapter 的 API 调用都应经过这里，保证：
 * 重试语义、错误 kind、日志脱敏在整个 adapter 内一致（GLAPI-032）。
 */
async function withGitLabRetry(operation, fn, overrides = {}) {
    const policy = { ...GITLAB_RETRY_DEFAULTS, ...policyOverrides, ...overrides };
    const sleep = policy.sleep ?? defaultSleep;
    const logger = getLogger();
    let lastError;
    for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
        try {
            return await fn(attempt);
        }
        catch (e) {
            const err = normalizeGitLabError(e, operation);
            lastError = err;
            if (!isRetryableErrorKind(err.errorKind))
                throw err;
            if (attempt >= policy.maxAttempts)
                break;
            const retryAfterMS = extractRetryAfterMS(e);
            if (retryAfterMS != null && retryAfterMS > policy.maxRetryAfterMS) {
                logger.warning(`${operation}: rate limited, Retry-After ${retryAfterMS}ms exceeds ` +
                    `${policy.maxRetryAfterMS}ms budget — giving up`);
                throw err;
            }
            const delayMS = retryAfterMS ?? computeBackoffMS(attempt, policy);
            logger.warning(`${operation}: ${err.errorKind}${err.statusCode == null ? '' : ` (${err.statusCode})`}, ` +
                `retrying in ${delayMS}ms (attempt ${attempt + 1}/${policy.maxAttempts})`);
            await sleep(delayMS);
        }
    }
    // 循环只可能因「重试次数耗尽」退出，此时 lastError 必然存在
    throw lastError ?? normalizeGitLabError(new Error('unknown failure'), operation);
}

// EXTERNAL MODULE: external "crypto"
var external_crypto_ = __nccwpck_require__(6113);
;// CONCATENATED MODULE: ./lib/platform/gitlab-write-marker.js
/**
 * platform/gitlab-write-marker.ts — 写操作幂等 marker（GLAPI-027）
 *
 * 超时/网络中断时无法区分「请求没到 GitLab」和「GitLab 已写入但响应丢了」。
 * 直接重试后者会产生重复 note/discussion。做法：
 *
 * 1. 写入前给正文追加一个隐藏 marker（HTML 注释，GitLab Markdown 不渲染）；
 * 2. 重试前先按 marker 查询已有内容，命中说明上一次其实成功了，直接复用；
 * 3. 返回给共享核心前把 marker 去掉，核心看到的正文与 GitHub 侧语义一致。
 *
 * 两条不变式：
 *
 * - **marker 唯一标识「一次逻辑写入」，不是「一段正文」**：每次写入由
 *   `newWriteOperationId()` 生成随机 operationId，只在该次调用的重试之间复用。
 *   否则同一 MR 里再次合法发布相同正文时（如两次 pause 回复），重试探测会命中
 *   历史评论并误判为「本次已成功」，导致新评论丢失。
 * - **marker 文本只含受限字符**：projectPath、文件路径、正文等外部内容只以
 *   sha1 摘要形式参与，绝不原样进入 HTML 注释。Git 文件名允许 `>` 甚至 `-->`，
 *   直接拼接会提前闭合注释并让剥离正则失效，把内部标记暴露给用户。
 *
 * marker 带 `gitlab:` 命名空间（A4），不与 GitHub 侧 marker 混用；
 * 也带 MR IID，便于人工排查时定位。
 */

const MARKER_PREFIX = 'ai-reviewer:gitlab:write';
/**
 * 匹配本模块生成的 marker（用于剥离）。
 * 各字段字符集受限且由本模块生成，外部内容无法构造出能破坏该格式的 marker。
 */
const MARKER_PATTERN = new RegExp(`\\n*<!-- ${MARKER_PREFIX}:\\d+:[a-z][a-z0-9-]*:[0-9a-f]{16} -->`, 'g');
/** 为一次逻辑写入生成唯一 ID */
function newWriteOperationId() {
    return (0,external_crypto_.randomUUID)();
}
/** 把操作种类规范化为受限 slug，保证 marker 文本格式不可被外部内容破坏 */
function normalizeOpKind(op) {
    const slug = op
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return /^[a-z]/.test(slug) ? slug : `op-${slug}`;
}
/** 生成幂等 marker */
function buildWriteMarker(input) {
    const kind = normalizeOpKind(input.op);
    // \0 作分隔符：合法的项目路径/文件名/正文都不含它，杜绝字段拼接歧义
    const digest = (0,external_crypto_.createHash)('sha1')
        .update([
        input.projectPath,
        String(input.changeRequestId),
        kind,
        input.opDetail ?? '',
        input.operationId,
        input.body
    ].join('\u0000'), 'utf8')
        .digest('hex')
        .slice(0, 16);
    return `<!-- ${MARKER_PREFIX}:${input.changeRequestId}:${kind}:${digest} -->`;
}
/** 追加 marker；已包含时保持原样（重试路径可安全重复调用） */
function appendWriteMarker(body, marker) {
    if (body.includes(marker))
        return body;
    return `${body}\n\n${marker}`;
}
/** 判断一段正文是否带指定 marker */
function hasWriteMarker(body, marker) {
    if (body == null)
        return false;
    return body.includes(marker);
}
/**
 * 剥离所有本模块的 marker，返回给共享核心的正文不含平台实现细节。
 * 只删 marker 本身与其前置空行，不触碰用户内容里的其他 HTML 注释。
 */
function stripWriteMarkers(body) {
    if (body == null)
        return '';
    return body.replace(MARKER_PATTERN, '');
}

;// CONCATENATED MODULE: ./lib/platform/gitlab-platform.js
/**
 * platform/gitlab-platform.ts - GitLab REST adapter（ARCH-020）
 *
 * 使用 @gitbeaker/rest 作为标准客户端。
 * @gitbeaker/rest 类型不泄露到 IGitPlatform 或共享业务核心（ARCH-024）。
 *
 * 已实现：
 * - GLAPI-001/002: getChangeRequest（MR 详情）
 * - GLAPI-003/004: compareDiff（diff 比较）
 * - GLAPI-005: getFileContent（文件内容）
 * - GLAPI-006: getChangeRequest 返回 headSha 供调用方做 HEAD 比较
 * - GLAPI-007~012: Notes CRUD（createComment/updateComment/deleteComment/listComments）
 * - GLAPI-013~019: Discussions（行级评论 + resolve）
 * - GLAPI-020~023: 权限 / 身份 / Award Emoji
 * - GLAPI-024: 所有 list API 走 listOptions() 的显式分页契约
 * - GLAPI-025/026: 所有 API 调用经 withGitLabRetry（429/5xx/超时重试，401/403 不重试）
 * - GLAPI-027: 写操作带隐藏 marker，重试前先探测上一次是否已写入成功
 * - GLAPI-029/030: 客户端统一由 createGitLabClient 构造
 * - DEP-001/004: listRepositoryTree（仓库文件树）
 */






// ─── GitLab diff 状态映射 ──────────────────────────────────────────────────
function diffStatus(d) {
    if (d.new_file)
        return 'added';
    if (d.deleted_file)
        return 'removed';
    if (d.renamed_file)
        return 'renamed';
    return 'modified';
}
// ─── GitHub ReactionContent → GitLab Award Emoji name 映射 ──────────────────
const REACTION_TO_EMOJI = {
    '+1': 'thumbsup',
    '-1': 'thumbsdown',
    laugh: 'laughing',
    confused: 'confused',
    heart: 'heart',
    hooray: 'tada',
    rocket: 'rocket',
    eyes: 'eyes'
};
// ─── GitLab AccessLevel → PlatformPermission 映射 ───────────────────────────
function accessLevelToPermission(level) {
    if (level >= 50)
        return 'admin'; // OWNER
    if (level >= 40)
        return 'maintain'; // MAINTAINER
    if (level >= 30)
        return 'write'; // DEVELOPER
    if (level >= 20)
        return 'triage'; // REPORTER
    if (level >= 10)
        return 'read'; // GUEST
    return 'none';
}
/** GitLab note → 平台无关 PlatformComment（GLAPI-032：snake_case → camelCase） */
function toPlatformComment(note) {
    return {
        id: note.id,
        body: stripWriteMarkers(note.body),
        author: note.author?.username ?? '',
        createdAt: note.created_at
    };
}
// ─── GitLabPlatform ────────────────────────────────────────────────────────
class GitLabPlatform {
    api;
    /**
     * noteId → mergerequestIId 映射缓存。
     * IGitPlatform.updateComment/deleteComment 签名中没有 changeRequestId，
     * 但 GitLab Notes API 需要 MR IID。通过 createComment/listComments 时
     * 缓存映射关系，供后续 update/delete 使用。
     */
    noteToMrIid = new Map();
    /**
     * discussion noteId → {discussionId, mrIid, projectPath} 映射缓存。
     * IGitPlatform 的 replyToReviewComment/updateReviewComment/deleteReviewComment
     * 只传 noteId，但 GitLab Discussions API 需要 discussionId + mrIid。
     * 通过 listReviewComments/createReviewComment/submitReviewComments 时缓存。
     */
    noteToDiscussion = new Map();
    /**
     * discussionId → {projectPath, mrIid} 缓存。
     * resolveThreads 只传 threadIds（即 discussionId），需要精确查找每个 discussion 的
     * projectPath 和 mrIid，避免跨 MR 混用。
     */
    discussionIdToContext = new Map();
    /**
     * 只接受受信任配置构造（GLAPI-029）：host/凭据/timeout 全部来自
     * resolveGitLabClientConfig()，adapter 不再自己拼 host 或读环境变量。
     */
    constructor(config) {
        this.api = createGitLabClient(config);
    }
    // ─── 写幂等探测（GLAPI-027）──────────────────────────────────────────────
    /** 按 marker 查找已存在的 MR note；命中说明上一次写入其实已成功 */
    async findNoteByMarker(projectPath, changeRequestId, marker) {
        const notes = (await this.api.MergeRequestNotes.all(projectPath, changeRequestId, listOptions({ sort: 'desc', orderBy: 'created_at' })));
        const hit = notes.find(n => hasWriteMarker(n.body, marker));
        if (!hit)
            return null;
        this.noteToMrIid.set(hit.id, changeRequestId);
        return toPlatformComment(hit);
    }
    /** 按 marker 查找已存在的 discussion；命中时补齐缓存 */
    async findDiscussionByMarker(projectPath, changeRequestId, marker) {
        const discussions = (await this.api.MergeRequestDiscussions.all(projectPath, changeRequestId, listOptions()));
        for (const disc of discussions) {
            const hit = (disc.notes ?? []).find((n) => hasWriteMarker(n.body, marker));
            if (!hit)
                continue;
            this.discussionIdToContext.set(disc.id, { projectPath, mrIid: changeRequestId });
            this.noteToDiscussion.set(hit.id, {
                discussionId: disc.id,
                mrIid: changeRequestId,
                projectPath
            });
            return true;
        }
        return false;
    }
    // ─── 10. 仓库文件树（DEP-001 / DEP-004）─────────────────────────────────
    /**
     * 获取 GitLab 仓库文件树。
     *
     * 使用 Repository Tree API (recursive) + 显式分页契约（GLAPI-024）。
     *
     * DEP-004 边界处理：
     * - 空仓库 → 返回空数组（正常状态，不抛错）
     * - subgroup 项目 → owner 含 `/`（如 "group/subgroup"），与 repo 拼接成完整 projectPath
     * - 超大仓库 → 翻页到 perPage × maxPages 上限后标记 truncated
     * - Unicode 路径 → gitbeaker 内部做 URL 编码
     * - API 部分失败 → 抛 GitPlatformError（不静默返回空数组）
     */
    async listRepositoryTree(owner, repo, ref) {
        const projectPath = `${owner}/${repo}`;
        try {
            const trees = await withGitLabRetry('listRepositoryTree', async () => this.api.Repositories.allRepositoryTrees(projectPath, listOptions({ ref, recursive: true })));
            const entries = trees.map(t => ({ type: t.type, path: t.path }));
            // 达到分页上限时明确标记截断，不谎报完整（GLAPI-024）
            const limit = PAGINATION_DEFAULTS.perPage * PAGINATION_DEFAULTS.maxPages;
            return { entries, truncated: entries.length >= limit };
        }
        catch (e) {
            // 空仓库返回 404 "404 Tree Not Found"，视为合法的空树
            const err = normalizeGitLabError(e, 'listRepositoryTree');
            if (err.errorKind === 'not_found' && /tree not found/i.test(err.message)) {
                return { entries: [], truncated: false };
            }
            throw err;
        }
    }
    // ─── 3. 文件内容 ─────────────────────────────────────────────────────────
    async getFileContent(owner, repo, path, ref) {
        const projectPath = `${owner}/${repo}`;
        try {
            // gitbeaker 对 path/ref 做 URL 编码，subgroup、Unicode、含空格路径均可直传
            const file = await withGitLabRetry('getFileContent', async () => this.api.RepositoryFiles.show(projectPath, path, ref));
            return Buffer.from(file.content, 'base64').toString('utf8');
        }
        catch (e) {
            const err = normalizeGitLabError(e, 'getFileContent');
            if (err.errorKind === 'not_found')
                return null;
            throw err;
        }
    }
    // ─── 1. PR/MR 信息（GLAPI-001/002/006）────────────────────────────────────
    async getChangeRequest(owner, repo, changeRequestId) {
        const projectPath = `${owner}/${repo}`;
        const mr = await withGitLabRetry('getChangeRequest', async () => this.api.MergeRequests.show(projectPath, changeRequestId));
        const state = mr.state === 'merged' ? 'merged' : mr.state === 'opened' ? 'open' : 'closed';
        // gitbeaker 返回 Camelize<unknown> 联合类型，需要 as any 断言
        const diffRefs = mr.diff_refs;
        // GitLab 新建 MR 时 diff_refs 可能暂时为空（异步计算），需显式校验
        if (!diffRefs?.base_sha || !diffRefs?.head_sha) {
            throw new GitPlatformError(`MR !${changeRequestId} diff_refs not yet available (GitLab is still computing diffs)`, 'conflict', undefined);
        }
        return {
            number: mr.iid,
            title: mr.title,
            body: mr.description ?? '',
            state,
            baseSha: diffRefs.base_sha,
            headSha: diffRefs.head_sha,
            baseRef: mr.target_branch,
            headRef: mr.source_branch,
            author: mr.author.username
        };
    }
    async updateChangeRequestBody(owner, repo, changeRequestId, body) {
        const projectPath = `${owner}/${repo}`;
        await withGitLabRetry('updateChangeRequestBody', async () => this.api.MergeRequests.edit(projectPath, changeRequestId, { description: body }));
    }
    async listChangeRequestCommits(owner, repo, changeRequestId) {
        const projectPath = `${owner}/${repo}`;
        const commits = await withGitLabRetry('listChangeRequestCommits', async () => this.api.MergeRequests.allCommits(projectPath, changeRequestId, listOptions()));
        return commits.map(c => c.id);
    }
    // ─── 2. Diff（GLAPI-003/004）──────────────────────────────────────────────
    async compareDiff(owner, repo, _base, _head) {
        // 使用 Repositories.compare API 比较两个 ref/SHA 的 diff
        const projectPath = `${owner}/${repo}`;
        const diff = await withGitLabRetry('compareDiff', async () => this.api.Repositories.compare(projectPath, _base, _head));
        // GitLab compare_timeout=true 时 diffs 可能不完整，fail closed 不审查残缺内容
        if (diff.compare_timeout) {
            throw new GitPlatformError(`GitLab compare timed out for ${_base}..${_head} — diff may be incomplete`, 'timeout', undefined);
        }
        // gitbeaker 返回 Camelize<unknown> 联合类型，需要 as any 断言
        const diffs = (diff.diffs ?? []);
        const files = diffs.map(d => ({
            filename: d.new_path,
            status: diffStatus(d),
            patch: d.diff ?? undefined,
            previousFilename: d.old_path !== d.new_path ? d.old_path : undefined
        }));
        const commits = (diff.commits ?? []);
        return {
            files,
            commits: commits.map(c => ({ sha: c.id }))
        };
    }
    // ─── 4. 顶层评论 / MR Notes（GLAPI-007~012）────────────────────────────────
    async createComment(owner, repo, changeRequestId, body) {
        const projectPath = `${owner}/${repo}`;
        // GLAPI-027：正文带幂等 marker，重试前先探测是否已写入。
        // operationId 每次调用新生成 → marker 只在本次调用的重试之间复用，
        // 不会命中同 MR 里正文相同的历史评论。
        const marker = buildWriteMarker({
            projectPath,
            changeRequestId,
            op: 'note',
            operationId: newWriteOperationId(),
            body
        });
        const markedBody = appendWriteMarker(body, marker);
        return withGitLabRetry('createComment', async (attempt) => {
            if (attempt > 1) {
                const existing = await this.findNoteByMarker(projectPath, changeRequestId, marker);
                if (existing != null)
                    return existing;
            }
            const note = (await this.api.MergeRequestNotes.create(projectPath, changeRequestId, markedBody));
            this.noteToMrIid.set(note.id, changeRequestId);
            return toPlatformComment(note);
        });
    }
    async updateComment(owner, repo, commentId, body) {
        const projectPath = `${owner}/${repo}`;
        const mrIid = this.noteToMrIid.get(commentId);
        if (mrIid == null) {
            throw new GitPlatformError(`Cannot update note ${commentId}: MR IID unknown (note was not created/listed via this adapter instance)`, 'not_found');
        }
        // 更新是覆盖写，天然幂等，不需要 marker 探测
        await withGitLabRetry('updateComment', async () => this.api.MergeRequestNotes.edit(projectPath, mrIid, commentId, { body }));
    }
    async deleteComment(owner, repo, commentId) {
        const projectPath = `${owner}/${repo}`;
        const mrIid = this.noteToMrIid.get(commentId);
        if (mrIid == null) {
            throw new GitPlatformError(`Cannot delete note ${commentId}: MR IID unknown (note was not created/listed via this adapter instance)`, 'not_found');
        }
        try {
            await withGitLabRetry('deleteComment', async () => this.api.MergeRequestNotes.remove(projectPath, mrIid, commentId));
        }
        catch (e) {
            const err = normalizeGitLabError(e, 'deleteComment');
            // 重试期间上一次删除其实已成功 → 404 视为达成目标（GLAPI-027）
            if (err.errorKind !== 'not_found')
                throw err;
        }
        this.noteToMrIid.delete(commentId);
    }
    async listComments(owner, repo, changeRequestId) {
        const projectPath = `${owner}/${repo}`;
        // GLAPI-024：显式分页，不依赖 SDK 默认 perPage
        const notes = await withGitLabRetry('listComments', async () => this.api.MergeRequestNotes.all(projectPath, changeRequestId, listOptions({ sort: 'asc', orderBy: 'created_at' })));
        // 过滤 system note（合并事件、标签变更等自动生成的 note）
        const userNotes = notes.filter(n => !n.system);
        // 缓存 noteId → mrIid 映射，供 update/delete 使用
        for (const n of userNotes) {
            this.noteToMrIid.set(n.id, changeRequestId);
        }
        return userNotes.map(toPlatformComment);
    }
    // ─── 5. 行级评论 / Discussions（GLAPI-013~019）─────────────────────────────
    /**
     * 获取所有 MR discussions，提取 DiffNote 作为 ReviewComment 返回。
     * 同时缓存 noteId → {discussionId, mrIid, projectPath} 和
     * discussionId → {projectPath, mrIid} 映射。
     */
    async getAllDiffDiscussions(projectPath, changeRequestId) {
        const discussions = (await withGitLabRetry('listDiscussions', async () => this.api.MergeRequestDiscussions.all(projectPath, changeRequestId, listOptions())));
        const reviewComments = [];
        for (const disc of discussions) {
            if (!disc.notes?.length)
                continue;
            this.discussionIdToContext.set(disc.id, { projectPath, mrIid: changeRequestId });
            for (const note of disc.notes) {
                // 只提取 DiffNote（行级评论），跳过普通 DiscussionNote 和 system note
                if (note.type !== 'DiffNote' || note.system)
                    continue;
                this.noteToDiscussion.set(note.id, {
                    discussionId: disc.id,
                    mrIid: changeRequestId,
                    projectPath
                });
                const pos = note.position;
                const replyToId = disc.notes[0].id !== note.id ? disc.notes[0].id : undefined;
                reviewComments.push({
                    id: note.id,
                    body: stripWriteMarkers(note.body),
                    path: pos?.new_path ?? pos?.old_path ?? '',
                    line: pos?.new_line != null ? Number(pos.new_line) : null,
                    startLine: null,
                    originalLine: pos?.old_line != null ? Number(pos.old_line) : null,
                    author: note.author?.username ?? '',
                    // eslint-disable-next-line camelcase
                    in_reply_to_id: replyToId,
                    createdAt: note.created_at
                });
            }
        }
        return { discussions, reviewComments };
    }
    async listReviewComments(owner, repo, changeRequestId) {
        const projectPath = `${owner}/${repo}`;
        const { reviewComments } = await this.getAllDiffDiscussions(projectPath, changeRequestId);
        return reviewComments;
    }
    async submitReviewComments(owner, repo, changeRequestId, commitSha, comments, _reviewBody) {
        // GitLab 无 batch review 概念，逐条创建 discussion
        let submitted = 0;
        for (const comment of comments) {
            try {
                await this.createReviewComment(owner, repo, changeRequestId, commitSha, comment);
                submitted++;
            }
            catch {
                // GLAPI-015: 行级位置无法映射时降级为顶层 note（同样带幂等 marker）
                try {
                    await this.createComment(owner, repo, changeRequestId, `**${comment.path}** (line ${comment.line})\n\n${comment.body}`);
                    submitted++;
                }
                catch {
                    // 降级也失败，跳过该条
                }
            }
        }
        return submitted;
    }
    async createReviewComment(owner, repo, changeRequestId, commitSha, comment) {
        const projectPath = `${owner}/${repo}`;
        // 文件路径只参与摘要（opDetail），不进 marker 文本：
        // Git 文件名允许 `>` 甚至 `-->`，原样拼接会提前闭合 HTML 注释
        const marker = buildWriteMarker({
            projectPath,
            changeRequestId,
            op: 'discussion',
            opDetail: `${comment.path}:${comment.line}`,
            operationId: newWriteOperationId(),
            body: comment.body
        });
        const markedBody = appendWriteMarker(comment.body, marker);
        await withGitLabRetry('createReviewComment', async (attempt) => {
            // GLAPI-027：重试前先确认上一次是否已经建出 discussion
            if (attempt > 1) {
                const exists = await this.findDiscussionByMarker(projectPath, changeRequestId, marker);
                if (exists)
                    return;
            }
            // 需要 base_sha / head_sha / start_sha 构造 position
            const mr = await this.api.MergeRequests.show(projectPath, changeRequestId);
            const diffRefs = mr.diff_refs;
            const discussion = (await this.api.MergeRequestDiscussions.create(projectPath, changeRequestId, markedBody, {
                commitId: commitSha,
                position: {
                    baseSha: diffRefs.base_sha,
                    headSha: diffRefs.head_sha,
                    startSha: diffRefs.start_sha,
                    positionType: 'text',
                    newPath: comment.path,
                    oldPath: comment.path,
                    newLine: String(comment.line)
                }
            }));
            // 缓存 discussion 及其第一个 note
            this.discussionIdToContext.set(discussion.id, { projectPath, mrIid: changeRequestId });
            if (discussion.notes?.[0]) {
                this.noteToDiscussion.set(discussion.notes[0].id, {
                    discussionId: discussion.id,
                    mrIid: changeRequestId,
                    projectPath
                });
            }
        });
    }
    async replyToReviewComment(owner, repo, changeRequestId, commentId, body) {
        const projectPath = `${owner}/${repo}`;
        let cached = this.noteToDiscussion.get(commentId);
        // cache miss fallback: webhook 路径下触发评论的 noteId 可能未缓存，
        // 此时 fetch 所有 discussions 补充缓存
        if (!cached) {
            await this.getAllDiffDiscussions(projectPath, changeRequestId);
            cached = this.noteToDiscussion.get(commentId);
        }
        if (!cached) {
            throw new GitPlatformError(`Cannot reply to note ${commentId}: discussion ID unknown`, 'not_found');
        }
        const discussionId = cached.discussionId;
        const marker = buildWriteMarker({
            projectPath,
            changeRequestId,
            op: 'reply',
            opDetail: discussionId,
            operationId: newWriteOperationId(),
            body
        });
        const markedBody = appendWriteMarker(body, marker);
        return withGitLabRetry('replyToReviewComment', async (attempt) => {
            if (attempt > 1) {
                const { discussions } = await this.getAllDiffDiscussions(projectPath, changeRequestId);
                const disc = discussions.find(d => d.id === discussionId);
                const hit = (disc?.notes ?? []).find((n) => hasWriteMarker(n.body, marker));
                if (hit != null)
                    return toPlatformComment(hit);
            }
            const note = (await this.api.MergeRequestDiscussions.addNote(projectPath, changeRequestId, discussionId, markedBody));
            this.noteToDiscussion.set(note.id, {
                discussionId,
                mrIid: changeRequestId,
                projectPath
            });
            return toPlatformComment(note);
        });
    }
    async updateReviewComment(owner, repo, commentId, body) {
        const projectPath = `${owner}/${repo}`;
        const cached = this.noteToDiscussion.get(commentId);
        if (!cached) {
            throw new GitPlatformError(`Cannot update note ${commentId}: discussion ID unknown`, 'not_found');
        }
        await withGitLabRetry('updateReviewComment', async () => this.api.MergeRequestDiscussions.editNote(projectPath, cached.mrIid, cached.discussionId, commentId, { body }));
    }
    async deleteReviewComment(owner, repo, commentId) {
        const projectPath = `${owner}/${repo}`;
        const cached = this.noteToDiscussion.get(commentId);
        if (!cached) {
            throw new GitPlatformError(`Cannot delete note ${commentId}: discussion ID unknown`, 'not_found');
        }
        try {
            await withGitLabRetry('deleteReviewComment', async () => this.api.MergeRequestDiscussions.removeNote(projectPath, cached.mrIid, cached.discussionId, commentId));
        }
        catch (e) {
            const err = normalizeGitLabError(e, 'deleteReviewComment');
            // 重试期间上一次删除其实已成功 → 404 视为达成目标（GLAPI-027）
            if (err.errorKind !== 'not_found')
                throw err;
        }
        this.noteToDiscussion.delete(commentId);
    }
    async deletePendingReview(_owner, _repo, _changeRequestId) {
        // GitLab 无 pending review 概念，空实现
    }
    // ─── 6. Review thread（GLAPI-017/018/019）────────────────────────────────
    async fetchThreadStatusMap(owner, repo, changeRequestId) {
        const projectPath = `${owner}/${repo}`;
        // discussionIdToContext 在 getAllDiffDiscussions 中自动填充
        const { discussions } = await this.getAllDiffDiscussions(projectPath, changeRequestId);
        const map = new Map();
        for (const disc of discussions) {
            const firstNote = disc.notes?.[0];
            if (!firstNote || firstNote.type !== 'DiffNote')
                continue;
            const pos = firstNote.position;
            const path = pos?.new_path ?? pos?.old_path;
            const line = pos?.new_line != null ? Number(pos.new_line) : null;
            if (path && line != null) {
                const key = `${path}:${line}`;
                const resolved = disc.notes.every((n) => !n.resolvable || n.resolved);
                if (!map.has(key) || !resolved) {
                    map.set(key, resolved);
                }
            }
        }
        return map;
    }
    async fetchUnresolvedBotThreads(owner, repo, changeRequestId, botLogin) {
        const projectPath = `${owner}/${repo}`;
        // discussionIdToContext 在 getAllDiffDiscussions 中自动填充
        const { discussions } = await this.getAllDiffDiscussions(projectPath, changeRequestId);
        const results = [];
        const normalizedBot = botLogin.toLowerCase();
        for (const disc of discussions) {
            const firstNote = disc.notes?.[0];
            if (!firstNote)
                continue;
            const authorLogin = firstNote.author?.username ?? '';
            const isResolved = disc.notes.every((n) => !n.resolvable || n.resolved);
            if (!isResolved && authorLogin.toLowerCase() === normalizedBot) {
                const pos = firstNote.position;
                results.push({
                    id: disc.id,
                    isResolved: false,
                    path: pos?.new_path ?? pos?.old_path ?? null,
                    line: pos?.new_line != null ? Number(pos.new_line) : null,
                    firstCommentAuthorLogin: authorLogin,
                    firstCommentBody: firstNote.body == null ? null : stripWriteMarkers(firstNote.body)
                });
            }
        }
        return results;
    }
    async resolveThreads(threadIds) {
        let ok = 0;
        const errors = [];
        await Promise.allSettled(threadIds.map(async (threadId) => {
            const ctx = this.discussionIdToContext.get(threadId);
            if (!ctx) {
                errors.push(new Error(`No cached context for discussion ${threadId}`));
                return;
            }
            try {
                await withGitLabRetry('resolveThread', async () => this.api.MergeRequestDiscussions.resolve(ctx.projectPath, ctx.mrIid, threadId, true));
                ok++;
            }
            catch (e) {
                errors.push(e instanceof Error ? e : new Error(String(e)));
            }
        }));
        return { ok, failed: errors.length, errors };
    }
    // ─── 7. Reaction（GLAPI-023）─────────────────────────────────────────────
    /**
     * GitLab Award Emoji ACK。
     *
     * GitHub ReactionContent → GitLab emoji name 映射后，
     * 通过 MergeRequestNoteAwardEmojis.award 添加。
     * GitLab 不区分 issue_comment / review_comment，都是 MR note。
     * 失败不阻塞核心审查（由调用方 reaction.ts 捕获）。
     */
    async addReaction(owner, repo, changeRequestId, commentId, content, _commentKind) {
        const projectPath = `${owner}/${repo}`;
        const emojiName = REACTION_TO_EMOJI[content];
        try {
            await withGitLabRetry('addReaction', async () => this.api.MergeRequestNoteAwardEmojis.award(projectPath, changeRequestId, commentId, emojiName));
        }
        catch (e) {
            const err = normalizeGitLabError(e, 'addReaction');
            // 重复 award 同一 emoji 是这个 endpoint 唯一的冲突场景（GitLab 各版本返回的
            // 409 文案不一致，故按状态码而非文案判定）。ACK 已经在了，视为达成目标。
            if (err.errorKind !== 'conflict')
                throw err;
            getLogger().debug(`addReaction: ${emojiName} already awarded on note ${commentId}`);
        }
    }
    // ─── 8. 权限（GLAPI-020 / GLAPI-021 / GLAPI-026）──────────────────────────
    /**
     * 按用户名查询项目 access level。
     *
     * 流程：Users.all({username}) 获取 userId → ProjectMembers.show(projectId, userId, {includeInherited})
     * 获取 access_level → 映射为 PlatformPermission。
     *
     * GLAPI-021: 任何环节失败都 fail closed，返回 'none'。
     * GLAPI-026: 401/403 时把权限诊断写进日志，避免 fail closed 变成无法排查的静默拒绝。
     */
    async getCollaboratorPermission(owner, repo, username) {
        const projectPath = `${owner}/${repo}`;
        try {
            // 1. 用户名 → userId
            const users = (await withGitLabRetry('getCollaboratorPermission.users', async () => this.api.Users.all(listOptions({ username }))));
            const user = users.find((u) => u.username.toLowerCase() === username.toLowerCase());
            if (!user)
                return 'none';
            // 2. userId → access_level（includeInherited 包含继承的组权限）
            const member = (await withGitLabRetry('getCollaboratorPermission.member', async () => this.api.ProjectMembers.show(projectPath, user.id, {
                includeInherited: true
            })));
            const level = member.access_level ?? 0;
            return accessLevelToPermission(level);
        }
        catch (e) {
            const err = normalizeGitLabError(e, 'getCollaboratorPermission');
            if (err.errorKind !== 'not_found') {
                getLogger().warning(`Permission lookup failed, denying access: ${err.message}`);
            }
            // GLAPI-021: fail closed
            return 'none';
        }
    }
    // ─── 9. 用户身份（GLAPI-022）───────────────────────────────────────────────
    /**
     * 获取当前 PAT / Job Token 对应的用户名。
     * 用于 bot 自评论过滤（fetchUnresolvedBotThreads 的 botLogin 参数）。
     */
    async getAuthenticatedLogin() {
        try {
            const user = (await withGitLabRetry('getAuthenticatedLogin', async () => this.api.Users.showCurrentUser()));
            return user.username;
        }
        catch (e) {
            const err = normalizeGitLabError(e, 'getAuthenticatedLogin');
            getLogger().warning(`Failed to resolve PAT username: ${err.message}`);
            return 'gitlab-bot';
        }
    }
}

;// CONCATENATED MODULE: ./lib/platform/exec-ctx-error-handler.js
/**
 * platform/exec-ctx-error-handler.ts — ExecutionContextError 统一处理（ARCH-026）
 *
 * 从 orchestrator.ts 拆出，确保 gitlab-trigger.ts 可以单独引入，
 * 不间接拉入 commenter/review/command-handler 等 GitHub 侧依赖（ARCH-015）。
 */

/**
 * ExecutionContextError 统一处理（ARCH-026）。
 *
 * @returns 'skip' 表示无关事件可跳过，'fatal' 表示需要 fail closed
 */
function handleExecCtxError(e, logger, onFailed) {
    if (e instanceof ExecutionContextError &&
        (e.reason === 'unknown_event' || e.reason === 'ignorable_event')) {
        // unknown_event：完全不认识的事件；ignorable_event：认识但业务上不需要处理
        // 的事件（note 编辑/删除、system note、非 MR note，见 EVENT-016/017、Issue #66）。
        // 两者都优雅跳过（skip），不应 fail closed。
        logger.warning(`Skipped: ${e.message}`);
        return 'skip';
    }
    if (e instanceof ExecutionContextError) {
        onFailed(`Failed to build ExecutionContext: ${e.message}`);
    }
    else if (e instanceof Error) {
        onFailed(`Failed to build ExecutionContext: ${e.message}, backtrace: ${e.stack}`);
    }
    else {
        onFailed(`Failed to build ExecutionContext: ${e}`);
    }
    return 'fatal';
}

;// CONCATENATED MODULE: ./lib/gitlab-trigger-validation.js
/**
 * gitlab-trigger-validation.ts - TRIGGER_PAYLOAD 结构校验（EVENT-003）
 *
 * `createGitLabExecutionContext` 已经校验了它需要的字段（object_attributes.iid、
 * project、noteable_type 等），但不读取/校验 source_project_id/target_project_id
 * ——这两个字段只用于 fork 检测。本模块只负责"这些字段存不存在、类型对不对"的结构性
 * 校验，不做业务判断；实际的 fork 拒绝逻辑（EVENT-010）在
 * `gitlab-mr-hook-rules.ts` 的 `checkForkMergeRequest()` + `gitlab-trigger.ts` 里。
 *
 * 参考 docs/tasks/gitlab-trigger-cli-design.md 第 4 节。
 */
function validateTriggerPayload(payload) {
    if (payload == null || typeof payload !== 'object') {
        return { ok: false, reason: 'payload is not an object' };
    }
    const p = payload;
    if (p.object_kind !== 'merge_request' && p.object_kind !== 'note') {
        // 未知 object_kind 的处理交给 createGitLabExecutionContext 的 unknown_event
        // 分支（EVENT-004 快速退出），这里只做"是不是我们认识的两种事件"的粗过滤
        return { ok: true };
    }
    const project = p.project;
    if (project?.id == null) {
        return { ok: false, reason: 'missing project.id' };
    }
    if (p.object_kind === 'merge_request') {
        const attrs = p.object_attributes;
        if (attrs?.iid == null) {
            return { ok: false, reason: 'missing object_attributes.iid' };
        }
        if (attrs?.source_project_id == null || attrs?.target_project_id == null) {
            return { ok: false, reason: 'missing source_project_id/target_project_id' };
        }
        return {
            ok: true,
            sourceTargetMismatch: attrs.source_project_id !== attrs.target_project_id
        };
    }
    // note
    const attrs = p.object_attributes;
    const mr = p.merge_request;
    if (attrs?.id == null) {
        return { ok: false, reason: 'missing object_attributes.id' };
    }
    if (mr?.iid == null) {
        return { ok: false, reason: 'missing merge_request.iid' };
    }
    return { ok: true };
}

;// CONCATENATED MODULE: ./lib/gitlab-mr-hook-rules.js
/**
 * gitlab-mr-hook-rules.ts - GitLab MR Hook 业务规则（EVENT-010/012/013）
 *
 * 三个纯函数，不做任何文件/网络 IO：
 * - checkForkMergeRequest()：EVENT-010，判断 MR 是否来自 fork（source_project_id
 *   != target_project_id），供 gitlab-trigger.ts 决定是否 fail closed 拒绝。
 * - isHeadStale()：EVENT-012，比较"事件里的 headSha"与"重新读取到的当前 headSha"
 *   是否一致；真正重新读取 GitLab MR 当前 HEAD 属于 GLAPI-006，本函数只做比较。
 * - buildMrIdempotencyKey()：EVENT-013，生成幂等键，格式为
 *   `gitlab:{project_id}:{mr_iid}:head:{head_sha}`；与 summary note marker 的比对
 *   属于 STATE-005，不在本文件范围。
 *
 * 参考 docs/tasks/gitlab-mr-hook-design.md 第 3.2/3.4/3.5 节。
 */
function checkForkMergeRequest(sourceProjectId, targetProjectId) {
    if (sourceProjectId !== targetProjectId) {
        return {
            isFork: true,
            reason: `source_project_id(${sourceProjectId}) !== target_project_id(${targetProjectId})`
        };
    }
    return { isFork: false };
}
function isHeadStale(eventHeadSha, currentHeadSha) {
    return {
        stale: eventHeadSha !== currentHeadSha,
        eventHeadSha,
        currentHeadSha
    };
}
function buildMrIdempotencyKey(projectId, mrIid, headSha) {
    return `gitlab:${projectId}:${mrIid}:head:${headSha}`;
}

;// CONCATENATED MODULE: ./lib/gitlab-trigger.js
/**
 * gitlab-trigger.ts - GitLab trigger CLI 入口（EVENT-001/002）
 *
 * 由 protected main 的 ai-review-trigger job 调用。从 file-type CI 变量
 * TRIGGER_PAYLOAD 指向的文件路径读取原始事件 → 解析 JSON → 结构校验 →
 * 构造 ExecutionContext → 打印摘要。
 *
 * 不 import @actions/core / @actions/github（ARCH-015）。
 * 使用 Logger 抽象（ARCH-012）和 handleExecCtxError（ARCH-026）。
 */











const logger = new GitLabLogger();
async function run() {
    // 初始化 GitLab Logger（ARCH-014）+ Platform（ARCH-018/020）
    setLogger(logger);
    // GLAPI-029：host / 凭据 / timeout 统一从受信任配置解析并校验，非法即 fail closed
    let clientConfig;
    try {
        clientConfig = resolveGitLabClientConfig();
    }
    catch (e) {
        logger.error(redact(e instanceof Error ? e.message : String(e)));
        process.exitCode = 1;
        return;
    }
    // 摘要只含 host/凭据类型/timeout，不含 token（GLAPI-029）；
    // 走 debug 级别，避免在事件被拒绝（如 fork MR）前产生无关输出
    logger.debug(`GitLab client: ${describeGitLabClientConfig(clientConfig)}`);
    setPlatform(new GitLabPlatform(clientConfig));
    const payloadPath = process.env.TRIGGER_PAYLOAD;
    if (payloadPath == null || payloadPath === '') {
        logger.error('TRIGGER_PAYLOAD is not set');
        process.exitCode = 1;
        return;
    }
    let raw;
    try {
        raw = (0,external_fs_namespaceObject.readFileSync)(payloadPath, 'utf8');
    }
    catch (e) {
        logger.error(`Failed to read TRIGGER_PAYLOAD file: ${redact(String(e))}`);
        process.exitCode = 1;
        return;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        logger.error('TRIGGER_PAYLOAD content is not valid JSON');
        process.exitCode = 1;
        return;
    }
    const validation = validateTriggerPayload(parsed);
    if (!validation.ok) {
        logger.error(`TRIGGER_PAYLOAD failed validation: ${validation.reason}`);
        process.exitCode = 1;
        return;
    }
    if (validation.sourceTargetMismatch) {
        // EVENT-010：fork MR 是需要人工关注的安全边界，fail closed 而非优雅跳过
        // （区别于 unknown_event 的 exit 0 语义）——见 docs/tasks/gitlab-mr-hook-design.md 第 3.2 节。
        const attrs = parsed.object_attributes;
        const forkCheck = checkForkMergeRequest(attrs.source_project_id, attrs.target_project_id);
        logger.error(`Rejected: fork MR not supported (MVP) — ${redact(forkCheck.reason ?? '')}`);
        process.exitCode = 1;
        return;
    }
    let execCtx;
    try {
        execCtx = createGitLabExecutionContext(parsed);
    }
    catch (e) {
        // ARCH-026：统一 ExecCtxError 处理
        const result = handleExecCtxError(e, logger, (msg) => {
            logger.error(redact(msg));
            process.exitCode = 1;
        });
        if (result === 'skip')
            return; // 无关事件，成功退出
        return; // fatal，exitCode 已设置
    }
    logger.info(`GitLab event validated: platform=${execCtx.platform} eventKind=${execCtx.eventKind} project=${execCtx.projectPath} mr=${execCtx.changeRequestId}`);
    // TODO: 待 GLAPI-* 补全后，此处调用 runOrchestrator 或 dispatchEvent 执行审查。
}
// 不用顶层 await（同 main.ts 的既有原因）
void (async () => {
    try {
        await run();
    }
    catch (e) {
        logger.error(`Unhandled error in gitlab-trigger run(): ${redact(String(e))}`);
        process.exitCode = 1;
    }
})();

})();

module.exports = __webpack_exports__;
/******/ })()
;