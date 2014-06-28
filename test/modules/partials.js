define([ 'ractive', 'legacy' ], function ( Ractive, legacy ) {

	'use strict';

	return function () {

		var fixture;

		module( 'partials' );

		fixture = document.getElementById( 'qunit-fixture' );


		test( 'specify partial by function', function ( t ) {

			var ractive = new Ractive({
				el: fixture,
				template: '{{>foo}}',
				data: {
					foo: true
				},
				partials: {
					foo: function ( data ) {
						return data.foo ? '<p>yes</p>' : '<h1>no</h1>'
					}
				}
			})

			t.htmlEqual( fixture.innerHTML, '<p>yes</p>' );

		});

		test( 'partial functions belong to instance, not Component', function ( t ) {

			var Component, ractive1, ractive2;

			Component = Ractive.extend({
				template: '{{>foo}}',
				partials: {
					foo: function ( data ) {
						return data.foo ? '<p>yes</p>' : '<h1>no</h1>'
					}
				}
			});

			ractive1 = new Component({
				data: {
					foo: true
				}
			})

			ractive2 = new Component({
				data: {
					foo: false
				}
			})

			t.equal( ractive1.toHTML(), '<p>yes</p>' );
			t.equal( ractive2.toHTML(), '<h1>no</h1>' );


		});

		test( 'partial functions selects same partial until reset', function ( t ) {

			var ractive = new Ractive({
				el: fixture,
				template: '{{#items}}{{>foo}}{{/items}}',
				partials: {
					foo: function ( data ) {
						return data.foo ? '<p>{{.}}</p>' : '<h1>{{.}}</h1>'
					}
				},
				data: {
					foo: true,
					items: [ 1 ]
				}
			})

			t.htmlEqual( fixture.innerHTML, '<p>1</p>' );

			ractive.set( 'foo', false );
			ractive.get( 'items' ).push( 2 );

			t.htmlEqual( fixture.innerHTML, '<p>1</p><p>2</p>' );
		});

		test( 'reset data re-evaluates partial', function ( t ) {

			var ractive = new Ractive({
				el: fixture,
				template: '{{>foo}}',
				data: { foo: true },
				partials: {
					foo: function ( data ) {
						return data.foo ? '<p>yes</p>' : '<h1>no</h1>'
					}
				}
			})

			t.htmlEqual( fixture.innerHTML, '<p>yes</p>' );
			ractive.reset( { foo: false } );
			t.htmlEqual( fixture.innerHTML, '<h1>no</h1>' );

		});

		test( 'partials functions can be found on view heirarchy', function ( t ) {

			var Component, ractive;

			Component = Ractive.extend({
				template: '{{>foo}}'
			});

			ractive = new Ractive({
				el: fixture,
				template: '{{#if !foo}}<widget/>{{/if}}',
				components: {
					widget: Component
				},
				data: { foo: true },
				partials: {
					foo: function ( data ) {
						return data.foo ? '<p>yes</p>' : '<h1>no</h1>'
					}
				}
			});

			t.htmlEqual( fixture.innerHTML, '' );

			ractive.set( 'foo', false );

			t.htmlEqual( fixture.innerHTML, '<h1>no</h1>' );

		});
	};

});
