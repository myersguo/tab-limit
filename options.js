// 默认设置
const DEFAULT_SETTINGS = {
  maxTabs: 5,
  exceedBehavior: 'group',
  groupStrategy: 'recent-asc',
   restoreStrategy: 'none',
  groupName: 'Others Group'
};

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  setupEventListeners();
  updateGroupSettingsVisibility();
});

// 加载设置
async function loadSettings() {
  const settings = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  const config = { ...DEFAULT_SETTINGS, ...settings };

  document.getElementById('maxTabs').value = config.maxTabs;
  document.getElementById('exceedBehavior').value = config.exceedBehavior;
  document.getElementById('groupStrategy').value = config.groupStrategy;
  document.getElementById('groupName').value = config.groupName;
  document.getElementById('restoreStrategy').value = config.restoreStrategy;
}

// 设置事件监听器
function setupEventListeners() {
  document.getElementById('save').addEventListener('click', saveSettings);
  document.getElementById('reset').addEventListener('click', resetSettings);
  document.getElementById('exceedBehavior').addEventListener('change', updateGroupSettingsVisibility);
}

// 保存设置
async function saveSettings() {
  const settings = {
    maxTabs: parseInt(document.getElementById('maxTabs').value),
    exceedBehavior: document.getElementById('exceedBehavior').value,
    groupStrategy: document.getElementById('groupStrategy').value,
    groupName: document.getElementById('groupName').value.trim() || 'Others Group',
    restoreStrategy: document.getElementById('restoreStrategy').value
  };

  // 验证输入
  if (settings.maxTabs < 1 || settings.maxTabs > 50) {
    showStatus('Tab count must be between 1-50', 'error');
    return;
  }

  await chrome.storage.sync.set(settings);
  showStatus('Settings saved', 'success');
}

// 重置设置
async function resetSettings() {
  await chrome.storage.sync.set(DEFAULT_SETTINGS);
  await loadSettings();
  showStatus('Settings reset to default', 'success');
}

// 更新分组设置的可见性
function updateGroupSettingsVisibility() {
  const behavior = document.getElementById('exceedBehavior').value;
  const groupSettings = document.getElementById('groupSettings');

  if (behavior === 'group') {
    groupSettings.style.display = 'block';
  } else {
    groupSettings.style.display = 'none';
  }
}

// 显示状态消息
function showStatus(message, type = 'info') {
  const statusDiv = document.getElementById('status');
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;

  setTimeout(() => {
    statusDiv.textContent = '';
    statusDiv.className = 'status';
  }, 3000);
}
