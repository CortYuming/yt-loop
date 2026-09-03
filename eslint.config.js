// One question is asked of the linter, and it is the one a browser only answers
// at the moment the line runs: does every name this file uses come from
// somewhere? The bug that put this here was a `const names = ...` deleted with
// one of its two uses left behind — the panel then threw the moment a note other
// than the first was selected, and nothing caught it until it was seen by eye.
//
// Deliberately nothing about style. A rule nobody agreed to is noise, and noise
// is how a check stops being read.
'use strict';

const globals = require('globals');

module.exports = [
  {
    // The three files the page loads. They share one global scope in the
    // browser — chords.js declares Chords, sheet.js declares Sheet and reads
    // Chords, main.js reads both — so each has to be told about the others'
    // names.
    files: ['main.js', 'chords.js', 'sheet.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        Chords: 'readonly',
        Sheet: 'readonly',
        // The YouTube IFrame API, which the page loads and the player waits for.
        YT: 'readonly',
      },
    },
    rules: { 'no-undef': 'error' },
  },
  {
    // The checker runs under node, not in a page.
    files: ['scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: { 'no-undef': 'error' },
  },
];
