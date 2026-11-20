module.exports = [{
  files: ['dist/app.js'],
  languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: {
    window: 'readonly', document: 'readonly', navigator: 'readonly', location: 'readonly', localStorage: 'readonly', console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
    requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly', performance: 'readonly', URL: 'readonly', Blob: 'readonly', File: 'readonly', Node: 'readonly', HTMLVideoElement: 'readonly', HTMLCanvasElement: 'readonly',
    ResizeObserver: 'readonly', MutationObserver: 'readonly', matchMedia: 'readonly', getComputedStyle: 'readonly', innerWidth: 'readonly', innerHeight: 'readonly', indexedDB: 'readonly', crypto: 'readonly',
    VideoEncoder: 'readonly', VideoFrame: 'readonly', VideoDecoder: 'readonly', EncodedVideoChunk: 'readonly', AudioEncoder: 'readonly', AudioData: 'readonly', OfflineAudioContext: 'readonly', MediaRecorder: 'readonly', MediaStream: 'readonly', AbortController: 'readonly',
    createImageBitmap: 'readonly', DataView: 'readonly', Uint8Array: 'readonly', Float32Array: 'readonly', Mp4Muxer: 'readonly', Promise: 'readonly', Map: 'readonly', Set: 'readonly', Intl: 'readonly', decodeURIComponent: 'readonly', module: 'readonly',
  } },
  rules: { 'no-undef': 'error', 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }], 'no-redeclare': 'error', 'no-dupe-keys': 'error', 'no-unreachable': 'error', 'no-const-assign': 'error', 'no-self-assign': 'error', 'no-dupe-class-members': 'error', 'getter-return': 'error', 'no-use-before-define': 'off' },
}];
