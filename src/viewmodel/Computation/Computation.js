import runloop from 'global/runloop';
import { log, warn } from 'utils/log';
import { isEqual } from 'utils/is';
import UnresolvedDependency from './UnresolvedDependency';

var Computation = function ( key, signature, initialValue ) {
	this.key = key;

	this.getter = signature.getter;
	this.setter = signature.setter;

	this.hardDeps = signature.deps || [];
	this.softDeps = [];
	this.unresolvedDeps = {};

	this.depValues = {};

	this._dirty = this._firstRun = true;

	this.viewmodel = key.owner;

	if ( this.setter && initialValue !== undefined ) {
		this.set( initialValue );
	}

	if ( this.hardDeps ) {
		this.hardDeps.forEach( d => d.register( this, 'computed' ) );
	}
};

Computation.prototype = {
	constructor: Computation,

	invalidate: function () {
		this._dirty = true;
	},

	get: function () {
		var newDeps, dependenciesChanged, dependencyValuesChanged = false;

		if ( this.getting ) {
			// prevent double-computation (e.g. caused by array mutation inside computation)
			return;
		}

		this.getting = true;

		if ( this._dirty ) {
			// determine whether the inputs have changed, in case this depends on
			// other computed values
			if ( this._firstRun || ( !this.hardDeps.length && !this.softDeps.length ) ) {
				dependencyValuesChanged = true;
			} else {
				[ this.hardDeps, this.softDeps ].forEach( deps => {
					var keypath, value, i;

					if ( dependencyValuesChanged ) {
						return;
					}

					i = deps.length;
					while ( i-- ) {
						keypath = deps[i];
						value = this.viewmodel.get( keypath );

						if ( !isEqual( value, this.depValues[ keypath.getKeypath() ] ) ) {
							this.depValues[ keypath.getKeypath() ] = value;
							dependencyValuesChanged = true;

							return;
						}
					}
				});
			}

			if ( dependencyValuesChanged ) {
				this.viewmodel.capture();

				try {
					this.value = this.getter();
				} catch ( err ) {
					if ( this.viewmodel.debug ) {
						warn( 'Failed to compute "%s"', this.key.getKeypath() );
						log( err.stack || err );
					}

					this.value = void 0;
				}

				newDeps = this.viewmodel.release();
				dependenciesChanged = this.updateDependencies( newDeps );

				if ( dependenciesChanged ) {
					[ this.hardDeps, this.softDeps ].forEach( deps => {
						deps.forEach( keypath => {
							this.depValues[ keypath.getKeypath() ] = this.viewmodel.get( keypath );
						});
					});
				}
			}

			this._dirty = false;
		}

		this.getting = this._firstRun = false;
		return this.value;
	},

	set: function ( value ) {
		if ( this.setting ) {
			this.value = value;
			return;
		}

		if ( !this.setter ) {
			throw new Error( 'Computed properties without setters are read-only. (This may change in a future version of Ractive!)' );
		}

		this.setter( value );
	},

	updateDependencies: function ( newDeps ) {
		var i, oldDeps, keypath, dependenciesChanged, unresolved;

		oldDeps = this.softDeps;

		// remove dependencies that are no longer used
		i = oldDeps.length;
		while ( i-- ) {
			keypath = oldDeps[i];

			if ( newDeps.indexOf( keypath ) === -1 ) {
				dependenciesChanged = true;
				keypath.unregister( this, 'computed' );
			}
		}

		// create references for any new dependencies
		i = newDeps.length;
		while ( i-- ) {
			keypath = newDeps[i];

			if ( oldDeps.indexOf( keypath ) === -1 && ( !this.hardDeps || this.hardDeps.indexOf( keypath ) === -1 ) ) {
				dependenciesChanged = true;

				// if this keypath is currently unresolved, we need to mark
				// it as such. TODO this is a bit muddy...
				if ( isUnresolved( this.viewmodel, keypath ) && ( !this.unresolvedDeps[ keypath.getKeypath() ] ) ) {
					unresolved = new UnresolvedDependency( this, keypath.getKeypath() );
					newDeps.splice( i, 1 );

					this.unresolvedDeps[ keypath.getKeypath() ] = unresolved;
					runloop.addUnresolved( unresolved );
				} else {
					keypath.register( this, 'computed' );
				}
			}
		}

		if ( dependenciesChanged ) {
			this.softDeps = newDeps.slice();
		}

		return dependenciesChanged;
	}
};

function isUnresolved( viewmodel, keypath ) {
	var key = keypath.firstKey;


	return keypath.unresolved || !keypath.isRoot;
}

export default Computation;
