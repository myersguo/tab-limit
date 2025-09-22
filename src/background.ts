import { Settings, DEFAULT_SETTINGS } from './config';

let config: Settings = DEFAULT_SETTINGS;

// Function to load/reload settings into the global config variable
const loadConfig = async () => {
  const storedSettings = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  config = { ...DEFAULT_SETTINGS, ...storedSettings };
};

// --- Event Listeners ---

chrome.runtime.onInstalled.addListener(async () => {
  await loadConfig();
});

// Listen for changes in storage and reload the config
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync') {
    loadConfig();
  }
});

chrome.tabs.onCreated.addListener(async (tab) => {
  if (tab.id) {
    const timestamp = Date.now();
    await chrome.storage.local.set({
      [`tab_${tab.id}_created`]: timestamp,
      [`tab_${tab.id}_lastUsed`]: timestamp
    });
  }
  
  // Handle duplicate URL removal if enabled
  if (config.keepSingleUrl && tab.windowId && tab.url) {
    await handleDuplicateUrls(tab.windowId, tab);
  }
  
  if (tab.windowId) {
    await handleTabLimit(tab.windowId, tab);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Check for duplicate URLs when a tab's URL changes
  if (config.keepSingleUrl && changeInfo.url && tab.windowId) {
    await handleDuplicateUrls(tab.windowId, tab);
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await chrome.storage.local.set({ [`tab_${activeInfo.tabId}_lastUsed`]: Date.now() });
});

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  await chrome.storage.local.remove([`tab_${tabId}_created`, `tab_${tabId}_lastUsed`]);
  if (removeInfo.windowId && !removeInfo.isWindowClosing) {
    await handleTabLimit(removeInfo.windowId);
  }
});

// --- Core Logic ---

async function handleDuplicateUrls(windowId: number, currentTab: chrome.tabs.Tab) {
  if (!currentTab.url || !currentTab.id) return;
  
  // Skip special URLs
  if (currentTab.url.startsWith('chrome://') || 
      currentTab.url.startsWith('chrome-extension://') ||
      currentTab.url === 'about:blank' ||
      currentTab.url === 'about:newtab') {
    return;
  }
  
  const normalizeUrl = (url: string) => {
    try {
      const urlObj = new URL(url);
      // By default, keep hash. If keepUrlHash is false, remove it.
      if (!config.keepUrlHash) {
        return urlObj.origin + urlObj.pathname + urlObj.search;
      }
      return urlObj.href;
    } catch {
      return url;
    }
  };

  const normalizedCurrentUrl = normalizeUrl(currentTab.url);
  const allTabs = await chrome.tabs.query({ windowId });
  
  // Find duplicate tabs with the same URL
  const duplicateTabs = allTabs.filter(tab => 
    tab.id !== currentTab.id && 
    tab.url && 
    normalizeUrl(tab.url) === normalizedCurrentUrl
  );
  
  if (duplicateTabs.length > 0) {
    // Sort duplicate tabs by creation time (keep the oldest)
    const tabsWithTime = await Promise.all([currentTab, ...duplicateTabs].map(async (tab) => {
      const key = `tab_${tab.id}_created`;
      const result = await chrome.storage.local.get(key);
      return { 
        tab, 
        timestamp: result[key] || tab.id || Date.now() 
      };
    }));
    
    // Sort by timestamp (oldest first)
    tabsWithTime.sort((a, b) => a.timestamp - b.timestamp);
    
    // Keep the first (oldest) tab and close the rest
    const tabsToClose = tabsWithTime.slice(1).map(item => item.tab.id).filter((id): id is number => id !== undefined);
    
    if (tabsToClose.length > 0) {
      await chrome.tabs.remove(tabsToClose);
      
      // If the current tab was closed, activate the kept tab
      if (tabsToClose.includes(currentTab.id)) {
        const keptTab = tabsWithTime[0].tab;
        if (keptTab.id) {
          await chrome.tabs.update(keptTab.id, { active: true });
        }
      }
    }
  }
}

async function handleTabLimit(windowId: number, newTab?: chrome.tabs.Tab) {
  let allTabs = await chrome.tabs.query({ windowId });

  if (newTab && !allTabs.some(t => t.id === newTab.id)) {
    allTabs.push(newTab);
  }

  const optionsUrl = chrome.runtime.getURL("src/options/index.html");
  const filteredTabs = allTabs.filter(tab => tab.url !== optionsUrl);
  const ungroupedTabs = filteredTabs.filter(tab => tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE);

  if (ungroupedTabs.length > config.maxTabs) {
    if (config.exceedBehavior === 'prevent') {
      await handlePreventCreation(ungroupedTabs, config.maxTabs);
    } else if (config.exceedBehavior === 'group') {
      await handleGroupExcess(ungroupedTabs, config, windowId);
    }
  } else if (ungroupedTabs.length < config.maxTabs && config.restoreStrategy === 'restore') {
    await handleRestoreFromGroup(ungroupedTabs, config, windowId);
  }
}

async function handlePreventCreation(tabs: chrome.tabs.Tab[], maxTabs: number) {
  const sortedTabs = await sortTabsByCreationTime(tabs, false); // Newest first
  const excessCount = tabs.length - maxTabs;
  if (excessCount <= 0) return;

  const tabsToRemove = sortedTabs.slice(0, excessCount);
  for (const tab of tabsToRemove) {
    if (tab.id) await chrome.tabs.remove(tab.id);
  }
}

async function handleGroupExcess(tabs: chrome.tabs.Tab[], config: Settings, windowId: number) {
  const excessCount = tabs.length - config.maxTabs;
  if (excessCount <= 0) return;

  let tabsToGroup: chrome.tabs.Tab[];
  
  switch (config.groupStrategy) {
    case 'creation-asc':
      tabsToGroup = (await sortTabsByCreationTime(tabs, true)).slice(0, excessCount);
      break;
    case 'creation-desc':
      tabsToGroup = (await sortTabsByCreationTime(tabs, false)).slice(0, excessCount);
      break;
    case 'recent-asc':
      tabsToGroup = (await sortTabsByRecentUse(tabs, true)).slice(0, excessCount);
      break;
    case 'recent-desc':
      tabsToGroup = (await sortTabsByRecentUse(tabs, false)).slice(0, excessCount);
      break;
    default:
      tabsToGroup = (await sortTabsByRecentUse(tabs, true)).slice(0, excessCount);
  }

  const tabIdsToGroup = tabsToGroup.map(t => t.id).filter((id): id is number => id !== undefined);
  if (tabIdsToGroup.length === 0) return;

  const existingGroups = await chrome.tabGroups.query({ windowId, title: config.groupName });
  
  if (existingGroups.length > 0) {
    const groupId = existingGroups[0].id;
    await chrome.tabs.group({ tabIds: tabIdsToGroup, groupId });
  } else {
    const newGroupId = await chrome.tabs.group({ tabIds: tabIdsToGroup });
    await chrome.tabGroups.update(newGroupId, { title: config.groupName, color: 'grey', collapsed: true });
  }
}

async function handleRestoreFromGroup(ungroupedTabs: chrome.tabs.Tab[], config: Settings, windowId: number) {
  const availableSlots = config.maxTabs - ungroupedTabs.length;
  if (availableSlots <= 0) return;

  const targetGroup = (await chrome.tabGroups.query({ windowId, title: config.groupName }))[0];
  if (!targetGroup) return;

  const groupedTabs = await chrome.tabs.query({ windowId, groupId: targetGroup.id });
  if (groupedTabs.length === 0) return;

  let tabsToRestore: chrome.tabs.Tab[];
  
  switch (config.groupStrategy) {
    case 'creation-asc':
      // If grouped by creation time ascending (oldest first), restore the newest tabs from the group.
      tabsToRestore = (await sortTabsByCreationTime(groupedTabs, false)).slice(0, availableSlots);
      break;
    case 'creation-desc':
      // If grouped by creation time descending (newest first), restore the oldest tabs from the group.
      tabsToRestore = (await sortTabsByCreationTime(groupedTabs, true)).slice(0, availableSlots);
      break;
    case 'recent-asc':
      // If grouped by least recent use, restore the most recently used tabs from the group.
      tabsToRestore = (await sortTabsByRecentUse(groupedTabs, false)).slice(0, availableSlots);
      break;
    case 'recent-desc':
      // If grouped by most recent use, restore the least recently used tabs from the group.
      tabsToRestore = (await sortTabsByRecentUse(groupedTabs, true)).slice(0, availableSlots);
      break;
    default:
      tabsToRestore = (await sortTabsByRecentUse(groupedTabs, false)).slice(0, availableSlots);
  }
  
  const tabIds = tabsToRestore.map(tab => tab.id).filter((id): id is number => id !== undefined);
  if (tabIds.length > 0) {
    await chrome.tabs.ungroup(tabIds);
  }
}

// --- Utility Functions ---

async function sortTabsByCreationTime(tabs: chrome.tabs.Tab[], ascending: boolean): Promise<chrome.tabs.Tab[]> {
  const tabsWithTime = await Promise.all(tabs.map(async (tab) => {
    const key = `tab_${tab.id}_created`;
    const result = await chrome.storage.local.get(key);
    return { ...tab, timestamp: result[key] || tab.id || 0 };
  }));
  return tabsWithTime.sort((a, b) => ascending ? a.timestamp - b.timestamp : b.timestamp - a.timestamp);
}

async function sortTabsByRecentUse(tabs: chrome.tabs.Tab[], ascending: boolean): Promise<chrome.tabs.Tab[]> {
  const tabsWithTime = await Promise.all(tabs.map(async (tab) => {
    const key = `tab_${tab.id}_lastUsed`;
    const result = await chrome.storage.local.get(key);
    return { ...tab, timestamp: result[key] || 0 };
  }));
  return tabsWithTime.sort((a, b) => ascending ? a.timestamp - b.timestamp : b.timestamp - a.timestamp);
}

// Initial load of the configuration
loadConfig();
