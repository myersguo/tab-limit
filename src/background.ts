// Define types for settings
interface Settings {
  maxTabs: number;
  exceedBehavior: 'group' | 'prevent';
  groupStrategy: 'creation-asc' | 'creation-desc' | 'recent-asc' | 'recent-desc';
  restoreStrategy: 'none' | 'restore';
  groupName: string;
}

const DEFAULT_SETTINGS: Settings = {
  maxTabs: 5,
  exceedBehavior: 'group',
  groupStrategy: 'recent-asc',
  restoreStrategy: 'none',
  groupName: 'Others Group'
};

// --- Event Listeners ---

chrome.runtime.onInstalled.addListener(async () => {
  const result = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  const settings = { ...DEFAULT_SETTINGS, ...result };
  await chrome.storage.sync.set(settings);
});

chrome.tabs.onCreated.addListener(async (tab) => {
  if (tab.id) {
    const timestamp = Date.now();
    await chrome.storage.local.set({
      [`tab_${tab.id}_created`]: timestamp,
      [`tab_${tab.id}_lastUsed`]: timestamp
    });
  }
  if (tab.windowId) {
    // Pass the newly created tab to handleTabLimit to avoid race conditions
    await handleTabLimit(tab.windowId, tab);
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

async function handleTabLimit(windowId: number, newTab?: chrome.tabs.Tab) {
  const settings: Settings = (await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS))) as Settings;
  const config = { ...DEFAULT_SETTINGS, ...settings };

  let allTabs = await chrome.tabs.query({ windowId });

  // Ensure the newly created tab is in the list, countering potential race conditions.
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
  
  const sortOrderIsAsc = config.groupStrategy.endsWith('-asc');
  switch (config.groupStrategy) {
    case 'creation-asc':
    case 'creation-desc':
      tabsToRestore = (await sortTabsByCreationTime(groupedTabs, !sortOrderIsAsc)).slice(0, availableSlots);
      break;
    case 'recent-asc':
    case 'recent-desc':
      tabsToRestore = (await sortTabsByRecentUse(groupedTabs, !sortOrderIsAsc)).slice(0, availableSlots);
      break;
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
