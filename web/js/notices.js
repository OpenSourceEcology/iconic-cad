let _noticeTimer = null;

export function showNotice(message) {
  const el = document.getElementById('trade-toast');
  if (!el) {
    if (typeof alert === 'function') alert(message);
    return;
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(_noticeTimer);
  _noticeTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

export function showVcsDisabled(feature) {
  showNotice(`${feature} is disabled for the VCS-12 demonstrator.`);
}
