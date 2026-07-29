import Settings from "@/components/settings/Settings";
import React from 'react';

const SettingsPage = () => {
  return <Settings />;
};

// Memoize the component to prevent unnecessary re-renders
export default React.memo(SettingsPage);