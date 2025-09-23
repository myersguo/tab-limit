// Define types for settings
export interface Settings {
  maxTabs: number;
  exceedBehavior: 'group' | 'prevent';
  groupStrategy: 'creation-asc' | 'creation-desc' | 'recent-asc' | 'recent-desc';
  restoreStrategy: 'none' | 'restore';
  groupName: string;
  keepSingleUrl: boolean;
  tabsPerUrl: number;
  keepUrlHash: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  maxTabs: 20,
  exceedBehavior: 'prevent',
  groupStrategy: 'recent-asc',
  restoreStrategy: 'restore',
  groupName: 'Others Group',
  keepSingleUrl: true,
  tabsPerUrl: 2,
  keepUrlHash: true,
};
