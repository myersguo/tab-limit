import React, { useState, useEffect } from 'react';
import '../styles.css';

interface PopupInfo {
  currentTabs: number;
  maxTabs: number | string;
  exceedBehavior: string;
}

const Popup: React.FC = () => {
  const [info, setInfo] = useState<PopupInfo>({
    currentTabs: 0,
    maxTabs: '-',
    exceedBehavior: '-',
  });

  useEffect(() => {
    const loadPopupData = async () => {
      const settings = await chrome.storage.sync.get(['maxTabs', 'exceedBehavior']);
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const ungroupedTabs = tabs.filter(tab => tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE);

      setInfo({
        currentTabs: ungroupedTabs.length,
        maxTabs: settings.maxTabs || 5,
        exceedBehavior: settings.exceedBehavior === 'group' ? 'Move to group' : 'Prevent creation',
      });
    };

    loadPopupData();
  }, []);

  const openOptions = () => {
    chrome.runtime.openOptionsPage();
    window.close();
  };

  return (
    <div className="popup-container">
      <h3>Tab Limit</h3>
      <div className="popup-content">
        <div className="info-item">
          <span className="label">Current tabs:</span>
          <span id="currentTabs" className="value">{info.currentTabs}</span>
        </div>
        <div className="info-item">
          <span className="label">Tab limit:</span>
          <span id="maxTabs" className="value">{info.maxTabs}</span>
        </div>
        <div className="info-item">
          <span className="label">Exceed behavior:</span>
          <span id="exceedBehavior" className="value">{info.exceedBehavior}</span>
        </div>
      </div>
      <div className="popup-actions">
        <button id="openOptions" onClick={openOptions}>Open Settings</button>
      </div>
    </div>
  );
};

export default Popup;