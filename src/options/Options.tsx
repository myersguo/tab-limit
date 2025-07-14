import React, { useState, useEffect } from 'react';
import '../styles.css';

const DEFAULT_SETTINGS = {
  maxTabs: 5,
  exceedBehavior: 'group',
  groupStrategy: 'recent-asc',
  restoreStrategy: 'none',
  groupName: 'Others Group'
};

const Options: React.FC = () => {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [status, setStatus] = useState<{ message: string, type: string } | null>(null);

  useEffect(() => {
    chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS), (storedSettings) => {
      setSettings({ ...DEFAULT_SETTINGS, ...storedSettings });
    });
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setSettings(prev => ({ ...prev, [name]: name === 'maxTabs' ? parseInt(value, 10) : value }));
  };

  const showStatus = (message: string, type: string = 'success') => {
    setStatus({ message, type });
    setTimeout(() => setStatus(null), 3000);
  };

  const saveSettings = () => {
    if (settings.maxTabs < 1 || settings.maxTabs > 50) {
      showStatus('Tab count must be between 1-50', 'error');
      return;
    }
    const finalSettings = {
      ...settings,
      groupName: settings.groupName.trim() || DEFAULT_SETTINGS.groupName,
    };
    chrome.storage.sync.set(finalSettings, () => {
      setSettings(finalSettings);
      showStatus('Settings saved');
    });
  };

  const resetSettings = () => {
    chrome.storage.sync.set(DEFAULT_SETTINGS, () => {
      setSettings(DEFAULT_SETTINGS);
      showStatus('Settings reset to default');
    });
  };

  return (
    <div className="container">
      <h1>Tab Limit Settings</h1>

      <div className="section">
        <h2>Basic Settings</h2>
        <div className="field">
          <label htmlFor="maxTabs">Maximum number of tabs:</label>
          <input
            type="number"
            id="maxTabs"
            name="maxTabs"
            min="1"
            max="50"
            value={settings.maxTabs}
            onChange={handleInputChange}
          />
        </div>
        <div className="field">
          <label htmlFor="exceedBehavior">When limit is exceeded:</label>
          <select
            id="exceedBehavior"
            name="exceedBehavior"
            value={settings.exceedBehavior}
            onChange={handleInputChange}
          >
            <option value="group">Move to group</option>
            <option value="prevent">Prevent creation</option>
          </select>
        </div>
      </div>

      {settings.exceedBehavior === 'group' && (
        <div className="section" id="groupSettings">
          <h2>Group Settings</h2>
          <div className="field">
            <label htmlFor="groupStrategy">Which tabs to move to group:</label>
            <select
              id="groupStrategy"
              name="groupStrategy"
              value={settings.groupStrategy}
              onChange={handleInputChange}
            >
              <option value="creation-asc">Oldest tabs first</option>
              <option value="creation-desc">Newest tabs first</option>
              <option value="recent-asc">Least recently used</option>
              <option value="recent-desc">Most recently used</option>
            </select>
            <div className="field-help">
              <strong>Oldest first:</strong> Tabs created earlier are moved to group first.<br />
              <strong>Newest first:</strong> Tabs created recently are moved to group first.<br />
              <strong>Least recently used:</strong> Tabs not used for a long time are moved first.<br />
              <strong>Most recently used:</strong> Tabs used recently are moved first.
            </div>
          </div>
          <div className="field">
            <label htmlFor="restoreStrategy">When tabs are below limit:</label>
            <select
              id="restoreStrategy"
              name="restoreStrategy"
              value={settings.restoreStrategy}
              onChange={handleInputChange}
            >
              <option value="none">Do nothing</option>
              <option value="restore">Restore tabs from group</option>
            </select>
            <div className="field-help">
              <strong>Do nothing:</strong> Tabs remain in the group even when below limit.<br />
              <strong>Restore:</strong> Automatically move tabs back from group.
            </div>
          </div>
          <div className="field">
            <label htmlFor="groupName">Group name:</label>
            <input
              type="text"
              id="groupName"
              name="groupName"
              value={settings.groupName}
              onChange={handleInputChange}
              maxLength={50}
            />
          </div>
        </div>
      )}

      <div className="actions">
        <button onClick={saveSettings}>Save Settings</button>
        <button onClick={resetSettings}>Reset to Default</button>
      </div>

      {status && <div id="status" className={`status ${status.type}`}>{status.message}</div>}
    </div>
  );
};

export default Options;