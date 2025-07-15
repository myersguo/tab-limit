
// Define types for settings
export interface Settings {
  maxTabs: number;
  exceedBehavior: 'group' | 'prevent';
  groupStrategy: 'creation-asc' | 'creation-desc' | 'recent-asc' | 'recent-desc';
  restoreStrategy: 'none' | 'restore';
  groupName: string;
}

export const DEFAULT_SETTINGS: Settings = {
  maxTabs: 10,
  exceedBehavior: 'group',
  groupStrategy: 'recent-asc',
  restoreStrategy: 'restore',
  groupName: 'Others Group'
};
