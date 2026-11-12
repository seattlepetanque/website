/* Decap editor preview: renders entries with the real site's CSS and markup.
   Mirrors layouts/events/single.html, blog/single.html, index.html and _default/single.html.
   Plain ES5, no build step. Loaded after decap-cms.js. */
(function () {
  var h = window.h;
  var createClass = window.createClass;

  // Same stylesheet and font the site uses (see layouts/_default/baseof.html).
  CMS.registerPreviewStyle('/admin/preview.css');
  CMS.registerPreviewStyle('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&display=swap');

  // Parse a value from the entry (string or Date). Date-only strings are read as local days.
  function toDate(v) {
    if (!v) return null;
    if (typeof v === 'string' && /^\d{4}-\d\d-\d\d$/.test(v)) {
      var p = v.split('-');
      return new Date(+p[0], +p[1] - 1, +p[2]);
    }
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  // "Saturday, December 16, 2023", plus " at 3:04 PM" unless the time is midnight.
  function longDate(v) {
    var d = toDate(v);
    if (!d) return '';
    var s = d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    if (d.getHours() !== 0 || d.getMinutes() !== 0) {
      s += ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }
    return s;
  }

  function shortDate(v) {
    var d = toDate(v);
    return d ? d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
  }

  // Wrapper that makes the scoped theme CSS apply and fills the pane like <body> does.
  function page(children) {
    return h('div', { className: 'theme-bistro', style: { minHeight: '100vh', display: 'flex', flexDirection: 'column' } },
      h('main', { id: 'main' }, children));
  }

  // URL for an image path, including images uploaded but not yet published.
  function imgUrl(getAsset, path) {
    if (!path) return '';
    var a = getAsset(path);
    return a ? String(a) : path;
  }

  function data(entry, key) { return entry.getIn(['data', key]); }

  var EventPreview = createClass({
    render: function () {
      var entry = this.props.entry, getAsset = this.props.getAsset;
      var recurring = data(entry, 'recurring'), end = data(entry, 'end_date');
      var location = data(entry, 'location'), mapUrl = data(entry, 'map_url');
      var photos = data(entry, 'photos');
      photos = photos && photos.toJS ? photos.toJS() : [];
      photos = photos.filter(function (p) { return p && p.image; });

      var when = [recurring ? recurring : h('time', {}, longDate(data(entry, 'date')))];
      if (end) when.push(h('br'), 'Ends: ', h('time', {}, longDate(end)));

      var kids = [
        h('h1', {}, data(entry, 'title')),
        h('p', { className: 'meta when' }, when)
      ];
      if (location) {
        kids.push(h('p', { className: 'meta where' }, 'Location: ',
          mapUrl ? h('a', { href: mapUrl }, location) : location));
      }
      kids.push(this.props.widgetFor('body'));
      var atts = data(entry, 'attachments');
      atts = atts && atts.toJS ? atts.toJS() : [];
      atts = atts.filter(function (a) { return a && a.file; });
      if (atts.length) {
        kids.push(h('ul', { className: 'attachments' }, atts.map(function (a, i) {
          return h('li', { key: i }, h('a', { href: imgUrl(getAsset, a.file) }, a.title || 'Download'));
        })));
      }
      if (photos.length) {
        kids.push(h('div', { className: 'gallery gallery-' + photos.length },
          photos.map(function (p, i) {
            var src = imgUrl(getAsset, p.image);
            return h('figure', { key: i },
              h('a', { href: src }, h('img', { src: src, alt: p.alt || '' })),
              p.caption ? h('figcaption', {}, p.caption) : null);
          })));
      }
      return page(h('article', { className: 'content event-detail' }, kids));
    }
  });

  var BlogPreview = createClass({
    render: function () {
      var entry = this.props.entry;
      var author = data(entry, 'author'), image = data(entry, 'image');
      var meta = [h('time', {}, shortDate(data(entry, 'date')))];
      if (author) meta.push(' · ' + author);
      return page(h('article', { className: 'content blog-post' },
        h('h1', {}, data(entry, 'title')),
        h('p', { className: 'meta' }, meta),
        image ? h('img', { className: 'figure', src: imgUrl(this.props.getAsset, image), alt: data(entry, 'image_alt') || '' }) : null,
        this.props.widgetFor('body')));
    }
  });

  // Pages collection: the home page and the links page have different layouts.
  var PagePreview = createClass({
    render: function () {
      var entry = this.props.entry;
      if (entry.get('slug') === 'home') {
        var hero = data(entry, 'hero_image'), heading = data(entry, 'hero_heading');
        return page([
          h('section', { className: 'hero', key: 'hero' },
            hero ? h('img', { src: imgUrl(this.props.getAsset, hero), alt: data(entry, 'hero_image_alt') || '' }) : null,
            heading ? h('h1', {}, heading) : null),
          h('div', { className: 'content', key: 'body' }, this.props.widgetFor('body')),
          h('section', { className: 'home-events events-list', key: 'events' },
            h('h2', {}, 'Upcoming events'),
            h('p', { className: 'meta' }, '(The three next events appear here on the live site.)'))
        ]);
      }
      return page(h('article', { className: 'content' },
        h('h1', {}, data(entry, 'title')),
        this.props.widgetFor('body')));
    }
  });

  CMS.registerPreviewTemplate('events', EventPreview);
  CMS.registerPreviewTemplate('blog', BlogPreview);
  CMS.registerPreviewTemplate('home', PagePreview);
  CMS.registerPreviewTemplate('links', PagePreview);
  // Site settings keep the default preview.
})();
