/* Optional exercise photos for the logger (the round thumbnail next to each exercise name).
   Without an entry the app draws a category icon. To use your own images, put the image files next to index.html and
   add a line per exercise: the key is the exercise name in lower case (a trailing "(or ...)" is ignored),
   the value is the image path, an https:// address, or a data: URI. Square images of about 96 x 96 px work best.
   Example:
     'zercher squat': 'zercher-squat.webp',
     'bench press': 'https://example.com/bench-press.webp',
   In the single-file page (index-single.html) there are no loose files next to it, so use an https:// address or a data: URI there.
   In the multi-file version, add local files to the SHELL list in sw.js if you want them available offline. */
(function (root) {
  'use strict';
  var HA = root.HA = root.HA || {};
  HA.THUMBS = {
  };
})(typeof window !== 'undefined' ? window : globalThis);
