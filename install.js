// ===== ЛОГИКА УСТАНОВКИ PWA =====
(function () {
  'use strict';

  let deferredInstallPrompt = null;

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredInstallPrompt = e;
    checkAndShowInstallModal('android');
  });

  function isAppInstalled() {
    if (window.navigator.standalone === true) return true;
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    return false;
  }

  function isIOSDevice() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  }

  function checkAndShowInstallModal(platform) {
    if (isAppInstalled()) return;
    if (localStorage.getItem('fitsolo_install_dismissed') === 'true') return;

    var modal = document.getElementById('installModal');
    if (!modal) return;

    if (platform === 'ios' || (isIOSDevice() && !deferredInstallPrompt)) {
      var iosContent = document.getElementById('installIosContent');
      var androidContent = document.getElementById('installAndroidContent');
      if (iosContent) iosContent.style.display = 'block';
      if (androidContent) androidContent.style.display = 'none';
      modal.classList.add('active');
    } else if (platform === 'android' && deferredInstallPrompt) {
      var iosContent2 = document.getElementById('installIosContent');
      var androidContent2 = document.getElementById('installAndroidContent');
      if (androidContent2) androidContent2.style.display = 'block';
      if (iosContent2) iosContent2.style.display = 'none';
      modal.classList.add('active');

      var installBtn = document.getElementById('installBtnNative');
      if (installBtn) {
        installBtn.onclick = function () {
          if (!deferredInstallPrompt) return;
          deferredInstallPrompt.prompt();
          deferredInstallPrompt.userChoice.then(function (choice) {
            console.log('Install choice:', choice.outcome);
            deferredInstallPrompt = null;
            closeInstallModal();
          });
        };
      }
    }
  }

  function closeInstallModal() {
    var modal = document.getElementById('installModal');
    if (modal) modal.classList.remove('active');
  }

  function dismissInstallForever() {
    localStorage.setItem('fitsolo_install_dismissed', 'true');
    closeInstallModal();
  }

  // Экспортируем в window, чтобы можно было вызывать из HTML
  window.checkAndShowInstallModal = checkAndShowInstallModal;
  window.closeInstallModal = closeInstallModal;
  window.dismissInstallForever = dismissInstallForever;

  // Автопоказ для iOS при загрузке
  window.addEventListener('load', function () {
    if (isIOSDevice() && !isAppInstalled() && localStorage.getItem('fitsolo_install_dismissed') !== 'true') {
      setTimeout(function () { checkAndShowInstallModal('ios'); }, 2000);
    }
  });
})();