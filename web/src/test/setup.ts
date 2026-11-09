import '@testing-library/jest-dom/vitest'

// jsdom does not implement the native dialog APIs. Real focus trapping and
// Escape behaviour are checked separately in Chrome.
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute('open', '')
}
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute('open')
}
