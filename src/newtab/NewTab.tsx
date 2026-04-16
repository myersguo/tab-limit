import React, { useEffect, useMemo, useState } from 'react';
import '../styles.css';

interface OverviewTab extends chrome.tabs.Tab {
  domainLabel: string;
  normalizedUrl: string;
  lastUsed: number;
  createdAt: number;
  groupTitle?: string;
  windowFocused?: boolean;
  windowLabel: string;
}

interface DomainGroup {
  key: string;
  label: string;
  tabs: OverviewTab[];
  duplicateCount: number;
  windowCount: number;
  latestUse: number;
}

interface ConfirmAction {
  title: string;
  message: string;
  actionLabel: string;
  run: () => Promise<void>;
}

interface QuickShortcut {
  id: string;
  title: string;
  url: string;
}

type WindowFilter = 'all' | number;

interface WindowOption {
  id: number;
  label: string;
  focused: boolean;
  tabCount: number;
}

const specialUrlLabel = (url?: string) => {
  if (!url) return 'Unknown';
  if (url.startsWith('chrome://')) return 'Chrome pages';
  if (url.startsWith('chrome-extension://')) return 'Extension pages';
  if (url.startsWith('file://')) return 'Local files';
  if (url === 'about:blank' || url === 'about:newtab') return 'Blank tabs';
  return '';
};

const getDomainLabel = (url?: string) => {
  const specialLabel = specialUrlLabel(url);
  if (specialLabel) return specialLabel;

  try {
    const host = new URL(url || '').hostname.replace(/^www\./, '');
    return host || 'Unknown';
  } catch {
    return 'Unknown';
  }
};

const normalizeUrl = (url?: string) => {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url;
  }
};

const getNavigationUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) return trimmed;
  if (/^[^\s]+\.[^\s]+/.test(trimmed)) return `https://${trimmed}`;
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
};

const formatRelativeTime = (timestamp: number) => {
  if (!timestamp) return 'not tracked';
  const seconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

const sortByRecentUse = (tabs: OverviewTab[]) =>
  [...tabs].sort((a, b) => {
    if (Number(b.active) !== Number(a.active)) return Number(b.active) - Number(a.active);
    if (Number(b.pinned) !== Number(a.pinned)) return Number(b.pinned) - Number(a.pinned);
    return b.lastUsed - a.lastUsed;
  });

const sortByLatestCreated = (tabs: OverviewTab[]) =>
  [...tabs].sort((a, b) => {
    const aCreated = a.createdAt || a.id || 0;
    const bCreated = b.createdAt || b.id || 0;
    return bCreated - aCreated;
  });

const PREVIEW_TABS_PER_GROUP = 5;
const QUICK_SHORTCUTS_STORAGE_KEY = 'quickLaunchShortcuts';

const makeShortcutId = () => `shortcut_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const normalizeShortcuts = (value: unknown): QuickShortcut[] => {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item): QuickShortcut[] => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Partial<QuickShortcut>;
    const title = typeof candidate.title === 'string' ? candidate.title.trim() : '';
    const url = typeof candidate.url === 'string' ? candidate.url.trim() : '';
    if (!title || !url) return [];

    return [{
      id: typeof candidate.id === 'string' && candidate.id ? candidate.id : makeShortcutId(),
      title,
      url,
    }];
  });
};

const getShortcutFallbackLabel = (shortcut: QuickShortcut) =>
  (shortcut.title || shortcut.url).trim().slice(0, 1).toUpperCase() || '?';

const NewTab: React.FC = () => {
  const [tabs, setTabs] = useState<OverviewTab[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [currentTabId, setCurrentTabId] = useState<number | undefined>();
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);
  const [selectedWindow, setSelectedWindow] = useState<WindowFilter>('all');
  const [windowOptions, setWindowOptions] = useState<WindowOption[]>([]);
  const [quickShortcuts, setQuickShortcuts] = useState<QuickShortcut[]>([]);
  const [shortcutDrafts, setShortcutDrafts] = useState<QuickShortcut[]>([]);
  const [shortcutEditorOpen, setShortcutEditorOpen] = useState(false);

  const loadTabs = async () => {
    setLoading(true);
    const [allTabs, windows, tabGroups, currentTab] = await Promise.all([
      chrome.tabs.query({}),
      chrome.windows.getAll(),
      chrome.tabGroups.query({}),
      chrome.tabs.getCurrent(),
    ]);

    setCurrentTabId(currentTab?.id);

    const windowFocus = new Map<number, boolean>();
    const windowLabels = new Map<number, string>();
    windows.forEach(win => {
      if (win.id !== undefined) windowFocus.set(win.id, Boolean(win.focused));
    });

    const orderedWindows = [...windows].sort((a, b) => {
      if (Number(b.focused) !== Number(a.focused)) return Number(b.focused) - Number(a.focused);
      return (a.id || 0) - (b.id || 0);
    });

    orderedWindows.forEach((win, index) => {
      if (win.id !== undefined) {
        windowLabels.set(win.id, win.focused ? 'Current window' : `Window ${index + 1}`);
      }
    });

    const groupTitles = new Map<number, string>();
    tabGroups.forEach(group => groupTitles.set(group.id, group.title || 'Unnamed group'));

    const storageKeys = allTabs
      .filter(tab => tab.id !== undefined)
      .flatMap(tab => [`tab_${tab.id}_created`, `tab_${tab.id}_lastUsed`]);
    const timingData = storageKeys.length > 0 ? await chrome.storage.local.get(storageKeys) : {};

    const overviewTabs = allTabs
      .filter(tab => tab.id !== currentTab?.id)
      .map((tab): OverviewTab => {
        const createdAt = tab.id !== undefined ? timingData[`tab_${tab.id}_created`] || 0 : 0;
        const lastUsed = tab.id !== undefined ? timingData[`tab_${tab.id}_lastUsed`] || createdAt : createdAt;
        return {
          ...tab,
          createdAt,
          lastUsed,
          domainLabel: getDomainLabel(tab.url),
          normalizedUrl: normalizeUrl(tab.url),
          groupTitle: tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE ? groupTitles.get(tab.groupId) : undefined,
          windowFocused: windowFocus.get(tab.windowId),
          windowLabel: windowLabels.get(tab.windowId) || 'Window',
        };
      });

    setWindowOptions(orderedWindows.flatMap(win => {
      if (win.id === undefined) return [];
      return [{
        id: win.id,
        label: windowLabels.get(win.id) || 'Window',
        focused: Boolean(win.focused),
        tabCount: overviewTabs.filter(tab => tab.windowId === win.id).length,
      }];
    }));
    setTabs(overviewTabs);
    setLoading(false);
  };

  useEffect(() => {
    loadTabs();
    const refreshTabs = () => {
      loadTabs();
    };

    chrome.tabs.onCreated.addListener(refreshTabs);
    chrome.tabs.onRemoved.addListener(refreshTabs);
    chrome.tabs.onUpdated.addListener(refreshTabs);
    chrome.tabs.onActivated.addListener(refreshTabs);
    chrome.windows.onFocusChanged.addListener(refreshTabs);

    return () => {
      chrome.tabs.onCreated.removeListener(refreshTabs);
      chrome.tabs.onRemoved.removeListener(refreshTabs);
      chrome.tabs.onUpdated.removeListener(refreshTabs);
      chrome.tabs.onActivated.removeListener(refreshTabs);
      chrome.windows.onFocusChanged.removeListener(refreshTabs);
    };
  }, []);

  useEffect(() => {
    const loadShortcuts = async () => {
      const data = await chrome.storage.local.get(QUICK_SHORTCUTS_STORAGE_KEY);
      setQuickShortcuts(normalizeShortcuts(data[QUICK_SHORTCUTS_STORAGE_KEY]));
    };

    loadShortcuts();
  }, []);

  const windowFilteredTabs = useMemo(() => {
    if (selectedWindow === 'all') return tabs;
    return tabs.filter(tab => tab.windowId === selectedWindow);
  }, [selectedWindow, tabs]);

  const filteredTabs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return windowFilteredTabs;

    return windowFilteredTabs.filter(tab => {
      const haystack = [
        tab.title,
        tab.url,
        tab.domainLabel,
        tab.groupTitle,
        tab.windowLabel,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [query, windowFilteredTabs]);

  const filteredShortcuts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return quickShortcuts;

    return quickShortcuts.filter(shortcut =>
      `${shortcut.title} ${shortcut.url}`.toLowerCase().includes(normalizedQuery)
    );
  }, [query, quickShortcuts]);

  const groups = useMemo(() => {
    const byDomain = new Map<string, OverviewTab[]>();
    filteredTabs.forEach(tab => {
      const key = tab.domainLabel;
      byDomain.set(key, [...(byDomain.get(key) || []), tab]);
    });

    return Array.from(byDomain.entries()).map(([label, domainTabs]): DomainGroup => {
      const duplicateMap = new Map<string, number>();
      domainTabs.forEach(tab => {
        if (!tab.normalizedUrl) return;
        duplicateMap.set(tab.normalizedUrl, (duplicateMap.get(tab.normalizedUrl) || 0) + 1);
      });

      return {
        key: label,
        label,
        tabs: sortByRecentUse(domainTabs),
        duplicateCount: Array.from(duplicateMap.values()).reduce((sum, count) => sum + Math.max(0, count - 1), 0),
        windowCount: new Set(domainTabs.map(tab => tab.windowId)).size,
        latestUse: Math.max(...domainTabs.map(tab => tab.lastUsed || 0)),
      };
    }).sort((a, b) => {
      const pinnedDelta = Number(b.tabs.some(tab => tab.pinned)) - Number(a.tabs.some(tab => tab.pinned));
      if (pinnedDelta !== 0) return pinnedDelta;
      return b.latestUse - a.latestUse;
    });
  }, [filteredTabs]);

  const stats = useMemo(() => {
    const duplicateUrls = new Map<string, number>();
    tabs.forEach(tab => {
      if (!tab.normalizedUrl) return;
      duplicateUrls.set(tab.normalizedUrl, (duplicateUrls.get(tab.normalizedUrl) || 0) + 1);
    });

    return {
      tabs: tabs.length,
      windows: new Set(tabs.map(tab => tab.windowId)).size,
      domains: new Set(tabs.map(tab => tab.domainLabel)).size,
      duplicates: Array.from(duplicateUrls.values()).reduce((sum, count) => sum + Math.max(0, count - 1), 0),
    };
  }, [tabs]);

  const selectedGroup = useMemo(
    () => groups.find(group => group.key === selectedGroupKey) || null,
    [groups, selectedGroupKey]
  );
  const queryText = query.trim();
  const hasSearchTarget = filteredTabs.length > 0 || (queryText.length > 0 && filteredShortcuts.length > 0);

  const activateTab = async (tab: OverviewTab) => {
    if (tab.windowId !== undefined) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    if (tab.id !== undefined) {
      await chrome.tabs.update(tab.id, { active: true });
    }
  };

  const closeTabs = async (tabIds: number[]) => {
    if (tabIds.length === 0) return;
    await chrome.tabs.remove(tabIds);
    setTabs(current => current.filter(tab => tab.id === undefined || !tabIds.includes(tab.id)));
  };

  const requestCloseTab = (tab: OverviewTab) => {
    if (tab.id === undefined) return;

    if (tab.pinned || tab.audible || tab.active) {
      setConfirmAction({
        title: 'Close protected tab',
        message: `${tab.title || tab.url || 'This tab'} is ${[
          tab.pinned ? 'pinned' : '',
          tab.audible ? 'playing audio' : '',
          tab.active ? 'active' : '',
        ].filter(Boolean).join(', ')}. Close it anyway?`,
        actionLabel: 'Close tab',
        run: async () => closeTabs([tab.id!]),
      });
      return;
    }

    closeTabs([tab.id]);
  };

  const requestCloseGroup = (group: DomainGroup) => {
    const closableTabs = group.tabs.filter(tab => !tab.pinned && !tab.audible && tab.id !== undefined);
    const protectedCount = group.tabs.length - closableTabs.length;
    if (closableTabs.length === 0) return;

    setConfirmAction({
      title: `Close ${group.label}`,
      message: `Close ${closableTabs.length} tabs from ${group.label}${protectedCount > 0 ? ` and keep ${protectedCount} pinned or audible tabs` : ''}?`,
      actionLabel: `Close ${closableTabs.length} tabs`,
      run: async () => closeTabs(closableTabs.map(tab => tab.id!).filter(Boolean)),
    });
  };

  const requestCloseDuplicates = (group: DomainGroup) => {
    const tabsByUrl = new Map<string, OverviewTab[]>();
    group.tabs.forEach(tab => {
      if (!tab.normalizedUrl || tab.id === undefined) return;
      tabsByUrl.set(tab.normalizedUrl, [...(tabsByUrl.get(tab.normalizedUrl) || []), tab]);
    });

    const tabsToClose = Array.from(tabsByUrl.values()).flatMap(duplicates => {
      if (duplicates.length <= 1) return [];
      const sorted = sortByLatestCreated(duplicates);
      return sorted.slice(1).filter(tab => !tab.pinned && !tab.audible);
    });

    if (tabsToClose.length === 0) return;

    setConfirmAction({
      title: `Close duplicates in ${group.label}`,
      message: `Close ${tabsToClose.length} duplicate tabs and keep the latest opened copy for each URL?`,
      actionLabel: `Close ${tabsToClose.length} duplicates`,
      run: async () => closeTabs(tabsToClose.map(tab => tab.id!).filter(Boolean)),
    });
  };

  const openUrl = async (url: string) => {
    const navigationUrl = getNavigationUrl(url);
    if (!navigationUrl) return;

    if (currentTabId !== undefined) {
      await chrome.tabs.update(currentTabId, { url: navigationUrl });
    } else {
      await chrome.tabs.create({ url: navigationUrl });
    }
  };

  const openShortcut = async (shortcut: QuickShortcut) => {
    await openUrl(shortcut.url);
  };

  const openShortcutEditor = () => {
    setShortcutDrafts(
      quickShortcuts.length > 0
        ? quickShortcuts.map(shortcut => ({ ...shortcut }))
        : [{ id: makeShortcutId(), title: '', url: '' }]
    );
    setShortcutEditorOpen(true);
  };

  const updateShortcutDraft = (id: string, field: 'title' | 'url', value: string) => {
    setShortcutDrafts(current => current.map(shortcut =>
      shortcut.id === id ? { ...shortcut, [field]: value } : shortcut
    ));
  };

  const addShortcutDraft = () => {
    setShortcutDrafts(current => [...current, { id: makeShortcutId(), title: '', url: '' }]);
  };

  const removeShortcutDraft = (id: string) => {
    setShortcutDrafts(current => {
      const next = current.filter(shortcut => shortcut.id !== id);
      return next.length > 0 ? next : [{ id: makeShortcutId(), title: '', url: '' }];
    });
  };

  const saveShortcutDrafts = async () => {
    const nextShortcuts = shortcutDrafts.flatMap((shortcut): QuickShortcut[] => {
      const title = shortcut.title.trim();
      const url = shortcut.url.trim();
      if (!title || !url) return [];

      return [{
        id: shortcut.id || makeShortcutId(),
        title,
        url,
      }];
    });

    await chrome.storage.local.set({ [QUICK_SHORTCUTS_STORAGE_KEY]: nextShortcuts });
    setQuickShortcuts(nextShortcuts);
    setShortcutEditorOpen(false);
  };

  const handleSearchSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const firstTab = filteredTabs[0];
    if (firstTab) {
      activateTab(firstTab);
      return;
    }

    const firstShortcut = queryText.length > 0 ? filteredShortcuts[0] : undefined;
    if (firstShortcut) {
      openShortcut(firstShortcut);
      return;
    }

    openUrl(query);
  };

  const runConfirmedAction = async () => {
    if (!confirmAction) return;
    await confirmAction.run();
    setConfirmAction(null);
  };

  return (
    <main className="newtab-page">
      <section className="newtab-hero">
        <div>
          <p className="newtab-kicker">Tab Limit Overview</p>
          <h1>Open tabs, grouped by where they came from.</h1>
        </div>
        <div className="newtab-stats" aria-label="Open tab summary">
          <span><strong>{stats.tabs}</strong> tabs</span>
          <span><strong>{stats.windows}</strong> windows</span>
          <span><strong>{stats.domains}</strong> domains</span>
          <span><strong>{stats.duplicates}</strong> duplicates</span>
        </div>
      </section>

      <form className="newtab-search" onSubmit={handleSearchSubmit}>
        <input
          autoFocus
          type="search"
          value={query}
          placeholder="Search title, URL, domain, group, or window"
          onChange={event => setQuery(event.target.value)}
        />
        <button type="submit" disabled={!hasSearchTarget && queryText.length === 0}>
          {hasSearchTarget ? 'Open first match' : 'Search web'}
        </button>
      </form>

      <section className="quick-shortcuts" aria-label="Quick launch shortcuts">
        <div className="quick-shortcuts-header">
          <div>
            <h2>Quick launch</h2>
            <p>{quickShortcuts.length > 0 ? 'Open a saved destination from this tab.' : 'Add the places you open most often.'}</p>
          </div>
          <button type="button" onClick={openShortcutEditor}>
            {quickShortcuts.length > 0 ? 'Edit shortcuts' : 'Add shortcut'}
          </button>
        </div>

        {quickShortcuts.length > 0 && (
          <div className="quick-shortcut-list">
            {filteredShortcuts.length > 0 ? (
              filteredShortcuts.map(shortcut => (
                <button type="button" className="quick-shortcut" key={shortcut.id} onClick={() => openShortcut(shortcut)}>
                  <span className="quick-shortcut-icon">{getShortcutFallbackLabel(shortcut)}</span>
                  <span>
                    <strong>{shortcut.title}</strong>
                    <small>{shortcut.url}</small>
                  </span>
                </button>
              ))
            ) : (
              <p className="quick-shortcut-empty">No shortcuts match this search.</p>
            )}
          </div>
        )}
      </section>

      <div className="window-filter" aria-label="Window filter">
        <button
          type="button"
          className={selectedWindow === 'all' ? 'is-selected' : ''}
          onClick={() => setSelectedWindow('all')}
        >
          All windows · {tabs.length}
        </button>
        {windowOptions.map(option => (
          <button
            type="button"
            key={option.id}
            className={selectedWindow === option.id ? 'is-selected' : ''}
            onClick={() => setSelectedWindow(option.id)}
          >
            {option.label} · {option.tabCount}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="newtab-empty">Loading tabs...</div>
      ) : groups.length === 0 ? (
        <div className="newtab-empty">No matching tabs.</div>
      ) : (
        <section className="domain-grid" aria-label="Grouped tabs">
          {groups.map(group => (
            <article className="domain-panel" key={group.key}>
              <header className="domain-header">
                <div>
                  <h2>{group.label}</h2>
                  <p>
                    {group.tabs.length} tabs · {group.windowCount} window{group.windowCount === 1 ? '' : 's'} · latest {formatRelativeTime(group.latestUse)}
                  </p>
                </div>
              </header>

              <div className="domain-summary">
                <div className="domain-summary-stats">
                  <span>{group.duplicateCount} duplicate{group.duplicateCount === 1 ? '' : 's'}</span>
                  <span>{group.tabs.filter(tab => tab.pinned).length} pinned</span>
                  <span>{group.tabs.filter(tab => tab.audible).length} audio</span>
                </div>

                <ul className="domain-preview-list">
                  {group.tabs.slice(0, PREVIEW_TABS_PER_GROUP).map(tab => (
                    <li key={tab.id}>
                      <button type="button" onClick={() => activateTab(tab)}>
                        {tab.favIconUrl ? (
                          <img src={tab.favIconUrl} alt="" />
                        ) : (
                          <span>{tab.domainLabel.slice(0, 1).toUpperCase()}</span>
                        )}
                        <span>{tab.title || tab.url || 'Untitled tab'}</span>
                      </button>
                      <button type="button" className="preview-close-button" onClick={() => requestCloseTab(tab)} aria-label={`Close ${tab.title || 'tab'}`}>
                        ×
                      </button>
                    </li>
                  ))}
                </ul>

                {group.tabs.length > PREVIEW_TABS_PER_GROUP && (
                  <p className="domain-more-count">+{group.tabs.length - PREVIEW_TABS_PER_GROUP} more</p>
                )}
              </div>

              <div className="domain-card-actions">
                <button type="button" onClick={() => setSelectedGroupKey(group.key)}>Details</button>
                {group.duplicateCount > 0 && (
                  <button type="button" onClick={() => requestCloseDuplicates(group)}>
                    Close duplicates
                  </button>
                )}
                <button type="button" className="domain-danger-action" onClick={() => requestCloseGroup(group)}>
                  Close group
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      {selectedGroup && (
        <div className="newtab-modal-backdrop" role="presentation">
          <div className="newtab-modal newtab-detail-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title">
            <header className="detail-modal-header">
              <div>
                <h2 id="detail-title">{selectedGroup.label}</h2>
                <p>
                  {selectedGroup.tabs.length} tabs · {selectedGroup.windowCount} window{selectedGroup.windowCount === 1 ? '' : 's'} · {selectedGroup.duplicateCount} duplicate{selectedGroup.duplicateCount === 1 ? '' : 's'}
                </p>
              </div>
              <button type="button" className="close-detail-button" onClick={() => setSelectedGroupKey(null)} aria-label="Close details">
                ×
              </button>
            </header>

            <div className="detail-modal-actions">
              <button
                type="button"
                disabled={selectedGroup.duplicateCount === 0}
                onClick={() => requestCloseDuplicates(selectedGroup)}
              >
                Close duplicates
              </button>
              <button type="button" className="danger-button" onClick={() => requestCloseGroup(selectedGroup)}>
                Close group
              </button>
            </div>

            <ul className="overview-tab-list detail-tab-list">
              {selectedGroup.tabs.map(tab => (
                <li className={`overview-tab ${tab.active ? 'is-active' : ''}`} key={tab.id}>
                  <button type="button" className="overview-tab-main" onClick={() => activateTab(tab)}>
                    {tab.favIconUrl ? (
                      <img src={tab.favIconUrl} alt="" className="overview-tab-icon" />
                    ) : (
                      <span className="overview-tab-icon fallback-icon">{tab.domainLabel.slice(0, 1).toUpperCase()}</span>
                    )}
                    <span className="overview-tab-copy">
                      <span className="overview-tab-title">{tab.title || tab.url || 'Untitled tab'}</span>
                      <span className="overview-tab-url">{tab.url || 'No URL'}</span>
                    </span>
                  </button>
                  <span className="overview-tab-meta">
                    {tab.groupTitle && <span>{tab.groupTitle}</span>}
                    {tab.pinned && <span>Pinned</span>}
                    {tab.audible && <span>Audio</span>}
                    {tab.active && <span>Active</span>}
                    {tab.windowFocused && <span>Current window</span>}
                    {!tab.windowFocused && <span>{tab.windowLabel}</span>}
                    <span>{formatRelativeTime(tab.lastUsed)}</span>
                  </span>
                  <button type="button" className="close-tab-button" onClick={() => requestCloseTab(tab)} aria-label={`Close ${tab.title || 'tab'}`}>
                    ×
                  </button>
                </li>
              ))}
              </ul>
          </div>
        </div>
      )}

      {confirmAction && (
        <div className="newtab-modal-backdrop" role="presentation">
          <div className="newtab-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
            <h2 id="confirm-title">{confirmAction.title}</h2>
            <p>{confirmAction.message}</p>
            <div className="newtab-modal-actions">
              <button type="button" onClick={() => setConfirmAction(null)}>Cancel</button>
              <button type="button" className="danger-button" onClick={runConfirmedAction}>{confirmAction.actionLabel}</button>
            </div>
          </div>
        </div>
      )}

      {shortcutEditorOpen && (
        <div className="newtab-modal-backdrop" role="presentation">
          <div className="newtab-modal shortcut-editor-modal" role="dialog" aria-modal="true" aria-labelledby="shortcut-editor-title">
            <header className="shortcut-editor-header">
              <div>
                <h2 id="shortcut-editor-title">Quick launch</h2>
                <p>Save the destinations you open from a new tab.</p>
              </div>
              <button type="button" className="close-detail-button" onClick={() => setShortcutEditorOpen(false)} aria-label="Close shortcut editor">
                ×
              </button>
            </header>

            <div className="shortcut-editor-list">
              {shortcutDrafts.map((shortcut, index) => (
                <div className="shortcut-editor-row" key={shortcut.id}>
                  <label>
                    Title
                    <input
                      type="text"
                      value={shortcut.title}
                      placeholder={`Shortcut ${index + 1}`}
                      onChange={event => updateShortcutDraft(shortcut.id, 'title', event.target.value)}
                    />
                  </label>
                  <label>
                    URL
                    <input
                      type="text"
                      value={shortcut.url}
                      placeholder="https://example.com"
                      onChange={event => updateShortcutDraft(shortcut.id, 'url', event.target.value)}
                    />
                  </label>
                  <button type="button" className="shortcut-remove-button" onClick={() => removeShortcutDraft(shortcut.id)} aria-label={`Remove shortcut ${index + 1}`}>
                    ×
                  </button>
                </div>
              ))}
            </div>

            <button type="button" className="shortcut-add-button" onClick={addShortcutDraft}>
              Add another
            </button>

            <div className="newtab-modal-actions">
              <button type="button" onClick={() => setShortcutEditorOpen(false)}>Cancel</button>
              <button type="button" onClick={saveShortcutDrafts}>Save shortcuts</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};

export default NewTab;
