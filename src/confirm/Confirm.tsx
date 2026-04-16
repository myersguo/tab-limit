import React, { useState, useEffect } from 'react';
import '../styles.css';

const Confirm: React.FC = () => {
  const [tabs, setTabs] = useState<chrome.tabs.Tab[]>([]);
  const [selectedTabIds, setSelectedTabIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    const loadTabs = async () => {
      const data = await chrome.storage.local.get('tabsToConfirmClose');
      if (data.tabsToConfirmClose && data.tabsToConfirmClose.length > 0) {
        const tabObjects: chrome.tabs.Tab[] = [];
        const initialSelected = new Set<number>();
        
        for (const tabId of data.tabsToConfirmClose) {
          try {
            const tab = await chrome.tabs.get(tabId);
            tabObjects.push(tab);
            if (tab.id !== undefined) {
              initialSelected.add(tab.id);
            }
          } catch (e) {
            // Tab might have been closed already
          }
        }
        setTabs(tabObjects);
        setSelectedTabIds(initialSelected);
      }
    };
    loadTabs();
  }, []);

  const handleToggleTab = (tabId: number) => {
    const newSelected = new Set(selectedTabIds);
    if (newSelected.has(tabId)) {
      newSelected.delete(tabId);
    } else {
      newSelected.add(tabId);
    }
    setSelectedTabIds(newSelected);
  };

  const handleToggleAll = () => {
    if (selectedTabIds.size === tabs.length) {
      setSelectedTabIds(new Set());
    } else {
      const newSelected = new Set<number>();
      tabs.forEach(tab => {
        if (tab.id !== undefined) newSelected.add(tab.id);
      });
      setSelectedTabIds(newSelected);
    }
  };

  const handleConfirm = async () => {
    // Separate tabs into closing and keeping lists
    const tabsToClose: number[] = [];
    const tabsToKeep: number[] = [];

    tabs.forEach(tab => {
      if (tab.id !== undefined) {
        if (selectedTabIds.has(tab.id)) {
          tabsToClose.push(tab.id);
        } else {
          tabsToKeep.push(tab.id);
        }
      }
    });

    // Close selected tabs
    if (tabsToClose.length > 0) {
      try {
        await chrome.tabs.remove(tabsToClose);
      } catch (e) {
        console.error(e);
      }
    }

    // Reset timer for kept tabs
    if (tabsToKeep.length > 0) {
      const now = Date.now();
      const updates: { [key: string]: number } = {};
      tabsToKeep.forEach(id => {
        updates[`tab_${id}_lastUsed`] = now;
      });
      await chrome.storage.local.set(updates);
    }

    await chrome.storage.local.remove('tabsToConfirmClose');
    window.close();
  };

  const handleCancel = async () => {
    // Reset timer for ALL tabs displayed (since we cancelled the whole operation)
    // Same logic as before, just ensuring we cover all loaded tabs
    const tabIds = tabs.map(t => t.id).filter((id): id is number => id !== undefined);
    if (tabIds.length > 0) {
      const now = Date.now();
      const updates: { [key: string]: number } = {};
      tabIds.forEach(id => {
        updates[`tab_${id}_lastUsed`] = now;
      });
      await chrome.storage.local.set(updates);
    }
    
    await chrome.storage.local.remove('tabsToConfirmClose');
    window.close(); 
  };

  return (
    <div className="confirm-container">
      <div className="confirm-header">
        <h2>Auto Close Inactive Tabs</h2>
      </div>
      <p className="confirm-description">
        The following tabs have been inactive for the configured threshold. Select tabs to close:
      </p>
      
      <div className="selection-controls">
        <label className="checkbox-label">
          <input 
            type="checkbox" 
            checked={tabs.length > 0 && selectedTabIds.size === tabs.length}
            onChange={handleToggleAll}
            className="tab-checkbox"
          />
          <strong>Select All</strong>
        </label>
      </div>

      <div className="tab-list-container">
        {tabs.length === 0 ? (
          <p className="no-tabs-message">No tabs to close.</p>
        ) : (
          <ul className="tab-list">
            {tabs.map(tab => (
              <li key={tab.id} className="tab-item">
                <label className="tab-item-label">
                  <input 
                    type="checkbox" 
                    checked={tab.id !== undefined && selectedTabIds.has(tab.id)}
                    onChange={() => tab.id !== undefined && handleToggleTab(tab.id)}
                    className="tab-checkbox"
                  />
                  {tab.favIconUrl ? (
                    <img src={tab.favIconUrl} alt="" className="tab-icon" />
                  ) : (
                    <div className="tab-icon" style={{ backgroundColor: '#ccc', borderRadius: '50%' }}></div>
                  )}
                  <span className="tab-title" title={tab.title || tab.url}>
                    {tab.title || tab.url}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="confirm-actions">
        <button onClick={handleCancel} className="btn-cancel">Cancel</button>
        <button onClick={handleConfirm} className="btn-confirm">
          Confirm Close ({selectedTabIds.size})
        </button>
      </div>
    </div>
  );
};

export default Confirm;
