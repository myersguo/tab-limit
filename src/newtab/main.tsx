import React from 'react';
import ReactDOM from 'react-dom/client';
import NewTab from './NewTab';
import { DEFAULT_SETTINGS } from '../config';

const renderNewTab = () => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <NewTab />
    </React.StrictMode>
  );
};

const initializeNewTab = async () => {
  try {
    const { overrideNewTab = DEFAULT_SETTINGS.overrideNewTab } =
      await chrome.storage.sync.get('overrideNewTab');

    if (!overrideNewTab) {
      const currentTab = await chrome.tabs.getCurrent();
      if (currentTab?.id) {
        await chrome.tabs.update(currentTab.id, { url: 'chrome://new-tab-page/' });
        return;
      }
    }
  } catch (error) {
    console.error('Failed to apply the new tab setting:', error);
  }

  renderNewTab();
};

initializeNewTab();
