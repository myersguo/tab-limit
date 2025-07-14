// 默认设置
const DEFAULT_SETTINGS = {
  maxTabs: 5,
  exceedBehavior: 'group', // 'group' 或 'prevent'
  groupStrategy: 'recent-asc', // 'creation-asc', 'creation-desc', 'recent-asc', 'recent-desc'
  restoreStrategy: 'none', // 'none' 或 'restore'
  groupName: 'Others Group'
};

// 初始化
chrome.runtime.onInstalled.addListener(async () => {
  const result = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  const settings = { ...DEFAULT_SETTINGS, ...result };
  await chrome.storage.sync.set(settings);
});

// 监听标签页创建
chrome.tabs.onCreated.addListener(async (tab) => {
  await handleTabLimit(tab.windowId);
});

// 监听标签页激活（用于更新最近使用时间）
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const timestamp = Date.now();
  await chrome.storage.local.set({
    [`tab_${activeInfo.tabId}_lastUsed`]: timestamp
  });
});

// 监听标签页移除
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  // 清理存储的时间戳
  await chrome.storage.local.remove(`tab_${tabId}_lastUsed`);
  await chrome.storage.local.remove(`tab_${tabId}_created`);
});

// 处理标签页限制逻辑
async function handleTabLimit(windowId) {
  const settings = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  const config = { ...DEFAULT_SETTINGS, ...settings };
  
  // 获取当前窗口的所有标签页
  const tabs = await chrome.tabs.query({ windowId: windowId });
  
  // 过滤掉选项页面
  const filteredTabs = tabs.filter(tab => {
    if (tab.url && (
      tab.url.includes('chrome-extension://') && tab.url.includes('options.html') ||
      tab.url === chrome.runtime.getURL('options.html')
    )) {
      return false;
    }
    return true;
  });
  
  const ungroupedTabs = filteredTabs.filter(tab => tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE);
  
  if (ungroupedTabs.length > config.maxTabs) {
    // 超出限制，按原有逻辑处理
    if (config.exceedBehavior === 'prevent') {
      await handlePreventCreation(ungroupedTabs, config.maxTabs);
    } else if (config.exceedBehavior === 'group') {
      await handleGroupExcess(ungroupedTabs, config, windowId);
    }
  } else if (ungroupedTabs.length < config.maxTabs && config.restoreStrategy === 'restore') {
    // 低于限制且设置了恢复策略
    await handleRestoreFromGroup(ungroupedTabs, config, windowId);
  }
}

// 处理禁止创建逻辑
async function handlePreventCreation(tabs, maxTabs) {
  // 再次过滤，确保不会关闭选项页面
  const filteredTabs = tabs.filter(tab => {
    if (tab.url && (
      tab.url.includes('chrome-extension://') && tab.url.includes('options.html') ||
      tab.url === chrome.runtime.getURL('options.html')
    )) {
      return false;
    }
    return true;
  });
  
  if (filteredTabs.length > maxTabs) {
    // 关闭最新创建的标签页
    const sortedTabs = await sortTabsByCreationTime(filteredTabs);
    const excessTabs = sortedTabs.slice(maxTabs);
    
    for (const tab of excessTabs) {
      await chrome.tabs.remove(tab.id);
    }
  }
}

// 处理分组逻辑
// 处理分组逻辑
async function handleGroupExcess(tabs, config, windowId) {
  const excessCount = tabs.length - config.maxTabs;
  
  if (excessCount <= 0) return;
  
  // 根据策略排序标签页
  let sortedTabs;
  let tabsToGroup;
  
  if (config.groupStrategy.startsWith('creation')) {
    const isAscending = config.groupStrategy === 'creation-asc';
    sortedTabs = await sortTabsByCreationTime(tabs, isAscending);
    
    if (config.groupStrategy === 'creation-asc') {
      // Oldest first: 移动最早创建的标签页
      tabsToGroup = sortedTabs.slice(0, excessCount);
    } else {
      // Newest first: 移动最新创建的标签页
      tabsToGroup = sortedTabs.slice(-excessCount);
    }
  } else if (config.groupStrategy.startsWith('recent')) {
    const isAscending = config.groupStrategy === 'recent-asc';
    sortedTabs = await sortTabsByRecentUse(tabs, isAscending);
    
    if (config.groupStrategy === 'recent-asc') {
      // Least recently used: 移动最久未使用的标签页
      tabsToGroup = sortedTabs.slice(0, excessCount);
    } else {
      // Most recently used: 移动最近使用的标签页
      tabsToGroup = sortedTabs.slice(-excessCount);
    }
  }
  
  // 查找或创建目标分组
  const groupId = await findOrCreateGroup(config.groupName, windowId);
  
  // 将标签页移入分组
  const tabIds = tabsToGroup.map(tab => tab.id);
  await chrome.tabs.group({ tabIds, groupId });
  
  // 收起分组
  await chrome.tabGroups.update(groupId, { collapsed: true });
}


// 按创建时间排序
async function sortTabsByCreationTime(tabs, ascending = true) {
  const tabsWithTime = await Promise.all(tabs.map(async (tab) => {
    const key = `tab_${tab.id}_created`;
    const result = await chrome.storage.local.get(key);
    return {
      ...tab,
      createdTime: result[key] || tab.id // 使用 tabId 作为备用排序
    };
  }));
  
  return tabsWithTime.sort((a, b) => {
    const diff = a.createdTime - b.createdTime;
    return ascending ? diff : -diff;
  });
}

// 按最近使用时间排序
async function sortTabsByRecentUse(tabs, ascending = true) {
  const tabsWithTime = await Promise.all(tabs.map(async (tab) => {
    const key = `tab_${tab.id}_lastUsed`;
    const result = await chrome.storage.local.get(key);
    return {
      ...tab,
      lastUsed: result[key] || 0
    };
  }));
  
  return tabsWithTime.sort((a, b) => {
    const diff = a.lastUsed - b.lastUsed;
    return ascending ? diff : -diff;
  });
}


// 查找或创建分组
async function findOrCreateGroup(groupName, windowId) {
  // 查找现有分组
  const groups = await chrome.tabGroups.query({ windowId });
  const existingGroup = groups.find(group => group.title === groupName);
  
  if (existingGroup) {
    return existingGroup.id;
  }
  
  // 创建新分组
  const tabs = await chrome.tabs.query({ windowId, active: false });
  if (tabs.length === 0) {
    // 如果没有非活动标签页，创建一个临时标签页用于分组
    const tempTab = await chrome.tabs.create({ windowId, url: 'chrome://newtab/', active: false });
    const groupId = await chrome.tabs.group({ tabIds: [tempTab.id] });
    await chrome.tabGroups.update(groupId, { 
      title: groupName,
      color: 'grey',
      collapsed: true
    });
    return groupId;
  }
  
  // 使用现有标签页创建分组
  const groupId = await chrome.tabs.group({ tabIds: [tabs[0].id] });
  await chrome.tabGroups.update(groupId, { 
    title: groupName,
    color: 'grey',
    collapsed: true
  });
  
  return groupId;
}


// 处理从分组恢复标签页
async function handleRestoreFromGroup(ungroupedTabs, config, windowId) {
  const availableSlots = config.maxTabs - ungroupedTabs.length;
  
  if (availableSlots <= 0) return;
  
  // 查找目标分组
  const groups = await chrome.tabGroups.query({ windowId });
  const targetGroup = groups.find(group => group.title === config.groupName);
  
  if (!targetGroup) return;
  
  // 获取分组中的标签页
  const groupedTabs = await chrome.tabs.query({ windowId, groupId: targetGroup.id });
  
  if (groupedTabs.length === 0) return;
  
  // 根据策略确定要恢复的标签页
  let tabsToRestore;
  
  if (config.groupStrategy.startsWith('creation')) {
    const isAscending = config.groupStrategy === 'creation-asc';
    const sortedTabs = await sortTabsByCreationTime(groupedTabs, isAscending);
    
    if (config.groupStrategy === 'creation-asc') {
      // 如果是按创建时间升序分组（最早的先进组），那么恢复时应该最晚的先出组
      tabsToRestore = sortedTabs.slice(-Math.min(availableSlots, sortedTabs.length));
    } else {
      // 如果是按创建时间降序分组（最新的先进组），那么恢复时应该最早的先出组
      tabsToRestore = sortedTabs.slice(0, Math.min(availableSlots, sortedTabs.length));
    }
  } else if (config.groupStrategy.startsWith('recent')) {
    const isAscending = config.groupStrategy === 'recent-asc';
    const sortedTabs = await sortTabsByRecentUse(groupedTabs, isAscending);
    
    if (config.groupStrategy === 'recent-asc') {
      // 如果是最久未使用的先进组，那么恢复时应该最近使用的先出组
      tabsToRestore = sortedTabs.slice(-Math.min(availableSlots, sortedTabs.length));
    } else {
      // 如果是最近使用的先进组，那么恢复时应该最久未使用的先出组
      tabsToRestore = sortedTabs.slice(0, Math.min(availableSlots, sortedTabs.length));
    }
  }
  
  // 将标签页移出分组
  const tabIds = tabsToRestore.map(tab => tab.id);
  await chrome.tabs.ungroup(tabIds);
  
  // 如果分组为空，删除分组
  const remainingGroupedTabs = await chrome.tabs.query({ windowId, groupId: targetGroup.id });
  if (remainingGroupedTabs.length === 0) {
    // 分组会自动删除当没有标签页时
  }
}



// 存储标签页创建时间
chrome.tabs.onCreated.addListener(async (tab) => {
  const timestamp = Date.now();
  await chrome.storage.local.set({
    [`tab_${tab.id}_created`]: timestamp,
    [`tab_${tab.id}_lastUsed`]: timestamp
  });
});


// 监听标签页移除
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  // 清理存储的时间戳
  await chrome.storage.local.remove(`tab_${tabId}_lastUsed`);
  await chrome.storage.local.remove(`tab_${tabId}_created`);
  
  // 检查是否需要恢复标签页
  await handleTabLimit(removeInfo.windowId);
});
