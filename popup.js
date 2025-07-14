// 页面加载时初始化
document.addEventListener('DOMContentLoaded', async () => {
  await loadPopupData();
  setupEventListeners();
});

// 加载弹窗数据
async function loadPopupData() {
  const settings = await chrome.storage.sync.get(['maxTabs', 'exceedBehavior']);
  const currentWindow = await chrome.windows.getCurrent();
  const tabs = await chrome.tabs.query({ windowId: currentWindow.id });
  const ungroupedTabs = tabs.filter(tab => tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE);
  
  document.getElementById('currentTabs').textContent = ungroupedTabs.length;
  document.getElementById('maxTabs').textContent = settings.maxTabs || 5;
    document.getElementById('exceedBehavior').textContent = 
  settings.exceedBehavior === 'group' ? 'Move to group' : 'Prevent creation';
}

// 设置事件监听器
function setupEventListeners() {
  document.getElementById('openOptions').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}
