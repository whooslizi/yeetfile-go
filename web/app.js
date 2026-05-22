import { Adb, AdbDaemonTransport, LinuxFileType } from 'https://esm.sh/@yume-chan/adb';
import { AdbDaemonWebUsbDeviceManager } from 'https://esm.sh/@yume-chan/adb-daemon-webusb';
import AdbWebCredentialStore from 'https://esm.sh/@yume-chan/adb-credential-web';
import { WrapConsumableStream, WrapReadableStream } from 'https://esm.sh/@yume-chan/stream-extra';

(function () {
  let adbInstance = null;
  let currentPath = '/sdcard';
  let history = [];
  let historyIdx = -1;
  let selectedFiles = new Set();
  let allFiles = [];
  let isGridView = false;
  let pendingUploads = [];

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const welcomeScreen = $('#welcome-screen');
  const browserScreen = $('#browser-screen');
  const deviceStatus = $('#device-status');
  const deviceBadge = $('#device-badge');
  const deviceNameEl = $('#device-name');
  const quickPaths = $('#quick-paths');
  const fileContainer = $('#file-container');
  const fileList = $('#file-list');
  const loadingState = $('#loading-state');
  const emptyDir = $('#empty-dir');
  const currentPathEl = $('#current-path');
  const selectionInfo = $('#selection-info');
  const selectionCount = $('#selection-count');
  const storageCard = $('#storage-card');
  const storageInfo = $('#storage-info');
  const uploadOverlay = $('#upload-overlay');
  const uploadDropzone = $('#upload-dropzone');
  const uploadProgress = $('#upload-progress');
  const uploadItems = $('#upload-items');
  const uploadDest = $('#upload-dest');
  const fileInput = $('#file-input');
  const toastContainer = $('#toast-container');
  const dragOverlay = $('#drag-overlay');

  const btnScan = $('#btn-scan');
  const btnRefresh = $('#btn-refresh');
  const btnBack = $('#btn-back');
  const btnUp = $('#btn-up');
  const btnUpload = $('#btn-upload');
  const btnNewFolder = $('#btn-new-folder');
  const btnViewToggle = $('#btn-view-toggle');
  const btnDownloadSelected = $('#btn-download-selected');
  const btnDeleteSelected = $('#btn-delete-selected');
  const btnClearSelection = $('#btn-clear-selection');
  const btnCloseUpload = $('#btn-close-upload');
  const btnStartUpload = $('#btn-start-upload');

  const defaultQuickPaths = [
    { Name: 'DCIM', Path: '/sdcard/DCIM' },
    { Name: 'Pictures', Path: '/sdcard/Pictures' },
    { Name: 'Downloads', Path: '/sdcard/Download' },
    { Name: 'Music', Path: '/sdcard/Music' },
    { Name: 'Movies', Path: '/sdcard/Movies' },
    { Name: 'Documents', Path: '/sdcard/Documents' },
    { Name: 'Internal Storage', Path: '/sdcard' },
  ];

  init();

  function init() {
    if (!('usb' in navigator)) {
      updateDeviceStatus(false, 'WebUSB not supported in this browser (Use Chrome/Edge/Brave)');
      btnScan.disabled = true;
      return;
    }

    btnScan.addEventListener('click', connectDevice);
    btnRefresh.addEventListener('click', () => {
      if (adbInstance) loadFiles(currentPath);
    });
    btnBack.addEventListener('click', goBack);
    btnUp.addEventListener('click', goUp);
    btnUpload.addEventListener('click', openUploadModal);
    btnNewFolder.addEventListener('click', createFolder);
    btnViewToggle.addEventListener('click', toggleView);
    btnDownloadSelected.addEventListener('click', downloadSelected);
    btnDeleteSelected.addEventListener('click', deleteSelected);
    btnClearSelection.addEventListener('click', clearSelection);
    btnCloseUpload.addEventListener('click', closeUploadModal);
    btnStartUpload.addEventListener('click', startUpload);

    uploadDropzone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);

    uploadDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadDropzone.classList.add('dragover');
    });
    uploadDropzone.addEventListener('dragleave', () => {
      uploadDropzone.classList.remove('dragover');
    });
    uploadDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadDropzone.classList.remove('dragover');
      addUploadFiles(e.dataTransfer.files);
    });

    document.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (adbInstance) dragOverlay.style.display = 'flex';
    });
    document.addEventListener('dragleave', (e) => {
      if (e.relatedTarget === null) dragOverlay.style.display = 'none';
    });
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      dragOverlay.style.display = 'none';
      if (adbInstance && e.dataTransfer.files.length) {
        openUploadModal();
        addUploadFiles(e.dataTransfer.files);
      }
    });

    document.addEventListener('click', () => {
      const menu = $('.context-menu');
      if (menu) menu.remove();
    });

    renderQuickPaths(defaultQuickPaths);
    checkAutoConnect();
  }

  async function checkAutoConnect() {
    try {
      const manager = AdbDaemonWebUsbDeviceManager.BROWSER;
      const devices = await manager.getDevices();
      if (devices.length > 0) {
        // Automatically try to connect to the first paired device
        setupAdbConnection(devices[0]);
      }
    } catch (e) {}
  }

  async function connectDevice() {
    updateDeviceStatus(null, 'Requesting device...');
    try {
      const manager = AdbDaemonWebUsbDeviceManager.BROWSER;
      const device = await manager.requestDevice();
      if (device) {
        setupAdbConnection(device);
      } else {
        updateDeviceStatus(false, 'No device selected');
      }
    } catch (e) {
      updateDeviceStatus(false, 'Connection failed');
      toast(e.message, 'error');
    }
  }

  async function setupAdbConnection(device) {
    updateDeviceStatus(null, 'Connecting...');
    try {
      const credentialStore = new AdbWebCredentialStore('yeetsend');
      toast('Please accept the RSA prompt on your phone if it appears', 'info');

      const connection = await device.connect();
      const transport = await AdbDaemonTransport.authenticate({
        serial: device.serial,
        connection,
        credentialStore,
      });
      adbInstance = new Adb(transport);

      updateDeviceStatus(true, device.name || device.serial);
      deviceNameEl.textContent = device.name || device.serial;

      welcomeScreen.style.display = 'none';
      browserScreen.style.display = 'flex';

      loadStorageInfo();
      navigateTo('/sdcard');
    } catch (e) {
      updateDeviceStatus(false, 'Authentication failed');
      toast('Failed to pair: ' + e.message, 'error');
    }
  }

  function updateDeviceStatus(online, text) {
    const dot = deviceStatus.querySelector('.dot');
    const label = deviceStatus.querySelector('.status-text');
    dot.className = 'dot ' + (online === null ? 'offline' : online ? 'online' : 'offline');
    label.textContent = text;
  }

  function renderQuickPaths(paths) {
    quickPaths.innerHTML = paths.map(p => {
      return `<div class="quick-path-item" data-path="${p.Path}">${p.Name}</div>`;
    }).join('');

    quickPaths.querySelectorAll('.quick-path-item').forEach(el => {
      el.addEventListener('click', () => {
        if (!adbInstance) {
          toast('Connect a device first', 'info');
          return;
        }
        navigateTo(el.dataset.path);
      });
    });
  }

  async function loadStorageInfo() {
    if (!adbInstance) return;
    try {
      const result = await adbInstance.subprocess.spawnAndWait(['df', '-h', '/sdcard']);
      const output = new TextDecoder().decode(result.stdout);
      const lines = output.trim().split('\n');
      let dataLine = lines[1];
      for (const line of lines) {
        if (line.includes('/storage') || line.includes('/sdcard') || line.includes('/data')) {
          dataLine = line;
          break;
        }
      }
      if (dataLine) {
        const parts = dataLine.trim().split(/\s+/);
        if (parts.length >= 4) {
          const total = parts[1];
          const used = parts[2];
          const free = parts[3];
          const pct = parts[4] ? parseInt(parts[4].replace('%', '')) : 50;

          storageCard.style.display = 'block';
          storageInfo.innerHTML = `
            <div class="storage-bar-wrap">
              <div class="storage-bar">
                <div class="storage-bar-fill" style="width:${pct}%"></div>
              </div>
              <div class="storage-text">
                <span>${used} used</span>
                <span>${free} free (${total} total)</span>
              </div>
            </div>
          `;
        }
      }
    } catch (e) {}
  }

  function navigateTo(path) {
    if (historyIdx < history.length - 1) {
      history = history.slice(0, historyIdx + 1);
    }
    history.push(path);
    historyIdx = history.length - 1;

    currentPath = path;
    clearSelection();
    loadFiles(path);
    updateNav();
  }

  function goBack() {
    if (historyIdx > 0) {
      historyIdx--;
      currentPath = history[historyIdx];
      clearSelection();
      loadFiles(currentPath);
      updateNav();
    }
  }

  function goUp() {
    if (currentPath === '/' || currentPath === '/sdcard') return;
    const parent = currentPath.split('/').slice(0, -1).join('/') || '/';
    navigateTo(parent);
  }

  function updateNav() {
    btnBack.disabled = historyIdx <= 0;
    btnUp.disabled = currentPath === '/' || currentPath === '/sdcard';
    currentPathEl.textContent = currentPath;

    quickPaths.querySelectorAll('.quick-path-item').forEach(el => {
      el.classList.toggle('active', el.dataset.path === currentPath);
    });
  }

  async function loadFiles(path) {
    loadingState.style.display = 'flex';
    fileList.innerHTML = '';
    emptyDir.style.display = 'none';

    try {
      const sync = await adbInstance.sync();
      try {
        const entries = [];
        for await (const entry of await sync.opendir(path)) {
          entries.push(entry);
        }

        allFiles = entries.map(e => ({
          name: e.name,
          path: path === '/' ? '/' + e.name : path + '/' + e.name,
          isDir: e.type === LinuxFileType.Directory,
          size: Number(e.size),
          modTime: formatTimestamp(e.mtime),
        }));

        allFiles.sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      } finally {
        await sync.dispose();
      }

      loadingState.style.display = 'none';

      if (!allFiles.length) {
        emptyDir.style.display = 'flex';
        return;
      }

      renderFiles();
    } catch (e) {
      loadingState.style.display = 'none';
      emptyDir.style.display = 'flex';
      toast('Failed to load files: ' + e.message, 'error');
    }
  }

  function renderFiles() {
    fileList.innerHTML = allFiles.map((f, i) => {
      const icon = getFileIcon(f);
      const size = f.isDir ? '--' : formatBytes(f.size);
      const sel = selectedFiles.has(f.path) ? ' selected' : '';
      const isImg = isImageFile(f.name);

      if (isGridView) {
        const visual = isImg
          ? `<img class="file-thumb" data-path="${f.path}" src="" loading="lazy" alt="">`
          : `<span class="file-icon">${icon}</span>`;
        return `
          <div class="file-item${sel}" data-index="${i}" data-path="${f.path}" data-dir="${f.isDir}">
            ${visual}
            <span class="file-name">${f.name}</span>
            <span class="file-size">${size}</span>
          </div>
        `;
      } else {
        const visual = isImg
          ? `<img class="file-thumb" data-path="${f.path}" src="" loading="lazy" alt="">`
          : `<span class="file-icon">${icon}</span>`;
        return `
          <div class="file-item${sel}" data-index="${i}" data-path="${f.path}" data-dir="${f.isDir}">
            ${visual}
            <span class="file-name">${f.name}</span>
            ${f.modTime ? `<span class="file-date">${f.modTime}</span>` : ''}
            <span class="file-size">${size}</span>
          </div>
        `;
      }
    }).join('');

    fileList.querySelectorAll('.file-item').forEach(el => {
      el.addEventListener('click', (e) => {
        const idx = parseInt(el.dataset.index);
        const file = allFiles[idx];

        if (e.ctrlKey || e.metaKey) {
          toggleSelect(file, el);
        } else if (file.isDir) {
          navigateTo(file.path);
        } else {
          clearSelection();
          toggleSelect(file, el);
        }
      });

      el.addEventListener('dblclick', () => {
        const idx = parseInt(el.dataset.index);
        const file = allFiles[idx];
        if (!file.isDir) downloadFile(file);
      });

      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const idx = parseInt(el.dataset.index);
        showContextMenu(e.clientX, e.clientY, allFiles[idx]);
      });
    });

    loadThumbnails();
  }

  async function loadThumbnails() {
    const imgs = $$('img.file-thumb[data-path]');
    for (const img of imgs) {
      if (img.src) continue;
      const path = img.dataset.path;
      try {
        const sync = await adbInstance.sync();
        try {
          const stream = sync.read(path);
          const response = new Response(stream);
          const blob = await response.blob();
          img.src = URL.createObjectURL(blob);
        } finally {
          await sync.dispose();
        }
      } catch (e) {}
    }
  }

  function toggleSelect(file, el) {
    if (selectedFiles.has(file.path)) {
      selectedFiles.delete(file.path);
      el.classList.remove('selected');
    } else {
      selectedFiles.add(file.path);
      el.classList.add('selected');
    }
    updateSelectionUI();
  }

  function clearSelection() {
    selectedFiles.clear();
    fileList.querySelectorAll('.file-item.selected').forEach(el => el.classList.remove('selected'));
    updateSelectionUI();
  }

  function updateSelectionUI() {
    if (selectedFiles.size > 0) {
      selectionInfo.style.display = 'flex';
      selectionCount.textContent = selectedFiles.size + ' selected';
    } else {
      selectionInfo.style.display = 'none';
    }
  }

  function showContextMenu(x, y, file) {
    const old = $('.context-menu');
    if (old) old.remove();

    const menu = document.createElement('div');
    menu.className = 'context-menu';

    const items = [];
    if (file.isDir) items.push({ label: 'Open', action: () => navigateTo(file.path) });
    if (!file.isDir) items.push({ label: 'Download', action: () => downloadFile(file) });
    items.push({ label: 'Delete', action: () => deleteFile(file), danger: true });

    items.forEach((item, i) => {
      if (i > 0 && item.danger) {
        const sep = document.createElement('div');
        sep.className = 'context-sep';
        menu.appendChild(sep);
      }
      const el = document.createElement('div');
      el.className = 'context-item' + (item.danger ? ' danger' : '');
      el.textContent = item.label;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.remove();
        item.action();
      });
      menu.appendChild(el);
    });

    menu.style.left = Math.min(x, window.innerWidth - 180) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - 120) + 'px';
    document.body.appendChild(menu);
  }

  async function downloadFile(file) {
    toast('Downloading ' + file.name, 'info');
    try {
      const sync = await adbInstance.sync();
      try {
        const stream = sync.read(file.path);
        const response = new Response(stream);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } finally {
        await sync.dispose();
      }
    } catch (e) {
      toast('Failed to download: ' + e.message, 'error');
    }
  }

  function downloadSelected() {
    selectedFiles.forEach(path => {
      const file = allFiles.find(f => f.path === path);
      if (file && !file.isDir) downloadFile(file);
    });
  }

  async function deleteFile(file) {
    if (!confirm('Delete "' + file.name + '"? This can\'t be undone.')) return;
    try {
      await adbInstance.subprocess.spawnAndWait(['rm', '-rf', file.path]);
      toast('Deleted ' + file.name, 'success');
      loadFiles(currentPath);
    } catch (e) {
      toast('Failed to delete: ' + e.message, 'error');
    }
  }

  async function deleteSelected() {
    const n = selectedFiles.size;
    if (!n) return;
    if (!confirm('Delete ' + n + ' item(s)?')) return;

    for (const path of selectedFiles) {
      try {
        await adbInstance.subprocess.spawnAndWait(['rm', '-rf', path]);
      } catch (e) {}
    }
    toast('Deleted ' + n + ' item(s)', 'success');
    clearSelection();
    loadFiles(currentPath);
  }

  async function createFolder() {
    const name = prompt('Folder name:');
    if (!name || !name.trim()) return;

    try {
      await adbInstance.subprocess.spawnAndWait(['mkdir', '-p', currentPath + '/' + name.trim()]);
      toast('Created folder', 'success');
      loadFiles(currentPath);
    } catch (e) {
      toast('Failed to create folder: ' + e.message, 'error');
    }
  }

  function toggleView() {
    isGridView = !isGridView;
    fileContainer.classList.toggle('grid-view', isGridView);
    fileContainer.classList.toggle('list-view', !isGridView);
    renderFiles();
  }

  function openUploadModal() {
    pendingUploads = [];
    uploadItems.innerHTML = '';
    uploadProgress.style.display = 'none';
    uploadDest.textContent = currentPath;
    btnStartUpload.disabled = true;
    uploadOverlay.style.display = 'flex';
  }

  function closeUploadModal() {
    uploadOverlay.style.display = 'none';
    pendingUploads = [];
  }

  function handleFileSelect(e) {
    addUploadFiles(e.target.files);
    fileInput.value = '';
  }

  function addUploadFiles(files) {
    for (const f of files) pendingUploads.push(f);
    renderUploadItems();
    btnStartUpload.disabled = pendingUploads.length === 0;
  }

  function renderUploadItems() {
    uploadProgress.style.display = 'block';
    uploadItems.innerHTML = pendingUploads.map((f, i) => `
      <div class="upload-item">
        <span class="upload-item-name">${f.name}</span>
        <span class="upload-item-size">${formatBytes(f.size)}</span>
        <span class="upload-item-status" id="upload-status-${i}">...</span>
      </div>
    `).join('');
  }

  async function startUpload() {
    if (!pendingUploads.length) return;
    btnStartUpload.disabled = true;

    try {
      const sync = await adbInstance.sync();
      try {
        for (let i = 0; i < pendingUploads.length; i++) {
          const file = pendingUploads[i];
          const dest = currentPath + '/' + file.name;
          const statusEl = $('#upload-status-' + i);
          if (statusEl) statusEl.textContent = '0%';

          try {
            let uploadedBytes = 0;
            const progressStream = new TransformStream({
              transform(chunk, controller) {
                uploadedBytes += chunk.byteLength;
                const pct = Math.round((uploadedBytes / file.size) * 100);
                if (statusEl) statusEl.textContent = `${pct}%`;
                controller.enqueue(chunk);
              }
            });

            const fileStream = new WrapReadableStream(file.stream().pipeThrough(progressStream))
              .pipeThrough(new WrapConsumableStream());

            await sync.write({
              filename: dest,
              file: fileStream,
              type: LinuxFileType.File,
              permission: 0o666,
            });

            if (statusEl) statusEl.textContent = 'done';
          } catch (e) {
            if (statusEl) statusEl.textContent = 'fail';
          }
        }
        toast('Upload finished', 'success');
      } finally {
        await sync.dispose();
      }

      loadFiles(currentPath);
      setTimeout(closeUploadModal, 1200);
    } catch (e) {
      toast('Upload failed: ' + e.message, 'error');
      btnStartUpload.disabled = false;
    }
  }

  function getFileIcon(file) {
    if (file.isDir) return '/';
    const ext = file.name.split('.').pop().toLowerCase();
    const map = {
      jpg: 'img', jpeg: 'img', png: 'img', gif: 'img', webp: 'img', svg: 'img', bmp: 'img',
      mp4: 'vid', mkv: 'vid', avi: 'vid', mov: 'vid', webm: 'vid',
      mp3: 'aud', flac: 'aud', wav: 'aud', aac: 'aud', ogg: 'aud', m4a: 'aud',
      pdf: 'pdf', doc: 'doc', docx: 'doc', txt: 'txt', md: 'txt',
      xls: 'xls', xlsx: 'xls', csv: 'csv',
      zip: 'zip', rar: 'zip', '7z': 'zip', tar: 'zip', gz: 'zip',
      apk: 'apk',
      json: 'cfg', xml: 'cfg', yaml: 'cfg', yml: 'cfg',
    };
    return map[ext] || '~';
  }

  function isImageFile(name) {
    const ext = name.split('.').pop().toLowerCase();
    return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext);
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const b = Number(bytes);
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(b) / Math.log(1024));
    return (b / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
  }

  function formatTimestamp(secondsBigInt) {
    if (!secondsBigInt) return '';
    const ms = Number(secondsBigInt) * 1000;
    const d = new Date(ms);
    return d.toISOString().split('T')[0] + ' ' + d.toTimeString().split(' ')[0].substring(0, 5);
  }

  function toast(msg, type) {
    const el = document.createElement('div');
    el.className = 'toast ' + (type || 'info');
    el.textContent = msg;
    toastContainer.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.3s';
      setTimeout(() => el.remove(), 300);
    }, 3500);
  }
})();
